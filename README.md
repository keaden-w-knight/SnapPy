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

## Five constraints worth knowing before you change anything

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

**4. Pyodide is served raw, and its import is built at runtime.**
Raw, because `pyodide.mjs` performs a dozen dynamic imports of its own (its
`asm.js` payload, plus `node:fs` and friends on the Node path). Letting a bundler
transform it rewrites those and breaks it, so it is served untouched from
`public/` and Vite must never treat it as source.

Built at runtime, because Vite rewrites every `import()` it can see: in dev it
wraps the specifier in `injectQuery`, appending `?import`, which routes the
request into the transform pipeline -- where a file under `public/` is rejected
outright ("should not be imported from source code"). Neither `@vite-ignore` nor
an opaque specifier variable avoids that rewrite, and `importScripts` is not an
escape either, because Vite's dev server always creates module workers
regardless of `worker.format`. So the worker does:

```ts
const importModule = new Function('url', 'return import(url)');
```

which is the one form Vite cannot see. The cost is a CSP `unsafe-eval` that
Pyodide's own `pyodide.asm.js` already required.

This one shipped broken: the dynamic-import version passed a production build
and failed only in dev, because nothing exercised a running page. `npm run
test:browser` exists because of it.

**5. Never let output be delivered line by line.**
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

## Functions

The Functions category replaces Blockly's built-in `PROCEDURE` flyout, which
lists one call block per defined function -- a palette that grows without bound.
Instead there are two call blocks that pick their target from a dropdown of
whatever is currently defined:

| Block | Shape | Generates |
| --- | --- | --- |
| `run [name]` | statement | `greet()` on its own line |
| `result of [name]` | oval | `answer()` inside an operator or any value input |

Both list every function, with or without a `return`. A function that returns
nothing still calls fine in an expression -- it yields `None` -- so filtering the
oval block down to return-functions would hide functions for no real gain.

Argument sockets follow the chosen function: picking a different name, or editing
a definition's parameters, rebuilds them. Connections are carried across by
parameter name, so renaming one parameter does not detach values plugged into the
others. A call whose function has been deleted keeps its name and shows a warning
rather than silently retargeting itself.

The menu reads `select a function` when nothing has been picked, and
`define a function first` when there is nothing to pick -- the latter being the
only entry, and choosing it a no-op.

Blockly's stock `FieldDropdown` fights all of this in three ways, so
`FunctionNameField` overrides each:

- It **rejects any value absent from the current option list** and falls back to
  the first option. The list is empty while a call block is deserialised ahead of
  its definition, so a chosen function silently reverted to the placeholder.
  Here the stored name is authoritative and a dangling one becomes a warning.
- It **caches the generated option list**, first built inside the field
  constructor before the field has a source block -- so it cached "no functions"
  and served that forever. The cache is bypassed.
- It **caches the display label** in `selectedOption_` when the value is set,
  which likewise froze at the placeholder. The label is derived from the live
  options instead.

## Why a global appears inside every function

Blockly's Python generator emits `global a, b` at the top of a function for every
workspace variable that is not one of that function's parameters -- with no check
on whether the body mentions them. Define any global anywhere and its name shows
up inside every function, reading as though the function uses it.

Names the body never references are now narrowed away. A `global` for a variable
that is only read is a no-op, and one for a variable that is never touched is
pure noise, so dropping them cannot change behaviour; a variable the function
actually assigns keeps its declaration.

Separately, Blockly hoists `name = None` for every variable the workspace uses.
That is deliberate -- it stops a read-before-assign becoming a `NameError` -- so
it stays, except for names Python already binds for you:

- **function parameters**, which are local by definition, and
- **`for` loop targets**, which the loop assigns before the body runs (this only
  applies to Blockly's stock loops; SnapPy's own loops never make a workspace
  variable in the first place).

A name is only dropped when *every* block using it sits inside the thing that
binds it. Read a loop variable after the loop and the declaration comes back,
because an empty list means the body never ran.

## Loop variables are ovals, not dropdowns

Blockly's `controls_for`/`controls_forEach` name their target with a
`field_variable`, which forces the loop variable to be a *workspace* variable: it
joins every variable dropdown in the project and clutters the Variables palette,
even though `for i in ...` binds `i` locally.

`snappy_for_each` and `snappy_for_range` instead keep the name in a
`snappy_local_get` block plugged into a `VAR` socket. Drag it out and you have a
reference to use in the body; the loop grows a fresh one in its place, so it
reads as taking a copy rather than removing something. `make (name) = (value)`
uses the same socket for the same reason. Nothing touches the variable list.

Two Blockly details make this work:

