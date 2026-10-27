import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse } from './universe-time-place.mjs';
import { timePlaceProjection } from './time-place.mjs';

const time = (id, label, storyIndex) => ({ id, kind: 'TimePoint', names: [{ text: label, kind: 'canonical' }], properties: { storyIndex, narrativeIndex: storyIndex, gloss: label, role: 'ADVANCE' }, confidence: 0.9 });
const place = (id, label, properties = {}) => ({ id, kind: 'Location', names: [{ text: label, kind: 'canonical' }], properties, confidence: 1 });
const person = (id, label) => ({ id, kind: 'Character', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const scene = (id, block, extra = {}) => ({ id, chapterIndex: 0, sentenceIds: [`b${String(block).padStart(4, '0')}_s0000`], charactersPresent: [], locationId: null, ...extra });
const rel = (type, fromId, toId) => ({ type, fromId, toId, properties: {}, confidence: 0.8 });
const book = (volume, sourceId, readingOrder, continuityId, entities, scenes, relations) => ({ volume, sourceId, title: `Book ${volume}`, readingOrder, continuityId, data: { entities, projection: timePlaceProjection({ entities, scenes, relations }) } });

// Invented: Star City across two books; book 2 does not say where District East is.
test('a universe merges its books: universe places, per-continuity story order, a parent carried across volumes', () => {
  const one = book(1, 'doc_a', 1, 'main', [time('t1', '黄昏', 0), time('t2', '夜', 1), place('city', '星城'), place('east', '东区'), person('ming', '小明')], [scene('s1', 1, { charactersPresent: ['ming'] }), scene('s2', 2)], [rel('OCCURS_DURING', 's1', 't1'), rel('OCCURS_DURING', 's2', 't2'), rel('PART_OF', 'east', 'city'), rel('LOCATED_AT', 's1', 'east'), rel('LOCATED_AT', 's2', 'city')]);
  const two = book(2, 'doc_b', 2, 'main', [time('t1', '清晨', 0), place('east', '东区'), person('m2', '小明')], [scene('s1', 1, { charactersPresent: ['m2'] })], [rel('OCCURS_DURING', 's1', 't1'), rel('LOCATED_AT', 's1', 'east')]);
  const side = book(3, 'doc_c', 1, 'alt', [time('t1', '雨天', 0), place('city', '星城')], [scene('s1', 1)], [rel('OCCURS_DURING', 's1', 't1'), rel('LOCATED_AT', 's1', 'city')]);
  const atlas = { universeId: 'star', title: '星城宇宙', places: [
    { id: 'doc_a::city', members: ['doc_a::city', 'doc_c::city'], parent: null },
    { id: 'doc_a::east', members: ['doc_a::east', 'doc_b::east'], parent: 'doc_a::city' },
  ] };
  const merged = mergeUniverse({ atlas, books: [two, side, one], continuities: [{ id: 'main', title: 'Main' }, { id: 'alt', title: 'Alt' }] });
  assert.equal(merged.scope, 'universe');
  assert.deepEqual(merged.books.map((entry) => entry.volume), [1, 3, 2], 'reading order');
  const east = merged.places.find((entry) => entry.id === 'u:doc_a::east');
  assert.deepEqual(east.sceneIds.sort(), ['1:s1', '2:s1'], 'one universe place across both books');
  assert.deepEqual([east.parentId, east.path], ['u:doc_a::city', ['u:doc_a::city', 'u:doc_a::east']], 'book 2 inherits the parent stated in book 1');
  assert.deepEqual(merged.places.find((entry) => entry.id === 'u:doc_a::city').books.sort(), [1, 3], 'the city appears in both continuities');
  const main = merged.times.filter((entry) => entry.continuityId === 'main').map((entry) => [entry.id, entry.storyIndex]);
  assert.deepEqual(main, [['1:t1', 0], ['1:t2', 1], ['2:t1', 2]], 'book 2 continues after book 1 in its continuity');
  assert.deepEqual(merged.times.filter((entry) => entry.continuityId === 'alt').map((entry) => entry.storyIndex), [0], 'another continuity keeps its own clock');
  assert.deepEqual(merged.scenes.find((entry) => entry.id === '2:s1').characterIds, ['c:小明'], 'same-named characters group for display');
  assert.equal(merged.characters.find((entry) => entry.id === 'c:小明').scenes, 2);
});
