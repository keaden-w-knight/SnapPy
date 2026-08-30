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

export type CallableKind = 'function' | 'method' | 'class';

export interface FunctionDef {
  name: string;
  params: FunctionParam[];
  kind: CallableKind;
  /** For a method, the class it belongs to. */
  owner?: string;
}

/** Standalone definition: wears a hat, so nothing stacks onto it. */
const DEF_BLOCK = 'snappy_function_def';
/** The same thing shaped as a statement, so it can sit inside a class body. */
export const METHOD_BLOCK = 'snappy_method_def';
/** Declared here rather than imported, to keep classes.ts the only dependent. */
export const CLASS_BLOCK = 'snappy_class_def';

/**
 * The special methods worth offering. Python has many more, but a menu of forty
 * is not a menu; these are the ones a class in a lesson actually defines.
 */
const SPECIAL_METHODS = [
  '__init__', '__str__', '__repr__', '__len__', '__eq__', '__lt__',
  '__add__', '__call__', '__getitem__', '__setitem__', '__contains__', '__iter__',
];

/** The class a block sits inside, if any. */
export function enclosingClass(block: Blockly.Block): string | null {
  for (let current = block.getSurroundParent(); current; current = current.getSurroundParent()) {
    if (current.type === CLASS_BLOCK) return toIdentifier(current.getFieldValue('NAME'));
  }
  return null;
}

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

  syncClassMembership(this);

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

/**
 * Shared by both definition shapes.
 *
 * A standalone definition wears a hat so nothing can be stacked onto it -- it
 * starts something rather than continuing a sequence. The inline one is an
 * ordinary statement, which is what lets it sit inside a class body.
 */
function initDefinition(block: DefBlock, inline: boolean) {
  block.appendDummyInput('HEADER')
    .appendField(inline ? 'method' : 'to')
    .appendField(new Blockly.FieldTextInput('do_something', toIdentifier), 'NAME');
  block.appendDummyInput('ADD').appendField(
    new Blockly.FieldImage(PLUS_ICON, 20, 20, 'add input', () => block.addParameter_()),
    'ADD_BUTTON',
  );
  block.appendStatementInput('DO').appendField('do');
  block.setInputsInline(true);

  if (inline) {
    block.setPreviousStatement(true);
    block.setNextStatement(true);
    block.setStyle('class_member_blocks');
    block.setTooltip('Define a method. Inside a class it gains self and the special methods.');
  } else {
    block.setStyle('definition_blocks');
    block.setTooltip('Define a function. Drag its inputs into the body to use them.');
  }

  // Registered explicitly: Blockly wires onchange during doInit_, which runs
  // before this definition's own properties would otherwise be consulted.
  block.setOnChange(syncParameters);
}

