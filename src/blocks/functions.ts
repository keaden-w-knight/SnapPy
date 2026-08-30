import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import { toIdentifier } from './names';
import { askForChoice } from '../ui/dialogs';

/**
 * Functions whose parameters are draggable ovals, not workspace variables.
 *
 * Blockly's own `procedures_*` blocks model each parameter as a workspace
 * variable, so declaring `do_something(param1)` puts `param1` in every variable
 * dropdown in the project. Here a parameter is a name block sitting in the
 * definition's socket: drag it into the body to use it, and the definition grows
 * a fresh one in its place.
 *
 * A parameter also has a *shape*. A value parameter is an oval; a true/false one
 * is a hexagon, which Zelos draws for a `Boolean` output. The call block's
 * matching argument socket takes the same shape, so what fits where is visible
 * rather than something to remember.
 *
 * There is one definition block rather than Blockly's separate with/without
 * return pair, because Python draws no such distinction: `return` is a
 * statement, and a function without one yields None.
 */

export type ParamType = 'value' | 'boolean';

export interface FunctionParam {
  name: string;
  type: ParamType;
}

export interface FunctionDef {
  name: string;
  params: FunctionParam[];
}

const DEF_BLOCK = 'snappy_function_def';

const GETTER_FOR: Record<ParamType, string> = {
  value: 'snappy_local_get',
  boolean: 'snappy_local_get_boolean',
};

const TYPE_OF_GETTER: Record<string, ParamType> = {
  snappy_local_get: 'value',
  snappy_local_get_boolean: 'boolean',
};

const PLUS_ICON =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<circle cx="10" cy="10" r="9" fill="#ffffff" opacity="0.95"/>' +
      '<path d="M10 5.5v9M5.5 10h9" stroke="#ff6680" stroke-width="2.6" ' +
      'stroke-linecap="round"/></svg>',
  );

interface DefBlock extends Blockly.Block {
  params_: FunctionParam[];
  updateShape_(params: FunctionParam[]): void;
  addParameter_(): void;
  getFunctionDef(): FunctionDef;
}

const paramInput = (index: number) => `PARAM${index}`;
const argInput = (index: number) => `ARG${index}`;

const sameParams = (a: FunctionParam[], b: FunctionParam[]) =>
  a.length === b.length && a.every((p, i) => p.name === b[i].name && p.type === b[i].type);

/** Builds a name block of the right shape for a parameter. */
function makeGetter(block: Blockly.Block, param: FunctionParam): Blockly.Block {
  const getter = block.workspace.newBlock(GETTER_FOR[param.type]);
  getter.setFieldValue(param.name, 'NAME');
  const svg = getter as Blockly.BlockSvg;
  if (svg.initSvg) {
    svg.initSvg();
    svg.render();
  }
  Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CREATE))(getter));
  return getter;
}

/**
 * Keeps `params_` in step with the ovals actually in the sockets, and puts one
 * back when it is dragged out -- the same "drag a copy" behaviour the loops use,
 * so a parameter is never lost by being used.
 */
function syncParameters(this: DefBlock, event: Blockly.Events.Abstract) {
  if (this.isInFlyout || !this.workspace || this.isDeadOrDying()) return;
  if ((this.workspace as Blockly.WorkspaceSvg).isDragging?.()) return;

  const previousGroup = Blockly.Events.getGroup();
  Blockly.Events.setGroup(event.group || true);
  try {
    this.params_.forEach((param, i) => {
      const socket = this.getInput(paramInput(i));
      if (!socket?.connection) return;

      const oval = socket.connection.targetBlock();
      if (!oval) {
        socket.connection.connect(makeGetter(this, param).outputConnection!);
        return;
      }
      // Renaming the oval renames the parameter; call blocks follow from there.
      param.name = toIdentifier(oval.getFieldValue('NAME') ?? param.name);
      param.type = TYPE_OF_GETTER[oval.type] ?? param.type;
    });
  } finally {
    Blockly.Events.setGroup(previousGroup);
  }
}

