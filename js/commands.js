import { findNode, replaceContents } from './graph.js';
import { clone } from './utils.js';

function removeAt(list, entries) {
  [...entries].sort((a, b) => b.index - a.index).forEach(({ index }) => list.splice(index, 1));
}

function insertAt(list, entries) {
  [...entries].sort((a, b) => a.index - b.index).forEach(({ index, item }) => list.splice(index, 0, item));
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export class AddNode {
  constructor(node) {
    this.node = clone(node);
    this.label = `Add "${node.label}"`;
  }

  do(graph) {
    graph.nodes.push(clone(this.node));
  }

  undo(graph) {
    graph.nodes = graph.nodes.filter((n) => n.id !== this.node.id);
  }
}

export class DeleteSelection {
  constructor(nodeIds = [], edgeIds = []) {
    this.nodeIds = [...nodeIds];
    this.edgeIds = [...edgeIds];
    const parts = [];
    if (this.nodeIds.length) parts.push(plural(this.nodeIds.length, 'node'));
    if (this.edgeIds.length) parts.push(plural(this.edgeIds.length, 'connection'));
    this.label = `Delete ${parts.join(', ')}`;
  }

  do(graph) {
    const nodeIds = new Set(this.nodeIds);
    const edgeIds = new Set(this.edgeIds);

    this.removedEdges = [];
    graph.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id) || nodeIds.has(edge.source.nodeId) || nodeIds.has(edge.target.nodeId)) {
        this.removedEdges.push({ index, item: edge });
      }
    });

    this.removedNodes = [];
    graph.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) this.removedNodes.push({ index, item: node });
    });

    removeAt(graph.edges, this.removedEdges);
    removeAt(graph.nodes, this.removedNodes);
  }

  undo(graph) {
    insertAt(graph.nodes, this.removedNodes);
    insertAt(graph.edges, this.removedEdges);
  }
}

export class MoveNodes {
  constructor(moves, label) {
    this.moves = moves.map((m) => ({ id: m.id, from: { ...m.from }, to: { ...m.to } }));
    this.label = label || `Move ${plural(moves.length, 'node')}`;
  }

  apply(graph, key) {
    this.moves.forEach((move) => {
      const node = findNode(graph, move.id);
      if (node) node.position = { ...move[key] };
    });
  }

  do(graph) {
    this.apply(graph, 'to');
  }

  undo(graph) {
    this.apply(graph, 'from');
  }
}

export class AddEdge {
  constructor(edge, label = 'Connect') {
    this.edge = clone(edge);
    this.label = label;
  }

  do(graph) {
    graph.edges.push(clone(this.edge));
  }

  undo(graph) {
    graph.edges = graph.edges.filter((e) => e.id !== this.edge.id);
  }
}

export class AddPort {
  constructor(nodeId, port, nodeLabel = 'node') {
    this.nodeId = nodeId;
    this.port = clone(port);
    this.label = `Add port "${port.name}" to "${nodeLabel}"`;
  }

  do(graph) {
    findNode(graph, this.nodeId).ports.push(clone(this.port));
  }

  undo(graph) {
    const node = findNode(graph, this.nodeId);
    node.ports = node.ports.filter((p) => p.id !== this.port.id);
  }
}

export class RemovePort {
  constructor(nodeId, portId, label = 'Remove port') {
    this.nodeId = nodeId;
    this.portId = portId;
    this.label = label;
  }

  do(graph) {
    const node = findNode(graph, this.nodeId);
    const index = node.ports.findIndex((p) => p.id === this.portId);
    this.removedPort = { index, item: node.ports[index] };

    this.removedEdges = [];
    graph.edges.forEach((edge, i) => {
      const touches = [edge.source, edge.target].some((r) => r.nodeId === this.nodeId && r.portId === this.portId);
      if (touches) this.removedEdges.push({ index: i, item: edge });
    });

    removeAt(graph.edges, this.removedEdges);
    removeAt(node.ports, [this.removedPort]);
  }

  undo(graph) {
    insertAt(findNode(graph, this.nodeId).ports, [this.removedPort]);
    insertAt(graph.edges, this.removedEdges);
  }
}

export class RenameNode {
  constructor(nodeId, from, to) {
    this.nodeId = nodeId;
    this.from = from;
    this.to = to;
    this.label = `Rename "${from}" to "${to}"`;
  }

  do(graph) {
    findNode(graph, this.nodeId).label = this.to;
  }

  undo(graph) {
    findNode(graph, this.nodeId).label = this.from;
  }
}

export class SetRouting {
  constructor(from, to) {
    this.from = from;
    this.to = to;
    this.label = `Switch wires to ${to === 'orthogonal' ? 'right-angle' : 'curved'}`;
  }

  do(graph) {
    graph.routing = this.to;
  }

  undo(graph) {
    graph.routing = this.from;
  }
}

export class ReplaceGraph {
  constructor(next, label = 'Replace workflow') {
    this.next = clone(next);
    this.label = label;
  }

  do(graph) {
    this.previous = clone(graph);
    replaceContents(graph, this.next);
  }

  undo(graph) {
    replaceContents(graph, this.previous);
  }
}
