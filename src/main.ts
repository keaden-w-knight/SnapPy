import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import './blocks/blocks';
import { scratchTheme } from './blocks/theme';
import { toolbox } from './blocks/toolbox';
import { PythonRunner, isolated, type RunnerState } from './python/runner';
import { ConsolePane } from './ui/console';
import { createCodePane } from './ui/codepane';
import './style.css';

const SAVE_KEY = 'snappy.workspace.v1';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const runButton = $<HTMLButtonElement>('#run');
const stopButton = $<HTMLButtonElement>('#stop');
const clearButton = $<HTMLButtonElement>('#clear');
const statusPill = $('#status');

const consolePane = new ConsolePane($('#console'));
const codePane = createCodePane($('#code'));

const workspace = Blockly.inject($('#blocks'), {
  toolbox,
  theme: scratchTheme,
  renderer: 'zelos', // Blockly's Scratch-shaped renderer.
  media: '/blockly-media/',
  trashcan: true,
  zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 2 },
  move: { scrollbars: true, drag: true, wheel: true },
  grid: { spacing: 40, length: 3, colour: '#ECECEC', snap: false },
});

// --- blocks -> python -------------------------------------------------------

let code = '';

function regenerate() {
  code = pythonGenerator.workspaceToCode(workspace);
  codePane.setCode(code || '# Drag blocks to build a program.');
  runButton.disabled = runner.currentState !== 'idle' || code.trim() === '';
}

// --- running ----------------------------------------------------------------

const runner = new PythonRunner({
  onState: applyState,
  onOutput: (text, stream) => consolePane.write(text, stream),
  onFinished: (status, message) => {
    if (status === 'error' && message) consolePane.write(`${message}\n`, 'stderr');
    if (status === 'stopped') consolePane.write('\n[stopped]\n', 'stderr');
  },
});

const LABELS: Record<RunnerState, string> = {
  booting: 'Starting Python…',
  idle: 'Ready',
  running: 'Running',
  'awaiting-input': 'Waiting for input',
  broken: 'Python failed to start',
};

function applyState(state: RunnerState) {
  statusPill.textContent = LABELS[state];
  statusPill.dataset.state = state;

  runButton.disabled = state !== 'idle' || code.trim() === '';
  stopButton.disabled = state !== 'running' && state !== 'awaiting-input';

  if (state === 'awaiting-input') {
    consolePane.requestInput((line) => runner.provideInput(line));
  } else {
    consolePane.hideInput();
  }
}

// Registered after the runner exists, because regenerate() reads its state.
workspace.addChangeListener((event: Blockly.Events.Abstract) => {
  if (event.isUiEvent) return;
  regenerate();
  localStorage.setItem(SAVE_KEY, JSON.stringify(Blockly.serialization.workspaces.save(workspace)));
});

runButton.addEventListener('click', () => {
  consolePane.clear();
  runner.run(code);
});
stopButton.addEventListener('click', () => runner.stop());
clearButton.addEventListener('click', () => consolePane.clear());

// --- startup ----------------------------------------------------------------

const STARTER = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'snappy_when_run',
        x: 60,
        y: 60,
        next: {
          block: {
            type: 'snappy_print',
            inputs: {
              VALUE: { shadow: { type: 'text', fields: { TEXT: 'Hello from SnapPy!' } } },
            },
          },
        },
      },
    ],
  },
};

const saved = localStorage.getItem(SAVE_KEY);
Blockly.serialization.workspaces.load(saved ? JSON.parse(saved) : STARTER, workspace);
regenerate();

if (!isolated) {
  consolePane.write(
    '[note] This page is not cross-origin isolated, so Stop restarts the interpreter ' +
      'instead of interrupting it, and input() is unavailable. See vite.config.ts.\n',
    'stderr',
  );
}

// Zelos measures against the container, so a resize needs an explicit nudge.
new ResizeObserver(() => Blockly.svgResize(workspace)).observe($('#blocks'));
