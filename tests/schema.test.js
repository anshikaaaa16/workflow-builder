import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportGraph, importGraph } from '../js/schema.js';
import { buildGraph, connect, ref } from './helpers.js';

function sampleGraph() {
  const graph = buildGraph();
  graph.routing = 'orthogonal';
  graph.nodes[1].label = 'Call API';
  graph.nodes[1].ports.push({ id: 'p-extra', name: 'Headers', direction: 'in', dataType: 'data', maxConnections: 1 });
  connect(graph, 'e1', ref('hook', 'out-fired'), ref('http', 'in-run'));
  connect(graph, 'e2', ref('hook', 'out-body'), ref('transform', 'in-input'));
  connect(graph, 'e3', ref('transform', 'out-output'), ref('http', 'p-extra'));
  return graph;
}

test('export → import round-trips without losing anything', () => {
  const graph = sampleGraph();
  const json = JSON.stringify(exportGraph(graph));
  const result = importGraph(json);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.graph, graph);
});

test('export produces the documented schema shape', () => {
  const data = exportGraph(sampleGraph());
  assert.equal(data.version, 1);
  assert.equal(data.meta.name, 'Test');
  assert.equal(data.meta.routing, 'orthogonal');
  assert.ok(Date.parse(data.meta.exportedAt));
  assert.deepEqual(Object.keys(data.nodes[0]), ['id', 'type', 'label', 'position', 'ports']);
  assert.deepEqual(Object.keys(data.edges[0]), ['id', 'source', 'target']);
});

test('the bundled sample workflow is valid', async () => {
  const text = await readFile(new URL('../samples/sample.json', import.meta.url), 'utf8');
  const result = importGraph(text);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.graph.nodes.length, 6);
  assert.equal(result.graph.edges.length, 7);
});

test('rejects text that is not JSON', () => {
  const result = importGraph('{ nodes: [');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Not valid JSON/);
});

test('rejects the wrong version or missing arrays', () => {
  assert.match(importGraph({ version: 2, nodes: [], edges: [] }).errors[0], /version/);
  assert.match(importGraph({ version: 1, edges: [] }).errors.join(), /"nodes" must be an array/);
  assert.equal(importGraph([]).ok, false);
});

test('rejects unknown node types, bad positions and duplicate ids', () => {
  const data = exportGraph(sampleGraph());
  data.nodes[0].type = 'teleporter';
  data.nodes[1].position.x = 'left';
  data.nodes[3].id = data.nodes[2].id;
  const result = importGraph(data);
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  assert.match(text, /unknown node type "teleporter"/);
  assert.match(text, /numeric x and y/);
  assert.match(text, /duplicate node id/);
});

test('rejects edges that point at missing nodes or ports', () => {
  const data = exportGraph(sampleGraph());
  data.edges.push({ id: 'ghost', source: ref('hook', 'out-fired'), target: ref('nobody', 'in-run') });
  data.edges.push({ id: 'ghost-port', source: ref('hook', 'out-nope'), target: ref('http', 'in-run') });
  const result = importGraph(data);
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  assert.match(text, /refers to node "nobody", which is missing/);
  assert.match(text, /node "hook" has no port "out-nope"/);
});

test('rejects edges that break the port rules', () => {
  const data = exportGraph(sampleGraph());
  data.edges.push({ id: 'bad', source: ref('hook', 'out-fired'), target: ref('transform', 'in-input') });
  const result = importGraph(data);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /Trigger output cannot feed a Data input/);
});

test('rejects edges written backwards (target → source)', () => {
  const data = exportGraph(sampleGraph());
  data.edges.push({ id: 'backwards', source: ref('delay', 'in-run'), target: ref('http', 'out-done') });
  const result = importGraph(data);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /"source" must be an output/);
});

test('rejects ports that break the port rules', () => {
  const data = exportGraph(sampleGraph());
  data.nodes[0].ports.push({ id: 'in-x', name: 'X', direction: 'in', dataType: 'flow', maxConnections: null });
  const result = importGraph(data);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /cannot have inputs/);
});
