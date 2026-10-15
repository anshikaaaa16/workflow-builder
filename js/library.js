import { createEmptyGraph } from './graph.js';
import { exportGraph, importGraph } from './schema.js';
import { uid } from './utils.js';

export const MAX_WORKFLOW_NAME = 60;

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function checkWorkflowName(name, items, exceptId = null) {
  const clean = (name || '').trim();
  if (!clean) return { ok: false, reason: 'Give the workflow a name.' };
  if (clean.length > MAX_WORKFLOW_NAME) {
    return { ok: false, reason: `Workflow names can be at most ${MAX_WORKFLOW_NAME} characters.` };
  }
  if (items.some((item) => item.id !== exceptId && sameName(item.name, clean))) {
    return { ok: false, reason: `A workflow called "${clean}" already exists.` };
  }
  return { ok: true, name: clean };
}

export class WorkflowLibrary {
  constructor(items = [], activeId = null) {
    this.items = items;
    if (!this.items.length) this.add(createEmptyGraph());
    this.activeId = this.items.some((item) => item.id === activeId) ? activeId : this.items[0].id;
  }

  static fromJSON(raw) {
    const items = [];
    (Array.isArray(raw?.items) ? raw.items : []).forEach((item) => {
      if (!item || typeof item.id !== 'string' || items.some((kept) => kept.id === item.id)) return;
      if (!importGraph(item.data).ok) return;
      items.push({ id: item.id, name: item.data.meta.name, updatedAt: Number(item.updatedAt) || 0, data: item.data });
    });
    return new WorkflowLibrary(items, raw?.activeId);
  }

  static fromGraphs(graphs) {
    const library = new WorkflowLibrary();
    if (!graphs.length) return library;
    library.items = [];
    graphs.forEach((graph) => library.add(graph));
    library.activeId = library.items[0].id;
    return library;
  }

  toJSON() {
    return { version: 1, activeId: this.activeId, items: this.items };
  }

  get(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  load(id) {
    return importGraph(this.get(id).data).graph;
  }

  uniqueName(base, exceptId = null) {
    const root = (base || 'Untitled workflow').trim().slice(0, MAX_WORKFLOW_NAME - 4);
    let name = root;
    for (let n = 2; this.items.some((item) => item.id !== exceptId && sameName(item.name, name)); n += 1) {
      name = `${root} ${n}`;
    }
    return name;
  }

  add(graph) {
    const name = this.uniqueName(graph.name);
    const item = { id: uid('wf'), name, updatedAt: Date.now(), data: exportGraph({ ...graph, name }) };
    this.items.push(item);
    return item;
  }

  save(id, graph) {
    const item = this.get(id);
    if (!item) return;
    item.name = graph.name;
    item.data = exportGraph(graph);
    item.updatedAt = Date.now();
  }

  remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return this.activeId;
    this.items.splice(index, 1);
    if (!this.items.length) this.add(createEmptyGraph());
    if (this.activeId === id) this.activeId = this.items[Math.min(index, this.items.length - 1)].id;
    return this.activeId;
  }
}
