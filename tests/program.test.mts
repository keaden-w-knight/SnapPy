import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import '../src/blocks/blocks';
import { generateProgram } from '../src/blocks/program';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

const ws = new Blockly.Workspace();
function program(blocks: unknown[]): string {
  ws.clear();
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks } } as never, ws);
  return generateProgram(ws);
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

const say = (what: string, rest: object = {}) => ({
  type: 'snappy_print', inputs: { VALUE: text(what) }, ...rest,
});

{
  const code = program([{ type: 'snappy_when_run', x: 0, y: 0, next: { block: say('run me') } }]);
  check('a stack under the hat is the program', code.includes("print('run me')"),
    JSON.stringify(code.trim()));
}

{
  // The case that prompted this: a stack parked on the canvas while thinking.
  const code = program([
    { type: 'snappy_when_run', x: 0, y: 0, next: { block: say('run me') } },
    { ...say('left lying around'), x: 0, y: 300 },
  ]);
  check('a loose stack is left out', !code.includes('left lying around'),
    JSON.stringify(code.trim()));
  check('the real program is unaffected', code.includes("print('run me')"));
  check('roots only -> valid Python', isValidPython(code));
}

{
  const code = program([
    { type: 'snappy_function_def', x: 0, y: 0, fields: { NAME: 'greet' },
      extraState: { params: [] },
      inputs: { DO: { block: say('hi') } } },
    { type: 'snappy_class_def', x: 0, y: 300, fields: { NAME: 'Dog' },
      inputs: { BODY: { block: {
        type: 'snappy_method_def', fields: { NAME: 'speak' },
        extraState: { params: [{ name: 'self', type: 'value' }] },
        inputs: {
          PARAM0: { block: { type: 'snappy_local_get', fields: { NAME: 'self' } } },
          DO: { block: say('woof') },
        },
      } } } },
  ]);
  check('a standalone definition is a root', code.includes('def greet():'),
    JSON.stringify(code.trim()));
  check('a class is a root', code.includes('class Dog:'));
  check('definitions and classes -> valid Python', isValidPython(code));
}

{
  // A method on its own is not a root: it belongs to a class.
  const code = program([{
    type: 'snappy_method_def', x: 0, y: 0, fields: { NAME: 'orphan' },
    extraState: { params: [] },
  }]);
  check('a loose method definition is left out', !code.includes('orphan'),
    JSON.stringify(code.trim()));
}

{
  const code = program([
    { type: 'snappy_local_get', x: 0, y: 0, fields: { NAME: 'stray' } },
    { type: 'snappy_call_value', x: 0, y: 100, fields: { NAME: 'nothing' } },
  ]);
  check('loose value blocks are left out', code.trim() === '', JSON.stringify(code.trim()));
}

{
  // An import is only hoisted if a root actually reaches the block needing it.
  const looseTurtle = program([{ type: 'snappy_turtle_home', x: 0, y: 0 }]);
  check('a loose turtle block does not import turtle',
    !looseTurtle.includes('import turtle'), JSON.stringify(looseTurtle.trim()));

  const usedTurtle = program([{
    type: 'snappy_when_run', x: 0, y: 0,
    next: { block: { type: 'snappy_turtle_home' } },
  }]);
  check('a turtle block under the hat does import turtle',
    usedTurtle.includes('import turtle'), JSON.stringify(usedTurtle.trim()));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
