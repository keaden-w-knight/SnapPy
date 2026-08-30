import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import { toIdentifier } from './names';
import { CLASS_BLOCK, METHOD_BLOCK } from './functions';

/**
 * Classes.
 *
 * The class block wears a hat for the same reason the `when program starts` and
 * standalone function blocks do: it begins something, so nothing can be stacked
 * onto it. Its body takes method definitions -- which is why the definition
 * block comes in a statement shape as well as a standalone one.
 *
 * A definition inside a class becomes a method: `self` is added as its first
 * input automatically, and the special-method names appear in a menu. That lives
 * in functions.ts, next to the definition block it changes.
 */

Blockly.common.defineBlocksWithJsonArray([
  {
    type: CLASS_BLOCK,
    message0: 'class %1',
    args0: [{ type: 'field_input', name: 'NAME', text: 'Thing' }],
    message1: 'has %1',
    args1: [{ type: 'input_statement', name: 'BODY' }],
    style: 'class_blocks',
    tooltip: 'Define a class. Put method definitions inside it.',
  },
  {
    type: 'snappy_property_set',
    message0: 'set %1 . %2 to %3',
    args0: [
      { type: 'input_value', name: 'OBJECT' },
      { type: 'field_input', name: 'NAME', text: 'value' },
      { type: 'input_value', name: 'VALUE' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'class_member_blocks',
    tooltip: 'self.value = ... -- stores something on an object.',
  },
  {
    type: 'snappy_property_get',
    message0: '%1 . %2',
    args0: [
      { type: 'input_value', name: 'OBJECT' },
      { type: 'field_input', name: 'NAME', text: 'value' },
    ],
    output: null,
    inputsInline: true,
    style: 'class_member_blocks',
    tooltip: 'self.value -- reads something stored on an object.',
  },
]);

/** Names in Python are identifiers; keep the field honest about that. */
for (const type of [CLASS_BLOCK, 'snappy_property_set', 'snappy_property_get']) {
  const definition = Blockly.Blocks[type] as { init: () => void };
  const original = definition.init;
  definition.init = function (this: Blockly.Block) {
    original.call(this);
    this.getField('NAME')?.setValidator(toIdentifier);
  };
}

pythonGenerator.forBlock[CLASS_BLOCK] = (block, generator) => {
  const name = toIdentifier(block.getFieldValue('NAME'));
  const body = generator.statementToCode(block, 'BODY') || `${generator.INDENT}pass\n`;
  return `class ${name}:\n${body}\n`;
};

/** Defaults to `self`, which is what these blocks are for most of the time. */
function objectExpression(block: Blockly.Block): string {
  return pythonGenerator.valueToCode(block, 'OBJECT', Order.MEMBER) || 'self';
}

pythonGenerator.forBlock['snappy_property_set'] = (block) => {
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || 'None';
  return `${objectExpression(block)}.${toIdentifier(block.getFieldValue('NAME'))} = ${value}\n`;
};

pythonGenerator.forBlock['snappy_property_get'] = (block) => [
  `${objectExpression(block)}.${toIdentifier(block.getFieldValue('NAME'))}`,
  Order.MEMBER,
];

export const CLASSES_CATEGORY = 'SNAPPY_CLASSES';

/** Pre-filled with a `self` oval, since that is the common case by far. */
const SELF = { block: { type: 'snappy_local_get', fields: { NAME: 'self' } } };

export function registerClassesCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerToolboxCategoryCallback(CLASSES_CATEGORY, () => [
    { kind: 'block', type: CLASS_BLOCK },
    { kind: 'block', type: METHOD_BLOCK },
    { kind: 'block', type: 'snappy_property_set', inputs: { OBJECT: SELF } },
    { kind: 'block', type: 'snappy_property_get', inputs: { OBJECT: SELF } },
    { kind: 'block', type: 'snappy_local_get', fields: { NAME: 'self' } },
  ]);
}
