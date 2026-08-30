import * as Blockly from 'blockly/core';

/**
 * Scratch's category palette, reused verbatim so the app reads as familiar to
 * anyone arriving from scratch.mit.edu. Categories are remapped to Python
 * concepts -- there are no sprites here, so Looks purple becomes Output and
 * Sensing blue becomes Input -- but the colour-to-position relationship in the
 * palette is preserved.
 */
const SCRATCH = {
  events: '#FFBF00',
  control: '#FFAB19',
  output: '#9966FF',
  input: '#5CB1D6',
  operators: '#59C059',
  variables: '#FF8C1A',
  lists: '#FF661A',
  functions: '#FF6680',
  // Scratch's Motion blue, unused until now because SnapPy has no sprites.
  turtle: '#4C97FF',
  classes: '#CF63CF', // Scratch's Sound magenta, otherwise unused
} as const;

/** Scratch draws block outlines a fixed step darker than the fill. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(c * amount))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function style(colour: string, hat?: 'cap') {
  return {
    colourPrimary: colour,
    colourSecondary: shade(colour, 0.9),
    colourTertiary: shade(colour, 0.78),
    ...(hat ? { hat } : {}),
  };
}

export const CATEGORY_COLOURS = SCRATCH;

export const scratchTheme = Blockly.Theme.defineTheme('snappy-scratch', {
  name: 'snappy-scratch',
  base: Blockly.Themes.Classic,
  fontStyle: {
    family: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    weight: 'bold',
    size: 12,
  },
  startHats: false, // Only our explicit event block wears a hat.
  blockStyles: {
    event_blocks: style(SCRATCH.events, 'cap'),
    control_blocks: style(SCRATCH.control),
    loop_blocks: style(SCRATCH.control),
    logic_blocks: style(SCRATCH.operators),
    output_blocks: style(SCRATCH.output),
    text_blocks: style(SCRATCH.output),
    input_blocks: style(SCRATCH.input),
    operator_blocks: style(SCRATCH.operators),
    math_blocks: style(SCRATCH.operators),
    variable_blocks: style(SCRATCH.variables),
    variable_dynamic_blocks: style(SCRATCH.variables),
    list_blocks: style(SCRATCH.lists),
    procedure_blocks: style(SCRATCH.functions),
    // Definitions wear a hat: they start something rather than continue it, so
    // nothing can be stacked on top of them.
    definition_blocks: style(SCRATCH.functions, 'cap'),
    class_blocks: style(SCRATCH.classes, 'cap'),
    class_member_blocks: style(SCRATCH.classes),
    turtle_blocks: style(SCRATCH.turtle),
  },
  categoryStyles: {
    event_category: { colour: SCRATCH.events },
    control_category: { colour: SCRATCH.control },
    output_category: { colour: SCRATCH.output },
    input_category: { colour: SCRATCH.input },
    operator_category: { colour: SCRATCH.operators },
    variable_category: { colour: SCRATCH.variables },
    list_category: { colour: SCRATCH.lists },
    procedure_category: { colour: SCRATCH.functions },
    turtle_category: { colour: SCRATCH.turtle },
    class_category: { colour: SCRATCH.classes },
    module_category: { colour: '#8E9AAF' },
  },
  componentStyles: {
    workspaceBackgroundColour: '#F9F9F9',
    toolboxBackgroundColour: '#FFFFFF',
    toolboxForegroundColour: '#575E75',
    flyoutBackgroundColour: '#F9F9F9',
    flyoutForegroundColour: '#575E75',
    flyoutOpacity: 1,
    scrollbarColour: '#CECDCE',
    scrollbarOpacity: 0.8,
    insertionMarkerColour: '#575E75',
    insertionMarkerOpacity: 0.3,
    markerColour: '#4C97FF',
    cursorColour: '#4C97FF',
  },
});
