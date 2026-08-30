import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import { installVarSlot, slotName, toIdentifier } from './names';

/**
 * Local variables: a name typed straight into the block, rather than one of
 * Blockly's workspace variables.
 *
 * Blockly's variables are all workspace-global -- creating a throwaway counter
 * inside one function adds it to every variable dropdown in the project. These
 * blocks lean on Python's own scoping instead: an assignment inside a function
 * makes a local, so `make counter = 0` in a function body is local to it and the
 * name never joins the global palette.
 *
 * The trade-off is that nothing checks the spelling. A typo in the getter is a
 * NameError at runtime -- which the error highlighter points straight at.
 */

Blockly.Blocks['snappy_local_get'] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField(new Blockly.FieldTextInput('counter', toIdentifier), 'NAME');
    this.setOutput(true); // Untyped, so it drops into any oval input.
    this.setStyle('variable_blocks');
    this.setTooltip('Use the value of a local variable.');
  },
};

/**
 * The name is an oval in a socket rather than a text field, so it can be dragged
 * out and reused -- the same interaction the loops use. See loops.ts.
 */
Blockly.Blocks['snappy_local_set'] = {
  init(this: Blockly.Block) {
    this.appendValueInput('VAR').appendField('make');
    this.appendValueInput('VALUE').appendField('=');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setInputsInline(true);
    this.setStyle('variable_blocks');
    this.setTooltip(
      'Create a variable that belongs to the function or loop it sits in. ' +
        'Drag the name out to use it.',
    );
    installVarSlot(this);
  },
};

pythonGenerator.forBlock['snappy_local_set'] = (block) => {
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || 'None';
  return `${slotName(block)} = ${value}\n`;
};

pythonGenerator.forBlock['snappy_local_get'] = (block) => [
  toIdentifier(block.getFieldValue('NAME')),
  Order.ATOMIC,
];

/**
 * Blockly's stock Variables flyout (the "Create variable..." button and the
 * global set/get/change blocks) with the local blocks appended, so both kinds
 * sit in one place and the difference is visible side by side.
 */
export const VARIABLES_CATEGORY = 'SNAPPY_VARIABLES';

/**
 * Drop "Delete the 'x' variable" from the variable dropdown. It removes every
 * block using the variable in one click, with a confirmation that is easy to
 * dismiss by reflex -- too much destruction for a menu meant for renaming.
 * Unused variables can still be cleared by starting a new project.
 */
const originalVariableOptions = Blockly.FieldVariable.dropdownCreate;
Blockly.FieldVariable.dropdownCreate = function (this: Blockly.FieldVariable) {
  return originalVariableOptions
    .call(this)
    .filter(([, value]) => value !== Blockly.DELETE_VARIABLE_ID);
};

const LOCAL_BLOCKS = `
  <block type="snappy_local_set">
    <value name="VAR"><block type="snappy_local_get"><field name="NAME">counter</field></block></value>
    <value name="VALUE"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
  </block>
  <block type="snappy_local_get"></block>
`;

export function registerVariablesCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerToolboxCategoryCallback(VARIABLES_CATEGORY, (ws) => {
    const items = Blockly.Variables.flyoutCategory(ws as Blockly.WorkspaceSvg);
    // flyoutCategory returns XML elements, so the additions have to be XML too.
    const extra = Blockly.utils.xml.textToDom(`<xml>${LOCAL_BLOCKS}</xml>`);
    items.push(...Array.from(extra.children));
    return items;
  });
}
