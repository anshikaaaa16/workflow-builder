import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyGraph } from '../js/graph.js';
import { WorkflowLibrary, checkWorkflowName } from '../js/library.js';
import { buildGraph } from './helpers.js';

test('a new library always has one empty workflow', () => {
  const library = new WorkflowLibrary();
  assert.equal(library.items.length, 1);
  assert.equal(library.activeId, library.items[0].id);
  assert.deepEqual(library.load(library.activeId).nodes, []);
});

test('adding workflows keeps names unique', () => {
  const library = WorkflowLibrary.fromGraphs([createEmptyGraph('Onboarding')]);
  const second = library.add(createEmptyGraph('Onboarding'));
  const third = library.add(createEmptyGraph('onboarding'));
  assert.equal(second.name, 'Onboarding 2');
  assert.equal(third.name, 'onboarding 3');
});

test('save and load round-trip a workflow', () => {
  const library = new WorkflowLibrary();
  const graph = buildGraph();
  library.save(library.activeId, graph);
  assert.deepEqual(library.load(library.activeId), graph);
  assert.equal(library.get(library.activeId).name, 'Test');
});

test('removing the active workflow activates a neighbour', () => {
  const library = WorkflowLibrary.fromGraphs([createEmptyGraph('A'), createEmptyGraph('B'), createEmptyGraph('C')]);
  const [a, b, c] = library.items;
  library.activeId = b.id;
  assert.equal(library.remove(b.id), c.id);
  assert.equal(library.remove(c.id), a.id);
  assert.equal(library.items.length, 1);
});

test('removing the last workflow leaves a fresh empty one', () => {
  const library = new WorkflowLibrary();
  const nextId = library.remove(library.activeId);
  assert.equal(library.items.length, 1);
  assert.equal(nextId, library.items[0].id);
});

test('fromJSON restores the library and skips broken entries', () => {
  const original = WorkflowLibrary.fromGraphs([buildGraph(), createEmptyGraph('Second')]);
  original.activeId = original.items[1].id;
  const raw = JSON.parse(JSON.stringify(original.toJSON()));
  raw.items.push({ id: 'broken', data: { version: 99 } }, { id: raw.items[0].id, data: raw.items[0].data });

  const restored = WorkflowLibrary.fromJSON(raw);
  assert.deepEqual(restored.items.map((i) => i.name), ['Test', 'Second']);
  assert.equal(restored.activeId, original.items[1].id);
});

test('fromJSON copes with garbage', () => {
  assert.equal(WorkflowLibrary.fromJSON(null).items.length, 1);
  assert.equal(WorkflowLibrary.fromJSON({ items: 'nope' }).items.length, 1);
});

test('checkWorkflowName validates names', () => {
  const items = [{ id: 'a', name: 'Onboarding' }, { id: 'b', name: 'Billing' }];
  assert.deepEqual(checkWorkflowName('  Reports ', items), { ok: true, name: 'Reports' });
  assert.match(checkWorkflowName('   ', items).reason, /name/);
  assert.match(checkWorkflowName('x'.repeat(61), items).reason, /at most 60/);
  assert.match(checkWorkflowName('billing', items).reason, /already exists/);
  assert.equal(checkWorkflowName('Billing', items, 'b').ok, true);
});
