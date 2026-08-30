/** Messages exchanged between the UI thread and the Pyodide worker. */

export type ToWorker =
  | { type: 'init'; interrupt: SharedArrayBuffer | null; stdin: SharedArrayBuffer | null }
  | { type: 'run'; code: string };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'boot-error'; message: string }
  | { type: 'out'; text: string; stream: 'stdout' | 'stderr' }
  | { type: 'stdin-request' }
  /** One turtle drawing operation; see src/python/turtle-shim.ts. */
  | { type: 'draw'; op: string; args: unknown[] }
  | { type: 'done'; status: 'ok' | 'error' | 'stopped'; message?: string };

/**
 * Layout of the stdin SharedArrayBuffer.
 *
 * [0] (Int32) state -- 0 = worker is waiting, 1 = a line is ready to read
 * [1] (Int32) byteLength of the payload, or CANCELLED to abort the read
 * [8..] UTF-8 bytes of the line the user typed
 *
 * The worker parks on Atomics.wait(state, 0) so that Python's input() blocks
 * exactly like it does natively, without freezing the UI thread.
 */
export const STDIN_STATE = 0;
export const STDIN_LENGTH = 1;
export const STDIN_HEADER_BYTES = 8;
export const STDIN_CAPACITY = 8192;
export const STDIN_TOTAL_BYTES = STDIN_HEADER_BYTES + STDIN_CAPACITY;

/** Written into STDIN_LENGTH to wake a waiting worker and raise KeyboardInterrupt. */
export const CANCELLED = -1;

/** Value Pyodide's interrupt buffer treats as SIGINT. */
export const SIGINT = 2;
