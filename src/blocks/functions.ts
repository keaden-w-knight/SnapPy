import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';

/**
 * Call blocks that pick their target from a dropdown of the functions currently
 * defined, rather than Blockly's default of one fixed call block per function.
 *
 * Two shapes, because Python allows both and the block shape is what tells a
 * learner which is which:
 *   snappy_call        statement -- `greet()` on its own line
 *   snappy_call_value  oval      -- `greet()` inside an operator or another input
 *
 * Both list every defined function. A function without an explicit return still
 * calls fine in an expression (it yields None), so filtering the oval block down
 * to only return-functions would hide functions for no real gain.
 */

const NO_FUNCTION = '';
const PLACEHOLDER = '(define a function first)';

type ProcedureTuple = [string, string[], boolean];

interface ProcedureDefBlock extends Blockly.Block {
  getProcedureDef(): ProcedureTuple;
}

interface CallBlock extends Blockly.Block {
  params_: string[];
  updateShape_(params: string[]): void;
}

/** Every function defined in the workspace, both kinds, sorted by name. */
function procedureOptions(this: Blockly.Field): Blockly.MenuOption[] {
  const block = this.getSourceBlock();
  const workspace = block?.workspace;
  const options: Blockly.MenuOption[] = [];

  if (workspace) {
    const [withoutReturn, withReturn] = Blockly.Procedures.allProcedures(workspace);
    for (const [name] of [...withoutReturn, ...withReturn]) options.push([name, name]);
    options.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }

  // Blockly requires the current value to be present, even if the function was
  // deleted -- otherwise it silently rewrites the field and the block loses its
  // target. onchange() flags the dangling reference instead.
  const current = block?.getFieldValue('NAME');
  if (current && current !== NO_FUNCTION && !options.some(([, value]) => value === current)) {
    options.unshift([current, current]);
  }

  return options.length ? options : [[PLACEHOLDER, NO_FUNCTION]];
}

/** Shared behaviour: keep the argument sockets matching the chosen function. */
const CALL_MIXIN = {
  params_: [] as string[],

  saveExtraState(this: CallBlock) {
    return { params: this.params_ };
  },

  loadExtraState(this: CallBlock, state: { params?: string[] }) {
    this.updateShape_(state.params ?? []);
  },

  /**
   * Rebuild the argument inputs. Connections are carried across by parameter
   * name, so renaming an unrelated parameter does not detach a value the user
   * plugged in somewhere else.
   */
  updateShape_(this: CallBlock, params: string[]) {
    const unchanged =
      params.length === this.params_.length && params.every((p, i) => p === this.params_[i]);
    if (unchanged) return;

    const attached = new Map<string, Blockly.Connection>();
    this.params_.forEach((name, i) => {
      const target = this.getInput(`ARG${i}`)?.connection?.targetConnection;
      if (target) attached.set(name, target);
      if (this.getInput(`ARG${i}`)) this.removeInput(`ARG${i}`);
    });

    this.params_ = [...params];
    params.forEach((name, i) => {
      const input = this.appendValueInput(`ARG${i}`).appendField(name, `ARGNAME${i}`);
      const previous = attached.get(name);
      if (previous) input.connection?.connect(previous);
    });
  },

  onchange(this: CallBlock, event: Blockly.Events.Abstract) {
    if (this.isInFlyout || !this.workspace || event.isUiEvent) return;

    const name = this.getFieldValue('NAME');
    if (!name) {
      this.setWarningText(null);
      this.updateShape_([]);
      return;
    }

    const definition = Blockly.Procedures.getDefinition(name, this.workspace) as
      | ProcedureDefBlock
      | undefined;

    if (!definition?.getProcedureDef) {
      this.setWarningText(`There is no function called "${name}".`);
      return;
    }

    this.setWarningText(null);
    this.updateShape_(definition.getProcedureDef()[1]);
  },
};

Blockly.Blocks['snappy_call'] = {
  init(this: CallBlock) {
    this.appendDummyInput('HEADER')
      .appendField('run')
      .appendField(new Blockly.FieldDropdown(procedureOptions), 'NAME');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setInputsInline(true);
    this.setStyle('procedure_blocks');
    this.setTooltip('Run one of your functions.');
  },
  ...CALL_MIXIN,
};

