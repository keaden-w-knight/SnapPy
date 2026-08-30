// End-to-end checks in a real browser.
//
// `npm test` covers pure logic, but the parts most likely to break are the ones
// only a browser can exercise: whether Pyodide actually boots, whether input()
// blocks and resumes over the shared stdin buffer, and whether Stop interrupts a
// runaway loop. A dynamic-import regression that passed a production build and
// broke the dev server shipped once because nothing here existed.
//
// Drives an installed Chromium browser over CDP. No dependencies: Node 22 has a
// global WebSocket, and the browser is one already on the machine.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.SNAPPY_TEST_PORT ?? 5178);
const CDP_PORT = Number(process.env.SNAPPY_CDP_PORT ?? 9333);
const APP = `http://localhost:${PORT}/`;

const BROWSERS = [
  process.env.SNAPPY_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- block programs, seeded through localStorage ----------------------------

const text = (t) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const numb = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const program = (blocks) => ({ blocks: { languageVersion: 0, blocks } });

const HELLO = program([{
  type: 'snappy_when_run', x: 40, y: 40,
  next: { block: { type: 'snappy_print', inputs: { VALUE: text('Hello from SnapPy!') } } },
}]);

const ASK = program([{
  type: 'snappy_when_run', x: 40, y: 40,
  next: { block: { type: 'snappy_print', inputs: {
    VALUE: { block: { type: 'snappy_ask', inputs: { PROMPT: text('Name? ') } } } } } },
}]);

// Throttled: an unbounded print loop fills the DOM faster than CDP can read it.
const FOREVER = program([{
  type: 'snappy_when_run', x: 40, y: 40,
  next: { block: { type: 'snappy_forever', inputs: {
    DO: { block: { type: 'snappy_wait', inputs: { SECONDS: numb(0.2) },
      next: { block: { type: 'snappy_print', inputs: { VALUE: text('tick') } } } } } } } },
}]);

const COUNT = program([{
  type: 'controls_repeat_ext', x: 40, y: 40,
  inputs: { TIMES: numb(3), DO: { block: { type: 'snappy_print', inputs: {
    VALUE: { block: { type: 'snappy_random', inputs: { FROM: numb(1), TO: numb(6) } } } } } } },
}]);

const FUNCTIONS = program([
  {
    type: 'procedures_defnoreturn', x: 40, y: 40, fields: { NAME: 'greet' },
    inputs: { STACK: { block: { type: 'snappy_print',
      inputs: { VALUE: text('hello from a function') } } } },
  },
  { type: 'snappy_when_run', x: 40, y: 240,
    next: { block: { type: 'snappy_call', fields: { NAME: 'greet' } } } },
]);

const FUNCTION_VALUE = program([
  { type: 'procedures_defreturn', x: 40, y: 40, fields: { NAME: 'answer' },
    inputs: { RETURN: numb(42) } },
  { type: 'snappy_when_run', x: 40, y: 240,
    next: { block: { type: 'snappy_print', inputs: {
      VALUE: { block: { type: 'math_arithmetic', fields: { OP: 'ADD' }, inputs: {
        A: { block: { type: 'snappy_call_value', fields: { NAME: 'answer' } } },
        B: numb(1),
      } } } } } } },
]);

// Divides by zero inside the second say block, so the failing block is known.
const BOOM = program([{
  type: 'snappy_when_run', x: 40, y: 40,
  next: { block: {
    type: 'snappy_print', id: 'okBlock', inputs: { VALUE: text('starting') },
    next: { block: {
      type: 'snappy_print', id: 'boomBlock',
      inputs: { VALUE: { block: { type: 'math_arithmetic', fields: { OP: 'DIVIDE' },
        inputs: { A: numb(1), B: numb(0) } } } },
    } },
  } },
}]);

// --- harness ----------------------------------------------------------------

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(d.exception?.description ?? d.exception?.value ?? d.text);
  }
  return r.result?.value;
}

