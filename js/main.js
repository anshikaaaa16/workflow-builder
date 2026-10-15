import { ReplaceGraph } from './commands.js';
import { createEmptyGraph } from './graph.js';
import { setupInteractions } from './interactions.js';
import { WorkflowLibrary, checkWorkflowName } from './library.js';
import { createRenderer } from './render.js';
import { importGraph } from './schema.js';
import { createEditor } from './state.js';
import {
  createToaster,
  downloadJson,
  setupHistoryPanel,
  setupInspector,
  setupJsonDialog,
  setupPalette,
  setupProblemsPanel,
  setupToolbar,
  setupWorkflowList,
} from './ui.js';
import { summarizeIssues, validateGraph } from './validate.js';

const LIBRARY_KEY = 'workflow-builder.library.v1';
const LEGACY_KEY = 'workflow-builder.autosave.v1';
const PREFS_KEY = 'workflow-builder.prefs.v1';
const $ = (id) => document.getElementById(id);

function readJson(key) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  return true;
}

const editor = createEditor();
const svg = $('canvas');
const toast = createToaster($('toasts'));
const { render } = createRenderer(editor, svg, $('wire-hint'));
const actions = setupInteractions(editor, svg, $('canvas-wrap'), { toast });
const sessions = new Map();
let library = null;

function persist() {
  if (!library) return;
  library.save(library.activeId, editor.graph);
  writeJson(LIBRARY_KEY, library.toJSON());
}

function rememberSession() {
  sessions.set(library.activeId, { stacks: editor.history.snapshot(), view: { ...editor.ui.view } });
}

function showWorkflow(id) {
  library.activeId = id;
  const session = sessions.get(id);
  editor.load(library.load(id), session?.stacks);
  if (session) {
    editor.ui.view = { ...session.view };
    editor.emit('view');
  } else {
    actions.fitView();
  }
  persist();
}

function openWorkflow(id) {
  if (id === library.activeId) return;
  persist();
  rememberSession();
  showWorkflow(id);
}

function addWorkflow(graph, message) {
  persist();
  rememberSession();
  const item = library.add(graph);
  showWorkflow(item.id);
  if (message) toast(message.replace('{name}', item.name), 'success');
}

function renameWorkflow(value) {
  const result = checkWorkflowName(value, library.items, library.activeId);
  if (!result.ok) return result;
  editor.graph.name = result.name;
  editor.emit('meta');
  return result;
}

function deleteWorkflow() {
  const name = editor.graph.name;
  if (!window.confirm(`Delete the workflow "${name}"? This cannot be undone.`)) return;
  const removedId = library.activeId;
  sessions.delete(removedId);
  const nextId = library.remove(removedId);
  showWorkflow(nextId);
  toast(`Deleted "${name}"`);
}

function applyImport(graph, label) {
  editor.clearSelection();
  editor.run(new ReplaceGraph({ ...graph, name: editor.graph.name }, label));
  actions.fitView();
  toast(`Loaded ${graph.nodes.length} nodes and ${graph.edges.length} connections`, 'success');
}

async function fetchSample() {
  const response = await fetch('samples/sample.json');
  return importGraph(await response.text());
}

async function loadSample() {
  try {
    const result = await fetchSample();
    if (result.ok) addWorkflow(result.graph, 'Opened the sample as "{name}"');
    else toast(result.errors[0], 'error');
  } catch {
    toast('Could not load the sample. Is the app running through npm start?', 'error');
  }
}

setupPalette($('palette'), actions);

const updateToolbar = setupToolbar(editor, {
  undo: $('btn-undo'),
  redo: $('btn-redo'),
  routing: $('routing'),
  name: $('wf-name'),
  zoomIn: $('btn-zoom-in'),
  zoomOut: $('btn-zoom-out'),
  zoomReset: $('btn-zoom'),
  fit: $('btn-fit'),
  empty: $('empty-state'),
}, actions, { renameWorkflow, toast });

