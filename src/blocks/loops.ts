import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import { installVarSlot, slotName } from './names';

/**
 * Loops whose variable is an oval you can drag out, not a dropdown.
 *
 * Blockly's `controls_for`/`controls_forEach` name their target with a
 * `field_variable`, which forces the loop variable to be a *workspace* variable:
 * it joins every variable dropdown in the project and clutters the Variables
 * palette, even though `for i in ...` binds `i` locally.
 *
 * Here the name lives in a `snappy_local_get` block plugged into the loop's VAR
 * socket. Drag it out and you have a reference to use in the body; the loop
 * grows a fresh one in its place, so it reads as copying rather than removing.
 * Nothing touches the workspace variable list.
 */

// A function extension rather than a mixin: it has to call setOnChange itself.
Blockly.Extensions.register('snappy_var_slot', function (this: Blockly.Block) {
  installVarSlot(this);
});

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'snappy_for_each',
    message0: 'for each %1 in %2',
    args0: [
      { type: 'input_value', name: 'VAR' },
      { type: 'input_value', name: 'LIST' },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'control_blocks',
    extensions: ['snappy_var_slot'],
    tooltip: 'Repeat once for each item in a list. Drag the name out to use it.',
  },
  {
    type: 'snappy_for_range',
    message0: 'count with %1 from %2 to %3 by %4',
    args0: [
      { type: 'input_value', name: 'VAR' },
      { type: 'input_value', name: 'FROM', check: 'Number' },
      { type: 'input_value', name: 'TO', check: 'Number' },
      { type: 'input_value', name: 'BY', check: 'Number' },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'control_blocks',
    extensions: ['snappy_var_slot'],
    tooltip: 'Count through a range of numbers. "to" is included.',
  },
]);

function body(block: Blockly.Block): string {
  return pythonGenerator.statementToCode(block, 'DO') || `${pythonGenerator.INDENT}pass\n`;
}

pythonGenerator.forBlock['snappy_for_each'] = (block) => {
  const list = pythonGenerator.valueToCode(block, 'LIST', Order.RELATIONAL) || '[]';
  return `for ${slotName(block)} in ${list}:\n${body(block)}`;
};

/**
 * "to" is inclusive, matching the other blocks rather than Python's half-open
 * range, so the bound is adjusted here. Literal arguments are folded so the
 * common case reads as a plain `range(1, 11)` instead of `range(1, 10 + 1)`.
 */
pythonGenerator.forBlock['snappy_for_range'] = (block) => {
  const from = pythonGenerator.valueToCode(block, 'FROM', Order.NONE) || '0';
  const to = pythonGenerator.valueToCode(block, 'TO', Order.NONE) || '0';
  const by = pythonGenerator.valueToCode(block, 'BY', Order.NONE) || '1';

  const step = Number(by);
  const stopLiteral = Number(to);
  const descending = Number.isFinite(step) && step < 0;

  let stop: string;
  if (Number.isFinite(stopLiteral)) {
    stop = String(stopLiteral + (descending ? -1 : 1));
  } else {
    stop = `${to} ${descending ? '-' : '+'} 1`;
  }

  const args = step === 1 ? `${from}, ${stop}` : `${from}, ${stop}, ${by}`;
  return `for ${slotName(block)} in range(${args}):\n${body(block)}`;
};
