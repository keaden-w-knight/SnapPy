import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';

/**
 * Hoisting and `global` cleanup for Blockly's *stock* blocks.
 *
 * SnapPy's own functions and loops name their variables with draggable ovals and
 * never create workspace variables, so none of this applies to them. It still
 * matters for projects that contain Blockly's built-in `procedures_*` and
 * `controls_for*` blocks, which model their names as workspace variables.
 */

type ProcedureTuple = [string, string[], boolean];

interface ProcedureDefBlock extends Blockly.Block {
  getProcedureDef(): ProcedureTuple;
}

/** Blocks that introduce a name in Python: function parameters and loop targets. */
const LOOP_BLOCKS = new Set(['controls_for', 'controls_forEach']);

function bindsName(block: Blockly.Block, name: string): boolean {
  const asProcedure = block as unknown as Partial<ProcedureDefBlock>;
  if (typeof asProcedure.getProcedureDef === 'function') {
    return asProcedure.getProcedureDef()[1].includes(name);
  }
  if (LOOP_BLOCKS.has(block.type)) {
    return (block.getVarModels?.() ?? []).some((model) => model.name === name);
  }
  return false;
}

/** Is every use of this name inside something that assigns it first? */
function boundAt(block: Blockly.Block, name: string): boolean {
  for (let current: Blockly.Block | null = block; current; current = current.getSurroundParent()) {
    if (bindsName(current, name)) return true;
  }
  return false;
}

/**
 * Blockly hoists `name = None` for every variable the workspace uses, which
 * catches names Python already binds for you: function parameters, and the
 * target of a `for` loop. `def greet(who)` produced a module-level `who = None`,
 * and `for i in x` produced `i = None`. Both are noise in the code pane, which
 * is the artefact this app exists to show.
 *
 * A name is only dropped when *every* block using it sits inside something that
 * binds it -- the function whose parameter it is, or the loop that assigns it.
 * Used anywhere else it keeps its declaration, because there it really can be
 * read before assignment (an empty list means the loop body never runs).
 */
function selfBoundNames(workspace: Blockly.Workspace): Set<string> {
  const candidates = new Set<string>();

  for (const block of workspace.getAllBlocks(false)) {
    const asProcedure = block as unknown as Partial<ProcedureDefBlock>;
    if (typeof asProcedure.getProcedureDef === 'function') {
      for (const param of asProcedure.getProcedureDef()[1]) candidates.add(param);
    }
    if (LOOP_BLOCKS.has(block.type)) {
      for (const model of block.getVarModels?.() ?? []) candidates.add(model.name);
    }
  }
  if (!candidates.size) return candidates;

  for (const block of workspace.getAllBlocks(false)) {
    for (const model of block.getVarModels?.() ?? []) {
      if (candidates.has(model.name) && !boundAt(block, model.name)) {
        candidates.delete(model.name);
      }
    }
  }
  return candidates;
}

type GeneratorInternals = { definitions_: Record<string, string> };

const baseInit = pythonGenerator.init.bind(pythonGenerator);
pythonGenerator.init = function (workspace: Blockly.Workspace) {
  baseInit(workspace);

  const skip = selfBoundNames(workspace);
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
