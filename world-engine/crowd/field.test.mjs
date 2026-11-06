import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdField, speedAt, FREE, JAM, RING } from './field.mjs';

// Open ground 60 m square on the 2 m walk grid, each node joined to its four neighbours.
const grid = (side = 30) => {
  const nodes = [], neighbours = new Map(), id = (i, j) => i * side + j;
  for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) { nodes.push({ id: id(i, j), x: i * 2, z: j * 2 }); neighbours.set(id(i, j), [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b]).filter(([a, b]) => a >= 0 && b >= 0 && a < side && b < side).map(([a, b]) => id(a, b))); }
  return { nodes, neighbours };
};
const meanDistance = (field, nodes, x, z) => { const at = new Map(nodes.map(node => [node.id, node])), live = field.samples.filter(s => !s.gone); return live.reduce((sum, s) => sum + Math.hypot(at.get(s.node).x - x, at.get(s.node).z - z), 0) / (live.length || 1); };

test('speed falls with density: free when empty, none at a crush (Weidmann)', () => {
  assert.equal(speedAt(0), FREE);
  assert.ok(speedAt(1) < FREE && speedAt(1) > speedAt(3));
  assert.equal(speedAt(JAM), 0);
});

test('alarm: a hazard drives the crowd away from it, people near it first', () => {
  const { nodes, neighbours } = grid(), field = crowdField({ nodes, neighbours, size: 'some', state: 'milling', seed: 't' });
  const before = meanDistance(field, nodes, 30, 30);
  field.hazard(30, 30);
  for (let k = 0; k < 6; k++) field.step(5);
  assert.ok(meanDistance(field, nodes, 30, 30) > before + 5, `fled: ${before.toFixed(1)} → ${meanDistance(field, nodes, 30, 30).toFixed(1)} m`);
});

test('gathering holds round a focus at about the ring; gone empties the field', () => {
  const { nodes, neighbours } = grid(), field = crowdField({ nodes, neighbours, size: 'some', state: 'gathering', seed: 'g' });
  field.set('gathering', { x: 30, z: 30 });
  for (let k = 0; k < 12; k++) field.step(5);
  assert.ok(meanDistance(field, nodes, 30, 30) < field.ring + 8, `round the focus: ${meanDistance(field, nodes, 30, 30).toFixed(1)} m`);
  field.set('gone');
  for (let k = 0; k < 20; k++) field.step(5);
  assert.ok(field.summary().samples < field.samples.length / 2, 'most have left');
});

test('crowd drag (L20): someone in a packed crowd keeps less of their speed than in a few', () => {
  const { nodes, neighbours } = grid(10), packed = crowdField({ nodes, neighbours, size: 'packed', seed: 'p' }), few = crowdField({ nodes, neighbours, size: 'few', seed: 'p' });
  assert.ok(packed.dragAt(9, 9) < few.dragAt(9, 9), `${packed.dragAt(9, 9).toFixed(2)} < ${few.dragAt(9, 9).toFixed(2)}`);
});

test('alarmed by the text before any hazard: the crowd scatters toward the ways out', () => {
  const { nodes, neighbours } = grid(), field = crowdField({ nodes, neighbours, size: 'some', state: 'alarmed', seed: 'a' });
  const before = meanDistance(field, nodes, 29, 29);
  for (let k = 0; k < 6; k++) field.step(5);
  assert.ok(meanDistance(field, nodes, 29, 29) > before, 'out from the middle');
});
