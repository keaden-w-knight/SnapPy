import './locale'; // Installs Blockly.Msg; must precede any block instantiation.
import * as Blockly from 'blockly/core';
import 'blockly/blocks'; // Must load before the restyle pass below.
import { pythonGenerator, Order } from 'blockly/python';

/**
 * Scratch-flavoured blocks that don't exist in stock Blockly. Everything else
 * (if/else, comparisons, variables, lists, functions) reuses Blockly's built-in
 * blocks, which already have correct Python generators -- we only restyle them.
 */
Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'snappy_when_run',
    message0: 'when ▶ program starts',
    nextStatement: null,
    style: 'event_blocks',
    tooltip: 'Everything under this block runs when you press Run.',
  },
  {
    type: 'snappy_print',
    message0: 'say %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'output_blocks',
    tooltip: 'print(...) -- shows a value in the console.',
  },
  {
    type: 'snappy_ask',
    message0: 'ask %1 and wait',
    args0: [{ type: 'input_value', name: 'PROMPT' }],
    output: 'String',
    inputsInline: true,
    style: 'input_blocks',
    tooltip: 'input(...) -- pauses until you type a line in the console.',
  },
  {
    type: 'snappy_ask_number',
    message0: 'ask %1 for a number',
    args0: [{ type: 'input_value', name: 'PROMPT' }],
    output: 'Number',
    inputsInline: true,
    style: 'input_blocks',
    tooltip: 'float(input(...)) -- reads a line and converts it to a number.',
  },
  {
    type: 'snappy_wait',
    message0: 'wait %1 seconds',
    args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'control_blocks',
    tooltip: 'time.sleep(...)',
  },
  {
    type: 'snappy_forever',
    message0: 'forever %1',
    args0: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    style: 'control_blocks',
    tooltip: 'while True: -- press Stop to break out.',
  },
  {
    type: 'snappy_random',
    message0: 'pick random %1 to %2',
    args0: [
      { type: 'input_value', name: 'FROM', check: 'Number' },
      { type: 'input_value', name: 'TO', check: 'Number' },
    ],
    output: 'Number',
    inputsInline: true,
    style: 'operator_blocks',
    tooltip: 'random.randint(a, b)',
  },
]);

/** `definitions_` is where the Python generator collects hoisted imports. */
type WithDefinitions = { definitions_: Record<string, string> };
function addImport(module: string) {
  (pythonGenerator as unknown as WithDefinitions).definitions_[`import_${module}`] =
    `import ${module}`;
}

/** Python needs a body; an empty C-block has to become `pass`. */
function body(block: Blockly.Block, name: string): string {
  return pythonGenerator.statementToCode(block, name) || `${pythonGenerator.INDENT}pass\n`;
}

const G = pythonGenerator.forBlock;

// The hat contributes no code of its own -- Blockly appends the stack beneath it.
G['snappy_when_run'] = () => '';

G['snappy_print'] = (block) => {
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || "''";
  return `print(${value})\n`;
};

G['snappy_ask'] = (block) => {
  const prompt = pythonGenerator.valueToCode(block, 'PROMPT', Order.NONE) || "''";
  return [`input(${prompt})`, Order.FUNCTION_CALL];
};

G['snappy_ask_number'] = (block) => {
  const prompt = pythonGenerator.valueToCode(block, 'PROMPT', Order.NONE) || "''";
  return [`float(input(${prompt}))`, Order.FUNCTION_CALL];
};

G['snappy_wait'] = (block) => {
  addImport('time');
  const seconds = pythonGenerator.valueToCode(block, 'SECONDS', Order.NONE) || '1';
  return `time.sleep(${seconds})\n`;
};

G['snappy_forever'] = (block) => `while True:\n${body(block, 'DO')}`;

G['snappy_random'] = (block) => {
  addImport('random');
  const from = pythonGenerator.valueToCode(block, 'FROM', Order.NONE) || '1';
  const to = pythonGenerator.valueToCode(block, 'TO', Order.NONE) || '10';
  return [`random.randint(${from}, ${to})`, Order.FUNCTION_CALL];
};

/**
 * Blockly groups if/else with the comparison blocks under one "logic" style, but
 * Scratch splits them: control flow is orange, comparisons are green. The theme
 * paints logic_blocks green, so the C-shaped control blocks get moved across here.
 */
const RESTYLE_AS_CONTROL = [
  'controls_if',
  'controls_repeat_ext',
  'controls_whileUntil',
  'controls_for',
  'controls_forEach',
  'controls_flow_statements',
];

for (const type of RESTYLE_AS_CONTROL) {
  const definition = Blockly.Blocks[type] as { init?: (this: Blockly.Block) => void } | undefined;
  const original = definition?.init;
  if (!definition || !original) continue;
  definition.init = function (this: Blockly.Block) {
    original.call(this);
    this.setStyle('control_blocks');
  };
}
