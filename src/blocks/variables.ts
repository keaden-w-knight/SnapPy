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
 * The true/false shape of the same thing. Zelos draws a `Boolean` output as a
 * hexagon, so a boolean parameter looks like the sockets it can drop into.
 */
Blockly.Blocks['snappy_local_get_boolean'] = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField(new Blockly.FieldTextInput('flag', toIdentifier), 'NAME');
    this.setOutput(true, 'Boolean');
    this.setStyle('variable_blocks');
    this.setTooltip('Use the value of a local true/false variable.');
  },
};

pythonGenerator.forBlock['snappy_local_get_boolean'] = (block) => nameExpression(block);

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

/**
 * A name on its own is a reference with no effect, so an unattached one
 * generates nothing. Blockly's default turns a top-level value block into a
 * statement, which for a name oval left on the canvas means a bare `input1`
 * line and a NameError -- code for a block the user never meant to run.
 */
function nameExpression(block: Blockly.Block): [string, number] {
  if (!block.getParent()) return ['', Order.ATOMIC];
  return [toIdentifier(block.getFieldValue('NAME')), Order.ATOMIC];
}

pythonGenerator.forBlock['snappy_local_get'] = nameExpression;

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

/**
 * Deleting a variable is gone from the dropdown, so this is how a name that is
 * no longer used leaves the palette. It only removes variables with zero blocks
 * referencing them, which makes it safe to press without reading carefully --
 * the property the per-variable delete lacked.
 */
const CLEANUP_CALLBACK = 'SNAPPY_CLEAN_VARIABLES';

function unusedVariables(workspace: Blockly.Workspace): Blockly.VariableModel[] {
  const used = new Set<string>();
  for (const block of workspace.getAllBlocks(false)) {
    for (const model of block.getVarModels?.() ?? []) used.add(model.getId());
  }
  return workspace.getAllVariables().filter((model) => !used.has(model.getId()));
}

export function registerVariablesCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerButtonCallback(CLEANUP_CALLBACK, (button) => {
    const ws = button.getTargetWorkspace();
    const unused = unusedVariables(ws);
    if (!unused.length) {
      Blockly.dialog.alert('Every variable is being used by a block.');
      return;
    }
    const names = unused.map((model) => model.name).join(', ');
    Blockly.dialog.confirm(`Remove ${unused.length} unused variable(s)? (${names})`, (ok) => {
      if (!ok) return;
      for (const model of unused) ws.deleteVariableById(model.getId());
      ws.refreshToolboxSelection();
    });
  });

  workspace.registerToolboxCategoryCallback(VARIABLES_CATEGORY, (ws) => {
    const items = Blockly.Variables.flyoutCategory(ws as Blockly.WorkspaceSvg);
    // flyoutCategory returns XML elements, so the additions have to be XML too.
    const extra = Blockly.utils.xml.textToDom(
      `<xml>${LOCAL_BLOCKS}` +
        `<button text="Remove unused variables" callbackKey="${CLEANUP_CALLBACK}"></button>` +
        `</xml>`,
    );
    items.push(...Array.from(extra.children));
    return items;
  });
}
