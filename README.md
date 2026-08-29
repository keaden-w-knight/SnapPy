# SnapPy

Drag-and-drop blocks that translate directly to Python, with the generated code
and a live interpreter in the same window. Runs in the browser, and as a desktop
app where it can drive your real local CPython instead.

```bash
npm install     # also copies Pyodide + Blockly media into public/
npm run dev     # http://localhost:5173
npm test        # headless: code generation + project format
npm run desktop # Tauri desktop app (needs Rust -- see below)
```

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Blocks | **Blockly 11**, `zelos` renderer | Zelos *is* the Scratch block shape, and Blockly ships a maintained Python generator. |
| Look | Scratch's palette + Helvetica Neue bold | See `src/blocks/theme.ts`. |
| Python (web) | **Pyodide 0.26** (real CPython 3.12 on WASM) | Not a lookalike interpreter; `import random`, `time`, etc. all work. |
| Python (desktop) | The user's own CPython, via Tauri | Native speed, real files, any pip package including C extensions. |
| Code view | CodeMirror 6, read-only | Blocks are the single source of truth. |
| Shell | Tauri 2 | Small installers, uses the OS webview. |

Deliberately **not** `scratch-blocks`: it is the Scratch team's fork of a
2016-era Blockly, has no Python generator, and would strand the project off the
maintained path. Zelos gets the same look on current Blockly.

## Two interchangeable Python backends

Both implement `PythonBackend` (`src/python/backend.ts`), so the UI does not care
which is running. `src/python/select.ts` picks one at startup: desktop builds
prefer local CPython and fall back to Pyodide if none is installed.

|  | Pyodide | Native |
| --- | --- | --- |
| Where | Browser and desktop | Desktop only |
| Stop | SIGINT via interrupt buffer, else terminate worker | Kill the process |
| `input()` | Backend signals each read (`on-demand`) | Console input stays open all run (`always`) |
| Traceback frame | `File "<exec>"` | `File "<string>"` |

The `input()` difference is not cosmetic. Pyodide can tell us precisely when the
program is parked on a read; a real pipe cannot, because nothing announces that a
child process is blocked. So the native backend leaves the input box open for the
whole run, exactly like a terminal.

## Four constraints worth knowing before you change anything

**1. Pyodide runs in a Web Worker, and it has to.**
On the main thread it freezes the UI and -- worse -- makes Stop impossible: a
student's `forever` loop would lock the tab with no escape.

**2. Cross-origin isolation is a hosting requirement, not a nicety.**
`SharedArrayBuffer` is only exposed to cross-origin-isolated pages, so every
response needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite sets these in dev and preview (`vite.config.ts`), and Tauri sets them via
`app.security.headers`. **Your production web host must set them too.** Netlify
and Cloudflare Pages can; GitHub Pages cannot. Without them the app still loads,
but Stop degrades to rebooting the interpreter (~3s) and `input()` stops working
-- the app detects this and says so in the console.

It is also why Pyodide is copied into `public/` rather than loaded from a CDN:
under `require-corp`, same-origin is the path of least resistance.

**3. `input()` blocks, which is the whole reason for the shared buffer.**
Pyodide's stdin hook must return synchronously. The worker parks on
`Atomics.wait` until the UI thread drops a line into the stdin buffer. Pressing
Stop while parked cannot be seen by the interrupt buffer, so the UI writes a
cancel sentinel to wake the worker and let it raise `KeyboardInterrupt` itself.

**4. Never let output be delivered line by line.**
`input()` writes its prompt *without* a trailing newline, so any line-batching
output hook holds the question back until after the read -- showing it too late.
Both backends therefore take raw bytes: Pyodide via `setStdout({ write })` rather
than `batched`, and Tauri via `Command.create(..., { encoding: 'raw' })` rather
than its default line events.

## Stopping a program

Pyodide has two paths:

1. **Cooperative** -- set SIGINT in Pyodide's interrupt buffer. Clean, keeps the
   interpreter warm.
2. **Hard** -- if SIGINT has not landed in 1.5s (a tight loop inside a C
   extension never checks the flag), terminate the worker and respawn.

