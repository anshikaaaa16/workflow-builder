import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../js/catalog.js';
import {
  NODE_WIDTH,
  bezierPath,
  nodeBox,
  orthogonalPoints,
  portPosition,
  roundedPath,
  simplifyPoints,
} from '../js/geometry.js';

const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

test('ports sit on the left (inputs) and right (outputs) edges of a node', () => {
  const node = createNode('http', { x: 100, y: 50 });
  const run = portPosition(node, node.ports[0]);
  const done = portPosition(node, node.ports[2]);
  assert.equal(run.x, 100);
  assert.equal(done.x, 100 + NODE_WIDTH);
  assert.equal(run.y, done.y);
  assert.ok(portPosition(node, node.ports[1]).y > run.y);
});

test('bezier path starts at the output and ends at the input', () => {
  const d = bezierPath({ x: 0, y: 0 }, { x: 200, y: 100 });
  const n = numbers(d);
  assert.deepEqual(n.slice(0, 2), [0, 0]);
  assert.deepEqual(n.slice(-2), [200, 100]);
  assert.ok(n[2] > 0, 'first handle pulls to the right of the output');
  assert.ok(n[4] < 200, 'second handle pulls to the left of the input');
});

test('bezier handles stretch further for backward wires', () => {
  const forward = numbers(bezierPath({ x: 0, y: 0 }, { x: 60, y: 0 }));
  const backward = numbers(bezierPath({ x: 300, y: 0 }, { x: 0, y: 200 }));
  assert.ok(forward[2] - 0 >= 40);
  assert.ok(backward[2] - 300 >= 80);
});

function assertAxisAligned(points) {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    assert.ok(a.x === b.x || a.y === b.y, `segment ${i} is diagonal`);
  }
}

test('orthogonal forward route uses only horizontal and vertical segments', () => {
  const p1 = { x: 0, y: 0 };
  const p2 = { x: 300, y: 120 };
  const points = orthogonalPoints(p1, p2);
  assertAxisAligned(points);
  assert.deepEqual(points[0], p1);
  assert.deepEqual(points.at(-1), p2);
});

test('orthogonal backward route goes around both nodes', () => {
  const source = createNode('delay', { x: 400, y: 0 });
  const target = createNode('delay', { x: 0, y: 200 });
  const p1 = portPosition(source, source.ports[1]);
  const p2 = portPosition(target, target.ports[0]);
  const sBox = nodeBox(source);
  const tBox = nodeBox(target);
  const points = orthogonalPoints(p1, p2, sBox, tBox);

  assertAxisAligned(points);
  const lane = points[2].y;
  assert.ok(lane > sBox.bottom && lane < tBox.top, 'horizontal lane runs through the gap between nodes');
  assert.ok(points[1].x > Math.max(sBox.right, tBox.right), 'right detour clears both nodes');
  assert.ok(points[3].x < Math.min(sBox.left, tBox.left), 'left detour clears both nodes');
});

test('orthogonal backward route goes underneath when nodes overlap vertically', () => {
  const source = createNode('delay', { x: 400, y: 0 });
  const target = createNode('delay', { x: 0, y: 20 });
  const sBox = nodeBox(source);
  const tBox = nodeBox(target);
  const points = orthogonalPoints(
    portPosition(source, source.ports[1]),
    portPosition(target, target.ports[0]),
    sBox,
    tBox,
  );
  assert.ok(points[2].y > Math.max(sBox.bottom, tBox.bottom));
});

test('simplifyPoints drops duplicates and straight-line midpoints', () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  assert.deepEqual(simplifyPoints(points), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
});

test('roundedPath curves each corner and draws straight lines straight', () => {
  const straight = roundedPath([{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 100, y: 10 }]);
  assert.equal(straight, 'M 0 10 L 100 10');

  const elbow = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(elbow, 'M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
});

test('corner radius shrinks on short segments', () => {
  const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 40, y: 6 }]);
  assert.match(d, /L 7 0 Q 10 0 10 3/);
});
