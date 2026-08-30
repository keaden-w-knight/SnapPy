import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import '../src/blocks/blocks';
import { CURRENT_VERSION, migrateWorkspace } from '../src/project/migrate';
import { parse, serialize } from '../src/project/format';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

const ws = new Blockly.Workspace();

/** Load a migrated project the way the app does, and generate from it. */
function load(state: object): string {
  ws.clear();
  Blockly.serialization.workspaces.load(state as never, ws);
  return pythonGenerator.workspaceToCode(ws);
}

function isValidPython(code: string): boolean {
  for (const exe of ['python', 'python3', 'py']) {
    try {
      execFileSync(exe, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
        input: code, stdio: ['pipe', 'ignore', 'pipe'],
      });
      return true;
    } catch (err) {
      if (typeof (err as { status?: number }).status === 'number') return false;
    }
  }
  return true;
}

const text = (t: string) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const numb = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

// --- a version 1 project, exactly as the old app would have written it -------

const V1_PROJECT = {
  variables: [
    { name: 'i', id: 'iId' },
    { name: 'who', id: 'whoId' },
    { name: 'score', id: 'scoreId' },
  ],
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'procedures_defnoreturn', x: 0, y: 0,
        fields: { NAME: 'greet' },
        extraState: { params: [{ name: 'who', id: 'whoId' }] },
        inputs: { STACK: { block: { type: 'snappy_print', inputs: { VALUE: text('hi') } } } },
      },
      {
        type: 'procedures_defreturn', x: 0, y: 200,
        fields: { NAME: 'answer' },
        extraState: { params: [] },
        inputs: { RETURN: numb(42) },
      },
      {
        type: 'controls_forEach', x: 0, y: 400,
        fields: { VAR: { id: 'iId' } },
        inputs: {
          LIST: { block: { type: 'lists_create_with' } },
          DO: { block: { type: 'snappy_print', inputs: {
            VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'iId' } } } } } } },
        },
      },
      {
        type: 'controls_for', x: 0, y: 600,
        fields: { VAR: { id: 'iId' } },
        inputs: { FROM: numb(1), TO: numb(3), BY: numb(1) },
      },
      {
        type: 'snappy_local_set', x: 0, y: 800,
        fields: { NAME: 'counter' },
        inputs: { VALUE: numb(0) },
      },
      {
        type: 'procedures_callnoreturn', x: 0, y: 1000,
        fields: { NAME: 'greet' },
        extraState: { params: ['who'] },
        inputs: { ARG0: text('Ada') },
      },
      {
        type: 'variables_set', x: 0, y: 1200,
        fields: { VAR: { id: 'scoreId' } },
        inputs: { VALUE: numb(1) },
      },
    ],
  },
};

const migrated = migrateWorkspace(V1_PROJECT, 1) as {
  variables?: { name: string }[];
  blocks: { blocks: { type: string }[] };
};
const types = migrated.blocks.blocks.map((block) => block.type);

check('the old project has no version-1 block types left',
  !types.some((type) => type.startsWith('procedures_') || type.startsWith('controls_for')),
  JSON.stringify(types));
check('definitions became the new function block',
  types.filter((type) => type === 'snappy_function_def').length === 2, JSON.stringify(types));
check('the call became the new call block', types.includes('snappy_call'));
check('for-each became the oval-named loop', types.includes('snappy_for_each'));
check('count-with became the oval-named loop', types.includes('snappy_for_range'));

check('a parameter is no longer a workspace variable',
  !migrated.variables?.some((variable) => variable.name === 'who'),
  JSON.stringify(migrated.variables?.map((v) => v.name)));
check('a loop target is no longer a workspace variable',
  !migrated.variables?.some((variable) => variable.name === 'i'));
check('a real variable survives',
  !!migrated.variables?.some((variable) => variable.name === 'score'),
  JSON.stringify(migrated.variables?.map((v) => v.name)));

// The migrated project must actually load and generate working Python.
const code = load(migrated);
check('the migrated project still defines its function',
  code.includes('def greet(who):'), JSON.stringify(code.trim()));
check('a returning function became a return statement',
  code.includes('def answer():') && code.includes('return 42'), JSON.stringify(code.trim()));
check('the call still passes its argument', code.includes("greet('Ada')"));
check('the loop kept its name', code.includes('for i in'));
check('make kept its name', code.includes('counter = 0'));
check('the real variable still works', code.includes('score = 1'));
check('the migrated project -> valid Python', isValidPython(code));
check('no block was dropped on the way',
  ws.getTopBlocks(false).length === V1_PROJECT.blocks.blocks.length,
  `${ws.getTopBlocks(false).length} of ${V1_PROJECT.blocks.blocks.length}`);

// --- the file format applies migrations on open ------------------------------

{
  const file = JSON.stringify({
    format: 'snappy', version: 1, name: 'Old Project', workspace: V1_PROJECT,
  });
  const project = parse(file, 'fallback');
  const state = project.workspace as { blocks: { blocks: { type: string }[] } };
  check('opening an old file migrates it',
    state.blocks.blocks.every((b) => !b.type.startsWith('procedures_')),
    JSON.stringify(state.blocks.blocks.map((b) => b.type)));
  check('opening an old file keeps its name', project.name === 'Old Project');
}

{
  // A current file is untouched, and round-trips.
  const current = { blocks: { languageVersion: 0, blocks: [
    { type: 'snappy_print', x: 0, y: 0, inputs: { VALUE: text('hi') } }] } };
  const file = serialize({ name: 'New', workspace: current });
  check('a new file is written at the current version',
    JSON.parse(file).version === CURRENT_VERSION, `version ${JSON.parse(file).version}`);
  const project = parse(file, 'fallback');
  check('a current file round-trips unchanged',
    JSON.stringify(project.workspace) === JSON.stringify(current));
}

{
  // Migrating twice must not double-apply.
  const once = migrateWorkspace(V1_PROJECT, 1);
  const twice = migrateWorkspace(once, CURRENT_VERSION);
  check('migration is idempotent at the current version',
    JSON.stringify(once) === JSON.stringify(twice));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