const DEFINITION_MIXIN = {
  params_: [] as FunctionParam[],

  saveExtraState(this: DefBlock) {
    return { params: this.params_ };
  },

  loadExtraState(this: DefBlock, state: { params?: FunctionParam[] }) {
    this.updateShape_(state.params ?? []);
  },

  getFunctionDef(this: DefBlock): FunctionDef {
    const owner = enclosingClass(this);
    return {
      name: toIdentifier(this.getFieldValue('NAME')),
      params: [...this.params_],
      kind: owner ? 'method' : 'function',
      ...(owner ? { owner } : {}),
    };
  },

  /**
   * Rebuild the parameter sockets, carrying each existing name oval across.
   *
   * Blockly's removeInput only *disconnects* a real child block -- it disposes
   * shadows, not real ones -- so rebuilding naively left every previous oval
   * loose on the canvas, where a stray name generates a line of code. Ovals are
   * detached deliberately, reconnected by name, and any belonging to a parameter
   * that no longer exists are disposed rather than abandoned.
   */
  updateShape_(this: DefBlock, params: FunctionParam[]) {
    if (sameParams(params, this.params_)) return;

    const existing = new Map<string, Blockly.Block>();
    this.params_.forEach((param, i) => {
      const oval = this.getInput(paramInput(i))?.connection?.targetBlock();
      if (oval) {
        oval.outputConnection?.disconnect();
        existing.set(param.name, oval);
      }
      if (this.getInput(paramInput(i))) this.removeInput(paramInput(i));
    });

    this.params_ = params.map((param) => ({ ...param }));
    this.params_.forEach((param, i) => {
      const input = this.appendValueInput(paramInput(i));
      if (param.type === 'boolean') input.setCheck('Boolean');
      // Appending puts it last, so pull it back in front of the + button.
      this.moveInputBefore(paramInput(i), 'ADD');

      const kept = existing.get(param.name);
      if (kept && TYPE_OF_GETTER[kept.type] === param.type) {
        input.connection?.connect(kept.outputConnection!);
        existing.delete(param.name);
      }
    });

    // Whatever is left belonged to a parameter that is gone.
    for (const orphan of existing.values()) orphan.dispose(false);
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

/**
 * A definition inside a class is a method: Python passes the instance as the
 * first argument, so `self` is added for you rather than being something to
 * remember, and the special methods become available by name.
 */
function syncClassMembership(block: DefBlock) {
  const inClass = enclosingClass(block) !== null;
  const header = block.getInput('HEADER');
  const hasMenu = !!block.getField('SPECIAL');

  if (inClass && !hasMenu && header) {
    header.insertFieldAt(2, specialMethodMenu(), 'SPECIAL');
  } else if (!inClass && hasMenu && header) {
    header.removeField('SPECIAL');
  }

  if (inClass && block.params_[0]?.name !== 'self') {
    block.updateShape_([{ name: 'self', type: 'value' }, ...block.params_]);
  }
}

/** Acts as a menu rather than a value: picking an entry writes it into NAME. */
function specialMethodMenu(): Blockly.FieldDropdown {
  return new Blockly.FieldDropdown(
    () => [
      ['special…', ''],
      ...SPECIAL_METHODS.map((name) => [name, name] as [string, string]),
    ],
    function (this: Blockly.FieldDropdown, value: string) {
      if (value) this.getSourceBlock()?.setFieldValue(value, 'NAME');
      return ''; // fall back to the prompt; the choice lives in NAME
    },
  );
}

Blockly.Blocks[DEF_BLOCK] = {
  ...DEFINITION_MIXIN,
  init(this: DefBlock) {
    initDefinition(this, false);
  },
};

Blockly.Blocks[METHOD_BLOCK] = {
  ...DEFINITION_MIXIN,
  init(this: DefBlock) {
    initDefinition(this, true);
  },
};

// --- looking callables up ---------------------------------------------------

/** A class is callable too: calling it builds an instance. */
function classDef(block: Blockly.Block, methods: FunctionDef[]): FunctionDef {
  const name = toIdentifier(block.getFieldValue('NAME'));
  const constructor = methods.find(
    (method) => method.owner === name && method.name === '__init__',
  );
  return {
    name,
    // Constructing takes __init__'s inputs, minus the instance it is handed.
    params: (constructor?.params ?? []).filter((param) => param.name !== 'self'),
    kind: 'class',
  };
}

/** Every function, method and class the workspace defines. */
export function listFunctions(workspace: Blockly.Workspace): FunctionDef[] {
  const functions = workspace
    .getBlocksByType(DEF_BLOCK, false)
    .map((block) => (block as DefBlock).getFunctionDef());
  const methods = workspace
    .getBlocksByType(METHOD_BLOCK, false)
    .map((block) => (block as DefBlock).getFunctionDef());
  const classes = workspace
    .getBlocksByType(CLASS_BLOCK, false)
    .map((block) => classDef(block, methods));

  return [...functions, ...classes, ...methods].filter((def) => def.name);
}

/** How a method is named in the call dropdown, e.g. `Dog.speak`. */
export const qualify = (def: FunctionDef) =>
  def.kind === 'method' && def.owner ? `${def.owner}.${def.name}` : def.name;

export function findFunction(name: string, workspace: Blockly.Workspace): FunctionDef | null {
  return listFunctions(workspace).find((def) => qualify(def) === name) ?? null;
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
  setTargetKind_(kind: CallableKind): void;
}

function functionOptions(this: Blockly.Field): Blockly.MenuOption[] {
  const owner = this.getSourceBlock()?.workspace as
    | (Blockly.Workspace & { isFlyout?: boolean; targetWorkspace?: Blockly.Workspace })
    | undefined;
  // A block in the flyout belongs to the flyout's own workspace, which holds
  // only palette samples; ask the one it will be dropped into.
  const workspace = owner?.isFlyout ? owner.targetWorkspace : owner;
  const names = workspace ? listFunctions(workspace).map(qualify) : [];
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
  /** A method call needs somewhere to send it; a plain call does not. */
  setTargetKind_(this: CallBlock, kind: CallableKind) {
    const wantsObject = kind === 'method';
    if (wantsObject && !this.getInput('ON')) {
      this.appendValueInput('ON').appendField('on');
      if (this.params_.length) this.moveInputBefore('ON', argInput(0));
    } else if (!wantsObject && this.getInput('ON')) {
      this.removeInput('ON', true);
    }
  },

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
    // The instance is passed by Python, so it is never an argument to fill in.
    this.updateShape_(def.params.filter((param) => param.name !== 'self'));
    this.setTargetKind_(def.kind);
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

/**
 * The same call in a boolean shape.
 *
 * A function that answers a yes/no question reads better in an `if` than a
 * general-purpose oval does, and Zelos draws a `Boolean` output as a hexagon --
 * so the block only fits where a condition belongs, and the fit is visible.
 */
Blockly.Blocks['snappy_call_boolean'] = {
  init(this: CallBlock) {
    this.appendDummyInput('HEADER')
      .appendField('result of')
      .appendField(new FunctionNameField(functionOptions), 'NAME');
    this.setOutput(true, 'Boolean');
    this.setInputsInline(true);
    this.setStyle('procedure_blocks');
    this.setTooltip('Use a function’s answer where a true/false value is wanted.');
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

/**
 * Returned rather than hoisted into `definitions_`.
 *
 * Blockly's usual home for a function definition is the definitions block, which
 * `finish()` pastes above everything else -- so a function jumped to the top of
 * the script no matter where its block sat. Returning the code lets program.ts
 * decide the order instead. Imports still hoist, because they have to come first
 * to be valid Python.
 */
pythonGenerator.forBlock[DEF_BLOCK] = (block, generator) => {
  const def = (block as DefBlock).getFunctionDef();
  const name = procedureName(def.name);
  const params = def.params.map((param) => toIdentifier(param.name)).join(', ');

  const globals = assignedGlobals(block);
  const globalLine = globals.length ? `${generator.INDENT}global ${globals.join(', ')}\n` : '';
  const body = generator.statementToCode(block, 'DO') || `${generator.INDENT}pass\n`;

  return `def ${name}(${params}):\n${globalLine}${body}\n`;
};

pythonGenerator.forBlock[METHOD_BLOCK] = (block, generator) => {
  const def = (block as DefBlock).getFunctionDef();
  const params = def.params.map((param) => toIdentifier(param.name)).join(', ');
  const body = generator.statementToCode(block, 'DO') || `${generator.INDENT}pass
`;
  // Emitted in place rather than hoisted, so it lands inside the class body.
  return `def ${toIdentifier(def.name)}(${params}):
${body}
`;
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

  // `Owner.method` in the dropdown becomes `object.method(...)` in the code.
  const dot = chosen.indexOf('.');
  if (dot !== -1 && block.getInput('ON')) {
    const target = pythonGenerator.valueToCode(block, 'ON', Order.MEMBER) || 'self';
    return `${target}.${toIdentifier(chosen.slice(dot + 1))}(${args.join(', ')})`;
  }

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

pythonGenerator.forBlock['snappy_call_boolean'] = (block) => {
  const call = callExpression(block);
  // False rather than None when unset: the shape promises a true/false value.
  return call ? [call, Order.FUNCTION_CALL] : ['False', Order.ATOMIC];
};

// --- palette ----------------------------------------------------------------

export const FUNCTIONS_CATEGORY = 'SNAPPY_FUNCTIONS';

export function registerFunctionsCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerToolboxCategoryCallback(FUNCTIONS_CATEGORY, () => [
    { kind: 'block', type: DEF_BLOCK },
    { kind: 'block', type: METHOD_BLOCK },
    { kind: 'block', type: 'snappy_call' },
    { kind: 'block', type: 'snappy_call_value' },
    { kind: 'block', type: 'snappy_call_boolean' },
    { kind: 'block', type: 'snappy_return' },
  ]);
}
