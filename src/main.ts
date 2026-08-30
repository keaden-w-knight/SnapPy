import * as Blockly from 'blockly/core';
import { pythonGenerator } from 'blockly/python';
import './blocks/blocks';
import { scratchTheme } from './blocks/theme';
import { toolbox } from './blocks/toolbox';
import { registerFunctionsCategory } from './blocks/functions';
import { registerVariablesCategory } from './blocks/variables';
import { buildLineMap } from './blocks/sourcemap';
import { errorLine } from './python/traceback';
import { clearErrorHighlight, showErrorBlock } from './ui/error-highlight';
import type { PythonBackend, RunnerState } from './python/backend';
import { createBackend } from './python/select';
import { isolated } from './python/pyodide-backend';
import { createProjectIO } from './project/storage';
import { parse, serialize } from './project/format';
import { ConsolePane } from './ui/console';
import { createCodePane } from './ui/codepane';
import './style.css';

const AUTOSAVE_KEY = 'snappy.workspace.v1';
const UNTITLED = 'Untitled';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const runButton = $<HTMLButtonElement>('#run');
const stopButton = $<HTMLButtonElement>('#stop');
const clearButton = $<HTMLButtonElement>('#clear');
const statusPill = $('#status');
const engineLabel = $('#engine');
const projectLabel = $('#project-name');

const consolePane = new ConsolePane($('#console'));
const codePane = createCodePane($('#code'));
const projectIO = createProjectIO();

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

registerFunctionsCategory(workspace);
registerVariablesCategory(workspace);

// --- project state ----------------------------------------------------------

let projectName = UNTITLED;
let dirty = false;
let code = '';
let backend: PythonBackend | null = null;

function snapshot(): object {
  return Blockly.serialization.workspaces.save(workspace);
}

function markClean() {
  dirty = false;
  renderProjectLabel();
}

function renderProjectLabel() {
  projectLabel.textContent = projectName;
  projectLabel.dataset.dirty = String(dirty);
  document.title = `${dirty ? '• ' : ''}${projectName} — SnapPy`;
}

// --- blocks -> python -------------------------------------------------------

function regenerate() {
  code = pythonGenerator.workspaceToCode(workspace);
  codePane.setCode(code || '# Drag blocks to build a program.');
  refreshButtons();
}

function refreshButtons() {
  const state = backend?.state ?? 'booting';
  runButton.disabled = state !== 'idle' || code.trim() === '';
  stopButton.disabled = state !== 'running' && state !== 'awaiting-input';
}

// --- running ----------------------------------------------------------------

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
  refreshButtons();

  // A pipe-backed process can't announce that it is blocked on a read, so the
  // console offers input for the whole run; Pyodide tells us precisely.
  const wantsInput =
    backend?.inputMode === 'always' ? state === 'running' : state === 'awaiting-input';

  if (wantsInput) {
    consolePane.requestInput((line) => backend?.provideInput(line), {
      persistent: backend?.inputMode === 'always',
    });
  } else {
    consolePane.hideInput();
  }
}

const events = {
  onState: applyState,
  onOutput: (text: string, stream: 'stdout' | 'stderr') => consolePane.write(text, stream),
  onFinished: (status: 'ok' | 'error' | 'stopped', message?: string) => {
    if (status === 'error' && message) {
      consolePane.write(`${message}\n`, 'stderr');
      blameBlock(message);
    }
    if (status === 'stopped') {
      consolePane.write(`\n[stopped${message ? ` -- ${message}` : ''}]\n`, 'stderr');
    }
  },
};

/**
 * Point at the block behind a traceback. The map is built per run rather than on
 * every edit, since it costs a second generation pass and is only ever needed
 * once something has actually failed.
 */
function blameBlock(message: string) {
  const line = errorLine(message);
  if (line === null) return;
  const blockId = buildLineMap(workspace, code).get(line);
  if (blockId) showErrorBlock(workspace, blockId);
}

runButton.addEventListener('click', () => {
  consolePane.clear();
  clearErrorHighlight();
  backend?.run(code);
});
stopButton.addEventListener('click', () => backend?.stop());
clearButton.addEventListener('click', () => consolePane.clear());

// --- file commands ----------------------------------------------------------

function confirmDiscard(action: string): boolean {
  return !dirty || confirm(`"${projectName}" has unsaved changes. ${action} anyway?`);
}

function loadProject(name: string, workspaceState: object) {
  Blockly.serialization.workspaces.load(workspaceState, workspace);
  projectName = name;
  regenerate();
  markClean();
}

async function openProject() {
  if (!confirmDiscard('Open another project')) return;
  try {
    const file = await projectIO.open();
    if (!file) return;
    const project = parse(file.text, file.name);
    loadProject(project.name || file.name, project.workspace);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

async function saveProject(forceNew: boolean) {
  try {
    const text = serialize({ name: projectName, workspace: snapshot() });
    const saved = await projectIO.save(text, projectName, forceNew);
    if (!saved) return; // Cancelled.
    projectName = saved;
    markClean();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

function newProject() {
  if (!confirmDiscard('Start a new project')) return;
  projectIO.forget();
  loadProject(UNTITLED, STARTER);
}

$('#new').addEventListener('click', newProject);
$('#open').addEventListener('click', () => void openProject());
$('#save').addEventListener('click', () => void saveProject(false));
$('#save-as').addEventListener('click', () => void saveProject(true));

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    void saveProject(event.shiftKey);
  } else if (key === 'o') {
    event.preventDefault();
    void openProject();
  }
});

// Browsers only honour this if the user has interacted with the page.
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

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

const autosaved = localStorage.getItem(AUTOSAVE_KEY);
Blockly.serialization.workspaces.load(autosaved ? JSON.parse(autosaved) : STARTER, workspace);
regenerate();
renderProjectLabel();

workspace.addChangeListener((event: Blockly.Events.Abstract) => {
  if (event.isUiEvent) return;
  regenerate();
  clearErrorHighlight();
  dirty = true;
  renderProjectLabel();
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot()));
});

// Zelos measures against the container, so a resize needs an explicit nudge.
new ResizeObserver(() => Blockly.svgResize(workspace)).observe($('#blocks'));

void createBackend(events).then((created) => {
  backend = created;
  engineLabel.textContent = created.label;
  refreshButtons();

  const degraded = created.inputMode === 'on-demand' && !isolated;
  if (degraded) {
    consolePane.write(
      '[note] This page is not cross-origin isolated, so Stop restarts the interpreter ' +
        'instead of interrupting it, and input() is unavailable. See vite.config.ts.\n',
      'stderr',
    );
  }
});
