import * as Blockly from 'blockly/core';
import './blocks/blocks';
import { scratchTheme } from './blocks/theme';
import { buildToolbox, MODULES, MODULES_CATEGORY } from './blocks/toolbox';
import { generateProgram } from './blocks/program';
import { registerFunctionsCategory } from './blocks/functions';
import { registerVariablesCategory } from './blocks/variables';
import { registerClassesCategory } from './blocks/classes';
import { buildLineMap } from './blocks/sourcemap';
import { errorLine } from './python/traceback';
import { clearErrorHighlight, showErrorBlock } from './ui/error-highlight';
import { askToConfirm, installDialogs } from './ui/dialogs';
import type { PythonBackend, RunnerState } from './python/backend';
import { createBackend, isTauri } from './python/select';
import { isolated } from './python/pyodide-backend';
import { createProjectIO } from './project/storage';
import { FORMAT_VERSION, parse, serialize } from './project/format';
import { migrateWorkspace } from './project/migrate';
import { ConsolePane } from './ui/console';
import { createCodePane } from './ui/codepane';
import { createStage } from './ui/stage';
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

// Installed before any workspace interaction can open one. The callback picks
// up renames, which Blockly applies inside the dialog's own callback.
installDialogs({ onClosed: () => noteWorkspaceChanged() });

/** Modules whose blocks are in the palette. Saved with the project. */
let modules: string[] = [];

const stage = createStage($('#stage'));

const workspace = Blockly.inject($('#blocks'), {
  toolbox: buildToolbox(modules),
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
registerClassesCategory(workspace);

/**
 * The module picker. Turning one on appends its category to the palette rather
 * than showing every library at once, which would bury the core blocks.
 */
function applyModules() {
  workspace.updateToolbox(buildToolbox(modules));
}

/**
 * The stage appears when the program actually imports turtle, not merely when
 * the blocks are in the palette -- having the category available should not cost
 * a pane you are not drawing in.
 */
function applyStageVisibility() {
  const drawing = code.includes('import turtle');
  $('#stage-pane').hidden = !drawing;
  // The row template depends on how many panes there are, and a hidden pane is
  // not a grid item -- so the class, rather than the count, decides the sizes.
  $('.side').classList.toggle('with-stage', drawing);
  stage.setVisible(drawing);
}

for (const name of MODULES) {
  workspace.registerButtonCallback(`SNAPPY_TOGGLE_${name}`, () => {
    modules = modules.includes(name)
      ? modules.filter((other) => other !== name)
      : [...modules, name];
    applyModules();
    noteWorkspaceChanged();
  });
}

workspace.registerToolboxCategoryCallback(MODULES_CATEGORY, () =>
  MODULES.map((name) => ({
    kind: 'button',
    text: modules.includes(name) ? `Remove ${name} blocks` : `Add ${name} blocks`,
    callbackkey: `SNAPPY_TOGGLE_${name}`,
  })),
);

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
  code = generateProgram(workspace);
  codePane.setCode(code || '# Drag blocks to build a program.');
  applyStageVisibility();
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
  onDraw: (op: string, args: unknown[]) => stage.draw(op, args),
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
  stage.clear();
  clearErrorHighlight();
  backend?.run(code);
});
stopButton.addEventListener('click', () => backend?.stop());
clearButton.addEventListener('click', () => consolePane.clear());

// --- the desktop build ------------------------------------------------------

/**
 * Where the installers live. Defaults to the repository's releases, and can be
 * pointed at a bucket instead with a VITE_DESKTOP_DOWNLOAD_URL build variable --
 * no code change, so the deploy decides.
 */
const DOWNLOAD_URL: string =
  (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ||
  'https://github.com/keaden-w-knight/SnapPy/releases/latest';

function platformName(): string {
  const agent = navigator.userAgent;
  if (/Windows/i.test(agent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(agent)) return 'macOS';
  if (/Linux|X11/i.test(agent)) return 'Linux';
  return 'your computer';
}

const downloadButton = $<HTMLButtonElement>('#download');
// Pointless inside the desktop app: you are already running it.
downloadButton.hidden = isTauri;

downloadButton.addEventListener('click', () => {
  askToConfirm({
    message:
      `The desktop version runs your own Python instead of the browser's copy, so it ` +
      `is faster, can open and save real files, and can use any installed package. ` +
      `Downloads for ${platformName()} are on the releases page.`,
    okLabel: 'Open downloads',
    onConfirm: () => window.open(DOWNLOAD_URL, '_blank', 'noopener'),
  });
});

// --- file commands ----------------------------------------------------------

function confirmDiscard(action: string): boolean {
  return !dirty || confirm(`"${projectName}" has unsaved changes. ${action} anyway?`);
}

function loadProject(name: string, workspaceState: object, projectModules: string[] = []) {
  modules = projectModules.filter((module) => MODULES.includes(module));
  applyModules();
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
    loadProject(project.name || file.name, project.workspace, project.modules);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

async function saveProject(forceNew: boolean) {
  try {
    const text = serialize({ name: projectName, workspace: snapshot(), modules });
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
  loadProject(UNTITLED, STARTER, []);
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

/**
 * The autosave predates having a version, so a bare workspace state is treated
 * as version 1 and migrated like any other old project.
 */
function restoreAutosave(): object {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return STARTER;
  try {
    const stored = JSON.parse(raw) as {
      version?: number;
      workspace?: object;
      modules?: string[];
    };
    // A wrapper is recognised by carrying a workspace, not by having a version:
    // the first wrapped autosaves predate the version field.
    const isWrapped = !!stored.workspace;
    modules = (stored.modules ?? []).filter((module) => MODULES.includes(module));
    return migrateWorkspace(isWrapped ? stored.workspace! : stored, stored.version ?? 1);
  } catch {
    return STARTER; // unreadable autosave should not stop the app starting
  }
}

Blockly.serialization.workspaces.load(restoreAutosave(), workspace);
applyModules();
regenerate();
renderProjectLabel();

function noteWorkspaceChanged() {
  regenerate();
  clearErrorHighlight();
  dirty = true;
  renderProjectLabel();
  localStorage.setItem(
    AUTOSAVE_KEY,
    JSON.stringify({ version: FORMAT_VERSION, workspace: snapshot(), modules }),
  );
}

workspace.addChangeListener((event: Blockly.Events.Abstract) => {
  if (event.isUiEvent) return;
  noteWorkspaceChanged();
});

// Dev-only handle so the browser test suite can drive the workspace directly
// rather than only through synthetic DOM events. Vite strips this from builds.
if (import.meta.env.DEV) {
  (window as unknown as { snappy?: unknown }).snappy = { workspace, Blockly, stage };
}

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
