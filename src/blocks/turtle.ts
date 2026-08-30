import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';

/**
 * Turtle graphics blocks.
 *
 * They generate ordinary `import turtle` code -- `turtle.forward(100)` and so on
 * -- rather than anything SnapPy-specific, so what the code pane shows is what a
 * learner would type outside the app. In the browser those calls land in the
 * stand-in module from `src/python/turtle-shim.ts`, because Pyodide has no
 * tkinter to run the real one.
 */

/** A small palette rather than a colour picker: nameable colours read better. */
const COLOURS: [string, string][] = [
  ['black', '#1a1a1a'],
  ['red', '#e64553'],
  ['orange', '#ff8c1a'],
  ['yellow', '#ffbf00'],
  ['green', '#59c059'],
  ['blue', '#4c97ff'],
  ['purple', '#9966ff'],
  ['pink', '#ff6680'],
  ['brown', '#8b5a2b'],
  ['white', '#ffffff'],
];

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'snappy_turtle_move',
    message0: 'move %1 by %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIRECTION',
        options: [
          ['forward', 'forward'],
          ['back', 'backward'],
        ],
      },
      { type: 'input_value', name: 'DISTANCE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.forward(...) / turtle.backward(...)',
  },
  {
    type: 'snappy_turtle_turn',
    message0: 'turn %1 by %2 degrees',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIRECTION',
        options: [
          ['right', 'right'],
          ['left', 'left'],
        ],
      },
      { type: 'input_value', name: 'ANGLE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.right(...) / turtle.left(...)',
  },
  {
    type: 'snappy_turtle_goto',
    message0: 'go to x %1 y %2',
    args0: [
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.goto(x, y) -- the middle of the stage is (0, 0)',
  },
  {
    type: 'snappy_turtle_heading',
    message0: 'point in direction %1',
    args0: [{ type: 'input_value', name: 'ANGLE', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.setheading(...) -- 0 is right, 90 is up',
  },
  {
    type: 'snappy_turtle_home',
    message0: 'go home',
    previousStatement: null,
    nextStatement: null,
    style: 'turtle_blocks',
    tooltip: 'turtle.home()',
  },
  {
    type: 'snappy_turtle_pen',
    message0: 'pen %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'STATE',
        options: [
          ['down', 'pendown'],
          ['up', 'penup'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    style: 'turtle_blocks',
    tooltip: 'turtle.pendown() / turtle.penup()',
  },
  {
    type: 'snappy_turtle_color',
    message0: 'set pen colour to %1',
    args0: [{ type: 'field_dropdown', name: 'COLOUR', options: COLOURS }],
    previousStatement: null,
    nextStatement: null,
    style: 'turtle_blocks',
    tooltip: 'turtle.pencolor(...)',
  },
  {
    type: 'snappy_turtle_size',
    message0: 'set pen size to %1',
    args0: [{ type: 'input_value', name: 'SIZE', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.pensize(...)',
  },
  {
    type: 'snappy_turtle_circle',
    message0: 'draw circle of radius %1',
    args0: [{ type: 'input_value', name: 'RADIUS', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.circle(...) -- curves to the turtle’s left',
  },
  {
    type: 'snappy_turtle_dot',
    message0: 'stamp dot of size %1',
    args0: [{ type: 'input_value', name: 'SIZE', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'turtle_blocks',
    tooltip: 'turtle.dot(...)',
  },
  {
    type: 'snappy_turtle_visible',
    message0: '%1 the turtle',
    args0: [
      {
        type: 'field_dropdown',
        name: 'STATE',
        options: [
          ['show', 'showturtle'],
          ['hide', 'hideturtle'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    style: 'turtle_blocks',
    tooltip: 'turtle.showturtle() / turtle.hideturtle()',
  },
  {
    type: 'snappy_turtle_clear',
    message0: 'clear the drawing',
    previousStatement: null,
    nextStatement: null,
    style: 'turtle_blocks',
    tooltip: 'turtle.clear()',
  },
  {
    type: 'snappy_turtle_report',
    message0: 'turtle %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'WHAT',
        options: [
          ['x', 'xcor'],
          ['y', 'ycor'],
          ['direction', 'heading'],
        ],
      },
    ],
    output: 'Number',
    style: 'turtle_blocks',
    tooltip: 'turtle.xcor() / turtle.ycor() / turtle.heading()',
  },
]);

type WithDefinitions = { definitions_: Record<string, string> };

/** Every turtle block needs the import, hoisted once. */
function importTurtle() {
  (pythonGenerator as unknown as WithDefinitions).definitions_['import_turtle'] = 'import turtle';
}

function call(name: string, args: string[] = []): string {
  importTurtle();
  return `turtle.${name}(${args.join(', ')})\n`;
}

const value = (block: Blockly.Block, field: string, fallback: string) =>
  pythonGenerator.valueToCode(block, field, Order.NONE) || fallback;

const G = pythonGenerator.forBlock;

G['snappy_turtle_move'] = (block) =>
  call(block.getFieldValue('DIRECTION'), [value(block, 'DISTANCE', '0')]);

G['snappy_turtle_turn'] = (block) =>
  call(block.getFieldValue('DIRECTION'), [value(block, 'ANGLE', '0')]);

G['snappy_turtle_goto'] = (block) =>
  call('goto', [value(block, 'X', '0'), value(block, 'Y', '0')]);

G['snappy_turtle_heading'] = (block) => call('setheading', [value(block, 'ANGLE', '0')]);

G['snappy_turtle_home'] = () => call('home');

G['snappy_turtle_pen'] = (block) => call(block.getFieldValue('STATE'));

G['snappy_turtle_color'] = (block) =>
  call('pencolor', [`'${block.getFieldValue('COLOUR')}'`]);

G['snappy_turtle_size'] = (block) => call('pensize', [value(block, 'SIZE', '1')]);

G['snappy_turtle_circle'] = (block) => call('circle', [value(block, 'RADIUS', '50')]);

G['snappy_turtle_dot'] = (block) => call('dot', [value(block, 'SIZE', '8')]);

G['snappy_turtle_visible'] = (block) => call(block.getFieldValue('STATE'));

G['snappy_turtle_clear'] = () => call('clear');

G['snappy_turtle_report'] = (block) => {
  importTurtle();
  return [`turtle.${block.getFieldValue('WHAT')}()`, Order.FUNCTION_CALL];
};
