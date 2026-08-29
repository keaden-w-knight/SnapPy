/// <reference lib="webworker" />
import {
  CANCELLED,
  STDIN_HEADER_BYTES,
  STDIN_LENGTH,
  STDIN_STATE,
  type FromWorker,
  type ToWorker,
} from './protocol';
import { cleanTraceback } from './traceback';

// Pyodide is fetched at runtime from /pyodide/ rather than bundled. @vite-ignore
// stops Vite from trying to resolve this at build time.
type Pyodide = Awaited<ReturnType<typeof import('pyodide').loadPyodide>>;

let pyodide: Pyodide | null = null;
let stdinBuffer: SharedArrayBuffer | null = null;
let stdinI32: Int32Array | null = null;
let interruptView: Uint8Array | null = null;

const decoder = new TextDecoder();
const post = (msg: FromWorker) => self.postMessage(msg);

/**
 * Synchronous stdin. Pyodide requires this to block, which is only legal off the
 * main thread -- hence the whole worker architecture. We park on Atomics.wait
 * until the UI thread drops a line into the shared buffer.
 */
function readLine(): string | null {
  if (!stdinI32 || !stdinBuffer) return null; // No SAB -> report EOF.

  Atomics.store(stdinI32, STDIN_STATE, 0);
  post({ type: 'stdin-request' });
  Atomics.wait(stdinI32, STDIN_STATE, 0);

  const length = Atomics.load(stdinI32, STDIN_LENGTH);
  if (length === CANCELLED) {
    // Stop was pressed while we were parked. The interrupt buffer can't be
    // polled from inside Atomics.wait, so the UI wakes us and we raise here.
    throw new Error('KeyboardInterrupt');
  }
  const bytes = new Uint8Array(stdinBuffer, STDIN_HEADER_BYTES, length).slice();
  return decoder.decode(bytes) + '\n';
}

// Held in a variable so TypeScript treats the import as dynamic rather than
// trying to resolve a path that only exists at runtime, under public/.
const PYODIDE_URL = '/pyodide/pyodide.mjs';

async function boot(msg: Extract<ToWorker, { type: 'init' }>) {
  const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_URL)) as typeof import('pyodide');

  const py = await loadPyodide({ indexURL: '/pyodide/' });
  pyodide = py;

  // Raw byte-level hooks rather than `batched`, because input()'s prompt is
  // written without a trailing newline and a line-batched writer would hold it
  // back until after the read -- showing the prompt only once it was too late.
  py.setStdout({ isatty: false, write: (buf: Uint8Array) => {
    post({ type: 'out', text: decoder.decode(buf), stream: 'stdout' });
    return buf.length;
  } });
  py.setStderr({ isatty: false, write: (buf: Uint8Array) => {
    post({ type: 'out', text: decoder.decode(buf), stream: 'stderr' });
    return buf.length;
  } });
  py.setStdin({ isatty: false, stdin: readLine });

  if (msg.stdin) {
    stdinBuffer = msg.stdin;
    stdinI32 = new Int32Array(msg.stdin);
  }
  if (msg.interrupt) {
    interruptView = new Uint8Array(msg.interrupt);
    py.setInterruptBuffer(interruptView);
  }

  post({ type: 'ready' });
}

/** Guards against reporting a second `done` for a run that already finished. */
let running = false;

function finish(status: 'ok' | 'error' | 'stopped', message?: string) {
  if (!running) return;
  running = false;
  post({ type: 'done', status, message });
}

function classify(err: unknown): { status: 'error' | 'stopped'; message?: string } {
  const message = err instanceof Error ? err.message : String(err);
  // Pyodide tags PythonError with the Python exception name; fall back to the
  // traceback text for errors raised by our own stdin cancellation path.
  const type = (err as { type?: string } | null)?.type;
  if (type === 'KeyboardInterrupt' || message.includes('KeyboardInterrupt')) {
    return { status: 'stopped' };
  }
  return { status: 'error', message: cleanTraceback(message) };
}

async function run(code: string) {
  const py = pyodide;
  if (!py) return;
  interruptView?.fill(0); // Clear any SIGINT left over from a previous run.
  running = true;

  try {
    await py.runPythonAsync(code);
    finish('ok');
  } catch (err) {
    const { status, message } = classify(err);
    finish(status, message);
  }
}

// An interrupt that lands while Pyodide is still compiling the source escapes
// through its asyncio webloop instead of the promise we awaited above, so the
// try/catch never sees it. Without this the run would never report completion
// and the UI would sit on "Running" until the runner's kill timer fired.
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  if (!running) return;
  event.preventDefault();
  const { status, message } = classify(event.reason);
  finish(status, message);
});

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') await boot(msg);
    else if (msg.type === 'run') await run(msg.code);
  } catch (err) {
    post({ type: 'boot-error', message: err instanceof Error ? err.message : String(err) });
  }
};