async function waitFor(label, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(expression);
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`timed out: ${label} (last: ${JSON.stringify(last)})`);
}

const READY = "(() => document.querySelector('#status')?.textContent?.trim() === 'Ready' || null)()";
// Always a bounded slice: a runaway program can emit megabytes.
const OUT = "(document.querySelector('#console .console-output')?.textContent ?? '').slice(-400)";
const STATUS = "document.querySelector('#status')?.textContent?.trim()";

async function loadProgram(workspace) {
  await evaluate(
    `localStorage.setItem('snappy.workspace.v1', ${JSON.stringify(JSON.stringify(workspace))})`,
  );
  await send('Page.reload', { ignoreCache: false });
  await sleep(1500);
  await waitFor('Python ready', READY, 180000);
}

async function waitForPort(url, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

// --- run --------------------------------------------------------------------

const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chromium-based browser found. Set SNAPPY_BROWSER to one.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'snappy-browser-test-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(npm, ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'ignore', shell: process.platform === 'win32',
});
let edge;

try {
  if (!(await waitForPort(APP, 60))) throw new Error(`dev server never came up on ${PORT}`);

  edge = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', APP,
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* browser still starting */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('no CDP page target');

  await new Promise((resolve, reject) => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed')));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  });
  await send('Runtime.enable');
  await send('Page.enable');

  // Navigate explicitly and wait for the document: evaluating against a page
  // that is still about:blank fails opaquely, and localStorage is per-origin.
  await send('Page.navigate', { url: APP });
  await waitFor('document ready', "document.readyState === 'complete' || null", 60000);

  // 1. The page is cross-origin isolated, without which stop and input() break.
  await loadProgram(HELLO);
  check('cross-origin isolated', (await evaluate('self.crossOriginIsolated')) === true);
  check('SharedArrayBuffer available',
    (await evaluate('typeof SharedArrayBuffer')) === 'function');
  check('blocks rendered',
    (await evaluate("document.querySelectorAll('#blocks .blocklyDraggable').length")) > 0);
  check('Pyodide booted', (await evaluate(STATUS)) === 'Ready',
    await evaluate("document.querySelector('#engine')?.textContent?.trim()"));

  // 2. A program runs end to end.
  await evaluate("document.querySelector('#run').click()");
  const hello = await waitFor('program output',
    `(() => { const t = ${OUT}; return t.includes('Hello from SnapPy!') ? t : null; })()`, 60000);
  check('program produces output', true, JSON.stringify(hello.trim()));

  // 3. input() blocks on the shared buffer and resumes when a line arrives.
  await loadProgram(ASK);
  await evaluate("document.querySelector('#run').click()");
  await waitFor('input row',
    "(() => !document.querySelector('.console-input')?.hidden || null)()", 30000);
  check('status shows waiting for input', (await evaluate(STATUS)) === 'Waiting for input');
  // The prompt has no trailing newline: this is what line-batched output breaks.
  check('prompt printed before the read', (await evaluate(OUT)).includes('Name? '));

  await evaluate(`(() => {
    const form = document.querySelector('.console-input');
    form.querySelector('input').value = 'Ada';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`);
  const answered = await waitFor('program to consume input',
    `(() => { const t = ${OUT}; return t.split('Ada').length >= 3 ? t : null; })()`, 30000);
  check('input reached Python', true, JSON.stringify(answered));
  check('returned to Ready after input', (await evaluate(READY)) === true);

  // 4. Stop interrupts a runaway loop.
  await loadProgram(FOREVER);
  await evaluate("document.querySelector('#run').click()");
  await waitFor('loop output',
    `(() => { const t = ${OUT}; return t.includes('tick') ? t : null; })()`, 30000);
  check('forever loop is running', (await evaluate(STATUS)) === 'Running');

  const t0 = Date.now();
  await evaluate("document.querySelector('#stop').click()");
  await waitFor('stop to take effect', READY, 30000);
  const stopMs = Date.now() - t0;
  check('Stop halted the loop', true,
    `${stopMs}ms via ${stopMs < 1400 ? 'cooperative SIGINT' : 'hard worker reset'}`);
  check('console reports it stopped', (await evaluate(OUT)).includes('[stopped'));

  // 5. The interpreter survives a stop.
  await loadProgram(COUNT);
  await evaluate("document.querySelector('#run').click()");
  const counted = await waitFor('program after a stop',
    `(() => { const t = ${OUT}; return t.trim().split('\\n').filter(Boolean).length >= 3 ? t : null; })()`,
    60000);
  check('interpreter still works after a Stop', true, JSON.stringify(counted.trim()));
  // 6. The Functions flyout offers the dropdown call blocks.
  await loadProgram(FUNCTIONS);
  const flyoutTypes = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.blocklyTreeRow')]
      .find((r) => r.textContent.trim() === 'Functions');
    if (!row) return 'no Functions category';
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    row.click();
    return null;
  })()`);
  if (flyoutTypes) throw new Error(flyoutTypes);
  const flyoutCount = await waitFor('functions flyout to open',
    "document.querySelectorAll('.blocklyFlyout .blocklyDraggable').length || null", 15000);
  check('Functions flyout has blocks', flyoutCount >= 4, `${flyoutCount} blocks`);

  // 7. A statement call to a defined function runs.
  check('statement call generates a call',
    (await evaluate("document.querySelector('#code .cm-content')?.textContent ?? ''"))
      .includes('greet()'));
  await evaluate("document.querySelector('#run').click()");
  const fnOut = await waitFor('function output',
    `(() => { const t = ${OUT}; return t.includes('hello from a function') ? t : null; })()`, 60000);
  check('calling a function produces its output', true, JSON.stringify(fnOut.trim()));

  // 8. The oval call block works inside an operator.
  await loadProgram(FUNCTION_VALUE);
  check('oval call nests in an operator',
    (await evaluate("document.querySelector('#code .cm-content')?.textContent ?? ''"))
      .includes('answer() + 1'));
  await evaluate("document.querySelector('#run').click()");
  const valueOut = await waitFor('oval call output',
    `(() => { const t = ${OUT}; return t.includes('43') ? t : null; })()`, 60000);
  check('oval call returns a usable value', true, JSON.stringify(valueOut.trim()));
  // 9. A runtime error blames the block that caused it.
  await loadProgram(BOOM);
  await evaluate("document.querySelector('#run').click()");
  await waitFor('the traceback',
    `(() => { const t = ${OUT}; return t.includes('ZeroDivisionError') ? t : null; })()`, 60000);

  const blamed = await waitFor('a highlighted block',
    "document.querySelector('.snappy-error-block')?.getAttribute('data-id') ?? null", 15000);
  check('the failing block is highlighted', blamed === 'boomBlock', `highlighted ${blamed}`);
  check('exactly one block is highlighted',
    (await evaluate("document.querySelectorAll('.snappy-error-block').length")) === 1);
  check('the highlight is red',
    (await evaluate(`(() => {
      const el = document.querySelector('.snappy-error-block > .blocklyPath');
      return el ? getComputedStyle(el).stroke : '';
    })()`)).replace(/ /g, '') === 'rgb(209,52,56)');

  // Editing the blocks clears a stale highlight.
  await evaluate("document.querySelector('#clear').click()");
  await evaluate("document.querySelector('#run').click()");
  await waitFor('highlight cleared on re-run',
    "(() => document.querySelectorAll('.snappy-error-block').length === 0 || null)()", 20000);
  check('re-running clears the previous highlight', true);
} catch (err) {
  console.error('ERROR --', err.message);
  failures++;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  edge?.kill();
  vite.kill();
  // The browser holds locked files for a moment after kill; a stale temp
  // profile is not worth failing the run over.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch { /* leave it for the OS to reap */ }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall browser checks passed');
  // The dev server is a detached npm shim on Windows; give it a moment to die.
  setTimeout(() => process.exit(failures ? 1 : 0), 500);
}
