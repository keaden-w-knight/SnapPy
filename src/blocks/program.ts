import type * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';

/**
 * Turns the workspace into a program.
 *
 * Blockly generates code for *every* top-level block, so a stack left on the
 * canvas while you think about it silently became part of the script -- and a
 * half-finished one could break a program that otherwise ran. Here only blocks
 * that start something are roots:
 *
 *   when the program starts    the entry point
 *   to (name) ...              a function definition
 *   class (Name) ...           a class definition
 *
 * The test is structural rather than a list of types: a root is a block that can
 * neither be stacked onto nor plugged in, which is exactly what the hat shape
 * means. Anything else on the canvas is scratch work and generates nothing, the
 * same way a loose stack in Scratch never runs.
 */
function isRoot(block: Blockly.Block): boolean {
  return !block.previousConnection && !block.outputConnection;
}

/**
 * Roots are emitted classes first, then functions, then the scripts that use
 * them -- so a program reads the way one is written by hand, with the things
 * being defined above the code that calls them.
 *
 * Within each group the canvas order stands: `getTopBlocks(true)` sorts roughly
 * top-to-bottom, and Array.sort is stable, so moving a definition up or down the
 * canvas moves it in the script.
 */
const GROUP_ORDER = ['snappy_class_def', 'snappy_function_def'];

const groupOf = (block: Blockly.Block) => {
  const index = GROUP_ORDER.indexOf(block.type);
  return index === -1 ? GROUP_ORDER.length : index; // scripts come last
};

/**
 * Mirrors Blockly's own workspaceToCode, minus the blocks we do not treat as
 * roots. The surrounding init/finish is what hoists imports and definitions, so
 * it has to stay.
 */
/** The blocks a program is generated from, in the order they are emitted. */
export function collectRoots(workspace: Blockly.Workspace): Blockly.Block[] {
  return workspace
    .getTopBlocks(true)
    .filter(isRoot)
    .sort((a, b) => groupOf(a) - groupOf(b));
}

export function generateProgram(workspace: Blockly.Workspace): string {
  const generator = pythonGenerator;
  generator.init(workspace);

  const lines: string[] = [];
  for (const block of collectRoots(workspace)) {
    let line = generator.blockToCode(block);
    if (Array.isArray(line)) line = line[0];
    if (line) lines.push(line);
  }

  return generator
    .finish(lines.join('\n'))
    // Two blank lines between top-level definitions, as PEP 8 asks; the
    // generators each end with their own newline and the join adds more.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\s+\n/, '')
    .replace(/\n\s+$/, '\n');
}
