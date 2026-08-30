// Smoke-tests the built site, the way a deploy will serve it.
//
// `npm run test:browser` runs against the dev server. That is where most bugs
// live, but not all of them: the one regression that reached a user was a
// Pyodide loader that worked in a production build and failed in dev. The
// reverse is just as possible, and a broken deploy is worse than a broken dev
// server, so the built artifact gets its own check.
//
// Kept separate from the main suite rather than folded into it, because the
// `window.snappy` handle the suite drives the workspace through is stripped from
// production builds -- most of those checks simply cannot run here.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.SNAPPY_BUILD_PORT ?? 5179);
const CDP_PORT = Number(process.env.SNAPPY_BUILD_CDP ?? 9334);
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

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

// --- what a deploy will actually serve ---------------------------------------

const headersFile = join(root, 'dist', '_headers');
if (!existsSync(headersFile)) {
  console.error('dist/_headers is missing -- run npm run build first.');
  process.exit(1);
}
const headers = readFileSync(headersFile, 'utf8');
check('the deploy sets Cross-Origin-Opener-Policy',
  /^\s*Cross-Origin-Opener-Policy:\s*same-origin\s*$/m.test(headers));
check('the deploy sets Cross-Origin-Embedder-Policy',
  /^\s*Cross-Origin-Embedder-Policy:\s*require-corp\s*$/m.test(headers));
check('those headers apply to every path', /^\/\*\s*$/m.test(headers));

// Pyodide is fetched at runtime relative to the page, so it has to be published.
for (const asset of ['pyodide/pyodide.mjs', 'pyodide/pyodide.asm.wasm',
  'pyodide/python_stdlib.zip', 'blockly-media/sprites.png']) {
  check(`the build publishes ${asset}`, existsSync(join(root, 'dist', asset)));
}

// --- and that the built page runs --------------------------------------------

let ws;
let nextId = 1;
const pending = new Map();

const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text);
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

const browser = BROWSERS.find((path) => existsSync(path));
if (!browser) {
  console.error('No Chromium-based browser found. Set SNAPPY_BROWSER to one.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'snappy-build-test-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const preview = spawn(npm, ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: 'ignore', shell: process.platform === 'win32',
});
let edge;

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      await fetch(APP);
      up = true;
    } catch {
      await sleep(500);
    }
  }
  if (!up) throw new Error(`preview server never came up on ${PORT}`);

  edge = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    APP,
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* still starting */ }
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
  // Headless never paints, and Blockly flushes its event queue from rAF.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 8);',
  });
  await send('Page.navigate', { url: APP });
  await waitFor('the page', "document.readyState === 'complete' || null", 60000);

  check('the built page is cross-origin isolated',
    (await evaluate('self.crossOriginIsolated')) === true);
  check('the dev-only debug handle is not in the build',
    (await evaluate("typeof window.snappy === 'undefined'")) === true);
  check('blocks render', (await evaluate(
    "document.querySelectorAll('#blocks .blocklyDraggable').length")) > 0);

  await waitFor('Python to boot',
    "(() => document.querySelector('#status')?.textContent?.trim() === 'Ready' || null)()",
    180000);
  check('Pyodide boots from the built assets', true,
    await evaluate("document.querySelector('#engine')?.textContent?.trim()"));

  await evaluate("document.querySelector('#run').click()");
  const output = await waitFor('the starter program to run', `(() => {
    const t = document.querySelector('#console .console-output')?.textContent ?? '';
    return t.includes('Hello from SnapPy!') ? t : null;
  })()`, 60000);
  check('the starter program runs', true, JSON.stringify(output.trim()));
} catch (err) {
  console.error('ERROR --', err.message);
  failures++;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  edge?.kill();
  preview.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch { /* the OS can reap it */ }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nthe built site is good to deploy');
  setTimeout(() => process.exit(failures ? 1 : 0), 500);
}
