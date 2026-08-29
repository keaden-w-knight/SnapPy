import type { BackendEvents, PythonBackend } from './backend';
import { PyodideBackend } from './pyodide-backend';

/** Tauri v2 injects this before any app code runs. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Desktop builds prefer the user's real CPython -- native speed, the whole
 * standard library, real files, and any pip package including C extensions.
 * Everything else (and any desktop machine without Python) falls back to
 * Pyodide, which behaves identically from the UI's point of view.
 */
export async function createBackend(events: BackendEvents): Promise<PythonBackend> {
  if (isTauri) {
    // Imported lazily so the browser bundle never pulls in the Tauri plugin.
    const { detectNative } = await import('./native-backend');
    const native = await detectNative(events);
    if (native) return native;
  }
  return new PyodideBackend(events);
}
