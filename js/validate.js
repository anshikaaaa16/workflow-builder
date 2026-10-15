import { NODE_TYPES } from './catalog.js';
import { portKey } from './graph.js';

const LEVEL_ORDER = { error: 0, warning: 1 };

function reachableFromTriggers(graph, triggers) {
  const seen = new Set();
  const stack = triggers.map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    graph.edges.forEach((edge) => {
      if (edge.source.nodeId === id) stack.push(edge.target.nodeId);
    });
  }
  return seen;
}

export function validateGraph(graph) {
  const issues = [];
  const add = (level, message, nodeId = null, portId = null) => issues.push({ level, message, nodeId, portId });

  if (!graph.nodes.length) return issues;

  const connected = new Set();
  graph.edges.forEach((edge) => {
    connected.add(portKey(edge.source));
    connected.add(portKey(edge.target));
  });
  const isConnected = (node, port) => connected.has(portKey({ nodeId: node.id, portId: port.id }));

  const triggers = graph.nodes.filter((n) => NODE_TYPES[n.type]?.category === 'trigger');
  if (!triggers.length) {
    add('error', 'There is no trigger. Add a Webhook or Schedule node so the workflow can start.');
  }
  const reachable = reachableFromTriggers(graph, triggers);

  const seenNames = new Map();

  graph.nodes.forEach((node) => {
    const def = NODE_TYPES[node.type];
    const name = `"${node.label}"`;
    const inputs = node.ports.filter((p) => p.direction === 'in');
    const outputs = node.ports.filter((p) => p.direction === 'out');

    const nameKey = node.label.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      add('warning', `Two nodes are called ${name}. Unique names make the workflow easier to follow.`, node.id);
    } else {
      seenNames.set(nameKey, node.id);
    }

    if (!node.ports.some((port) => isConnected(node, port))) {
      add('warning', `${name} is not connected to anything.`, node.id);
      return;
    }

    if (def.category === 'trigger') {
      const starter = outputs.find((p) => p.dataType === 'trigger');
      if (starter && !isConnected(node, starter)) {
        add('warning', `${name} does not start anything. Connect "${starter.name}" to a Run input.`, node.id, starter.id);
      }
      return;
    }

    if (!reachable.has(node.id)) {
      add('warning', `${name} cannot be reached from a trigger, so it will never run.`, node.id);
    }

    const flowInputs = inputs.filter((p) => p.dataType === 'flow');
    const connectedFlowInputs = flowInputs.filter((p) => isConnected(node, p));
    if (flowInputs.length && !connectedFlowInputs.length) {
      add('error', `${name} is never told to run. Connect its "${flowInputs[0].name}" input.`, node.id, flowInputs[0].id);
    }

    inputs
      .filter((p) => p.dataType === 'data' && !isConnected(node, p))
      .forEach((port) => add('error', `${name} needs data on its "${port.name}" input.`, node.id, port.id));

    if (node.type === 'merge' && connectedFlowInputs.length === 1) {
      add('warning', `${name} only has one branch connected, so there is nothing to merge.`, node.id);
    }

    if (node.type === 'condition') {
      const branches = outputs.filter((p) => p.dataType === 'flow');
      if (branches.length && !branches.some((p) => isConnected(node, p))) {
        add('warning', `${name} has no branches connected, so its result is never used.`, node.id);
      }
    }
  });

  return issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export function summarizeIssues(issues) {
  const errors = issues.filter((i) => i.level === 'error').length;
  return { errors, warnings: issues.length - errors };
}
