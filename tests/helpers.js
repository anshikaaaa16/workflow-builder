import { createNode } from '../js/catalog.js';
import { createEmptyGraph } from '../js/graph.js';

export const ref = (nodeId, portId) => ({ nodeId, portId });

export function buildGraph() {
  const graph = createEmptyGraph('Test');
  graph.nodes.push(
    createNode('webhook', { x: 0, y: 0 }, 'hook'),
    createNode('http', { x: 300, y: 0 }, 'http'),
    createNode('transform', { x: 300, y: 200 }, 'transform'),
    createNode('delay', { x: 600, y: 0 }, 'delay'),
  );
  return graph;
}

export function connect(graph, id, source, target) {
  graph.edges.push({ id, source, target });
}
