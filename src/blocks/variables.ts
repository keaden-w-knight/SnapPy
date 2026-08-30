import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';

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

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/**
 * Coerce whatever was typed into a legal Python identifier. Runs as a field
 * validator, so the block always displays exactly the name it will generate --
 * no silent difference between what is on screen and what runs.
 */
export function toIdentifier(raw: string | null): string {
  let name = (raw ?? '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!name) name = 'item';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (PYTHON_KEYWORDS.has(name)) name = `${name}_`;
  return name;
}

const nameField = () => new Blockly.FieldTextInput('counter', toIdentifier);

Blockly.Blocks['snappy_local_set'] = {
  init(this: Blockly.Block) {
    this.appendValueInput('VALUE')
      .appendField('make')
      .appendField(nameField(), 'NAME')
      .appendField('=');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setInputsInline(true);
    this.setStyle('variable_blocks');
    this.setTooltip(
      'Create a variable that belongs to the function or loop it sits in.',
    );
  },
};

Blockly.Blocks['snappy_local_get'] = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField(nameField(), 'NAME');
    this.setOutput(true); // Untyped, so it drops into any oval input.
    this.setStyle('variable_blocks');
    this.setTooltip('Use the value of a local variable.');
  },
};

pythonGenerator.forBlock['snappy_local_set'] = (block) => {
  const name = toIdentifier(block.getFieldValue('NAME'));
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || 'None';
  return `${name} = ${value}\n`;
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
