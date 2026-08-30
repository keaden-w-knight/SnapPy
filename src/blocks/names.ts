import * as Blockly from 'blockly/core';

/**
 * The shared machinery behind every block that names a variable with a draggable
 * oval: the loops and `make (name) = (value)`.
 *
 * Kept in its own module because both sides need it, and importing each other
 * would leave one of them reading an uninitialised binding at module-eval time.
 */

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/**
 * Coerce whatever was typed into a legal Python identifier. Runs as a field
 * validator, so a block always displays exactly the name it will generate --
 * no silent difference between what is on screen and what runs.
 */
export function toIdentifier(raw: string | null): string {
  let name = (raw ?? '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!name) name = 'item';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (PYTHON_KEYWORDS.has(name)) name = `${name}_`;
  return name;
}

/** What a block's name oval is called when it first appears, or reappears. */
const DEFAULT_NAMES: Record<string, string> = {
  snappy_for_each: 'item',
  snappy_for_range: 'i',
  snappy_local_set: 'counter',
};

interface VarSlotBlock extends Blockly.Block {
  lastName_?: string;
}

/** Reads the name out of the oval, falling back to the last one it held. */
export function slotName(block: Blockly.Block): string {
  const oval = block.getInputTargetBlock('VAR');
  const raw = oval?.getFieldValue('NAME');
  if (typeof raw === 'string' && raw) return toIdentifier(raw);
  return toIdentifier((block as VarSlotBlock).lastName_ ?? DEFAULT_NAMES[block.type] ?? 'item');
}

/**
 * Keeps a name oval in the VAR socket.
 *
 * Blockly's usual answer for a default child is a shadow block, but shadows are
 * never draggable -- it does not convert one to a real block on drag -- which is
 * the whole point here. So the socket holds a real block, and grows a fresh one
 * when that is dragged away. From the user's side it reads as copying the name
 * out rather than removing it.
 */
function refillVarSlot(this: VarSlotBlock, event: Blockly.Events.Abstract) {
  if (this.isInFlyout || !this.workspace || this.isDeadOrDying()) return;
  // Mid-drag the socket is legitimately empty; refilling now would fight the
  // gesture. The drag's own move event brings us back here when it ends.
  if ((this.workspace as Blockly.WorkspaceSvg).isDragging?.()) return;

  const oval = this.getInputTargetBlock('VAR');
  if (oval) {
    this.lastName_ = oval.getFieldValue('NAME') || this.lastName_;
    return;
  }

  const input = this.getInput('VAR');
  if (!input?.connection) return;

  // Same event group as whatever emptied the socket, so one undo restores it.
  const previousGroup = Blockly.Events.getGroup();
  Blockly.Events.setGroup(event.group || true);
  try {
    const replacement = this.workspace.newBlock('snappy_local_get');
    replacement.setFieldValue(
      this.lastName_ ?? DEFAULT_NAMES[this.type] ?? 'item',
      'NAME',
    );
    const svg = replacement as Blockly.BlockSvg;
    if (svg.initSvg) {
      svg.initSvg();
      svg.render();
    }
    Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CREATE))(replacement));
    input.connection.connect(replacement.outputConnection!);
  } finally {
    Blockly.Events.setGroup(previousGroup);
  }
}

/**
 * Must be called from the block's own init.
 *
 * Simply putting `onchange` on the block definition is not enough: Blockly wires
 * `onchange` up to the workspace during doInit_, which runs *before* JSON
 * extensions are applied -- so a mixin's handler lands on the instance but is
 * never registered as a listener, and silently never fires. setOnChange does the
 * registration explicitly.
 */
export function installVarSlot(block: Blockly.Block) {
  block.setOnChange(refillVarSlot);
}
