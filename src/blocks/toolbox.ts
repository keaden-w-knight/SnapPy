import type * as Blockly from 'blockly/core';
import { FUNCTIONS_CATEGORY } from './functions';
import { CLASSES_CATEGORY } from './classes';
import { VARIABLES_CATEGORY } from './variables';

const num = (value: number) => ({
  shadow: { type: 'math_number', fields: { NUM: value } },
});
const str = (value: string) => ({
  shadow: { type: 'text', fields: { TEXT: value } },
});

/**
 * Category order mirrors Scratch's palette so the muscle memory transfers:
 * events, control, then the "do something" categories, then operators and data.
 */
/** Blocks a module adds to the palette once it is switched on. */
const MODULE_CATEGORIES: Record<string, Blockly.utils.toolbox.ToolboxItemInfo> = {
  turtle: {
    kind: 'category',
    name: 'Turtle',
    categorystyle: 'turtle_category',
    contents: [
      { kind: 'block', type: 'snappy_turtle_move', inputs: { DISTANCE: num(100) } },
      { kind: 'block', type: 'snappy_turtle_turn', inputs: { ANGLE: num(90) } },
      { kind: 'block', type: 'snappy_turtle_goto', inputs: { X: num(0), Y: num(0) } },
      { kind: 'block', type: 'snappy_turtle_heading', inputs: { ANGLE: num(0) } },
      { kind: 'block', type: 'snappy_turtle_home' },
      { kind: 'block', type: 'snappy_turtle_pen' },
      { kind: 'block', type: 'snappy_turtle_color' },
      { kind: 'block', type: 'snappy_turtle_size', inputs: { SIZE: num(2) } },
      { kind: 'block', type: 'snappy_turtle_circle', inputs: { RADIUS: num(50) } },
      { kind: 'block', type: 'snappy_turtle_dot', inputs: { SIZE: num(8) } },
      { kind: 'block', type: 'snappy_turtle_visible' },
      { kind: 'block', type: 'snappy_turtle_clear' },
      { kind: 'block', type: 'snappy_turtle_report' },
    ],
  },
};

export const MODULES = Object.keys(MODULE_CATEGORIES);
export const MODULES_CATEGORY = 'SNAPPY_MODULES';

/**
 * The palette, with any switched-on modules appended.
 *
 * Category order mirrors Scratch's so the muscle memory transfers: events,
 * control, then the "do something" categories, then operators and data.
 * Modules come last, next to the picker that turns them on.
 */
export function buildToolbox(
  enabled: readonly string[] = [],
): Blockly.utils.toolbox.ToolboxDefinition {
  return {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Events',
      categorystyle: 'event_category',
      contents: [{ kind: 'block', type: 'snappy_when_run' }],
    },
    {
      kind: 'category',
      name: 'Control',
      categorystyle: 'control_category',
      contents: [
        { kind: 'block', type: 'snappy_wait', inputs: { SECONDS: num(1) } },
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: num(10) } },
        { kind: 'block', type: 'snappy_forever' },
        { kind: 'block', type: 'controls_if' },
        {
          kind: 'block',
          type: 'controls_if',
          extraState: { elseIfCount: 0, hasElse: true },
        },
        { kind: 'block', type: 'controls_whileUntil' },
        {
          kind: 'block',
          type: 'snappy_for_range',
          inputs: {
            // A real block, not a shadow: the name oval has to be draggable.
            VAR: { block: { type: 'snappy_local_get', fields: { NAME: 'i' } } },
            FROM: num(1),
            TO: num(10),
            BY: num(1),
          },
        },
        {
          kind: 'block',
          type: 'snappy_for_each',
          inputs: {
            VAR: { block: { type: 'snappy_local_get', fields: { NAME: 'item' } } },
          },
        },
        { kind: 'block', type: 'controls_flow_statements' },
      ],
    },
    {
      kind: 'category',
      name: 'Output',
      categorystyle: 'output_category',
      contents: [
        { kind: 'block', type: 'snappy_print', inputs: { VALUE: str('Hello!') } },
        { kind: 'block', type: 'text' },
        {
          kind: 'block',
          type: 'text_join',
          inputs: { ADD0: str('score: '), ADD1: str('') },
        },
        { kind: 'block', type: 'text_length', inputs: { VALUE: str('world') } },
      ],
    },
    {
      kind: 'category',
      name: 'Input',
      categorystyle: 'input_category',
      contents: [
        { kind: 'block', type: 'snappy_ask', inputs: { PROMPT: str("What's your name? ") } },
        {
          kind: 'block',
          type: 'snappy_ask_number',
          inputs: { PROMPT: str('Pick a number: ') },
        },
      ],
    },
    {
      kind: 'category',
      name: 'Operators',
      categorystyle: 'operator_category',
      contents: [
        { kind: 'block', type: 'math_number' },
        {
          kind: 'block',
          type: 'math_arithmetic',
          inputs: { A: num(1), B: num(1) },
        },
        { kind: 'block', type: 'math_modulo', inputs: { DIVIDEND: num(64), DIVISOR: num(10) } },
        { kind: 'block', type: 'math_round', inputs: { NUM: num(3.1) } },
        { kind: 'block', type: 'snappy_random', inputs: { FROM: num(1), TO: num(10) } },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      categorystyle: 'variable_category',
      // Blockly's own flyout, plus the local-variable blocks.
      custom: VARIABLES_CATEGORY,
    },
    {
      kind: 'category',
      name: 'Lists',
      categorystyle: 'list_category',
      contents: [
        { kind: 'block', type: 'lists_create_with' },
        { kind: 'block', type: 'lists_length' },
        { kind: 'block', type: 'lists_getIndex' },
        { kind: 'block', type: 'lists_setIndex' },
        // Blockly's sub-list block is the slice: 1-based and inclusive, matching
        // the other list blocks rather than Python's 0-based half-open indexing.
        { kind: 'block', type: 'lists_getSublist' },
      ],
    },
    {
      kind: 'category',
      name: 'Functions',
      categorystyle: 'procedure_category',
      // Our own flyout: two dropdown call blocks instead of one per function.
      custom: FUNCTIONS_CATEGORY,
    },
    {
      kind: 'category',
      name: 'Classes',
      categorystyle: 'class_category',
      custom: CLASSES_CATEGORY,
    },
    ...enabled
      .filter((name) => name in MODULE_CATEGORIES)
      .map((name) => MODULE_CATEGORIES[name]),
    {
      kind: 'category',
      name: 'Modules',
      categorystyle: 'module_category',
      custom: MODULES_CATEGORY,
    },
  ],
  };
}