Stop is therefore never a lie; it just sometimes costs an interpreter reboot.
The native backend simply kills the child process.

A related sharp edge: an interrupt that arrives while Pyodide is still
*compiling* escapes through its asyncio webloop rather than the awaited promise,
so the worker also listens for `unhandledrejection`. Without that the run never
reports completion.

## Projects

Saved as `.snappy` -- JSON with a `format`/`version` header, so old files keep
loading and files from a future version are refused loudly rather than silently
losing blocks. `src/project/storage.ts` picks the best available strategy:

| Environment | Open | Save |
| --- | --- | --- |
| Desktop (Tauri) | Native dialog | Writes back to the same path |
| Chrome / Edge | File System Access API | Writes back to the same handle |
| Firefox / Safari | `<input type=file>` | Download (Save behaves as Save As) |

Separately, the workspace autosaves to `localStorage` under
`snappy.workspace.v1` on every edit, so a closed tab does not lose work. That is
a crash net, not a project store -- the dot beside the project name marks unsaved
changes, and Ctrl/Cmd+S and Ctrl/Cmd+O are wired up.

## Desktop build

Needs the Rust toolchain (https://rustup.rs) plus a platform webview: WebView2 on
Windows, `webkit2gtk` on Linux, nothing extra on macOS.

```bash
npm run desktop        # dev, with hot reload from Vite
npm run desktop:build  # installers in src-tauri/target/release/bundle/
```

`src-tauri/capabilities/default.json` allows launching `python`, `python3` and
`py` with arbitrary arguments. Argument validation would be security theatre
here -- the whole purpose of the app is to run Python the user authored -- so the
meaningful boundary is the command allow-list: nothing but a Python interpreter
can be launched. File access is scoped to the user's own folders.

Placeholder icons are generated by `npm run icons` (no image dependencies, just
`zlib`). Replace them with `npx tauri icon <artwork.png>` when there is real
branding; that also produces the `.icns` that macOS needs.

## Testing

`npm test` bundles each `tests/*.test.mts` and runs it in Node. It covers block
to Python generation -- including that every generated program is accepted by a
real local interpreter via `ast.parse` -- and the project file format, both
round-trip and error paths. Drag and drop and the Tauri backends are not covered;
they need a browser and a built desktop app respectively.

## Layout

```
src/blocks/locale.ts           Installs Blockly.Msg -- import before any block exists
src/blocks/theme.ts            Scratch palette, Zelos styling
src/blocks/blocks.ts           Custom blocks + Python generators, restyle pass
src/blocks/toolbox.ts          Palette contents and category order
src/python/backend.ts          The interface both engines implement
src/python/select.ts           Chooses native or Pyodide at startup
src/python/pyodide-backend.ts  Owns the worker, interrupt buffer, stop logic
src/python/native-backend.ts   Drives local CPython through Tauri's shell plugin
src/python/pyodide.worker.ts   stdout/stdin hooks, interrupt, traceback tidying
src/python/protocol.ts         Worker messages + shared-buffer layout
src/python/traceback.ts        Strips harness frames from both engines
src/project/format.ts          .snappy schema, parse/serialize
src/project/storage.ts         Tauri / File System Access / download strategies
src/ui/                        Console and read-only code pane
src-tauri/                     Rust shell, config, capabilities, icons
```

`locale.ts` exists because importing `blockly/core` + `blockly/blocks` (rather
than the umbrella `blockly` entry) skips the message bundle the built-in blocks
reference -- every stock block throws on instantiation without it.

## Known trade-offs

- **Code is read-only.** Blocks to Python is one-way. Round-tripping means a real
  Python parser and only covers the subset the blocks express; that is a v2
  decision, not an accident.
- **First web load pulls ~14 MB** of Pyodide. Cached afterwards.
- **Desktop builds still bundle Pyodide** even when local Python is found, since
  it is the fallback. Worth excluding from desktop builds if size matters.
- **~1 MB of JS** (~308 KB gzipped), nearly all Blockly.
