import { Command, type Child } from '@tauri-apps/plugin-shell';
import type { BackendEvents, InputMode, PythonBackend, RunnerState } from './backend';
import { cleanTraceback, normalizeNewlines } from './traceback';

/**
 * Candidate launchers, in preference order. Each must also be declared in
 * src-tauri/capabilities/default.json -- Tauri's shell scope is an allow-list,
 * so a name missing there fails at runtime rather than compile time.
 */
const CANDIDATES = ['python', 'python3', 'py'] as const;

const decoder = new TextDecoder();

/** Probe a launcher by asking it to print its version. */
async function probe(name: string): Promise<string | null> {
  try {
    const result = await Command.create(name, [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]).execute();
    if (result.code !== 0) return null;
    const version = result.stdout.trim();
    return /^\d+\.\d+/.test(version) ? version : null;
  } catch {
    return null; // Not installed, or not permitted by the shell scope.
  }
}

/** Returns a usable backend, or null if no local Python could be found. */
export async function detectNative(events: BackendEvents): Promise<NativeBackend | null> {
  for (const name of CANDIDATES) {
    const version = await probe(name);
    if (version) return new NativeBackend(events, name, version);
  }
  return null;
}

/**
 * Runs the generated program with the user's own CPython.
 *
 * Uses `-u -c <code>`: unbuffered so output streams as it happens, and `-c` so
 * the source arrives as an argument -- which leaves stdin free for input().
 * (Passing source on stdin would consume the pipe the program needs to read.)
 */
export class NativeBackend implements PythonBackend {
  readonly inputMode: InputMode = 'always';
  readonly label: string;

  private currentState: RunnerState = 'idle';
  private child: Child | null = null;
  private stopping = false;
  private stderrBuffer = '';

  constructor(
    private events: BackendEvents,
    private command: string,
    version: string,
  ) {
    this.label = `CPython ${version} (local)`;
  }

  get state(): RunnerState {
    return this.currentState;
  }

  private setState(state: RunnerState) {
    this.currentState = state;
    this.events.onState(state);
  }

  async run(code: string) {
    if (this.currentState !== 'idle') return;
    this.setState('running');
    this.stopping = false;
    this.stderrBuffer = '';

    // `encoding: 'raw'` matters: the default splits output into lines and strips
    // the newline, which would hold back an input() prompt until something else
    // emitted a newline -- showing the question only after it was needed.
    const cmd = Command.create(this.command, ['-u', '-c', code], { encoding: 'raw' });

    cmd.stdout.on('data', (bytes: Uint8Array) => {
      this.events.onOutput(normalizeNewlines(decoder.decode(bytes)), 'stdout');
    });

    // stderr is buffered rather than streamed so a traceback can be tidied as a
    // whole; anything that isn't a traceback is flushed when the process exits.
    cmd.stderr.on('data', (bytes: Uint8Array) => {
      this.stderrBuffer += normalizeNewlines(decoder.decode(bytes));
    });

    cmd.on('close', ({ code: exitCode }: { code: number | null }) => {
      this.child = null;
      this.setState('idle');

      if (this.stopping) {
        this.events.onFinished('stopped');
      } else if (exitCode === 0) {
        this.events.onFinished('ok');
      } else {
        this.events.onFinished('error', cleanTraceback(this.stderrBuffer));
      }
    });

    cmd.on('error', (message: string) => {
      this.child = null;
      this.setState('idle');
      this.events.onFinished('error', `Could not start ${this.command}: ${message}`);
    });

    try {
      this.child = await cmd.spawn();
    } catch (err) {
      this.child = null;
      this.setState('idle');
      this.events.onFinished('error', err instanceof Error ? err.message : String(err));
    }
  }

  provideInput(line: string) {
    // A real pipe: there is no way to know the child is blocked on a read, so
    // anything typed is written straight through, as a terminal would.
    void this.child?.write(`${line}\n`);
  }

  stop() {
    if (!this.child) return;
    this.stopping = true;
    void this.child.kill();
  }

  dispose() {
    void this.child?.kill();
    this.child = null;
  }
}
