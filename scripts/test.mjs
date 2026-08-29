// Bundles each tests/*.test.mts and runs it in Node.
//
// Blockly's code generation and the project file format are pure logic, so they
// can be exercised headlessly -- no browser, no Pyodide download. The parts that
// genuinely need a browser (drag and drop, the Tauri backends) are not covered.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = join(root, 'tests');
const files = readdirSync(testDir).filter((f) => f.endsWith('.test.mts'));

let failed = 0;
for (const file of files) {
  // CJS with external packages: Blockly's Node entry uses require(), and keeping
  // packages external means module resolution still finds node_modules.
  const bundle = join(root, `.test-${file}.cjs`);
  try {
    await build({
      entryPoints: [join(testDir, file)],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      packages: 'external',
      outfile: bundle,
      logLevel: 'warning',
    });
    console.log(`\n=== ${file} ===`);
    execFileSync(process.execPath, [bundle], { cwd: root, stdio: 'inherit' });
  } catch (err) {
    // A non-zero exit is a reported test failure; anything else is a harness bug.
    if (typeof err?.status !== 'number') console.error(err.message);
    failed++;
  } finally {
    rmSync(bundle, { force: true });
  }
}

console.log(failed ? `\n${failed} of ${files.length} test file(s) failed` : '\nall test files passed');
process.exit(failed ? 1 : 0);
