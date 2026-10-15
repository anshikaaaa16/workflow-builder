import { NODE_TYPES, PORT_TYPES } from './catalog.js';
import { canAddPort, canConnect } from './rules.js';
import { createEmptyGraph, findPort } from './graph.js';

export const SCHEMA_VERSION = 1;
const ROUTINGS = ['bezier', 'orthogonal'];
const MAX_ERRORS = 25;

export function exportGraph(graph) {
  return {
    version: SCHEMA_VERSION,
    meta: {
      name: graph.name,
      routing: graph.routing,
      exportedAt: new Date().toISOString(),
    },
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: node.position.x, y: node.position.y },
      ports: node.ports.map((port) => ({
        id: port.id,
        name: port.name,
        direction: port.direction,
        dataType: port.dataType,
        maxConnections: port.maxConnections ?? null,
      })),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: { nodeId: edge.source.nodeId, portId: edge.source.portId },
      target: { nodeId: edge.target.nodeId, portId: edge.target.portId },
    })),
  };
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isRef = (v) => isObject(v) && isText(v.nodeId) && isText(v.portId);

export function importGraph(input) {
  const errors = [];
  const result = () => ({ ok: errors.length === 0, graph: errors.length ? null : graph, errors: errors.slice(0, MAX_ERRORS) });

  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      errors.push(`Not valid JSON: ${err.message}`);
      return { ok: false, graph: null, errors };
    }
  }

  if (!isObject(data)) {
    errors.push('The workflow must be a JSON object.');
    return { ok: false, graph: null, errors };
  }
  if (data.version !== SCHEMA_VERSION) {
    errors.push(`Unsupported schema version "${data.version}". Expected ${SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(data.nodes)) errors.push('"nodes" must be an array.');
  if (!Array.isArray(data.edges)) errors.push('"edges" must be an array.');
  if (errors.length) return { ok: false, graph: null, errors };

  const meta = isObject(data.meta) ? data.meta : {};
  const graph = createEmptyGraph(isText(meta.name) ? meta.name.trim() : 'Imported workflow');
  if (meta.routing !== undefined && !ROUTINGS.includes(meta.routing)) {
    errors.push(`Unknown routing "${meta.routing}". Use "bezier" or "orthogonal".`);
  } else if (meta.routing) {
    graph.routing = meta.routing;
  }

  const nodeIds = new Set();
  data.nodes.forEach((raw, i) => {
    const where = `nodes[${i}]`;
    if (!isObject(raw)) return errors.push(`${where} must be an object.`);
    if (!isText(raw.id)) return errors.push(`${where} needs a text "id".`);
    if (nodeIds.has(raw.id)) return errors.push(`${where}: duplicate node id "${raw.id}".`);
    if (!NODE_TYPES[raw.type]) return errors.push(`${where}: unknown node type "${raw.type}".`);
    if (!isObject(raw.position) || !isNumber(raw.position.x) || !isNumber(raw.position.y)) {
      return errors.push(`${where}: "position" needs numeric x and y.`);
    }
    if (!Array.isArray(raw.ports)) return errors.push(`${where}: "ports" must be an array.`);

    nodeIds.add(raw.id);
    const node = {
      id: raw.id,
      type: raw.type,
      label: isText(raw.label) ? raw.label.trim() : NODE_TYPES[raw.type].label,
      position: { x: raw.position.x, y: raw.position.y },
      ports: [],
    };

    const portIds = new Set();
    raw.ports.forEach((rawPort, j) => {
      const portWhere = `${where}.ports[${j}]`;
      if (!isObject(rawPort) || !isText(rawPort.id)) return errors.push(`${portWhere} needs a text "id".`);
      if (portIds.has(rawPort.id)) return errors.push(`${portWhere}: duplicate port id "${rawPort.id}".`);
      if (!PORT_TYPES[rawPort.dataType]) return errors.push(`${portWhere}: unknown dataType "${rawPort.dataType}".`);
      const port = {
        id: rawPort.id,
        name: typeof rawPort.name === 'string' ? rawPort.name.trim() : '',
        direction: rawPort.direction,
        dataType: rawPort.dataType,
        maxConnections: rawPort.maxConnections ?? null,
      };
      const check = canAddPort(node, port);
      if (!check.ok) return errors.push(`${portWhere}: ${check.reason}`);
      portIds.add(port.id);
      node.ports.push(port);
    });

    graph.nodes.push(node);
  });

  const edgeIds = new Set();
  data.edges.forEach((raw, i) => {
    const where = `edges[${i}]`;
    if (!isObject(raw) || !isText(raw.id)) return errors.push(`${where} needs a text "id".`);
    if (edgeIds.has(raw.id)) return errors.push(`${where}: duplicate edge id "${raw.id}".`);
    if (!isRef(raw.source) || !isRef(raw.target)) {
      return errors.push(`${where}: "source" and "target" need nodeId and portId.`);
    }
    const missing = [raw.source, raw.target].find((r) => !findPort(graph, r));
    if (missing) {
      const nodeExists = graph.nodes.some((n) => n.id === missing.nodeId);
      return errors.push(nodeExists
        ? `${where}: node "${missing.nodeId}" has no port "${missing.portId}".`
        : `${where}: refers to node "${missing.nodeId}", which is missing or invalid.`);
    }
    const check = canConnect(graph, raw.source, raw.target);
    if (!check.ok) return errors.push(`${where} (${raw.source.nodeId} → ${raw.target.nodeId}): ${check.reason}`);
    if (check.source.portId !== raw.source.portId || check.source.nodeId !== raw.source.nodeId) {
      return errors.push(`${where}: "source" must be an output port and "target" an input port.`);
    }
    edgeIds.add(raw.id);
    graph.edges.push({ id: raw.id, source: check.source, target: check.target });
  });

  return result();
}
