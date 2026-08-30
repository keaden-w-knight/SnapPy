import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import '../src/blocks/blocks';
import { listFunctions, parameterSlot, qualify, removeParameter } from '../src/blocks/functions';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

const ws = new Blockly.Workspace();
function gen(blocks: unknown[]): string {
  ws.clear();
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks } } as never, ws);
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
const oval = (name: string) => ({
  block: { type: 'snappy_local_get', fields: { NAME: name } },
});
const param = (name: string) => ({ name, type: 'value' as const });

// --- block shapes ------------------------------------------------------------

{
  ws.clear();
  const standalone = ws.newBlock('snappy_function_def');
  const method = ws.newBlock('snappy_method_def');
  const klass = ws.newBlock('snappy_class_def');

  check('a standalone definition cannot be stacked onto',
    standalone.previousConnection === null && standalone.nextConnection === null);
  check('a method definition is an ordinary statement',
    method.previousConnection !== null && method.nextConnection !== null);
  check('a class cannot be stacked onto',
    klass.previousConnection === null && klass.nextConnection === null);
  check('a class takes a body', !!klass.getInput('BODY'));
}

// --- a class with methods ----------------------------------------------------

const DOG = [{
  type: 'snappy_class_def', x: 0, y: 0,
  fields: { NAME: 'Dog' },
  inputs: {
    BODY: {
      block: {
        type: 'snappy_method_def',
        fields: { NAME: '__init__' },
        extraState: { params: [param('self'), param('name')] },
        inputs: {
          PARAM0: oval('self'),
          PARAM1: oval('name'),
          DO: {
            block: {
              type: 'snappy_property_set',
              fields: { NAME: 'name' },
              inputs: { OBJECT: oval('self'), VALUE: oval('name') },
            },
          },
        },
        next: {
          block: {
            type: 'snappy_method_def',
            fields: { NAME: 'speak' },
            extraState: { params: [param('self')] },
            inputs: {
              PARAM0: oval('self'),
              DO: {
                block: {
                  type: 'snappy_print',
                  inputs: {
                    VALUE: {
                      block: {
                        type: 'snappy_property_get',
                        fields: { NAME: 'name' },
                        inputs: { OBJECT: oval('self') },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}];

{
  const code = gen(DOG);
  check('a class generates a class statement', code.includes('class Dog:'),
    JSON.stringify(code.trim()));
  check('methods are indented into the class',
    /class Dog:\n {2}def __init__\(self, name\):/.test(code), JSON.stringify(code.trim()));
  check('a second method sits alongside the first',
    /\n {2}def speak\(self\):/.test(code), JSON.stringify(code.trim()));
  check('setting a property assigns through the object',
    code.includes('self.name = name'), JSON.stringify(code.trim()));
  check('reading a property reads through the object',
    code.includes('print(self.name)'), JSON.stringify(code.trim()));
  check('a class -> valid Python', isValidPython(code));
  check('methods are not hoisted out of the class', !/^def __init__/m.test(code));
}

// --- what the call dropdown offers -------------------------------------------

{
  ws.clear();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: DOG } } as never, ws);
  const offered = listFunctions(ws).map(qualify).sort();
  check('the class is offered as something to call', offered.includes('Dog'),
    JSON.stringify(offered));
  check('its methods are offered, qualified by class',
    offered.includes('Dog.speak') && offered.includes('Dog.__init__'),
    JSON.stringify(offered));

  const dog = listFunctions(ws).find((def) => def.name === 'Dog')!;
  check('constructing takes __init__ inputs without self',
    JSON.stringify(dog.params.map((p) => p.name)) === '["name"]',
    JSON.stringify(dog.params));
  check('a method knows which class it belongs to',
    listFunctions(ws).find((def) => def.name === 'speak')?.owner === 'Dog');
}

// --- calling ------------------------------------------------------------------

{
  const code = gen([
    ...DOG,
    {
      type: 'snappy_local_set', x: 0, y: 400,
      inputs: {
        VAR: oval('rex'),
        VALUE: {
          block: {
            type: 'snappy_call_value',
            fields: { NAME: 'Dog' },
            extraState: { params: [param('name')] },
            inputs: { ARG0: text('Rex') },
          },
        },
      },
    },
  ]);
  check('calling a class constructs an instance', code.includes("rex = Dog('Rex')"),
    JSON.stringify(code.trim()));
  check('constructing -> valid Python', isValidPython(code));
}

{
  // A method call needs the object socket, which onchange adds; build it directly.
  ws.clear();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: DOG } } as never, ws);

  const call = ws.newBlock('snappy_call') as Blockly.Block & {
    setTargetKind_(kind: string): void;
    updateShape_(params: unknown[]): void;
  };
  call.setFieldValue('Dog.speak', 'NAME');
  call.updateShape_([]);
  call.setTargetKind_('method');

  const target = ws.newBlock('snappy_local_get');
  target.setFieldValue('rex', 'NAME');
  call.getInput('ON')!.connection!.connect(target.outputConnection!);

  const code = pythonGenerator.workspaceToCode(ws);
  check('a method call goes through its object', code.includes('rex.speak()'),
    JSON.stringify(code.trim()));
  check('a method call -> valid Python', isValidPython(code));
}

// --- editing and removing parameters ----------------------------------------

{
  ws.clear();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{
    type: 'snappy_function_def', x: 0, y: 0, fields: { NAME: 'greet' },
    extraState: { params: [param('who'), param('loud')] },
    inputs: {
      PARAM0: oval('who'),
      PARAM1: oval('loud'),
      DO: { block: { type: 'snappy_print', inputs: {
        VALUE: { block: { type: 'snappy_local_get', fields: { NAME: 'who' } } } } } },
    },
  }] } } as never, ws);

  const def = ws.getAllBlocks(false).find((b) => b.type === 'snappy_function_def')!;
  const slotted = ws.getAllBlocks(false).find(
    (b) => b.type === 'snappy_local_get' && b.getParent() === def)!;

  check('a name oval in a definition socket is a parameter',
    parameterSlot(slotted)?.index === 0, JSON.stringify(parameterSlot(slotted)?.index));

  const looseOval = ws.newBlock('snappy_local_get');
  check('a loose oval is not a parameter', parameterSlot(looseOval) === null);
  looseOval.dispose(false);

  removeParameter(def as never, 1);
  check('removing a parameter drops it from the definition',
    pythonGenerator.workspaceToCode(ws).includes('def greet(who):'),
    JSON.stringify(pythonGenerator.workspaceToCode(ws).trim()));
  check('the removed socket is gone', !def.getInput('PARAM1'));
}

{
  // Renaming has to carry the body's uses with it, or the function breaks
  // silently: the signature changes and the body still says the old name.
  ws.clear();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{
    type: 'snappy_function_def', x: 0, y: 0, fields: { NAME: 'greet' },
    extraState: { params: [param('who')] },
    inputs: {
      PARAM0: oval('who'),
      DO: { block: { type: 'snappy_print', inputs: {
        VALUE: { block: { type: 'snappy_local_get', fields: { NAME: 'who' } } } } } },
    },
  }] } } as never, ws);

  const def = ws.getAllBlocks(false).find(
    (b) => b.type === 'snappy_function_def') as Blockly.Block & {
      params_: { name: string; type: string }[];
      updateShape_(p: unknown[]): void;
    };

  // What the edit dialog does once the user confirms.
  for (const block of def.getDescendants(false)) {
    if (block.type === 'snappy_local_get' && block.getFieldValue('NAME') === 'who') {
      block.setFieldValue('name', 'NAME');
    }
  }
  def.updateShape_([{ name: 'name', type: 'boolean' }]);

  const code = pythonGenerator.workspaceToCode(ws);
  check('renaming a parameter renames its uses',
    code.includes('def greet(name):') && code.includes('print(name)'),
    JSON.stringify(code.trim()));
  check('the old name is gone from the body', !code.includes('who'));
  check('changing the type reshapes the socket',
    JSON.stringify(def.getInput('PARAM0')?.connection?.getCheck()) === '["Boolean"]',
    JSON.stringify(def.getInput('PARAM0')?.connection?.getCheck()));
}

{
  // The hexagonal return, for a function that answers a question.
  const code = gen([{
    type: 'snappy_function_def', x: 0, y: 0, fields: { NAME: 'is_ready' },
    extraState: { params: [] },
    inputs: { DO: { block: { type: 'snappy_return_boolean',
      inputs: { VALUE: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } } } } },
  }]);
  check('the hexagonal return generates the same statement',
    code.includes('return True'), JSON.stringify(code.trim()));
  check('hexagonal return -> valid Python', isValidPython(code));

  const ret = ws.getAllBlocks(false).find((b) => b.type === 'snappy_return_boolean')!;
  check('its socket only takes a boolean',
    JSON.stringify(ret.getInput('VALUE')?.connection?.getCheck()) === '["Boolean"]');

  const plain = ws.newBlock('snappy_return');
  check('the ordinary return still takes anything',
    plain.getInput('VALUE')?.connection?.getCheck() === null);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
