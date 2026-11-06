import test from 'node:test';
import assert from 'node:assert/strict';
import { airPath, clearance, wayOut } from './air.mjs';

// Two towers 60 m apart with a taller one between: A (x 0–20, 120 m), B (x 80–100, 160 m), C between (x 40–60, 140 m).
const A = { x0: 0, z0: 0, x1: 20, z1: 20, top: 120 }, B = { x0: 80, z0: 0, x1: 100, z1: 20, top: 160 }, C = { x0: 40, z0: 0, x1: 60, z1: 20, top: 140 };
const lots = [A, B, C];
// Is a point inside a lot's plan below its roof (inside the building), the ends' own lots aside?
const clips = (points, skip) => points.some(p => lots.some((lot, n) => !skip.includes(n) && p[0] > lot.x0 && p[0] < lot.x1 && p[2] > lot.z0 && p[2] < lot.z1 && p[1] < lot.top));
// The segments too, sampled every metre.
const segmentsClip = (points, skip) => points.slice(1).some((q, n) => { const p = points[n], k = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])); return clips(Array.from({ length: k + 1 }, (_, s) => [p[0] + (q[0] - p[0]) * s / k, p[1] + (q[1] - p[1]) * s / k, p[2] + (q[2] - p[2]) * s / k]), skip); });

test('clearance: the highest roof under a line; the ends\' own buildings left out', () => {
  assert.equal(clearance([10, 0, 10], [90, 0, 10], lots), 160);
  assert.equal(clearance([10, 0, 10], [90, 0, 10], lots, new Set([0, 1])), 140);
  assert.equal(clearance([10, 0, 40], [90, 0, 40], lots), 0, 'open ground beside them');
});

test('out through a window: where the line toward the other end leaves the plan, at the same height; from a roof, straight', () => {
  assert.deepEqual(wayOut([10, 114, 10], A, [90, 156, 10]), [21, 114, 10]);
  assert.deepEqual(wayOut([10, 120, 10], A, [90, 156, 10]), [10, 120, 10], 'on the roof already');
});

test('a leap from a 38th floor to another tower\'s 52nd (scenes 162, 168): out of a window, over the tower between, in at the far floor; nothing passes through a building', () => {
  const a = [10, 114, 10], b = [90, 156, 10], points = airPath(a, b, { lots, from: 0, to: 1, kind: 'leap' });
  assert.deepEqual(points[0], a); assert.deepEqual(points.at(-1), b);
  assert.ok(!segmentsClip(points, [0, 1]), 'over the tower between');
  assert.ok(Math.max(...points.map(p => p[1])) >= 140 + 10, 'its top 10 m over the roof between');
  assert.ok(points.slice(1, -1).every((p, n) => n === 0 || Math.hypot(p[0] - points[n][0], p[2] - points[n][2]) <= 8.5), 'an arc in short steps');
});

test('a flight from the street to a roof: up to a height over every roof on its line, across, straight down onto the roof', () => {
  const a = [-40, 0, 10], b = [90, 160, 10], points = airPath(a, b, { lots, from: -1, to: 1, kind: 'flight' });
  assert.ok(!segmentsClip(points, []), 'through no building');
  assert.equal(points[1][1], 170, 'cruising at the far roof plus 10 m');
  assert.deepEqual(points.at(-1), b);
  assert.equal(points.length, 4, 'up, across, down');
});

test('a climb up a wall: across to the wall\'s foot, up it, onto the roof', () => {
  const a = [-40, 0, 10], b = [10, 120, 10], points = airPath(a, b, { lots, from: -1, to: 0, kind: 'climb' });
  assert.deepEqual(points, [a, [-1, 0, 10], [-1, 120, 10], b]);
  assert.ok(!segmentsClip(points, [0]));
});
