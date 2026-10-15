import { ReplaceGraph } from './commands.js';
import { createEmptyGraph } from './graph.js';
import { setupInteractions } from './interactions.js';
import { createRenderer } from './render.js';
import { exportGraph, importGraph } from './schema.js';
import { createEditor } from './state.js';
import {
  createToaster,
  downloadJson,
  setupHistoryPanel,
  setupInspector,
  setupJsonDialog,
  setupPalette,
  setupToolbar,
} from './ui.js';

const STORAGE_KEY = 'workflow-builder.autosave.v1';
const $ = (id) => document.getElementById(id);

const editor = createEditor();
const svg = $('canvas');
const toast = createToaster($('toasts'));
const { render } = createRenderer(editor, svg, $('wire-hint'));
const actions = setupInteractions(editor, svg, $('canvas-wrap'), { toast });

function applyImport(graph, label) {
  editor.clearSelection();
  editor.run(new ReplaceGraph(graph, label));
  actions.fitView();
  toast(`Loaded "${graph.name}" (${graph.nodes.length} nodes, ${graph.edges.length} connections)`, 'success');
}

async function fetchSample() {
  const response = await fetch('samples/sample.json');
  return importGraph(await response.text());
}

async function loadSample() {
  try {
    const result = await fetchSample();
    if (result.ok) applyImport(result.graph, 'Load sample workflow');
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
}, actions);

const updateInspector = setupInspector(editor, $('inspector'), { toast, deleteSelection: actions.deleteSelection });
const updateHistory = setupHistoryPanel(editor, $('history-list'), $('history-count'));

const jsonDialog = setupJsonDialog(editor, {
  dialog: $('json-dialog'),
  text: $('json-text'),
  errors: $('json-errors'),
  copy: $('json-copy'),
  download: $('json-download'),
  load: $('json-load'),
}, { toast, applyImport });

$('btn-export').addEventListener('click', () => downloadJson(editor.graph));
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
    applyImport(result.graph, `Import ${file.name}`);
  } else {
    toast(`"${file.name}" has ${result.errors.length} problem(s). See the details.`, 'error');
    jsonDialog.open(text, result.errors);
  }
});

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exportGraph(editor.graph)));
  } catch {
    return;
  }
}

function readSaved() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? importGraph(text) : null;
  } catch {
    return null;
  }
}

editor.subscribe((reason) => {
  render();
  if (reason === 'drag') return;
  updateToolbar();
  if (reason === 'view') return;
  updateInspector();
  updateHistory();
  if (reason === 'graph' || reason === 'meta') save();
});

async function boot() {
  const saved = readSaved();
  if (saved?.ok) {
    editor.load(saved.graph);
  } else {
    try {
      const sample = await fetchSample();
      if (sample.ok) editor.load(sample.graph);
    } catch {
      editor.load(createEmptyGraph());
    }
  }
  actions.fitView();
}

boot();
