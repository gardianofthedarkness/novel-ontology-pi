import test from 'node:test';
import assert from 'node:assert/strict';
import { beyondReach, relax } from './float.mjs';

const place = (x, z, mass, movable = true, parent = 'd', r = 10) => ({ at: [x, z], mass, movable, parent, r });

test('a track beyond reach pulls its two places together; the lighter one gives most; the energy falls', () => {
  const places = new Map([['a', place(0, 0, 30)], ['b', place(1000, 0, 1)]]);
  const tracks = [{ a: 'a', b: 'b', reach: 200 }];
  const out = relax({ places, tracks });
  assert.ok(out.after.energy < out.before.energy);
  const a = out.at.get('a'), b = out.at.get('b');
  assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 1000);
  assert.ok(Math.abs(b[0] - 1000) > Math.abs(a[0]) * 5, 'the light place moved much more than the heavy one');
  assert.ok(beyondReach(out.at, tracks).metres < beyondReach(new Map([['a', [0, 0]], ['b', [1000, 0]]]), tracks).metres);
});

test('a place that is not movable stays; a setting pull moves a light place toward the ground it asks for', () => {
  const places = new Map([['district', place(0, 0, 1, false)], ['street', place(0, 0, 1, true, 'district')]]);
  const out = relax({ places, tracks: [], pulls: [{ place: 'street', to: [100, 0] }] });
  assert.deepEqual(out.at.get('district'), [0, 0]);
  assert.ok(out.at.get('street')[0] > 20 && out.at.get('street')[0] < 100);
});

test('siblings are kept clear of each other', () => {
  const places = new Map([['a', place(0, 0, 1, true, 'p', 10)], ['b', place(50, 0, 30, false, 'p', 10)]]);
  const out = relax({ places, tracks: [], pulls: [{ place: 'a', to: [50, 0] }], weights: { track: 1, setting: 50 } });
  const a = out.at.get('a');
  assert.ok(Math.hypot(a[0] - 50, a[1]) >= 24 - 1e-6);
});

test('a track is measured where its people stand (the place plus its offset), and the move carries them', () => {
  const places = new Map([['a', place(0, 0, 30, false)], ['b', place(100, 0, 1)]]);
  const far = [{ a: 'a', b: 'b', reach: 200, offB: [800, 0] }];
  assert.equal(beyondReach(new Map([['a', [0, 0]], ['b', [100, 0]]]), far).count, 1, 'the spot is near, but its people stand 900 m off');
  const out = relax({ places, tracks: far });
  assert.ok(out.at.get('b')[0] < 100, 'pulled back toward a, though its spot already stood within reach');
});