Blockly.Blocks['snappy_call_value'] = {
  init(this: CallBlock) {
    this.appendDummyInput('HEADER')
      .appendField('result of')
      .appendField(new Blockly.FieldDropdown(procedureOptions), 'NAME');
    this.setOutput(true); // No type check: it fits any oval input.
    this.setInputsInline(true);
    this.setStyle('procedure_blocks');
    this.setTooltip('Use what one of your functions returns, inside another block.');
  },
  ...CALL_MIXIN,
};

/**
 * The generator must use the same name database as the definition, or a function
 * named e.g. `print` would be called under its original name while being defined
 * under a de-duplicated one.
 */
type WithNameDB = { nameDB_?: Blockly.Names };

function callExpression(block: Blockly.Block): string | null {
  const chosen = block.getFieldValue('NAME');
  if (!chosen) return null;

  const db = (pythonGenerator as unknown as WithNameDB).nameDB_;
  const name = db ? db.getName(chosen, Blockly.Names.NameType.PROCEDURE) : chosen;
  const params = (block as CallBlock).params_ ?? [];
  const args = params.map(
    (_, i) => pythonGenerator.valueToCode(block, `ARG${i}`, Order.NONE) || 'None',
  );
  return `${name}(${args.join(', ')})`;
}

pythonGenerator.forBlock['snappy_call'] = (block) => {
  const call = callExpression(block);
  return call ? `${call}\n` : '';
};

pythonGenerator.forBlock['snappy_call_value'] = (block) => {
  const call = callExpression(block);
  // An unset dropdown still has to yield a valid expression.
  return call ? [call, Order.FUNCTION_CALL] : ['None', Order.ATOMIC];
};

/**
 * Replaces Blockly's built-in PROCEDURE flyout, which lists one call block per
 * defined function. Here the two dropdown blocks cover every function, so the
 * palette stays the same size no matter how many are defined.
 */
export const FUNCTIONS_CATEGORY = 'SNAPPY_FUNCTIONS';

export function registerFunctionsCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerToolboxCategoryCallback(FUNCTIONS_CATEGORY, () => [
    { kind: 'block', type: 'procedures_defnoreturn' },
    { kind: 'block', type: 'procedures_defreturn' },
    { kind: 'block', type: 'snappy_call' },
    { kind: 'block', type: 'snappy_call_value' },
    { kind: 'block', type: 'procedures_ifreturn' },
  ]);
}

/**
 * Blockly hoists `name = None` for every variable a workspace uses, and function
 * parameters count as variables -- so `def greet(who)` also emitted a module
 * level `who = None`. That line is pure noise in the code pane, which is the
 * thing this app exists to show.
 *
 * Only parameters used nowhere outside a function definition are dropped. If the
 * same name is also used at the top level it keeps its declaration, because
 * there it really can be read before it is assigned.
 */
function parameterOnlyNames(workspace: Blockly.Workspace): Set<string> {
  const [withoutReturn, withReturn] = Blockly.Procedures.allProcedures(workspace);
  const names = new Set<string>();
  for (const [, params] of [...withoutReturn, ...withReturn]) {
    for (const param of params) names.add(param);
  }
  if (!names.size) return names;

  for (const block of workspace.getAllBlocks(false)) {
    if (isInsideProcedure(block)) continue;
    for (const model of block.getVarModels?.() ?? []) names.delete(model.name);
  }
  return names;
}

function isInsideProcedure(block: Blockly.Block | null): boolean {
  for (let current = block; current; current = current.getSurroundParent()) {
    if (typeof (current as unknown as Partial<ProcedureDefBlock>).getProcedureDef === 'function') {
      return true;
    }
  }
  return false;
}

type GeneratorInternals = { definitions_: Record<string, string> };

const baseInit = pythonGenerator.init.bind(pythonGenerator);
pythonGenerator.init = function (workspace: Blockly.Workspace) {
  baseInit(workspace);

  const skip = parameterOnlyNames(workspace);
  if (!skip.size) return;

  const internals = pythonGenerator as unknown as GeneratorInternals;
  const declarations = internals.definitions_['variables'];
  if (!declarations) return;

  // Compare against generated names: a variable may have been renamed to avoid
  // colliding with a reserved word.
  const generated = new Set([...skip].map((name) => pythonGenerator.getVariableName(name)));
  internals.definitions_['variables'] = declarations
    .split('\n')
    .filter((line) => !generated.has(line.split(' = ')[0]))
    .join('\n');
};
