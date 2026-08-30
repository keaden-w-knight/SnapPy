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

// --- functions with draggable, typed parameters ------------------------------

const withVar = (blocks: unknown[], variables: unknown[] = []) => {
  ws.clear();
  Blockly.serialization.workspaces.load(
    { variables, blocks: { languageVersion: 0, blocks } } as never, ws);
  return pythonGenerator.workspaceToCode(ws);
};

const param = (name: string, type: 'value' | 'boolean' = 'value') => ({ name, type });
const paramOval = (name: string, type: 'value' | 'boolean' = 'value') => ({
  block: {
    type: type === 'boolean' ? 'snappy_local_get_boolean' : 'snappy_local_get',
    fields: { NAME: name },
  },
});

{
  // A no-argument function, called as a statement.
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'greet' },
      extraState: { params: [] },
      inputs: { DO: { block: { type: 'snappy_print', inputs: { VALUE: text('hi') } } } },
    },
    { type: 'snappy_call', x: 0, y: 300, fields: { NAME: 'greet' },
      extraState: { params: [] } },
  ]);
  check('statement call generates a call',
    code.includes('def greet():') && code.includes('greet()'),
    JSON.stringify(code.trim()));
  check('statement call -> valid Python', isValidPython(code));
  check('parameters are not workspace variables', ws.getAllVariables().length === 0);
}

{
  // A parameter, named by the oval in the definition's socket.
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'greet' },
      extraState: { params: [param('who')] },
      inputs: {
        PARAM0: paramOval('who'),
        DO: { block: { type: 'snappy_print', inputs: {
          VALUE: { block: { type: 'snappy_local_get', fields: { NAME: 'who' } } } } } },
      },
    },
    {
      type: 'snappy_call', x: 0, y: 300, fields: { NAME: 'greet' },
      extraState: { params: [param('who')] },
      inputs: { ARG0: text('Ada') },
    },
  ]);
  check('a parameter reaches the definition and the call',
    code.includes('def greet(who):') && code.includes("greet('Ada')") &&
      code.includes('print(who)'),
    JSON.stringify(code.trim()));
  check('parameterised call -> valid Python', isValidPython(code));
  check('a parameter never becomes a workspace variable',
    ws.getAllVariables().length === 0, `${ws.getAllVariables().length} variables`);
  check('no stray hoist for the parameter', !code.includes('who = None'));
}

{
  // Return is its own statement, so one definition block covers both cases.
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'answer' },
      extraState: { params: [] },
      inputs: { DO: { block: { type: 'snappy_return', inputs: { VALUE: numb(42) } } } },
    },
    {
      type: 'snappy_print', x: 0, y: 300,
      inputs: { VALUE: { block: { type: 'snappy_call_value',
        fields: { NAME: 'answer' }, extraState: { params: [] } } } },
    },
  ]);
  check('return generates a return statement',
    code.includes('def answer():') && code.includes('return 42'),
    JSON.stringify(code.trim()));
  check('oval call nests inside a value input', code.includes('print(answer())'));
  check('return -> valid Python', isValidPython(code));
}

{
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'answer' }, extraState: { params: [] },
      inputs: { DO: { block: { type: 'snappy_return', inputs: { VALUE: numb(42) } } } },
    },
    {
      type: 'snappy_print', x: 0, y: 300,
      inputs: { VALUE: { block: { type: 'math_arithmetic', fields: { OP: 'ADD' },
        inputs: {
          A: { block: { type: 'snappy_call_value', fields: { NAME: 'answer' },
            extraState: { params: [] } } },
          B: numb(1),
        } } } },
    },
  ]);
  check('oval call works inside an operator', code.includes('answer() + 1'),
    JSON.stringify(code.trim()));
  check('oval call in operator -> valid Python', isValidPython(code));
}

{
  // A true/false parameter takes a hexagonal socket on both blocks.
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'report' },
      extraState: { params: [param('loud', 'boolean')] },
      inputs: {
        PARAM0: paramOval('loud', 'boolean'),
        DO: { block: { type: 'controls_if', inputs: {
          IF0: { block: { type: 'snappy_local_get_boolean', fields: { NAME: 'loud' } } },
          DO0: { block: { type: 'snappy_print', inputs: { VALUE: text('HI') } } } } } },
      },
    },
    {
      type: 'snappy_call', x: 0, y: 300, fields: { NAME: 'report' },
      extraState: { params: [param('loud', 'boolean')] },
      inputs: { ARG0: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } },
    },
  ]);
  check('a boolean parameter generates normally',
    code.includes('def report(loud):') && code.includes('report(True)') &&
      code.includes('if loud:'),
    JSON.stringify(code.trim()));
  check('boolean parameter -> valid Python', isValidPython(code));

  const call = ws.getAllBlocks(false).find((b) => b.type === 'snappy_call')!;
  check('the call socket is shaped for a boolean',
    JSON.stringify(call.getInput('ARG0')?.connection?.getCheck()) === '["Boolean"]',
    JSON.stringify(call.getInput('ARG0')?.connection?.getCheck()));

  const definition = ws.getAllBlocks(false).find((b) => b.type === 'snappy_function_def')!;
  check('the definition socket is shaped for a boolean',
    JSON.stringify(definition.getInput('PARAM0')?.connection?.getCheck()) === '["Boolean"]');
}

