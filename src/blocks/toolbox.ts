import type * as Blockly from 'blockly/core';
import { FUNCTIONS_CATEGORY } from './functions';
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
export const toolbox: Blockly.utils.toolbox.ToolboxDefinition = {
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
          type: 'controls_for',
          inputs: { FROM: num(1), TO: num(10), BY: num(1) },
        },
        { kind: 'block', type: 'controls_forEach' },
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
  ],
};
