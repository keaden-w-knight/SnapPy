import * as Blockly from 'blockly/core';
import '../src/blocks/blocks';
import { parse, serialize, nameFromPath, FORMAT_VERSION } from '../src/project/format';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

// Round-trip a real Blockly workspace through the file format.
const ws = new Blockly.Workspace();
Blockly.serialization.workspaces.load({
  blocks: { languageVersion: 0, blocks: [{
    type: 'snappy_when_run', x: 10, y: 20,
    next: { block: { type: 'snappy_print', inputs: {
      VALUE: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } } } },
  }] },
} as never, ws);

const original = Blockly.serialization.workspaces.save(ws);
const text = serialize({ name: 'My Game', workspace: original });
const loaded = parse(text, 'fallback');

check('round-trip keeps name', loaded.name === 'My Game', loaded.name);
check('round-trip keeps workspace',
  JSON.stringify(loaded.workspace) === JSON.stringify(original));

// Reload into a fresh workspace and confirm the blocks survive.
const ws2 = new Blockly.Workspace();
Blockly.serialization.workspaces.load(loaded.workspace as never, ws2);
check('reloaded workspace has same block count',
  ws2.getAllBlocks(false).length === ws.getAllBlocks(false).length,
  `${ws2.getAllBlocks(false).length} blocks`);

// Error paths, each of which the UI surfaces verbatim.
const bad: [string, string][] = [
  ['not json', 'this is not json {'],
  ['json but not a project', '{"hello":"world"}'],
  ['wrong format tag', '{"format":"scratch","version":1,"workspace":{}}'],
  ['future version', `{"format":"snappy","version":${FORMAT_VERSION + 1},"workspace":{}}`],
  ['missing workspace', '{"format":"snappy","version":1,"name":"x"}'],
  ['null literal', 'null'],
];
for (const [name, input] of bad) {
  try {
    parse(input, 'fallback');
    check(`rejects ${name}`, false, 'no error thrown');
  } catch (e) {
    check(`rejects ${name}`, e instanceof Error && e.message.length > 10,
      (e as Error).message);
  }
}

// A project saved without a name falls back to the filename.
check('falls back to filename',
  parse('{"format":"snappy","version":1,"workspace":{}}', 'from-disk').name === 'from-disk');
check('blank name falls back',
  parse('{"format":"snappy","version":1,"name":"   ","workspace":{}}', 'fb').name === 'fb');

// Older files must still load.
check('accepts older version',
  parse('{"format":"snappy","version":0,"name":"old","workspace":{}}', 'fb').name === 'old');

// Path handling on both separators, and case-insensitive extension.
check('windows path', nameFromPath('C:\\Users\\k\\Projects\\Maze.snappy') === 'Maze');
check('posix path', nameFromPath('/home/k/Maze.snappy') === 'Maze');
check('uppercase ext', nameFromPath('Maze.SNAPPY') === 'Maze');
check('no extension', nameFromPath('Maze') === 'Maze');
check('dots in name', nameFromPath('v1.2.snappy') === 'v1.2');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
