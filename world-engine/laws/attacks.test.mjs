import test from 'node:test';
import assert from 'node:assert/strict';
import { attackCheck, limitsOf, lineBlocked } from './attacks.mjs';

test('the limits of a blow: the attacker\'s own ability, else a weapon held, else a person\'s; no explosion without one', () => {
  assert.deepEqual(limitsOf('line', { own: { line: { range: 400, sure: 1 } } }), { range: 400, sure: 1, by: 'ability' });
  assert.deepEqual(limitsOf('line', { weapons: [{ label: 'gun', attack: { kind: 'line', range: 100, sure: 0.9 } }] }), { range: 100, by: 'weapon', weapon: 'gun' });
  assert.deepEqual(limitsOf('close', {}), { reach: 3, by: 'person' });
  assert.equal(limitsOf('area', {}), null);
});

test('a line stops at a building standing across it; one past it is not stopped by the buildings it starts or ends in', () => {
  const lots = [{ i0: 10, j0: -5, nx: 5, nz: 10, floors: 10 }, { i0: 40, j0: -5, nx: 5, nz: 10, floors: 10 }];
  assert.ok(lineBlocked([0, 0, 0], [60, 0, 0], lots), 'a ten-floor building between');
  assert.equal(lineBlocked([0, 0, 0], [15, 0, 0], lots), null, 'a line into the building is not blocked by it');
  assert.equal(lineBlocked([0, 0, 20], [60, 0, 20], lots), null, 'a line beside it');
});

test('L21: close within reach, a line within range and clear, an explosion within its range and radius', () => {
  assert.equal(attackCheck({ kind: 'close', from: [0, 0, 0], to: [1.5, 0, 0], limits: { reach: 2 } }).verdict, 'ok');
  assert.equal(attackCheck({ kind: 'close', from: [0, 0, 0], to: [8, 0, 0], limits: { reach: 2 } }).verdict, 'held');
  assert.equal(attackCheck({ kind: 'line', from: [0, 0, 0], to: [200, 0, 0], limits: { range: 100 } }).verdict, 'held');
  assert.equal(attackCheck({ kind: 'line', from: [0, 0, 0], to: [60, 0, 0], limits: { range: 100 }, lots: [{ i0: 10, j0: -5, nx: 5, nz: 10, floors: 10 }] }).verdict, 'held');
  assert.equal(attackCheck({ kind: 'area', from: [0, 0, 0], to: [105, 0, 0], limits: { range: 100, radius: 10 } }).verdict, 'ok');
  assert.equal(attackCheck({ kind: 'area', from: [0, 0, 0], to: [5, 0, 0], limits: null }).verdict, 'held');
  assert.equal(attackCheck({ kind: 'close', from: null, to: [1, 0, 0], limits: { reach: 2 } }), null);
});
