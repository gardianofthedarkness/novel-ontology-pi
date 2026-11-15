import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemTimeline, itemsOnPage, keepItem } from './items.mjs';

const scenes = [
  { id: 's1', events: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
  { id: 's2', events: [{ id: 'd1' }, { id: 'd2' }] },
];
const ev = (scene, card, event, who = null, to = null) => ({ scene, card, event, who, to });

test('the strict rule: acted on twice, or in two scenes', () => {
  assert.equal(keepItem({ events: [ev('s1', 'c1', 'appears', 'a')] }), false);
  assert.equal(keepItem({ events: [ev('s1', 'c1', 'used', 'a')] }), false);
  assert.equal(keepItem({ events: [ev('s1', 'c1', 'used', 'a'), ev('s1', 'c2', 'thrown', 'a')] }), true);
  assert.equal(keepItem({ events: [ev('s1', 'c1', 'held', 'a'), ev('s2', null, 'held', 'a')] }), true);
});

test('held with its holder until put down, then lying there until the scene ends', () => {
  const placed = [{ scene: 's1', event: 0, x: 1, y: 1, z: 1, place: 'p' }, { scene: 's1', event: 2, x: 5, y: 0, z: 5, place: 'p' }];
  const line = itemTimeline({ events: [ev('s1', 'c1', 'picked-up', 'a'), ev('s1', 'c3', 'put-down', 'a')] }, scenes, placed);
  assert.deepEqual(line.holds, [{ who: 'a', scene: 's1', from: 0, to: 2 }]);
  assert.deepEqual(line.loose, [{ scene: 's1', from: 2, to: null, place: 'p', x: 5, y: 0, z: 5 }]);
});

test('given to another: the hold passes; a new scene ends the hold unless it starts held again', () => {
  const line = itemTimeline({ events: [ev('s1', 'c1', 'held', 'a'), ev('s1', 'c2', 'given', 'a', 'b'), ev('s2', null, 'held', 'b'), ev('s2', 'd2', 'used', 'b')] }, scenes);
  assert.deepEqual(line.holds, [{ who: 'a', scene: 's1', from: 0, to: 1 }, { who: 'b', scene: 's1', from: 1, to: null }, { who: 'b', scene: 's2', from: 0, to: null }]);
  assert.deepEqual(line.loose, []);
});

test('nothing lies on from one scene into the next', () => {
  const placed = [{ scene: 's1', event: 1, x: 2, y: 0, z: 2, place: 'p' }];
  const line = itemTimeline({ events: [ev('s1', 'c2', 'thrown', 'a'), ev('s2', 'd1', 'broken')] }, scenes, placed);
  assert.equal(line.loose.length, 1);
  assert.equal(line.loose[0].to, null);
  assert.equal(line.loose[0].scene, 's1');
  assert.deepEqual(line.broken, { scene: 's2', event: 0 });
});

test('the page: an item not kept is left off; things that are not items stay as they were', () => {
  const things = [{ id: 'thing_1', placed: [{ scene: 's1', event: 0 }] }, { id: 'item:x', placed: [] }, { id: 'item:y', placed: [] }];
  const items = [{ id: 'item:x', events: [ev('s1', 'c1', 'appears', 'a')] }, { id: 'item:y', events: [ev('s1', 'c1', 'used', 'a'), ev('s1', 'c2', 'used', 'a')] }];
  const { things: out, counts } = itemsOnPage(things, items, scenes);
  assert.deepEqual(out.map(thing => thing.id), ['thing_1', 'item:y']);
  assert.deepEqual(out[1].holds, [{ who: 'a', scene: 's1', from: 0, to: null }]);
  assert.deepEqual(counts, { items: 2, kept: 1, holds: 1, loose: 0 });
});

test('a kept item with a model takes it and its size; one without keeps its shape', async () => {
  const { bindItemModels } = await import('./items.mjs');
  const things = [{ id: 'item:x', name: 'x', holds: [], placed: [{ scene: 's1', from: 0, to: null, fit: { sx: 1 } }], size: 0.5 }, { id: 'item:y', name: 'y', holds: [], placed: [] }, { id: 'thing_1', name: 'x', placed: [] }];
  const mesh = { p: [0, 0, 0], t: [0, 0, 0], c: [1, 1, 1], size: [0.3, 0.4, 0.2] };
  const { things: out, scadModels } = bindItemModels(things, new Map([['x', { id: 'routine_bucket', mesh }]]));
  assert.equal(out[0].model, 'scad:routine_bucket'); assert.deepEqual([out[0].size, out[0].height, out[0].depth], [0.3, 0.4, 0.2]);
  assert.equal(out[0].placed[0].fit.sx, 0.3);
  assert.equal(out[1].model, undefined); assert.equal(out[2].model, undefined);
  assert.deepEqual(Object.keys(scadModels), ['routine_bucket']);
});

test('an item the sort found is not an object is left off the page', async () => {
  const { bindItemModels } = await import('./items.mjs');
  const things = [{ id: 'item:a', name: 'a', holds: [], placed: [] }, { id: 'item:b', name: 'b', holds: [], placed: [] }];
  const { things: out } = bindItemModels(things, new Map([['a', { hide: true }]]));
  assert.deepEqual(out.map(thing => thing.id), ['item:b']);
});