Blockly.Blocks[DEF_BLOCK] = {
  params_: [] as FunctionParam[],

  init(this: DefBlock) {
    this.appendDummyInput('HEADER')
      .appendField('to')
      .appendField(new Blockly.FieldTextInput('do_something', toIdentifier), 'NAME');
    this.appendDummyInput('ADD').appendField(
      new Blockly.FieldImage(PLUS_ICON, 20, 20, 'add input', () => this.addParameter_()),
      'ADD_BUTTON',
    );
    this.appendStatementInput('DO').appendField('do');
    this.setInputsInline(true);
    this.setStyle('procedure_blocks');
    this.setTooltip('Define a function. Drag its inputs into the body to use them.');
    // Registered explicitly: Blockly wires onchange during doInit_, which runs
    // before this definition's own properties would otherwise be consulted.
    this.setOnChange(syncParameters);
  },

  saveExtraState(this: DefBlock) {
    return { params: this.params_ };
  },

  loadExtraState(this: DefBlock, state: { params?: FunctionParam[] }) {
    this.updateShape_(state.params ?? []);
  },

  getFunctionDef(this: DefBlock): FunctionDef {
    return { name: toIdentifier(this.getFieldValue('NAME')), params: [...this.params_] };
  },

  updateShape_(this: DefBlock, params: FunctionParam[]) {
    if (sameParams(params, this.params_)) return;

    for (let i = 0; i < this.params_.length; i++) {
      if (this.getInput(paramInput(i))) this.removeInput(paramInput(i));
    }

    this.params_ = params.map((param) => ({ ...param }));
    this.params_.forEach((param, i) => {
      const input = this.appendValueInput(paramInput(i));
      if (param.type === 'boolean') input.setCheck('Boolean');
      // Appending puts it last, so pull it back in front of the + button.
      this.moveInputBefore(paramInput(i), 'ADD');
    });
  },

  addParameter_(this: DefBlock) {
    const taken = new Set(this.params_.map((param) => param.name));
    let suggestion = `input${this.params_.length + 1}`;
    while (taken.has(suggestion)) suggestion += '_';

    askForChoice({
      message: 'Add an input to this function:',
      defaultValue: suggestion,
      choices: [
        { label: 'value (oval)', value: 'value' },
        { label: 'true / false (hexagon)', value: 'boolean' },
      ],
      onDone: (result) => {
        if (!result) return;
        const name = toIdentifier(result.text);
        if (this.params_.some((param) => param.name === name)) {
          Blockly.dialog.alert(`This function already has an input called "${name}".`);
          return;
        }
        Blockly.Events.setGroup(true);
        try {
          this.updateShape_([...this.params_, { name, type: result.choice as ParamType }]);
        } finally {
          Blockly.Events.setGroup(false);
        }
      },
    });
  },

  /** Removing an input is rare enough to belong in the context menu. */
  customContextMenu(
    this: DefBlock,
    options: Blockly.ContextMenuRegistry.LegacyContextMenuOption[],
  ) {
    if (this.isInFlyout) return;
    for (const param of this.params_) {
      options.push({
        text: `Remove input "${param.name}"`,
        enabled: true,
        callback: () => {
          Blockly.Events.setGroup(true);
          try {
            this.updateShape_(this.params_.filter((other) => other.name !== param.name));
          } finally {
            Blockly.Events.setGroup(false);
          }
        },
      });
    }
  },
};

// --- looking functions up ---------------------------------------------------

export function listFunctions(workspace: Blockly.Workspace): FunctionDef[] {
  return workspace
    .getBlocksByType(DEF_BLOCK, false)
    .map((block) => (block as DefBlock).getFunctionDef())
    .filter((def) => def.name);
}

export function findFunction(name: string, workspace: Blockly.Workspace): FunctionDef | null {
  return listFunctions(workspace).find((def) => def.name === name) ?? null;
}

// --- call blocks ------------------------------------------------------------

