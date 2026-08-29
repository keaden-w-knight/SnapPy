// Copies the Pyodide runtime out of node_modules into public/pyodide/ so the app
// self-hosts it. Self-hosting (rather than hitting a CDN) keeps the app working
// offline and, more importantly, keeps every asset same-origin -- which matters
// because we serve under COEP: require-corp for SharedArrayBuffer.
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'pyodide');
const dest = join(root, 'public', 'pyodide');

if (!existsSync(src)) {
  console.error('[copy-pyodide] node_modules/pyodide not found; skipping.');
  process.exit(0);
}

// Everything Pyodide needs at runtime. The stdlib zip and the packages lockfile
// are loaded by pyodide.mjs relative to indexURL, so they have to sit alongside it.
const needed = [
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

await mkdir(dest, { recursive: true });

let copied = 0;
for (const name of needed) {
  const from = join(src, name);
  if (!existsSync(from)) {
    console.warn(`[copy-pyodide] missing ${name} -- Pyodide layout may have changed.`);
    continue;
  }
  await cp(from, join(dest, name));
  copied++;
}

const bytes = (await Promise.all(
  (await readdir(dest)).map(async (f) => (await stat(join(dest, f))).size),
)).reduce((a, b) => a + b, 0);

console.log(`[copy-pyodide] ${copied} files -> public/pyodide (${(bytes / 1e6).toFixed(1)} MB)`);

// Blockly's trashcan/zoom sprites are loaded by URL from the `media` option.
const blocklyMedia = join(root, 'node_modules', 'blockly', 'media');
if (existsSync(blocklyMedia)) {
  await cp(blocklyMedia, join(root, 'public', 'blockly-media'), { recursive: true });
  console.log('[copy-pyodide] blockly media -> public/blockly-media');
}
