import type * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import { generateProgram } from './program';

/**
 * Maps lines of generated Python back to the blocks that produced them, so a
 * traceback can point at a block instead of a line number the user never wrote.
 *
 * Blockly has no source map, but it does have STATEMENT_PREFIX: a snippet
 * injected before every statement, with %1 replaced by the block's id. Running
 * generation a second time with a marker comment as the prefix gives a copy of
 * the program annotated with block ids, and stripping the markers must yield the
 * original program exactly. That equality is the correctness check -- if the two
 * passes disagree for any reason, the map is discarded rather than trusted.
 *
 * The markers never reach the user: they exist only in the throwaway second
 * pass, so the code pane and the interpreter both see clean output.
 */

const PREFIX = '#@snappy:%1\n';
// injectId wraps the id in single quotes.
const MARKER = /^\s*#@snappy:'(.*)'\s*$/;

/**
 * @param expected the program actually shown and run; the map is only returned
 *   if the annotated pass reproduces it exactly.
 * @returns 1-based line number -> block id
 */
export function buildLineMap(
  workspace: Blockly.Workspace,
  expected: string,
): Map<number, string> {
  const previous = pythonGenerator.STATEMENT_PREFIX;
  let annotated: string;
  try {
    pythonGenerator.STATEMENT_PREFIX = PREFIX;
    // The same generator the program uses, or the two passes would disagree
    // about which blocks count and the map would be discarded every time.
    annotated = generateProgram(workspace);
  } catch {
    return new Map();
  } finally {
    pythonGenerator.STATEMENT_PREFIX = previous;
  }

  const map = new Map<number, string>();
  const rebuilt: string[] = [];
  let pending: string | null = null;

  for (const line of annotated.split('\n')) {
    const marker = MARKER.exec(line);
    if (marker) {
      // Nested statements emit their own marker after the enclosing one, so the
      // last marker before a line is the innermost block -- the specific one.
      pending = marker[1];
      continue;
    }
    rebuilt.push(line);
    if (pending) {
      map.set(rebuilt.length, pending);
      pending = null;
    }
  }

  return rebuilt.join('\n') === expected ? map : new Map();
}