const UNSET = '';
/** Shown when functions exist but none has been picked yet. */
const SELECT_PROMPT = 'select a function';
/** Shown when there is nothing to pick. Choosing it is a no-op. */
const NONE_DEFINED = 'define a function first';

interface CallBlock extends Blockly.Block {
  params_: FunctionParam[];
  updateShape_(params: FunctionParam[]): void;
}

function functionOptions(this: Blockly.Field): Blockly.MenuOption[] {
  const owner = this.getSourceBlock()?.workspace as
    | (Blockly.Workspace & { isFlyout?: boolean; targetWorkspace?: Blockly.Workspace })
    | undefined;
  // A block in the flyout belongs to the flyout's own workspace, which holds
  // only palette samples; ask the one it will be dropped into.
  const workspace = owner?.isFlyout ? owner.targetWorkspace : owner;
  const names = workspace ? listFunctions(workspace).map((def) => def.name) : [];
  names.sort((a, b) => a.localeCompare(b));

  if (!names.length) return [[NONE_DEFINED, UNSET]];
  const options: Blockly.MenuOption[] = names.map((name) => [name, name]);
  // Offered only while nothing is chosen, so it cannot un-choose by accident.
  if (this.getValue() === UNSET) options.unshift([SELECT_PROMPT, UNSET]);
  return options;
}

/**
 * A dropdown that never rewrites its own value.
 *
 * Blockly's FieldDropdown rejects a value missing from the current option list
 * and falls back to the first entry. That list is empty while a call block is
 * deserialised ahead of its definition and for a block in the flyout, so a
 * chosen function silently reverted to the placeholder. It also caches both the
 * option list (first built in the constructor, before the field has a source
 * block) and the display label, each of which froze at the placeholder.
 */
class FunctionNameField extends Blockly.FieldDropdown {
  // Both overloads must be restated, or the class narrows to Field<string> and
  // no longer matches Blockly's Field<string | undefined>.
  protected override doClassValidation_(newValue: string): string | null | undefined;
  protected override doClassValidation_(newValue?: string): string | null;
  protected override doClassValidation_(newValue?: string): string | null | undefined {
    return typeof newValue === 'string' ? newValue : null;
  }

  protected override getText_(): string | null {
    const value = this.getValue();
    const match = this.getOptions().find(([, option]) => option === value);
    return typeof match?.[0] === 'string' ? match[0] : null;
  }

  override getOptions(): Blockly.MenuOption[] {
    const options = super.getOptions(false); // never cached; see above
    const value = this.getValue();
    if (
      typeof value === 'string' &&
      value !== UNSET &&
      !options.some(([, option]) => option === value)
    ) {
      return [[value, value], ...options];
    }
    return options;
  }
}

const CALL_MIXIN = {
  params_: [] as FunctionParam[],

  saveExtraState(this: CallBlock) {
    return { params: this.params_ };
  },

  loadExtraState(this: CallBlock, state: { params?: FunctionParam[] }) {
    this.updateShape_(state.params ?? []);
  },

  /**
   * Rebuild the argument sockets, each shaped for its parameter. Connections are
   * carried across by parameter name, so renaming one input does not detach
   * values plugged into the others.
   */
  updateShape_(this: CallBlock, params: FunctionParam[]) {
    if (sameParams(params, this.params_)) return;

    const attached = new Map<string, Blockly.Connection>();
    this.params_.forEach((param, i) => {
      const target = this.getInput(argInput(i))?.connection?.targetConnection;
      if (target) attached.set(param.name, target);
      if (this.getInput(argInput(i))) this.removeInput(argInput(i));
    });

    this.params_ = params.map((param) => ({ ...param }));
    this.params_.forEach((param, i) => {
      const input = this.appendValueInput(argInput(i)).appendField(param.name, `ARGNAME${i}`);
      if (param.type === 'boolean') input.setCheck('Boolean');
      const previous = attached.get(param.name);
      if (previous) input.connection?.connect(previous);
    });
  },

  onchange(this: CallBlock, event: Blockly.Events.Abstract) {
    if (this.isInFlyout || !this.workspace || event.isUiEvent) return;

    const chosen = this.getFieldValue('NAME');
    if (!chosen) {
      this.setWarningText(null);
      this.updateShape_([]);
      return;
    }

    const def = findFunction(chosen, this.workspace);
    if (!def) {
      this.setWarningText(`There is no function called "${chosen}".`);
      return;
    }
    this.setWarningText(null);
    this.updateShape_(def.params);
  },
};

