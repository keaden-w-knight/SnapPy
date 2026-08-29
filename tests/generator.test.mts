import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import '../src/blocks/blocks';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

const ws = new Blockly.Workspace();
function gen(blocks: unknown[]): string {
  ws.clear();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } } as never, ws);
  return pythonGenerator.workspaceToCode(ws);
}

const text = (t: string) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const numb = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

/** Every generated program must at least be parseable by a real interpreter. */
function isValidPython(code: string): boolean {
  for (const exe of ['python', 'python3', 'py']) {
    try {
      execFileSync(exe, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], {
        input: code,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      return true;
    } catch (err) {
      const e = err as { status?: number };
      // A non-zero exit means the interpreter ran and rejected the source.
      if (typeof e.status === 'number') return false;
      // Anything else means this launcher is not installed; try the next.
    }
  }
  console.log('     (no local Python found -- syntax check skipped)');
  return true;
}

const cases: [string, unknown[], string[]][] = [
  [
    'hat + say',
    [{
      type: 'snappy_when_run', x: 0, y: 0,
      next: { block: { type: 'snappy_print', inputs: { VALUE: text('Hello from SnapPy!') } } },
    }],
    ["print('Hello from SnapPy!')"],
  ],
  [
    'forever + wait hoists import time',
    [{
      type: 'snappy_when_run', x: 0, y: 0,
      next: { block: { type: 'snappy_forever', inputs: {
        DO: { block: { type: 'snappy_wait', inputs: { SECONDS: numb(0.5) } } } } } },
    }],
    ['import time', 'while True:', '  time.sleep(0.5)'],
  ],
  [
    'empty body becomes pass',
    [{ type: 'snappy_forever', x: 0, y: 0 }],
    ['while True:', '  pass'],
  ],
  [
    'ask nested in say',
    [{
      type: 'snappy_print', x: 0, y: 0,
      inputs: { VALUE: { block: { type: 'snappy_ask', inputs: { PROMPT: text('Name? ') } } } },
    }],
    ["print(input('Name? '))"],
  ],
  [
    'repeat + random hoists import random',
    [{
      type: 'controls_repeat_ext', x: 0, y: 0,
      inputs: {
        TIMES: numb(3),
        DO: { block: { type: 'snappy_print', inputs: {
          VALUE: { block: { type: 'snappy_random', inputs: { FROM: numb(1), TO: numb(6) } } } } } },
      },
    }],
    ['import random', 'for count in range(3):', '  print(random.randint(1, 6))'],
  ],
  [
    'if/else from a built-in block still generates',
    [{
      type: 'controls_if', x: 0, y: 0,
      extraState: { hasElse: true },
      inputs: {
        IF0: { block: { type: 'logic_compare', fields: { OP: 'GT' },
          inputs: { A: numb(2), B: numb(1) } } },
        DO0: { block: { type: 'snappy_print', inputs: { VALUE: text('yes') } } },
        ELSE: { block: { type: 'snappy_print', inputs: { VALUE: text('no') } } },
      },
    }],
    ['if 2 > 1:', "  print('yes')", 'else:', "  print('no')"],
  ],
];

for (const [name, blocks, expected] of cases) {
  let code: string;
  try {
    code = gen(blocks);
  } catch (err) {
    check(name, false, (err as Error).message);
    continue;
  }
  const missing = expected.filter((fragment) => !code.includes(fragment));
  check(name, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '');
  check(`${name} -> valid Python`, isValidPython(code));
}

// --- dropdown-based function call blocks ------------------------------------

const withVar = (blocks: unknown[], variables: unknown[] = []) => {
  ws.clear();
  Blockly.serialization.workspaces.load(
    { variables, blocks: { languageVersion: 0, blocks } } as never, ws);
  return pythonGenerator.workspaceToCode(ws);
};

{
  // A no-argument function, called as a statement.
  const code = withVar([
    {
      type: 'procedures_defnoreturn', x: 0, y: 0,
      fields: { NAME: 'greet' },
      inputs: { STACK: { block: { type: 'snappy_print',
        inputs: { VALUE: text('hi') } } } },
    },
    { type: 'snappy_call', x: 0, y: 200, fields: { NAME: 'greet' } },
  ]);
  check('statement call generates a call',
    code.includes('def greet():') && code.includes('greet()'),
    JSON.stringify(code.trim()));
  check('statement call -> valid Python', isValidPython(code));
}

{
  // A function with a parameter, with a value plugged into the argument socket.
  const code = withVar(
    [
      {
        type: 'procedures_defnoreturn', x: 0, y: 0,
        extraState: { params: [{ name: 'who', id: 'whoId' }] },
        fields: { NAME: 'greet' },
        inputs: { STACK: { block: { type: 'snappy_print',
          inputs: { VALUE: text('hi') } } } },
      },
      {
        type: 'snappy_call', x: 0, y: 200,
        extraState: { params: ['who'] },
        fields: { NAME: 'greet' },
        inputs: { ARG0: text('Ada') },
      },
    ],
    [{ name: 'who', id: 'whoId' }],
  );
  check('parameters reach the definition and the call',
    code.includes('def greet(who):') && code.includes("greet('Ada')"),
    JSON.stringify(code.trim()));
  check('parameterised call -> valid Python', isValidPython(code));
}

{
  // The oval block used inside another block's value input.
  const code = withVar([
    {
      type: 'procedures_defreturn', x: 0, y: 0,
      fields: { NAME: 'answer' },
      inputs: { RETURN: numb(42) },
    },
    {
      type: 'snappy_print', x: 0, y: 200,
      inputs: { VALUE: { block: { type: 'snappy_call_value',
        fields: { NAME: 'answer' } } } },
    },
  ]);
  check('oval call nests inside a value input',
    code.includes('print(answer())'), JSON.stringify(code.trim()));
  check('oval call -> valid Python', isValidPython(code));
}

{
  // The oval block inside an operator, which is what "oval inputs" means.
  const code = withVar([
    {
      type: 'procedures_defreturn', x: 0, y: 0,
      fields: { NAME: 'answer' },
      inputs: { RETURN: numb(42) },
    },
    {
      type: 'snappy_print', x: 0, y: 200,
      inputs: { VALUE: { block: { type: 'math_arithmetic', fields: { OP: 'ADD' },
        inputs: {
          A: { block: { type: 'snappy_call_value', fields: { NAME: 'answer' } } },
          B: numb(1),
        } } } },
    },
  ]);
  check('oval call works inside an operator',
    code.includes('answer() + 1'), JSON.stringify(code.trim()));
  check('oval call in operator -> valid Python', isValidPython(code));
}

{
  // An unset dropdown must still produce something Python can parse.
  const code = withVar([
    { type: 'snappy_print', x: 0, y: 0,
      inputs: { VALUE: { block: { type: 'snappy_call_value' } } } },
  ]);
  check('unset oval call falls back to None',
    code.includes('print(None)'), JSON.stringify(code.trim()));
  check('unset oval call -> valid Python', isValidPython(code));
}

// The hat block itself must contribute no code of its own.
check('hat alone generates nothing',
  gen([{ type: 'snappy_when_run', x: 0, y: 0 }]).trim() === '');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
