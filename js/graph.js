export function createEmptyGraph(name = 'Untitled workflow') {
  return { name, routing: 'bezier', nodes: [], edges: [] };
}

export function findNode(graph, nodeId) {
  return graph.nodes.find((node) => node.id === nodeId) || null;
}

export function findPort(graph, ref) {
  const node = findNode(graph, ref.nodeId);
  const port = node ? node.ports.find((p) => p.id === ref.portId) : null;
  return port ? { node, port } : null;
}

export function portKey(ref) {
  return `${ref.nodeId}::${ref.portId}`;
}

export function sameRef(a, b) {
  return a.nodeId === b.nodeId && a.portId === b.portId;
}

export function replaceContents(graph, next) {
  graph.name = next.name;
  graph.routing = next.routing;
  graph.nodes = structuredClone(next.nodes);
  graph.edges = structuredClone(next.edges);
}