- **Shadow blocks are not draggable.** Blockly's usual way to put a default child
  in a socket is a shadow, but it never converts one to a real block on drag, so
  the socket holds a real block and refills itself when emptied.
- **`onchange` on a block definition is not enough.** Blockly wires `onchange` up
  to the workspace in `doInit_`, which runs *before* JSON extensions are applied
  -- a mixin's handler lands on the instance but is never registered, and
  silently never fires. `installVarSlot` calls `setOnChange` explicitly.

`count with` treats `to` as inclusive, matching the other blocks rather than
Python's half-open `range`, and folds literals so the common case reads
`range(1, 11)` rather than `range(1, 10 + 1)`.

A loose oval left on the canvas still generates a line of code, the same as any
other unattached block -- this app treats everything on the workspace as program
text.

## Variables: global and local

Blockly's variables are all workspace-global -- a throwaway counter inside one
function joins every variable dropdown in the project. The Variables category
keeps Blockly's own blocks and adds two that lean on Python's scoping instead:

| Block | Shape | Generates |
| --- | --- | --- |
| `make [name] = [value]` | statement | `counter = 0` |
| `[name]` | oval | `counter` |

The name is typed into the block rather than chosen from a dropdown, so it never
enters the global palette. An assignment inside a function is a local in Python,
which is exactly the scoping these blocks inherit -- `make counter = 0` in a
function body belongs to that function.

The trade-off is that nothing checks the spelling: a typo in the getter is a
`NameError` at runtime. The error highlighter below points straight at it.

Blockly's own variable dropdown keeps **Rename variable...** but no longer offers
**Delete the 'x' variable**: it removes every block using the variable in one
click, behind a confirmation that is easy to dismiss by reflex.

Rename goes through an in-app dialog rather than `window.prompt`. WebView2 --
what the Tauri desktop build renders in -- does not implement `window.prompt` at
all, so Blockly's default silently did nothing there: the menu item fired, no
prompt appeared, and the callback never ran. `src/ui/dialogs.ts` replaces
`prompt`, `alert` and `confirm` through `Blockly.dialog.set*`.

Typed names are coerced to legal Python identifiers as you type (`my var!`
becomes `my_var_`, `class` becomes `class_`), so the block always displays
exactly the name it will generate.

## Errors point at the block

When a program fails, the block that caused it is outlined in red and scrolled
into view. Blockly has no source map, so this is built from `STATEMENT_PREFIX`:
generation runs a second time with a marker comment carrying each block's id
before every statement, and stripping those markers must reproduce the real
program *exactly*. That equality is the correctness check -- if the two passes
disagree for any reason, the map is thrown away and nothing is highlighted,
rather than blaming the wrong block.

The markers only exist in the throwaway second pass, so the code pane and the
interpreter both see clean output. The map is built per run rather than per edit,
since it costs a full extra generation and is only needed once something failed.

Both backends are covered: Pyodide tracebacks name the module `<exec>` and
CPython's `-c` names it `<string>`, and the deepest frame in either is the one
that gets blamed.

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
round-trip and error paths.

`npm run test:browser` drives an installed Chromium browser over CDP, with no
extra dependencies (Node 22 has a global `WebSocket`). It covers what unit tests
cannot: that the page is cross-origin isolated, that Pyodide boots, that a
program runs, that `input()` blocks and resumes with its prompt flushed before
the read, that Stop interrupts a runaway loop and the interpreter survives it,
that the Functions flyout and both call blocks work, and that a failing program
highlights the block that caused it. Set `SNAPPY_BROWSER` if the browser is not
found automatically.

The harness shims `requestAnimationFrame` with `setTimeout`. Headless Chrome
never paints, so rAF callbacks never run -- and Blockly flushes its event queue
from rAF, so without the shim no change listener in the app ever fires and every
event-driven behaviour looks broken when it is merely unobserved. That cost real
time to diagnose twice.

A Pyodide loading regression that passed a production build but broke the dev
server shipped once because nothing exercised a running page. Hence the above.

The Tauri backends are still not covered; they need a built desktop app.

## Layout

```
src/blocks/locale.ts           Installs Blockly.Msg -- import before any block exists
src/blocks/theme.ts            Scratch palette, Zelos styling
src/blocks/blocks.ts           Custom blocks + Python generators, restyle pass
src/blocks/functions.ts        Dropdown call blocks, Functions flyout, hoisting fix
src/blocks/variables.ts        Local-variable blocks + the Variables flyout
src/blocks/loops.ts            Loops whose variable is a draggable oval
src/blocks/names.ts            Identifier rules + the refilling name socket
src/blocks/sourcemap.ts        Generated line -> block id, for error highlighting
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
src/ui/                        Console, code pane, error highlight, dialogs
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
