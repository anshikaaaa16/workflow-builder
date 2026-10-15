import { History } from './history.js';
import { createEmptyGraph, replaceContents } from './graph.js';

export function createEditor(graph = createEmptyGraph()) {
  const listeners = new Set();

  const editor = {
    graph,
    ui: {
      selectedNodes: new Set(),
      selectedEdge: null,
      view: { x: 0, y: 0, k: 1 },
      connecting: null,
      hoverPort: null,
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    emit(reason) {
      listeners.forEach((listener) => listener(reason));
    },

    run(command) {
      editor.history.execute(command);
    },

    load(next) {
      replaceContents(editor.graph, next);
      editor.clearSelection();
      editor.history.clear();
    },

    clearSelection() {
      editor.ui.selectedNodes = new Set();
      editor.ui.selectedEdge = null;
    },

    pruneSelection() {
      const { ui } = editor;
      const nodeIds = new Set(editor.graph.nodes.map((n) => n.id));
      ui.selectedNodes = new Set([...ui.selectedNodes].filter((id) => nodeIds.has(id)));
      if (ui.selectedEdge && !editor.graph.edges.some((e) => e.id === ui.selectedEdge)) ui.selectedEdge = null;
    },
  };

  editor.history = new History(graph, {
    onChange: () => {
      editor.pruneSelection();
      editor.emit('graph');
    },
  });

  return editor;
}
