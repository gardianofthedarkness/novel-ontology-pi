import test from 'node:test';
import assert from 'node:assert/strict';
import { acrossLayers, meansOf } from './layers.mjs';

// A street (nodes 1–3, y 0) and a deep floor (nodes 11–13, y −90): a real lift from 12 up to 2, a virtual one from 13 up to 3.
const POS = { 1: [0, 0, 0], 2: [40, 0, 0], 3: [80, 0, 0], 11: [0, -90, 0], 12: [40, -90, 0], 13: [80, -90, 0] };
const at = id => POS[id];
const layerOf = id => (POS[id][1] <= -20 ? 'deep' : 'near');
// A leg inside one layer: straight along it, or null where `cut` says that layer has no way.
const legs = (cut = new Set()) => {
  const calls = [];
  const walkIn = (from, targets, layer) => { calls.push([from, targets[0], layer]); assert.ok([from, ...targets].every(id => layerOf(id) === layer), 'a leg never leaves its band'); return cut.has(`${from}>${targets[0]}`) ? null : [from, targets[0]]; };
  return { walkIn, calls };
};
const lift = { foot: 12, top: 2, up: 24, down: 24, virtual: false }, virtual = { foot: 13, top: 3, up: (90 / 5 + 20) * 1.4, down: (90 / 5 + 20) * 1.4, virtual: true };

test('down to a hall more than 20 m under: walk to the nearest lift, ride it, walk on; each leg inside its own band', () => {
  const { walkIn, calls } = legs();
  const { path, portal } = acrossLayers({ from: 1, targets: [11], mine: 'near', portals: [virtual, lift], walkIn, at });
  assert.deepEqual(path, [1, 2, 12, 11]);
  assert.deepEqual(portal, { by: 'lift', down: true, at: { x: 40, z: 0 }, depth: 90 });
  assert.deepEqual(calls, [[1, 2, 'near'], [12, 11, 'deep']]);
});

test("the text's own lift is taken before a virtual one where both are as near; a virtual one when it is much nearer", () => {
  const near = acrossLayers({ from: 13, targets: [3], mine: 'deep', portals: [lift, { ...virtual }], walkIn: legs().walkIn, at });
  assert.equal(near.portal.by, 'virtual lift', "standing at the virtual lift's foot, it goes straight up");
  assert.deepEqual(near.path, [13, 3]);
  const both = acrossLayers({ from: 12, targets: [2], mine: 'deep', portals: [{ ...virtual, foot: 12, top: 2 }, lift], walkIn: legs().walkIn, at });
  assert.equal(both.portal.by, 'lift', 'the same spot: the real lift costs less than the virtual ride');
});

test('a portal whose leg has no way is passed over for the next; with none left, the reason names the layer and the means', () => {
  const { walkIn } = legs(new Set(['1>2']));
  const next = acrossLayers({ from: 1, targets: [11], mine: 'near', portals: [lift, virtual], walkIn, at, how: 'run' });
  assert.equal(next.portal.by, 'virtual lift');
  const none = acrossLayers({ from: 1, targets: [11], mine: 'near', portals: [lift], walkIn, at, how: 'run' });
  assert.equal(none.path, null);
  assert.equal(none.why, 'no way on foot at street level and just under it to the lift 40 m off');
  const deepCut = acrossLayers({ from: 1, targets: [11], mine: 'near', portals: [lift], walkIn: legs(new Set(['12>11'])).walkIn, at, how: 'climb:6' });
  assert.equal(deepCut.why, 'no way climbing more than 20 m down from the lift to there');
  assert.match(acrossLayers({ from: 1, targets: [11], mine: 'near', portals: [], walkIn, at }).why, /no lift, shaft, stairs or ladder within 120 m/);
  assert.equal(meansOf('ride:4'), 'riding');
});
