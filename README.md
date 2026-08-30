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

Blockly's own `procedures_*` blocks model every parameter as a workspace
variable, so declaring `do_something(param1)` put `param1` in every variable
dropdown in the project. `snappy_function_def` replaces them:

```
to (greet) (who) +          <- "who" is a draggable oval; + adds an input
do  say (who)
```

A parameter is a name block sitting in the definition's socket. Drag it into the
body to use it and the definition grows a fresh one in its place, so a parameter
is never lost by being used. Nothing touches the variable list.

Parameters have a **shape**, chosen when you press `+`:

| Kind | Shape | Fits |
| --- | --- | --- |
| value | oval | any value socket |
| true / false | hexagon | boolean sockets, like `if`'s condition |

Zelos draws a `Boolean` output as a hexagon, so the call block's matching
argument socket takes the same shape and what fits where is visible rather than
something to remember. Inputs are removed from the block's context menu.

There is one definition block rather than Blockly's separate with/without return
pair, because Python draws no such distinction: `return` is a statement, and a
function without one yields `None`.

| Block | Shape | Generates |
| --- | --- | --- |
| `run [name]` | statement | `greet()` on its own line |
| `result of [name]` | oval | `answer()` inside an operator or any value input |
| `return [value]` | statement | `return 42` |

Both call blocks list every function and pick their target from a dropdown, so
the palette stays one block per shape however many functions exist. The menu
reads `select a function` when nothing has been picked, and `define a function
first` when there is nothing to pick -- the latter being the only entry, and
choosing it a no-op.

Argument sockets follow the chosen function: picking a different name, or
renaming a parameter oval, rebuilds them. Connections are carried across by
parameter name, so renaming one input does not detach values plugged into the
others. A call whose function has been deleted keeps its name and shows a
warning rather than silently retargeting itself.

Blockly's stock `FieldDropdown` fights that in three ways, so `FunctionNameField`
overrides each:

- It **rejects any value absent from the current option list** and falls back to
  the first option. The list is empty while a call block is deserialised ahead of
  its definition, so a chosen function silently reverted to the placeholder.
- It **caches the generated option list**, first built inside the field
  constructor before the field has a source block -- so it cached "no functions"
  and served that forever.
- It **caches the display label** in `selectedOption_` when the value is set,
  which froze at the placeholder for the same reason.

Only variables a function body *assigns* get a `global` declaration; reading one
already finds the module-level value. Blockly's own procedure blocks declared
every workspace variable regardless, which is where stray `global x` lines came
from.

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
click, behind a confirmation that is easy to dismiss by reflex. In its place the
Variables palette has a **Remove unused variables** button, which only clears
names no block references -- safe to press without reading carefully, which the
per-variable delete never was.

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

## Modules: turtle

The **Modules** category at the bottom of the palette switches libraries on. Only
`turtle` so far; adding it appends a Turtle category and reveals the Stage pane.
Which modules a project uses is saved with it.

The blocks generate ordinary code -- `import turtle`, `turtle.forward(100)` --
so what the code pane shows is what a learner would type outside the app.

**Pyodide has no tkinter**, so real `turtle` cannot run in the browser at all.
`src/python/turtle-shim.ts` installs a stand-in under the same name: it keeps the
same coordinate system (origin in the middle, y upwards, angles
counter-clockwise from east), computes the geometry in Python, and posts plain
line and dot operations out to a canvas. Only the subset the blocks need is
implemented -- no screens, no multiple turtles, no event loop -- though `done()`
and `mainloop()` exist as no-ops because every tutorial calls them.

The stage keeps two canvases: ink, which accumulates, and the turtle marker,
which is cleared and redrawn on every move so a moving turtle does not repaint
the whole drawing. Operations are retained and replayed on resize, since a canvas
loses its contents when its backing store changes size.

On the desktop backend these blocks run the *real* `turtle` against the user's
CPython, which opens a Tk window rather than drawing on the stage.

## Project versions and migration

Saved projects carry a `version`, and `src/project/migrate.ts` walks an older one
forward before Blockly ever sees it -- so a block type that has been retired
never has to stay registered, and a very old file walks the whole chain one step
at a time.

This matters because blocks have been replaced more than once: loops and
functions stopped using workspace-variable dropdowns, and `make` moved its name
into a socket. Without migration such a project loads with blocks that still
render but no longer connect to anything, quietly losing behaviour.

The v1 → v2 step rewrites both loop blocks, both procedure definitions (a
returning one becomes a definition plus a `return` statement), both call blocks,
and `make`. Names bound by a loop or a parameter are no longer variables, so
every block that read or wrote one is converted too -- otherwise the variable
stays referenced and the loop body silently means something other than the loop
header. Anything left unreferenced is dropped, which is what finally clears names
like `i` from the palette.

The autosave is versioned the same way. **When you change a block's shape, add a
migration step and let `CURRENT_VERSION` follow from it.**

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
src/blocks/hoisting.ts         Tidies code from Blockly's stock blocks
src/blocks/turtle.ts           Turtle graphics blocks
src/python/turtle-shim.ts      A `turtle` module for Pyodide, which has no tkinter
src/project/migrate.ts         Walks older saved projects forward
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
src/ui/                        Console, code pane, stage, error highlight, dialogs
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
