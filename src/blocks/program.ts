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
 * Mirrors Blockly's own workspaceToCode, minus the blocks we do not treat as
 * roots. The surrounding init/finish is what hoists imports and definitions, so
 * it has to stay.
 */
export function generateProgram(workspace: Blockly.Workspace): string {
  const generator = pythonGenerator;
  generator.init(workspace);

  const lines: string[] = [];
  for (const block of workspace.getTopBlocks(true)) {
    if (!isRoot(block)) continue;

    let line = generator.blockToCode(block);
    if (Array.isArray(line)) line = line[0];
    if (line) lines.push(line);
  }

  return generator
    .finish(lines.join('\n'))
    .replace(/^\s+\n/, '')
    .replace(/\n\s+$/, '\n')
    .replace(/[ \t]+\n/g, '\n');
}
