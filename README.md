# SnapPy

**Snap blocks together, get real Python.** SnapPy is a block-based coding
environment for learning Python: you build a program by dragging Scratch-style
blocks, and the exact Python code appears beside them as you work — then runs,
right there in the same window.

It is aimed at anyone making the jump from blocks to text: students, classrooms,
and self-teachers who want to *see* the code their blocks become instead of
guessing at it.

- **Try it in a browser** — nothing to install.
- **Download the desktop app** — runs on your own Python, with real files and
  any installed package.

> No account, no sign-in, no data leaves your machine. Your programs run locally
> (in the browser tab, or on your own Python on the desktop).

---

## What makes it different

- **The code is real, and it's always visible.** Every block generates genuine
  Python — `for i in range(1, 11):`, `import turtle`, a proper `class` — shown
  live in a read-only code pane. What you see is what you'd type by hand, so the
  blocks teach the text.
- **It actually runs Python, not a lookalike.** In the browser it runs real
  CPython 3.12 (via Pyodide/WebAssembly), so `import random`, `time`, and friends
  all work. On the desktop it runs *your* installed Python.
- **Programs that ask and answer.** `input()` works — the program pauses for
  typed input just like a terminal — and you can **Stop** a runaway `forever`
  loop at any time without freezing the page.
- **It grows with the learner.** Start with "say Hello", finish with classes and
  methods. The same window covers the whole path.

## Using it

### 1. Build a program

Drag blocks from the palette on the left. A program starts from a **`when the
program starts`** hat block; anything stacked under it runs top to bottom.

The palette is organised into categories:

| Category | What's in it |
| --- | --- |
| **Events** | `when the program starts` — where your program begins. |
| **Control** | `repeat`, `forever`, `if / else`, `while`, `for each`, `count with`, `wait`. |
| **Output** | `say` (print), text blocks, joining and length. |
| **Input** | `ask …` — read a line the person types. |
| **Operators** | Maths, random numbers, comparisons, and `and` / `or` / `not`. |
| **Variables** | Make and use variables that follow Python's real scoping. |
| **Lists** | Build and work with lists. |
| **Functions** | Define your own functions and call them (with parameters and return values). |
| **Classes** | Define classes with methods and properties — real object-oriented Python. |
| **Modules** | Switch on extra libraries. **Turtle** graphics is built in. |

### 2. Watch the Python

The code pane updates as you build. Only the blocks that belong to a program —
the `when the program starts` stack, plus any function and class definitions —
become code. Loose blocks you've left on the canvas while thinking are scratch
work and generate nothing, exactly like a stray stack in Scratch.

### 3. Run it

Press **Run**. Output appears in the console; if the program calls `ask`, type
your answer there. Press **Stop** to end it. If the program hits an error, the
**block that caused it is outlined in red** and scrolled into view, so you can
find the problem without reading a traceback.

### 4. Draw with Turtle

Turn on the **Modules → Turtle** category and a drawing stage appears when your
program imports turtle. Move, turn, lift the pen, change colour — the classic
turtle, running live in the browser. On the desktop app the same blocks drive
Python's real `turtle` window.

## Saving your work

- Your workspace **autosaves** in the browser as you go, so closing the tab
  doesn't lose anything.
- Save a project to a file with **Ctrl/Cmd + S** (`.snappy` files); open one with
  **Ctrl/Cmd + O**.
- Older project files keep working — SnapPy upgrades them automatically when they
  load.

## Web vs. desktop — which should I use?

|  | Browser | Desktop app |
| --- | --- | --- |
| Install | Nothing — just open the page | Download an installer |
| Python | Built in (CPython on WebAssembly) | **Your own** installed Python |
| Packages | The ones Pyodide bundles | Anything you've `pip install`ed, including C extensions |
| Files | Download / pick a file | Reads and writes real files on your machine |
| Turtle | Built-in drawing stage | Python's real turtle window |
| Speed | Fast enough for learning | Native |

The browser version is the easiest way to start. The desktop app is for when you
want your real Python, your real files, and full speed. (If you open the desktop
app without Python installed, it falls back to the built-in interpreter so it
still works.)

## Privacy

SnapPy runs entirely on your device. There's no account, no server storing your
code, and no telemetry — your programs execute in your browser tab or on your own
Python installation, and your project files stay wherever you save them.

## Building from source

SnapPy is open source (MIT). To run it locally:

```bash
npm install     # also fetches the Python runtime + block assets
npm run dev     # open http://localhost:5173
```

Build the desktop app (needs the [Rust toolchain](https://rustup.rs) and a
platform webview):

```bash
npm run desktop        # run in dev
npm run desktop:build  # produce installers
```

Run the tests:

```bash
npm test               # block-to-Python generation + project format
npm run test:browser   # full run in a real browser (needs Chromium)
```

## Contributing

Issues and pull requests are welcome. If you're changing how the app works
internally — the Python backends, the block/code generation, project migration,
or the build — read **[ARCHITECTURE.md](ARCHITECTURE.md)** first. It documents
the design decisions and the sharp edges (why Pyodide runs in a worker, why the
site needs specific HTTP headers, how error highlighting is built, and more) so a
change doesn't quietly undo one.

## License

[MIT](LICENSE).
