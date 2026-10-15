import { findPort } from './graph.js';

export const NODE_WIDTH = 200;
export const HEADER_HEIGHT = 32;
export const PORT_ROW = 24;
export const PORT_TOP = 8;
export const NODE_BOTTOM = 10;
export const STUB = 24;
export const CORNER_RADIUS = 10;

export function nodeHeight(node) {
  const inputs = node.ports.filter((p) => p.direction === 'in').length;
  const outputs = node.ports.length - inputs;
  return HEADER_HEIGHT + PORT_TOP + Math.max(1, inputs, outputs) * PORT_ROW + NODE_BOTTOM;
}

export function nodeBox(node) {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + NODE_WIDTH,
    bottom: node.position.y + nodeHeight(node),
  };
}

export function portOffset(node, port) {
  const sameSide = node.ports.filter((p) => p.direction === port.direction);
  const index = sameSide.indexOf(port);
  return {
    x: port.direction === 'in' ? 0 : NODE_WIDTH,
    y: HEADER_HEIGHT + PORT_TOP + index * PORT_ROW + PORT_ROW / 2,
  };
}

export function portPosition(node, port) {
  const offset = portOffset(node, port);
  return { x: node.position.x + offset.x, y: node.position.y + offset.y };
}

const fmt = (n) => Math.round(n * 10) / 10;

export function bezierPath(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const pull = dx >= 0
    ? Math.max(40, dx / 2)
    : Math.min(220, Math.max(80, Math.abs(dx) / 3 + Math.abs(dy) / 3));
  return `M ${fmt(p1.x)} ${fmt(p1.y)} C ${fmt(p1.x + pull)} ${fmt(p1.y)}, ${fmt(p2.x - pull)} ${fmt(p2.y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
}

export function orthogonalPoints(p1, p2, sourceBox = null, targetBox = null) {
  const exitX = p1.x + STUB;
  const entryX = p2.x - STUB;

  if (entryX >= exitX) {
    const midX = (exitX + entryX) / 2;
    return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
  }

  let rightX = exitX;
  let leftX = entryX;
  let laneY = (p1.y + p2.y) / 2;

  if (sourceBox && targetBox) {
    rightX = Math.max(sourceBox.right, targetBox.right) + STUB;
    leftX = Math.min(sourceBox.left, targetBox.left) - STUB;
    if (targetBox.top - sourceBox.bottom >= STUB) {
      laneY = (sourceBox.bottom + targetBox.top) / 2;
    } else if (sourceBox.top - targetBox.bottom >= STUB) {
      laneY = (targetBox.bottom + sourceBox.top) / 2;
    } else {
      laneY = Math.max(sourceBox.bottom, targetBox.bottom) + STUB;
    }
  }

  return [
    p1,
    { x: rightX, y: p1.y },
    { x: rightX, y: laneY },
    { x: leftX, y: laneY },
    { x: leftX, y: p2.y },
    p2,
  ];
}

export function simplifyPoints(points) {
  const unique = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true;
    const a = unique[i - 1];
    const b = unique[i + 1];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

export function roundedPath(points, radius = CORNER_RADIUS) {
  const pts = simplifyPoints(points);
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;

  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1];
    const corner = pts[i];
    const next = pts[i + 1];
    const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);

    const before = {
      x: corner.x - ((corner.x - prev.x) / lenIn) * r,
      y: corner.y - ((corner.y - prev.y) / lenIn) * r,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / lenOut) * r,
      y: corner.y + ((next.y - corner.y) / lenOut) * r,
    };
    d += ` L ${fmt(before.x)} ${fmt(before.y)} Q ${fmt(corner.x)} ${fmt(corner.y)} ${fmt(after.x)} ${fmt(after.y)}`;
  }

  const last = pts[pts.length - 1];
  return `${d} L ${fmt(last.x)} ${fmt(last.y)}`;
}

export function wirePath(p1, p2, routing, sourceBox = null, targetBox = null) {
  return routing === 'orthogonal'
    ? roundedPath(orthogonalPoints(p1, p2, sourceBox, targetBox))
    : bezierPath(p1, p2);
}

export function edgePath(graph, edge, routing = graph.routing) {
  const source = findPort(graph, edge.source);
  const target = findPort(graph, edge.target);
  if (!source || !target) return null;
  return wirePath(
    portPosition(source.node, source.port),
    portPosition(target.node, target.port),
    routing,
    nodeBox(source.node),
    nodeBox(target.node),
  );
}

export function graphBounds(graph) {
  if (!graph.nodes.length) return null;
  const boxes = graph.nodes.map(nodeBox);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}