Blockly.Blocks['snappy_call'] = {
  init(this: CallBlock) {
    this.appendDummyInput('HEADER')
      .appendField('run')
      .appendField(new FunctionNameField(functionOptions), 'NAME');
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
      .appendField(new FunctionNameField(functionOptions), 'NAME');
    this.setOutput(true); // untyped: it fits any oval input
    this.setInputsInline(true);
    this.setStyle('procedure_blocks');
    this.setTooltip('Use what one of your functions returns, inside another block.');
  },
  ...CALL_MIXIN,
};

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'snappy_return',
    message0: 'return %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null,
    inputsInline: true,
    style: 'procedure_blocks',
    tooltip: 'Send a value back to whoever called this function.',
  },
]);

// --- generators -------------------------------------------------------------

type GeneratorInternals = {
  definitions_: Record<string, string>;
  nameDB_?: Blockly.Names;
};

function procedureName(raw: string): string {
  const db = (pythonGenerator as unknown as GeneratorInternals).nameDB_;
  return db ? db.getName(raw, Blockly.Names.NameType.PROCEDURE) : raw;
}

/**
 * Only variables the body *assigns* need a `global`; reading one already finds
 * the module-level value. Blockly's own procedure blocks declare every workspace
 * variable regardless, which is where the stray `global x` came from.
 */
function assignedGlobals(block: Blockly.Block): string[] {
  const names = new Set<string>();
  for (const descendant of block.getDescendants(false)) {
    if (descendant.type !== 'variables_set' && descendant.type !== 'math_change') continue;
    for (const model of descendant.getVarModels?.() ?? []) {
      names.add(pythonGenerator.getVariableName(model.name));
    }
  }
  return [...names].sort();
}

pythonGenerator.forBlock[DEF_BLOCK] = (block, generator) => {
  const def = (block as DefBlock).getFunctionDef();
  const name = procedureName(def.name);
  const params = def.params.map((param) => toIdentifier(param.name)).join(', ');

  const globals = assignedGlobals(block);
  const globalLine = globals.length ? `${generator.INDENT}global ${globals.join(', ')}\n` : '';
  const body = generator.statementToCode(block, 'DO') || `${generator.INDENT}pass\n`;

  const internals = generator as unknown as GeneratorInternals;
  internals.definitions_[`%${name}`] = `def ${name}(${params}):\n${globalLine}${body}`;
  return null;
};

pythonGenerator.forBlock['snappy_return'] = (block) => {
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE);
  return value ? `return ${value}\n` : 'return\n';
};

function callExpression(block: Blockly.Block): string | null {
  const chosen = block.getFieldValue('NAME');
  if (!chosen) return null;
  const params = (block as CallBlock).params_ ?? [];
  const args = params.map(
    (_, i) => pythonGenerator.valueToCode(block, argInput(i), Order.NONE) || 'None',
  );
  return `${procedureName(chosen)}(${args.join(', ')})`;
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

// --- palette ----------------------------------------------------------------

export const FUNCTIONS_CATEGORY = 'SNAPPY_FUNCTIONS';

export function registerFunctionsCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerToolboxCategoryCallback(FUNCTIONS_CATEGORY, () => [
    { kind: 'block', type: DEF_BLOCK },
    { kind: 'block', type: 'snappy_call' },
    { kind: 'block', type: 'snappy_call_value' },
    { kind: 'block', type: 'snappy_return' },
  ]);
}
