import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';

/**
 * Importing `blockly/core` + `blockly/blocks` (rather than the umbrella `blockly`
 * entry) keeps the bundle smaller but skips the message bundle those built-in
 * blocks reference via %{BKY_...}. Without this, every stock block throws
 * "Message does not reference all N arg(s)" the moment it is instantiated.
 *
 * Must run before any block is created -- import this module first.
 */
Blockly.setLocale(En as unknown as Record<string, string>);
