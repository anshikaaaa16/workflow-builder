import test from 'node:test';
import assert from 'node:assert/strict';
import { canAddPort, canConnect } from '../js/rules.js';
import { buildGraph, connect, ref } from './helpers.js';

test('trigger output can start a flow input', () => {
  const graph = buildGraph();
  const result = canConnect(graph, ref('hook', 'out-fired'), ref('http', 'in-run'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.source, ref('hook', 'out-fired'));
  assert.deepEqual(result.target, ref('http', 'in-run'));
});

test('dragging from an input to an output is normalised to output → input', () => {
  const graph = buildGraph();
  const result = canConnect(graph, ref('http', 'in-url'), ref('hook', 'out-body'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.source, ref('hook', 'out-body'));
  assert.deepEqual(result.target, ref('http', 'in-url'));
});

test('rejects connecting a node to itself', () => {
  const graph = buildGraph();
  const result = canConnect(graph, ref('http', 'out-done'), ref('http', 'in-run'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /itself/);
});

test('rejects output → output and input → input', () => {
  const graph = buildGraph();
  assert.equal(canConnect(graph, ref('hook', 'out-fired'), ref('http', 'out-done')).ok, false);
  assert.equal(canConnect(graph, ref('http', 'in-run'), ref('delay', 'in-run')).ok, false);
});

test('rejects incompatible port types', () => {
  const graph = buildGraph();
  const triggerToData = canConnect(graph, ref('hook', 'out-fired'), ref('http', 'in-url'));
  assert.equal(triggerToData.ok, false);
  assert.match(triggerToData.reason, /Trigger output cannot feed a Data input/);
  assert.equal(canConnect(graph, ref('hook', 'out-body'), ref('http', 'in-run')).ok, false);
  assert.equal(canConnect(graph, ref('http', 'out-done'), ref('transform', 'in-input')).ok, false);
});

test('rejects duplicate connections', () => {
  const graph = buildGraph();
  connect(graph, 'e1', ref('hook', 'out-fired'), ref('http', 'in-run'));
  const result = canConnect(graph, ref('hook', 'out-fired'), ref('http', 'in-run'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /already connected/);
});

test('respects maxConnections on inputs', () => {
  const graph = buildGraph();
  connect(graph, 'e1', ref('transform', 'out-output'), ref('http', 'in-url'));
  const result = canConnect(graph, ref('hook', 'out-body'), ref('http', 'in-url'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /accepts only 1 connection/);
});

test('rejects connections that would create a loop', () => {
  const graph = buildGraph();
  connect(graph, 'e1', ref('http', 'out-done'), ref('delay', 'in-run'));
  const result = canConnect(graph, ref('delay', 'out-then'), ref('http', 'in-run'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /loop/);
});

test('rejects ports that do not exist', () => {
  const graph = buildGraph();
  assert.equal(canConnect(graph, ref('hook', 'nope'), ref('http', 'in-run')).ok, false);
});

test('canAddPort enforces port rules', () => {
  const graph = buildGraph();
  const [hook, http] = graph.nodes;
  const port = (direction, dataType, name = 'Extra') => ({ id: 'p1', name, direction, dataType, maxConnections: null });

  assert.equal(canAddPort(http, port('in', 'data')).ok, true);
  assert.equal(canAddPort(hook, port('out', 'trigger')).ok, true);
  assert.match(canAddPort(hook, port('in', 'flow')).reason, /cannot have inputs/);
  assert.match(canAddPort(http, port('out', 'trigger')).reason, /Only trigger nodes/);
  assert.equal(canAddPort(http, port('in', 'trigger')).ok, false);
  assert.match(canAddPort(http, port('in', 'flow', 'run')).reason, /already has an input/);
  assert.match(canAddPort(http, port('in', 'flow', '  ')).reason, /name/);
  assert.equal(canAddPort(http, { ...port('in', 'data'), maxConnections: 0 }).ok, false);
});
