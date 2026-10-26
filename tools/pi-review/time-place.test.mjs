import test from 'node:test';
import assert from 'node:assert/strict';
import { timePlaceProjection } from './time-place.mjs';

const time = (id, label, storyIndex, narrativeIndex, extra = {}) => ({ id, kind: 'TimePoint', names: [{ text: label, kind: 'canonical' }], properties: { storyIndex, narrativeIndex, gloss: label, role: 'ADVANCE', ...extra }, confidence: 0.9 });
const place = (id, label) => ({ id, kind: 'Location', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const person = (id, label) => ({ id, kind: 'Character', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const scene = (id, block, chapterIndex, extra = {}) => ({ id, chapterIndex, sentenceIds: [`b${String(block).padStart(4, '0')}_s0000`], charactersPresent: [], locationId: null, ...extra });
const rel = (type, fromId, toId, properties = {}) => ({ type, fromId, toId, properties, confidence: 0.7 });

test('story time and places project in story order; unnamed places carry within a chapter only, flagged', () => {
  const entities = [time('t_eve', '平安夜', 1, 0, { date: { month: 12, day: 24, derived: false } }), time('t_past', '三年前', 0, 1, { flashback: true, toldFromId: 't_eve', flashbackProbability: 0.8 }), place('loc_7', '中央区'), person('c_1', '小明')];
  const scenes = [scene('s2', 2, 0, { charactersPresent: ['c_1'] }), scene('s1', 1, 0, { charactersPresent: ['c_1'] }), scene('s3', 3, 1)];
  const relations = [rel('OCCURS_DURING', 's1', 't_eve', { via: 'anchor' }), rel('OCCURS_DURING', 's2', 't_past', { via: 'anchor' }), rel('OCCURS_DURING', 's3', 't_eve'), rel('LOCATED_AT', 's1', 'loc_7')];
  const projection = timePlaceProjection({ entities, scenes, relations });
  assert.equal(projection.available, true);
  assert.deepEqual(projection.times.map((entry) => entry.id), ['t_past', 't_eve'], 'story order, flashback first');
  assert.deepEqual(projection.scenes.map((entry) => entry.id), ['s1', 's2', 's3'], 'reading order by source position');
  const [first, second, third] = projection.scenes;
  assert.deepEqual([first.placeIds, first.placeCarried], [['loc_7'], false]);
  assert.deepEqual([second.placeIds, second.placeCarried], [['loc_7'], true], 'carried, and says so');
  assert.deepEqual(third.placeIds, [], 'never across a chapter break');
  assert.equal(second.flashback, true);
  assert.equal(first.label, '小明', 'a scene without a summary or events is named by who is present');
  assert.equal(timePlaceProjection({ entities, scenes, relations, events: [{ id: 'e1', chronologicalOrder: 0, summaryEn: '小明醒来。', evidence: { sentenceIds: ['b0001_s0000'] } }] }).scenes[0].label, '小明醒来。', 'else by its first event');
  assert.deepEqual(projection.places[0], { id: 'loc_7', label: '中央区', sceneIds: ['s1', 's2'], statedScenes: 1, characterIds: ['c_1'], proposed: false });
  assert.equal(projection.names.c_1, '小明');
  assert.ok(!JSON.stringify(projection).includes('sentenceIds'), 'no source references leak');
});

test('books without time-place facts report unavailable', () => {
  assert.equal(timePlaceProjection({ entities: [], scenes: [scene('s1', 1, 0)], relations: [] }).available, false);
});

test('pending time-place proposals show as proposed periods and places, never as canon', () => {
  const scenes = [scene('s1', 1, 0), scene('s2', 2, 0)];
  const pending = [
    { kind: 'upsert_entity', payload: time('t_new', '早上', 0, 0) },
    { kind: 'upsert_entity', payload: place('loc_new', '车站') },
    { kind: 'add_relation', payload: rel('OCCURS_DURING', 's1', 't_new', { via: 'anchor' }) },
    { kind: 'add_relation', payload: rel('LOCATED_AT', 's1', 'loc_new') },
    { kind: 'add_relation', payload: rel('CAUSES', 's1', 's2') },
  ];
  const projection = timePlaceProjection({ entities: [], scenes, relations: [], pending });
  assert.equal(projection.available, true);
  assert.deepEqual(projection.times.map((entry) => [entry.id, entry.proposed]), [['t_new', true]]);
  assert.deepEqual(projection.places.map((entry) => [entry.id, entry.proposed]), [['loc_new', true]]);
  const confirmed = timePlaceProjection({ entities: [time('t_new', '早上', 0, 0)], scenes, relations: [rel('OCCURS_DURING', 's1', 't_new', { via: 'anchor' })], pending });
  assert.equal(confirmed.times[0].proposed, false, 'once applied, the stored fact wins');
});
