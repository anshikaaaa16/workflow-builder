import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNode } from '../js/catalog.js';
import { createEmptyGraph } from '../js/graph.js';
import { importGraph } from '../js/schema.js';
import { summarizeIssues, validateGraph } from '../js/validate.js';
import { buildGraph, connect, ref } from './helpers.js';

const messages = (issues) => issues.map((i) => i.message).join('\n');

function healthyGraph() {
  const graph = buildGraph();
  connect(graph, 'e1', ref('hook', 'out-fired'), ref('http', 'in-run'));
  connect(graph, 'e2', ref('hook', 'out-body'), ref('transform', 'in-input'));
  connect(graph, 'e3', ref('transform', 'out-output'), ref('http', 'in-url'));
  connect(graph, 'e4', ref('http', 'out-done'), ref('delay', 'in-run'));
  return graph;
}

test('an empty workflow has no problems', () => {
  assert.deepEqual(validateGraph(createEmptyGraph()), []);
});

test('a fully wired workflow is valid', () => {
  assert.deepEqual(validateGraph(healthyGraph()), []);
});

test('the bundled sample is valid', async () => {
  const text = await readFile(new URL('../samples/sample.json', import.meta.url), 'utf8');
  assert.deepEqual(validateGraph(importGraph(text).graph), []);
});

test('a workflow needs a trigger', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode('delay', { x: 0, y: 0 }, 'a'), createNode('delay', { x: 300, y: 0 }, 'b'));
  connect(graph, 'e1', ref('a', 'out-then'), ref('b', 'in-run'));
  const issues = validateGraph(graph);
  assert.match(messages(issues), /There is no trigger/);
  assert.equal(issues[0].level, 'error');
});

test('unconnected data inputs are errors that point at the port', () => {
  const graph = healthyGraph();
  graph.edges = graph.edges.filter((e) => e.id !== 'e3');
  const issue = validateGraph(graph).find((i) => i.portId === 'in-url');
  assert.equal(issue.level, 'error');
  assert.equal(issue.nodeId, 'http');
  assert.match(issue.message, /needs data on its "URL" input/);
});

test('a node whose Run input is not connected is never told to run', () => {
  const graph = healthyGraph();
  graph.edges = graph.edges.filter((e) => e.id !== 'e4');
  graph.edges.push({ id: 'e5', source: ref('http', 'out-done'), target: ref('delay', 'in-run') });
  graph.edges = graph.edges.filter((e) => e.id !== 'e1');
  const text = messages(validateGraph(graph));
  assert.match(text, /"HTTP Request" is never told to run/);
});

test('nodes with no connections are flagged as warnings', () => {
  const graph = healthyGraph();
  graph.nodes.push(createNode('email', { x: 0, y: 400 }, 'lonely'));
  const issues = validateGraph(graph);
  const lonely = issues.find((i) => i.nodeId === 'lonely');
  assert.equal(lonely.level, 'warning');
  assert.match(lonely.message, /not connected to anything/);
});

test('nodes that cannot be reached from a trigger are flagged', () => {
  const graph = healthyGraph();
  graph.nodes.push(createNode('delay', { x: 0, y: 400 }, 'd1'), createNode('delay', { x: 300, y: 400 }, 'd2'));
  connect(graph, 'e9', ref('d1', 'out-then'), ref('d2', 'in-run'));
  const text = messages(validateGraph(graph));
  assert.match(text, /cannot be reached from a trigger/);
});

test('a trigger that starts nothing is flagged', () => {
  const graph = healthyGraph();
  graph.edges = graph.edges.filter((e) => e.id !== 'e1');
  const issue = validateGraph(graph).find((i) => i.nodeId === 'hook');
  assert.equal(issue.portId, 'out-fired');
  assert.match(issue.message, /does not start anything/);
});

test('merge with one branch and condition with no branches are warnings', () => {
  const graph = healthyGraph();
  graph.nodes.push(createNode('merge', { x: 900, y: 0 }, 'merge'), createNode('condition', { x: 900, y: 300 }, 'cond'));
  connect(graph, 'e10', ref('delay', 'out-then'), ref('merge', 'in-a'));
  connect(graph, 'e11', ref('merge', 'out-out'), ref('cond', 'in-run'));
  connect(graph, 'e12', ref('hook', 'out-body'), ref('cond', 'in-value'));
  const text = messages(validateGraph(graph));
  assert.match(text, /only has one branch connected/);
  assert.match(text, /has no branches connected/);
});

test('duplicate node names are flagged', () => {
  const graph = healthyGraph();
  graph.nodes[3].label = 'http request';
  assert.match(messages(validateGraph(graph)), /Two nodes are called "http request"/);
});

test('errors are listed before warnings and can be counted', () => {
  const graph = healthyGraph();
  graph.edges = graph.edges.filter((e) => e.id !== 'e3');
  graph.nodes.push(createNode('email', { x: 0, y: 400 }, 'lonely'));
  const issues = validateGraph(graph);
  assert.equal(issues[0].level, 'error');
  assert.equal(issues.at(-1).level, 'warning');
  assert.deepEqual(summarizeIssues(issues), { errors: 1, warnings: 1 });
});
