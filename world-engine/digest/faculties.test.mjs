import test from 'node:test';
import assert from 'node:assert/strict';
import { firedSpans } from './faculties.mjs';

test('a faculty reads where the gate fires it: overlapping windows joined, sixty lines a request', () => {
  const scene = { id: 'u1', sentences: Array.from({ length: 130 }, (_, k) => `s${k}`) };
  const gate = { windows: [
    { scene: 'u1', first: 's0', last: 's11', fired: ['journeys'] }, { scene: 'u1', first: 's6', last: 's17', fired: ['journeys', 'conversation'] },
    { scene: 'u1', first: 's40', last: 's129', fired: ['journeys'] }, { scene: 'u2', first: 's0', last: 's5', fired: ['journeys'] },
  ] };
  assert.deepEqual(firedSpans(gate, scene, 'journeys').map(span => [span[0], span.at(-1), span.length]), [['s0', 's17', 18], ['s40', 's99', 60], ['s100', 's129', 30]]);
  assert.deepEqual(firedSpans(gate, scene, 'conversation').map(span => span.length), [12]);
  assert.deepEqual(firedSpans(gate, scene, 'choreography'), []);
});
