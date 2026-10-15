import { NODE_TYPES, PORT_TYPES } from './catalog.js';
import { findPort, sameRef } from './graph.js';

export const COMPATIBLE = {
  trigger: ['flow'],
  flow: ['flow'],
  data: ['data'],
};

const fail = (reason) => ({ ok: false, reason });

const typeName = (port) => PORT_TYPES[port.dataType]?.label || port.dataType;

export function canConnect(graph, a, b) {
  const first = findPort(graph, a);
  const second = findPort(graph, b);
  if (!first || !second) return fail('That port no longer exists.');

  if (first.node.id === second.node.id) return fail('A node cannot connect to itself.');

  if (first.port.direction === second.port.direction) {
    const kind = first.port.direction === 'out' ? 'outputs' : 'inputs';
    return fail(`Two ${kind} cannot be connected. Wire an output to an input.`);
  }

  const [from, to] = first.port.direction === 'out' ? [first, second] : [second, first];
  const source = { nodeId: from.node.id, portId: from.port.id };
  const target = { nodeId: to.node.id, portId: to.port.id };

  if (!(COMPATIBLE[from.port.dataType] || []).includes(to.port.dataType)) {
    return fail(`A ${typeName(from.port)} output cannot feed a ${typeName(to.port)} input.`);
  }

  if (graph.edges.some((e) => sameRef(e.source, source) && sameRef(e.target, target))) {
    return fail('These ports are already connected.');
  }

  const max = to.port.maxConnections;
  if (max && graph.edges.filter((e) => sameRef(e.target, target)).length >= max) {
    return fail(`"${to.port.name}" accepts only ${max} connection${max === 1 ? '' : 's'}.`);
  }

  if (canReach(graph, to.node.id, from.node.id)) {
    return fail('That connection would create a loop.');
  }

  return { ok: true, source, target };
}

export function canReach(graph, startId, goalId) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (id === goalId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) {
      if (edge.source.nodeId === id) stack.push(edge.target.nodeId);
    }
  }
  return false;
}

export function canAddPort(node, port) {
  const category = NODE_TYPES[node.type]?.category;
  const name = (port.name || '').trim();

  if (!name) return fail('Give the port a name.');
  if (name.length > 24) return fail('Port names can be at most 24 characters.');
  if (port.direction !== 'in' && port.direction !== 'out') return fail('Port direction must be input or output.');
  if (!PORT_TYPES[port.dataType]) return fail(`Unknown port type "${port.dataType}".`);

  if (port.direction === 'in' && category === 'trigger') {
    return fail('Trigger nodes start a workflow, so they cannot have inputs.');
  }
  if (port.dataType === 'trigger' && port.direction === 'in') {
    return fail('Trigger ports can only be outputs.');
  }
  if (port.dataType === 'trigger' && category !== 'trigger') {
    return fail('Only trigger nodes can have trigger outputs.');
  }

  const max = port.maxConnections;
  if (max !== null && max !== undefined && !(Number.isInteger(max) && max > 0)) {
    return fail('Max connections must be a positive whole number.');
  }

  const clash = node.ports.some(
    (p) => p.id !== port.id && p.direction === port.direction && p.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return fail(`This node already has an ${port.direction === 'in' ? 'input' : 'output'} called "${name}".`);

  return { ok: true };
}