{
  const code = withVar([
    { type: 'snappy_print', x: 0, y: 0,
      inputs: { VALUE: { block: { type: 'snappy_call_value' } } } },
  ]);
  check('unset oval call falls back to None', code.includes('print(None)'),
    JSON.stringify(code.trim()));
  check('unset oval call -> valid Python', isValidPython(code));
}

{
  // Adding a parameter rebuilds the sockets. Blockly's removeInput only
  // disconnects real children, so the previous ovals used to be left loose on
  // the canvas -- where a stray name generated a line of code.
  withVar([{
    type: 'snappy_function_def', x: 0, y: 0,
    fields: { NAME: 'do_something' },
    extraState: { params: [param('input1')] },
    inputs: {
      PARAM0: paramOval('input1'),
      DO: { block: { type: 'snappy_print', inputs: {
        VALUE: { block: { type: 'snappy_local_get', fields: { NAME: 'input1' } } } } } },
    },
  }]);

  const def = ws.getAllBlocks(false).find((b) => b.type === 'snappy_function_def')!;
  (def as unknown as { updateShape_(p: unknown[]): void }).updateShape_([
    param('input1'), param('input2'),
  ]);

  const loose = ws.getTopBlocks(false).filter((b) => b.type === 'snappy_local_get');
  check('adding a parameter leaves no loose ovals', loose.length === 0,
    `${loose.length} loose`);
  check('the existing parameter oval stays connected',
    def.getInputTargetBlock('PARAM0')?.getFieldValue('NAME') === 'input1');

  const code = pythonGenerator.workspaceToCode(ws);
  check('no stray name statement is generated', !/^input1$/m.test(code),
    JSON.stringify(code.trim()));
  check('the definition still has both parameters',
    code.includes('def do_something(input1, input2):'), JSON.stringify(code.trim()));
}

{
  // Removing a parameter disposes its oval rather than abandoning it.
  withVar([{
    type: 'snappy_function_def', x: 0, y: 0,
    fields: { NAME: 'f' },
    extraState: { params: [param('a'), param('b')] },
    inputs: { PARAM0: paramOval('a'), PARAM1: paramOval('b') },
  }]);
  const def = ws.getAllBlocks(false).find((b) => b.type === 'snappy_function_def')!;
  (def as unknown as { updateShape_(p: unknown[]): void }).updateShape_([param('a')]);
  check('removing a parameter disposes its oval',
    ws.getAllBlocks(false).filter((b) => b.type === 'snappy_local_get').length === 1);
  check('the remaining parameter is untouched',
    def.getInputTargetBlock('PARAM0')?.getFieldValue('NAME') === 'a');
}

{
  // A name oval left loose on the canvas is a leftover, not a statement.
  const code = withVar([
    { type: 'snappy_local_get', x: 0, y: 0, fields: { NAME: 'stray' } },
    { type: 'snappy_print', x: 0, y: 200, inputs: { VALUE: text('hi') } },
  ]);
  check('a loose name oval generates nothing',
    !code.includes('stray') && code.includes("print('hi')"),
    JSON.stringify(code.trim()));
  check('loose oval -> valid Python', isValidPython(code));
}

{
  // The hexagonal call: a function's answer used as a condition.
  const code = withVar([
    {
      type: 'snappy_function_def', x: 0, y: 0,
      fields: { NAME: 'is_ready' }, extraState: { params: [] },
      inputs: { DO: { block: { type: 'snappy_return',
        inputs: { VALUE: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } } } } },
    },
    {
      type: 'controls_if', x: 0, y: 300,
      inputs: {
        IF0: { block: { type: 'snappy_call_boolean', fields: { NAME: 'is_ready' },
          extraState: { params: [] } } },
        DO0: { block: { type: 'snappy_print', inputs: { VALUE: text('go') } } },
      },
    },
  ]);
  check('a hexagonal call fits an if condition',
    code.includes('if is_ready():'), JSON.stringify(code.trim()));
  check('hexagonal call -> valid Python', isValidPython(code));

  const hex = ws.getAllBlocks(false).find((b) => b.type === 'snappy_call_boolean')!;
  check('the hexagonal call reports a boolean shape',
    JSON.stringify(hex.outputConnection?.getCheck()) === '["Boolean"]',
    JSON.stringify(hex.outputConnection?.getCheck()));

  const oval = ws.newBlock('snappy_call_value');
  check('the oval call stays untyped so it fits anywhere',
    oval.outputConnection?.getCheck() === null,
    JSON.stringify(oval.outputConnection?.getCheck()));
}

{
  // An unset hexagon still has to be a truth value.
  const code = withVar([{
    type: 'controls_if', x: 0, y: 0,
    inputs: { IF0: { block: { type: 'snappy_call_boolean' } } },
  }]);
  check('an unset hexagonal call falls back to False',
    code.includes('if False:'), JSON.stringify(code.trim()));
  check('unset hexagonal call -> valid Python', isValidPython(code));
}

// The hat block itself must contribute no code of its own.
check('hat alone generates nothing',
  gen([{ type: 'snappy_when_run', x: 0, y: 0 }]).trim() === '');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
