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

const UNSET = '';
/** Shown when functions exist but none has been picked yet. */
const SELECT_PROMPT = 'select a function';
/** Shown when there is nothing to pick. Choosing it is a no-op. */
const NONE_DEFINED = 'define a function first';

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
  const owner = this.getSourceBlock()?.workspace as
    | (Blockly.Workspace & { isFlyout?: boolean; targetWorkspace?: Blockly.Workspace })
    | undefined;
  // A block sitting in the flyout belongs to the flyout's own workspace, which
  // holds only the palette's sample blocks. Ask the workspace it will be dropped
  // into, so the menu offers the project's real functions.
  const workspace = owner?.isFlyout ? owner.targetWorkspace : owner;
  const names: string[] = [];

  if (workspace) {
    const [withoutReturn, withReturn] = Blockly.Procedures.allProcedures(workspace);
    for (const [name] of [...withoutReturn, ...withReturn]) names.push(name);
    names.sort((a, b) => a.localeCompare(b));
  }

  if (!names.length) return [[NONE_DEFINED, UNSET]];

  const options: Blockly.MenuOption[] = names.map((name) => [name, name]);
  // The prompt is only offered while nothing is chosen, so it cannot be picked
  // to un-choose a function by accident.
  if (this.getValue() === UNSET) options.unshift([SELECT_PROMPT, UNSET]);
  return options;
}

/**
 * A dropdown that never rewrites its own value.
 *
 * Blockly's FieldDropdown rejects any value missing from the current option
 * list and falls back to the first option. With a dynamic list that is a trap:
 * the list is empty while a call block is being deserialised ahead of its
 * definition, while the block sits in the flyout, and briefly during some
 * workspace edits -- so a chosen function would silently revert to the
 * placeholder. Here the name is authoritative, and a name with no matching
 * definition is reported by onchange() as a warning instead.
 */
class FunctionNameField extends Blockly.FieldDropdown {
  // Both overloads must be restated, or the class narrows to Field<string> and
  // no longer matches Blockly's Field<string | undefined>.
  protected override doClassValidation_(newValue: string): string | null | undefined;
  protected override doClassValidation_(newValue?: string): string | null;
  protected override doClassValidation_(newValue?: string): string | null | undefined {
    return typeof newValue === 'string' ? newValue : null;
  }

  /**
   * FieldDropdown caches the chosen option -- label included -- in
   * selectedOption_ when the value is set. That happens in the constructor,
   * before the field has a source block, so the label froze as the "no
   * functions" placeholder and stayed there even once functions existed.
   * Deriving the label from the live options instead keeps it honest.
   */
  protected override getText_(): string | null {
    const value = this.getValue();
    const match = this.getOptions().find(([, option]) => option === value);
    return typeof match?.[0] === 'string' ? match[0] : null;
  }

  override getOptions(): Blockly.MenuOption[] {
    // Never use Blockly's cache. The first generation happens in the field
    // constructor, before the field has a source block -- so it caches the
    // "no functions" placeholder and would keep serving it forever, including
    // for blocks dragged out of the flyout.
    const options = super.getOptions(false);
    const value = this.getValue();
    // Keep the selected name present so the menu shows it and Blockly's own
    // lookup for the display label succeeds.
    if (typeof value === 'string' && value !== UNSET &&
        !options.some(([, option]) => option === value)) {
      return [[value, value], ...options];
    }
    return options;
  }
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
      .appendField(new FunctionNameField(procedureOptions), 'NAME');
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
      .appendField(new FunctionNameField(procedureOptions), 'NAME');
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

/**
 * Blockly emits `global a, b` at the top of every function for every workspace
 * variable that is not one of that function's parameters -- whether or not the
 * body mentions it. So defining any global variable anywhere puts its name
 * inside every function, which reads as though the function uses it.
 *
 * Names the body never references are narrowed away. A `global` for a variable
 * that is only read is a no-op anyway, and one for a variable that is never
 * touched is pure noise, so dropping them cannot change behaviour. Names that
 * are not workspace variables (Blockly's developer variables) are left alone.
 */
function narrowGlobals(block: Blockly.Block, code: string): string {
  const lines = code.split('\n');
  const defIndex = lines.findIndex((line) => line.startsWith('def '));
  if (defIndex === -1) return code;

  // Blockly always emits the global line first in the body, so match it by
  // position rather than by scanning -- user code could contain the word too.
  const globalLine = lines[defIndex + 1] ?? '';
  const match = /^(\s+)global (.+)$/.exec(globalLine);
  if (!match) return code;

  const referenced = new Set<string>();
  for (const descendant of block.getDescendants(false)) {
    if (descendant === block) continue; // its own params are not globals
    for (const model of descendant.getVarModels?.() ?? []) {
      referenced.add(pythonGenerator.getVariableName(model.name));
    }
  }
  const workspaceVars = new Set(
    block.workspace.getAllVariables().map((v) => pythonGenerator.getVariableName(v.name)),
  );

  const declared = match[2].split(', ');
  const kept = declared.filter((name) => referenced.has(name) || !workspaceVars.has(name));
  if (kept.length === declared.length) return code;

  if (kept.length) lines[defIndex + 1] = match[1] + 'global ' + kept.join(', ');
  else lines.splice(defIndex + 1, 1);
  return lines.join('\n');
}

// The definition generators return null and stash their code in definitions_,
// so the narrowing has to happen there rather than on a returned string.
for (const type of ['procedures_defnoreturn', 'procedures_defreturn'] as const) {
  const original = pythonGenerator.forBlock[type];
  if (!original) continue;
  pythonGenerator.forBlock[type] = function (block, generator) {
    const definitions = (generator as unknown as GeneratorInternals).definitions_;
    const before = new Set(Object.keys(definitions));
    const result = original.call(this, block, generator);
    for (const key of Object.keys(definitions)) {
      if (!before.has(key)) definitions[key] = narrowGlobals(block, definitions[key]);
    }
    return result;
  };
}
