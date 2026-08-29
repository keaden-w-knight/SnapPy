import { defineConfig } from 'vite';

// SharedArrayBuffer -- which we need both to interrupt a runaway loop and to make
// input() block correctly -- is only exposed to cross-origin-isolated pages.
// That requires these two headers on every response, in dev and in production.
// If you deploy somewhere that cannot set them, the app still runs: Stop falls
// back to terminating the worker, and input() falls back to a blocking prompt.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // Pyodide is loaded at runtime from /pyodide/ (see scripts/copy-pyodide.mjs),
  // never bundled -- it resolves its own .wasm and .zip relative to indexURL.
  optimizeDeps: { exclude: ['pyodide'] },
});
