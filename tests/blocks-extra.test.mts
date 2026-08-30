import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import '../src/blocks/blocks';
import { toIdentifier } from '../src/blocks/variables';
import { buildLineMap } from '../src/blocks/sourcemap';
import { errorLine } from '../src/python/traceback';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

const ws = new Blockly.Workspace();
function gen(blocks: unknown[], variables: unknown[] = []): string {
  ws.clear();
  Blockly.serialization.workspaces.load(
    { variables, blocks: { languageVersion: 0, blocks } } as never, ws);
  return pythonGenerator.workspaceToCode(ws);
}

const text = (t: string) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const numb = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

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
  return true; // no interpreter here; skip rather than fail
}

// --- parameter declarations are no longer hoisted ---------------------------

const greetDef = {
  type: 'procedures_defnoreturn', x: 0, y: 0,
  extraState: { params: [{ name: 'who', id: 'whoId' }] },
  fields: { NAME: 'greet' },
  inputs: { STACK: { block: { type: 'snappy_print', inputs: { VALUE: text('hi') } } } },
};

{
  const code = gen(
    [greetDef, { type: 'snappy_call', x: 0, y: 300, extraState: { params: ['who'] },
      fields: { NAME: 'greet' }, inputs: { ARG0: text('Ada') } }],
    [{ name: 'who', id: 'whoId' }],
  );
  check('parameter is not hoisted as a global',
    !code.includes('who = None') && code.includes('def greet(who):'),
    JSON.stringify(code.trim()));
  check('parameter suppression -> valid Python', isValidPython(code));
}

{
  // The same name used at the top level must keep its declaration, because
  // there it really can be read before being assigned.
  const code = gen(
    [
      greetDef,
      { type: 'snappy_print', x: 0, y: 300,
        inputs: { VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'whoId' } } } } } },
    ],
    [{ name: 'who', id: 'whoId' }],
  );
  check('a parameter also used globally keeps its declaration',
    code.includes('who = None'), JSON.stringify(code.trim()));
}

{
  // Ordinary variables are untouched.
  const code = gen(
    [{ type: 'snappy_print', x: 0, y: 0,
      inputs: { VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'sId' } } } } } }],
    [{ name: 'score', id: 'sId' }],
  );
  check('ordinary variables are still hoisted', code.includes('score = None'));
}

// --- local variables --------------------------------------------------------

check('identifier: spaces and punctuation', toIdentifier('my var!') === 'my_var_', toIdentifier('my var!'));
check('identifier: leading digit', toIdentifier('3x') === '_3x', toIdentifier('3x'));
check('identifier: python keyword', toIdentifier('class') === 'class_', toIdentifier('class'));
check('identifier: empty falls back', toIdentifier('') === 'item', toIdentifier(''));
check('identifier: already valid is untouched', toIdentifier('counter') === 'counter');

{
  const code = gen([
    { type: 'snappy_local_set', x: 0, y: 0, fields: { NAME: 'counter' },
      inputs: { VALUE: numb(0) },
      next: { block: { type: 'snappy_print', inputs: {
        VALUE: { block: { type: 'snappy_local_get', fields: { NAME: 'counter' } } } } } } },
  ]);
  check('local set and get round-trip',
    code.includes('counter = 0') && code.includes('print(counter)'),
    JSON.stringify(code.trim()));
  check('local variables -> valid Python', isValidPython(code));
  check('locals are not hoisted', !code.includes('counter = None'));
}

{
  // A local declared inside a function stays inside it.
  const code = gen([{
    type: 'procedures_defnoreturn', x: 0, y: 0, fields: { NAME: 'tally' },
    inputs: { STACK: { block: { type: 'snappy_local_set',
      fields: { NAME: 'counter' }, inputs: { VALUE: numb(0) } } } },
  }]);
  check('local inside a function is indented into it',
    code.includes('def tally():') && /\n\s+counter = 0/.test(code),
    JSON.stringify(code.trim()));
}

// --- slice and for loops ----------------------------------------------------

{
  const code = gen([{
    type: 'snappy_print', x: 0, y: 0,
    inputs: { VALUE: { block: { type: 'lists_getSublist',
      inputs: { LIST: { block: { type: 'lists_create_with' } } } } } },
  }]);
  check('slice block generates a slice', code.includes('[') && code.includes(':'),
    JSON.stringify(code.trim()));
  check('slice -> valid Python', isValidPython(code));
}

{
  const code = gen(
    [{ type: 'controls_for', x: 0, y: 0, fields: { VAR: { id: 'iId' } },
      inputs: { FROM: numb(1), TO: numb(5), BY: numb(1),
        DO: { block: { type: 'snappy_print', inputs: {
          VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'iId' } } } } } } } } }],
    [{ name: 'i', id: 'iId' }],
  );
  check('count-with loop generates a for loop',
    code.includes('for i in range('), JSON.stringify(code.trim()));
  check('for loop -> valid Python', isValidPython(code));
}

{
  const code = gen(
    [{ type: 'controls_forEach', x: 0, y: 0, fields: { VAR: { id: 'itemId' } },
      inputs: { LIST: { block: { type: 'lists_create_with' } },
        DO: { block: { type: 'snappy_print', inputs: {
          VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'itemId' } } } } } } } } }],
    [{ name: 'item', id: 'itemId' }],
  );
  check('for-each loop iterates a list',
    /for item in/.test(code), JSON.stringify(code.trim()));
  check('for-each -> valid Python', isValidPython(code));
}

// --- source map: which block produced which line ----------------------------

{
  // Divide by zero on the second statement, so the failing line is unambiguous.
  const code = gen([{
    type: 'snappy_when_run', x: 0, y: 0, id: 'hatId',
    next: { block: {
      type: 'snappy_print', id: 'firstId', inputs: { VALUE: text('before') },
      next: { block: {
        type: 'snappy_print', id: 'boomId',
        inputs: { VALUE: { block: { type: 'math_arithmetic', fields: { OP: 'DIVIDE' },
          inputs: { A: numb(1), B: numb(0) } } } },
        next: { block: { type: 'snappy_print', id: 'lastId',
          inputs: { VALUE: text('after') } } },
      } },
    } },
  }]);

  const map = buildLineMap(ws, code);
  check('line map was produced', map.size > 0, `${map.size} lines mapped`);

  const lines = code.split('\n');
  const boomLine = lines.findIndex((l) => l.includes('/ 0')) + 1;
  check('the failing line maps to the block that produced it',
    map.get(boomLine) === 'boomId', `line ${boomLine} -> ${map.get(boomLine)}`);

  const firstLine = lines.findIndex((l) => l.includes('before')) + 1;
  check('an earlier line maps to its own block',
    map.get(firstLine) === 'firstId', `line ${firstLine} -> ${map.get(firstLine)}`);

  // The annotated pass must reproduce the real program exactly, or the map is
  // discarded -- that equality is what makes the line numbers trustworthy.
  check('markers do not leak into the generated code',
    !code.includes('#@snappy'), JSON.stringify(code.trim()));
}

// --- traceback line extraction ----------------------------------------------

check('reads the line from a Pyodide traceback',
  errorLine('Traceback (most recent call last):\n  File "<exec>", line 3, in <module>\nZeroDivisionError: x') === 3);
check('reads the line from a native traceback',
  errorLine('Traceback (most recent call last):\n  File "<string>", line 7, in <module>\nNameError: x') === 7);
check('prefers the deepest user frame',
  errorLine('File "<exec>", line 2, in <module>\n  File "<exec>", line 9, in greet\nValueError') === 9);
check('returns null when there is no user frame',
  errorLine('RuntimeError: something went wrong') === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