const updateInspector = setupInspector(editor, $('inspector'), { toast, deleteSelection: actions.deleteSelection });
const updateHistory = setupHistoryPanel(editor, $('history-list'), $('history-count'));
const updateProblems = setupProblemsPanel(editor, {
  chip: $('status-chip'),
  panel: $('problems-panel'),
  list: $('problems-list'),
  count: $('problems-count'),
}, { focusNode: actions.focusNode });

let updateWorkflows = () => {};

const jsonDialog = setupJsonDialog(editor, {
  dialog: $('json-dialog'),
  text: $('json-text'),
  errors: $('json-errors'),
  copy: $('json-copy'),
  download: $('json-download'),
  load: $('json-load'),
}, { toast, applyImport });

$('btn-export').addEventListener('click', () => {
  downloadJson(editor.graph);
  const { errors } = summarizeIssues(editor.ui.issues);
  if (errors) toast(`Exported, but the workflow still has ${errors} error${errors === 1 ? '' : 's'}.`, 'error');
});
$('btn-json').addEventListener('click', () => jsonDialog.open());
$('btn-sample').addEventListener('click', loadSample);
$('btn-clear').addEventListener('click', () => {
  if (!editor.graph.nodes.length) return;
  editor.clearSelection();
  const empty = createEmptyGraph(editor.graph.name);
  empty.routing = editor.graph.routing;
  editor.run(new ReplaceGraph(empty, 'Clear canvas'));
  toast('Canvas cleared. Press Ctrl+Z to bring it back.');
});

const fileInput = $('file-input');
$('btn-import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  const text = await file.text();
  const result = importGraph(text);
  if (result.ok) {
    addWorkflow(result.graph, `Imported ${file.name} as "{name}"`);
  } else {
    toast(`"${file.name}" has ${result.errors.length} problem(s). See the details.`, 'error');
    jsonDialog.open(text, result.errors);
  }
});

const animateToggle = $('animate-flow');
const prefs = readJson(PREFS_KEY) || {};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
animateToggle.checked = prefs.animateFlow ?? !reducedMotion;
svg.classList.toggle('animate-flow', animateToggle.checked);
animateToggle.addEventListener('change', () => {
  svg.classList.toggle('animate-flow', animateToggle.checked);
  writeJson(PREFS_KEY, { ...prefs, animateFlow: animateToggle.checked });
});

editor.subscribe((reason) => {
  if (reason === 'graph') editor.ui.issues = validateGraph(editor.graph);
  render();
  if (reason === 'drag') return;
  updateToolbar();
  if (reason === 'view') return;
  updateInspector();
  updateHistory();
  updateProblems();
  if (reason === 'graph' || reason === 'meta') {
    persist();
    updateWorkflows();
  }
});

async function createLibrary() {
  const saved = readJson(LIBRARY_KEY);
  if (saved) return WorkflowLibrary.fromJSON(saved);

  const legacy = readJson(LEGACY_KEY);
  const legacyGraph = legacy && importGraph(legacy);
  if (legacyGraph?.ok) return WorkflowLibrary.fromGraphs([legacyGraph.graph]);

  try {
    const sample = await fetchSample();
    if (sample.ok) return WorkflowLibrary.fromGraphs([sample.graph]);
  } catch {
    return new WorkflowLibrary([]);
  }
  return new WorkflowLibrary([]);
}

async function boot() {
  library = await createLibrary();
  updateWorkflows = setupWorkflowList(editor, {
    list: $('workflow-list'),
    count: $('workflow-count'),
    create: $('wf-new'),
    duplicate: $('wf-duplicate'),
    remove: $('wf-delete'),
  }, library, {
    open: openWorkflow,
    create: () => addWorkflow(createEmptyGraph('Untitled workflow'), 'Created "{name}"'),
    duplicate: () => addWorkflow({ ...structuredClone(editor.graph), name: `${editor.graph.name} copy` }, 'Created "{name}"'),
    remove: deleteWorkflow,
  });
  showWorkflow(library.activeId);
}

boot();
