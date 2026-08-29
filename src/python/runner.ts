import PyodideWorker from './pyodide.worker?worker';
import {
  CANCELLED,
  SIGINT,
  STDIN_CAPACITY,
  STDIN_HEADER_BYTES,
  STDIN_LENGTH,
  STDIN_STATE,
  STDIN_TOTAL_BYTES,
  type FromWorker,
} from './protocol';

export type RunnerState = 'booting' | 'idle' | 'running' | 'awaiting-input' | 'broken';

export interface RunnerEvents {
  onState(state: RunnerState): void;
  onOutput(text: string, stream: 'stdout' | 'stderr'): void;
  onFinished(status: 'ok' | 'error' | 'stopped', message?: string): void;
}

/** Cross-origin isolation gates SharedArrayBuffer; without it we lose graceful stop. */
export const isolated = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;

/**
 * Owns the Pyodide worker and the shared buffers that let us interrupt it.
 *
 * Two stop paths: a cooperative SIGINT via Pyodide's interrupt buffer, and a
 * hard worker terminate if that doesn't land. The hard path always works, so
 * Stop is never a lie -- it just costs a ~3s reboot of the interpreter.
 */
export class PythonRunner {
  private worker!: Worker;
  private state: RunnerState = 'booting';
  private interrupt: SharedArrayBuffer | null = null;
  private stdin: SharedArrayBuffer | null = null;
  private stdinI32: Int32Array | null = null;
  private killTimer: number | null = null;
  private encoder = new TextEncoder();

  constructor(private events: RunnerEvents) {
    if (isolated) {
      this.interrupt = new SharedArrayBuffer(1);
      this.stdin = new SharedArrayBuffer(STDIN_TOTAL_BYTES);
      this.stdinI32 = new Int32Array(this.stdin);
    }
    this.spawn();
  }

  private spawn() {
    this.worker = new PyodideWorker();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.setState('booting');
    this.worker.postMessage({ type: 'init', interrupt: this.interrupt, stdin: this.stdin });
  }

  private setState(state: RunnerState) {
    this.state = state;
    this.events.onState(state);
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case 'ready':
        this.setState('idle');
        break;
      case 'boot-error':
        this.events.onOutput(`Failed to start Python: ${msg.message}\n`, 'stderr');
        this.setState('broken');
        break;
      case 'out':
        this.events.onOutput(msg.text, msg.stream);
        break;
      case 'stdin-request':
        this.setState('awaiting-input');
        break;
      case 'done':
        this.clearKillTimer();
        this.setState('idle');
        this.events.onFinished(msg.status, msg.message);
        break;
    }
  }

  get currentState() {
    return this.state;
  }

  run(code: string) {
    if (this.state !== 'idle') return;
    this.setState('running');
    this.worker.postMessage({ type: 'run', code });
  }

  /** Hand a line to a program parked inside input(). */
  provideInput(line: string) {
    if (this.state !== 'awaiting-input' || !this.stdinI32 || !this.stdin) return;
    const bytes = this.encoder.encode(line).slice(0, STDIN_CAPACITY);
    new Uint8Array(this.stdin, STDIN_HEADER_BYTES, bytes.length).set(bytes);
    Atomics.store(this.stdinI32, STDIN_LENGTH, bytes.length);
    Atomics.store(this.stdinI32, STDIN_STATE, 1);
    Atomics.notify(this.stdinI32, STDIN_STATE);
    this.setState('running');
  }

  stop() {
    if (this.state !== 'running' && this.state !== 'awaiting-input') return;

    // Parked in Atomics.wait: the interrupt buffer is unreachable, so wake the
    // worker with a cancel sentinel and let it raise KeyboardInterrupt itself.
    if (this.state === 'awaiting-input' && this.stdinI32) {
      Atomics.store(this.stdinI32, STDIN_LENGTH, CANCELLED);
      Atomics.store(this.stdinI32, STDIN_STATE, 1);
      Atomics.notify(this.stdinI32, STDIN_STATE);
      return;
    }

    if (this.interrupt) {
      new Uint8Array(this.interrupt)[0] = SIGINT;
      // Tight loops in C extensions never check the interrupt flag, so promise
      // nothing and fall back to the hammer if SIGINT hasn't landed shortly.
      this.killTimer = self.setTimeout(() => this.hardReset(), 1500);
    } else {
      this.hardReset();
    }
  }

  private hardReset() {
    this.clearKillTimer();
    this.worker.terminate();
    this.events.onOutput('\n[stopped -- restarting Python]\n', 'stderr');
    this.events.onFinished('stopped');
    this.spawn();
  }

  private clearKillTimer() {
    if (this.killTimer !== null) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }
}
