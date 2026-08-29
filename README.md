# SnapPy

Drag-and-drop blocks that translate directly to Python, with the generated code
and a live interpreter in the same window. Runs in the browser.

```bash
npm install     # also copies Pyodide + Blockly media into public/
npm run dev     # http://localhost:5173
```

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Blocks | **Blockly 11**, `zelos` renderer | Zelos *is* the Scratch block shape, and Blockly ships a maintained Python generator. |
| Look | Scratch's palette + Helvetica Neue bold | See `src/blocks/theme.ts`. |
| Python | **Pyodide 0.26** (real CPython 3.12 on WASM) | Not a lookalike interpreter; `import random`, `time`, etc. all work. |
| Code view | CodeMirror 6, read-only | Blocks are the single source of truth. |
| Build | Vite + TypeScript | — |

Deliberately **not** `scratch-blocks`: it is the Scratch team's fork of a
2016-era Blockly, has no Python generator, and would strand the project off the
maintained path. Zelos gets the same look on current Blockly.

## Three constraints worth knowing before you change anything

**1. Python runs in a Web Worker, and it has to.**
Pyodide on the main thread freezes the UI and — worse — makes Stop impossible: a
student's `forever` loop would lock the tab with no escape. `src/python/runner.ts`
owns the worker and two `SharedArrayBuffer`s.

**2. Cross-origin isolation is a hosting requirement, not a nicety.**
`SharedArrayBuffer` is only exposed to cross-origin-isolated pages, so every
response needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite sets these in dev and preview (`vite.config.ts`); **your production host must
set them too.** Without them the app still loads, but Stop degrades to terminating
and rebooting the interpreter (~3s) and `input()` stops working. The app detects
this and says so in the console.

This is also why Pyodide is copied into `public/` rather than loaded from a CDN —
under `require-corp`, same-origin is the path of least resistance.

**3. `input()` blocks, which is the whole reason for the shared buffer.**
Pyodide's stdin hook must return synchronously. The worker parks on
`Atomics.wait` until the UI thread drops a line into the stdin buffer. Pressing
Stop while parked can't be seen by the interrupt buffer, so the UI writes a
cancel sentinel to wake the worker and let it raise `KeyboardInterrupt` itself.

## Stopping a program: two paths

1. **Cooperative** — set SIGINT in Pyodide's interrupt buffer. Clean, keeps the
   interpreter warm.
2. **Hard** — if SIGINT hasn't landed in 1.5s (a tight loop inside a C extension
   never checks the flag), terminate the worker and respawn.

Stop is therefore never a lie; it just sometimes costs an interpreter reboot.

A related sharp edge: an interrupt that arrives while Pyodide is still *compiling*
escapes through its asyncio webloop rather than the awaited promise, so the worker
also listens for `unhandledrejection`. Without that the run never reports
completion.

## Layout

```
src/blocks/locale.ts   Installs Blockly.Msg -- must import before any block exists
src/blocks/theme.ts    Scratch palette, Zelos styling
src/blocks/blocks.ts   Custom blocks + Python generators, restyle pass
src/blocks/toolbox.ts  Palette contents and category order
src/python/protocol.ts Worker message types + shared-buffer layout
src/python/*.worker.ts Pyodide host: stdout/stdin hooks, interrupt, tracebacks
src/python/runner.ts   Main-thread owner of the worker and stop logic
src/ui/                Console and read-only code pane
```

`locale.ts` exists because importing `blockly/core` + `blockly/blocks` (rather
than the umbrella `blockly` entry) skips the message bundle the built-in blocks
reference — every stock block throws on instantiation without it.

## Known trade-offs

- **Code is read-only.** Blocks → Python is one-way. Round-tripping means a real
  Python parser and only covers the subset the blocks express; that's a v2
  decision, not an accident.
- **First load pulls ~14 MB** of Pyodide. Cached afterwards.
- **~1 MB of JS** (300 KB gzipped), nearly all Blockly.

## Roadmap sketch

- Package with Tauri and swap the backend to the user's real local CPython —
  same UI, same blocks, native speed and full pip.
- Save/load projects as files; the workspace currently autosaves to
  `localStorage` under `snappy.workspace.v1`.
