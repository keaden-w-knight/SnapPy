export type RunnerState = 'booting' | 'idle' | 'running' | 'awaiting-input' | 'broken';

export interface BackendEvents {
  onState(state: RunnerState): void;
  onOutput(text: string, stream: 'stdout' | 'stderr'): void;
  onFinished(status: 'ok' | 'error' | 'stopped', message?: string): void;
  /** Turtle drawing. Only the Pyodide backend can produce these. */
  onDraw?(op: string, args: unknown[]): void;
}

/**
 * How the console should offer an input box.
 *
 * `on-demand` -- the backend can tell us the program is parked in input()
 *               (Pyodide, via the shared stdin buffer).
 * `always`    -- a real pipe to a real process: nobody can tell when the child
 *               is blocked on a read, so the box stays open for the whole run,
 *               exactly like a terminal.
 */
export type InputMode = 'on-demand' | 'always';

export interface PythonBackend {
  /** Human-readable, shown in the status bar, e.g. "CPython 3.13 (local)". */
  readonly label: string;
  readonly inputMode: InputMode;
  readonly state: RunnerState;
  run(code: string): void;
  provideInput(line: string): void;
  stop(): void;
  dispose(): void;
}
