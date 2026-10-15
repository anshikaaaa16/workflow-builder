import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../js/catalog.js';
import {
  AddEdge,
  AddNode,
  AddPort,
  DeleteSelection,
  MoveNodes,
  RemovePort,
  RenameNode,
  ReplaceGraph,
  SetRouting,
} from '../js/commands.js';
import { createEmptyGraph } from '../js/graph.js';
import { History } from '../js/history.js';
import { buildGraph, connect, ref } from './helpers.js';

function wiredGraph() {
  const graph = buildGraph();
  connect(graph, 'e1', ref('hook', 'out-fired'), ref('http', 'in-run'));
  connect(graph, 'e2', ref('hook', 'out-body'), ref('transform', 'in-input'));
  connect(graph, 'e3', ref('transform', 'out-output'), ref('http', 'in-url'));
  connect(graph, 'e4', ref('http', 'out-done'), ref('delay', 'in-run'));
  return graph;
}

function assertRoundTrip(makeCommand) {
  const graph = wiredGraph();
  const original = structuredClone(graph);
  const history = new History(graph);

  history.execute(makeCommand());
  const afterDo = structuredClone(graph);
  assert.notDeepEqual(graph, original, 'command should change the graph');

  history.undo();
  assert.deepEqual(graph, original, 'undo should restore the original graph');

  history.redo();
  assert.deepEqual(graph, afterDo, 'redo should reapply the command');
}

test('every command can be undone and redone exactly', () => {
  const extraPort = { id: 'p-new', name: 'Headers', direction: 'in', dataType: 'data', maxConnections: 1 };
  const cases = {
    AddNode: () => new AddNode(createNode('merge', { x: 40, y: 400 }, 'merge')),
    MoveNodes: () => new MoveNodes([
      { id: 'http', from: { x: 300, y: 0 }, to: { x: 320, y: 80 } },
      { id: 'delay', from: { x: 600, y: 0 }, to: { x: 660, y: 40 } },
    ]),
    AddEdge: () => new AddEdge({ id: 'e9', source: ref('hook', 'out-body'), target: ref('http', 'in-url') }),
    DeleteNode: () => new DeleteSelection(['http']),
    DeleteEdge: () => new DeleteSelection([], ['e2']),
    DeleteMixed: () => new DeleteSelection(['hook', 'delay'], ['e3']),
    AddPort: () => new AddPort('http', extraPort),
    RemovePort: () => new RemovePort('http', 'in-url'),
    RenameNode: () => new RenameNode('http', 'HTTP Request', 'Call API'),
    SetRouting: () => new SetRouting('bezier', 'orthogonal'),
    ReplaceGraph: () => new ReplaceGraph(createEmptyGraph('Fresh')),
  };

  Object.values(cases).forEach(assertRoundTrip);
});

test('deleting a node also removes its connections, and undo restores them in place', () => {
  const graph = wiredGraph();
  const history = new History(graph);
  history.execute(new DeleteSelection(['http']));

  assert.deepEqual(graph.edges.map((e) => e.id), ['e2']);
  assert.equal(graph.nodes.some((n) => n.id === 'http'), false);

  history.undo();
  assert.deepEqual(graph.edges.map((e) => e.id), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(graph.nodes.map((n) => n.id), ['hook', 'http', 'transform', 'delay']);
});

test('removing a port removes the wires attached to it', () => {
  const graph = wiredGraph();
  const history = new History(graph);
  history.execute(new RemovePort('http', 'in-run'));
  assert.deepEqual(graph.edges.map((e) => e.id), ['e2', 'e3', 'e4']);
  history.undo();
  assert.deepEqual(graph.edges.map((e) => e.id), ['e1', 'e2', 'e3', 'e4']);
});

test('a new command clears the redo stack', () => {
  const graph = wiredGraph();
  const history = new History(graph);
  history.execute(new RenameNode('http', 'HTTP Request', 'A'));
  history.undo();
  assert.equal(history.canRedo(), true);
  history.execute(new RenameNode('http', 'HTTP Request', 'B'));
  assert.equal(history.canRedo(), false);
  assert.equal(history.redo(), false);
});

test('undo and redo on empty stacks do nothing', () => {
  const graph = wiredGraph();
  const original = structuredClone(graph);
  const history = new History(graph);
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
  assert.deepEqual(graph, original);
});

test('jumpTo travels to any point in the timeline', () => {
  const graph = wiredGraph();
  const history = new History(graph);
  const names = ['A', 'B', 'C', 'D'];
  let previous = 'HTTP Request';
  names.forEach((name) => {
    history.execute(new RenameNode('http', previous, name));
    previous = name;
  });
  const label = () => graph.nodes.find((n) => n.id === 'http').label;

  history.jumpTo(1);
  assert.equal(label(), 'A');
  assert.deepEqual(history.timeline().position, 1);
  history.jumpTo(0);
  assert.equal(label(), 'HTTP Request');
  history.jumpTo(4);
  assert.equal(label(), 'D');
  assert.equal(history.timeline().labels.length, 4);
});

test('onChange fires once per action, and once for a jump', () => {
  const graph = wiredGraph();
  let calls = 0;
  const history = new History(graph, { onChange: () => { calls += 1; } });
  history.execute(new SetRouting('bezier', 'orthogonal'));
  history.execute(new RenameNode('http', 'HTTP Request', 'X'));
  history.jumpTo(0);
  assert.equal(calls, 3);
});

test('history is capped at the limit', () => {
  const graph = wiredGraph();
  const history = new History(graph, { limit: 3 });
  for (let i = 0; i < 5; i += 1) history.execute(new SetRouting('bezier', 'orthogonal'));
  assert.equal(history.done.length, 3);
});
