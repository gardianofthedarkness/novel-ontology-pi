import test from 'node:test';
import assert from 'node:assert/strict';
import { alignCards, scenesAsSegments, segmentPresence, segmentWorld } from './segments.mjs';

const segments = [
  { scene: 's1', first: 'a1', last: 'a3', sentences: ['a1', 'a2', 'a3'], type: 'routine', distribution: { routine: 1 } },
  { scene: 's1', first: 'a4', last: 'a6', sentences: ['a4', 'a5', 'a6'], type: 'confrontation', distribution: { confrontation: 0.9, exposition: 0.1 } },
  { scene: 's1', first: 'a7', last: 'a8', sentences: ['a7', 'a8'], type: 'memory', distribution: { memory: 0.8, interior: 0.2 } },
];

test('a card across a segment boundary is split there, each piece with the people of its own lines', () => {
  const cards = [{ id: 'dialogue:a2', kind: 'dialogue', first: 'a2', sentences: ['a2', 'a3', 'a4'], people: [{ id: 'p', how: ['speaks'], at: ['a2'] }, { id: 'q', how: ['speaks'], at: ['a4'] }] }];
  const out = alignCards(cards, segments);
  assert.deepEqual(out.map(card => [card.id, card.sentences.join(','), card.people.map(person => person.id).join(',')]), [['dialogue:a2', 'a2,a3', 'p'], ['dialogue:a2#2', 'a4', 'q']]);
});

test('presence by physics: placed by evidence, held at the place until seen elsewhere or the time moves on; never by the script alone', () => {
  const at = (scene, ids, type = 'routine') => ({ scene, first: ids[0], last: ids.at(-1), sentences: ids, type, distribution: { [type]: 1 } });
  const segs = [at('s1', ['a1', 'a2']), at('s1', ['a3', 'a4']), at('s2', ['b1']), at('s3', ['c1', 'c2']), at('s3', ['c3'], 'memory'), at('s4', ['d1'])];
  const card = (id, who) => ({ id: `action:${id}`, kind: 'action', first: id, sentences: [id], people: [{ id: who, how: ['acts'], at: [id] }] });
  const cards = [card('a1', 'p'), card('a3', 'q'), card('b1', 'q'), card('c3', 'r')];
  const scenes = new Map([['s1', { place: 'bar', at: { node: 't1' }, present: ['p', 'q', 's'] }], ['s2', { place: 'street', at: { node: 't1' } }], ['s3', { place: 'bar', at: { node: 't1' } }], ['s4', { place: 'bar', at: { node: 't2' } }]]);
  const present = segmentPresence({ segments: segs, cards, scriptScenes: scenes }).map(entry => entry.present.sort().join(','));
  assert.deepEqual(present, ['p', 'p,q', 'q', 'p', 'p', '']);
  // s: in the script only, never placed; q: left the bar for the street; p: still at the bar when the story returns; r: a
  // memory's actor, the past; s4: a later period, nobody held.
});

test('held is not on stage: out of view after the hold unless named again, still held where they were', () => {
  const at = (scene, ids) => ({ scene, first: ids[0], last: ids.at(-1), sentences: ids, type: 'routine', distribution: { routine: 1 } });
  const lines = prefix => Array.from({ length: 10 }, (_, n) => `${prefix}${n}`);
  const segs = [at('s1', lines('a')), at('s1', lines('b')), at('s1', lines('c')), at('s1', lines('d')), at('s1', lines('e'))];
  const cards = [{ id: 'action:a0', kind: 'action', first: 'a0', sentences: ['a0'], people: [{ id: 'p', how: ['acts'], at: ['a0'] }, { id: 'q', how: ['acts'], at: ['a0'] }] },
    { id: 'narration:d5', kind: 'narration', first: 'd5', sentences: ['d5'], people: [{ id: 'q', how: ['named'], at: ['d5'] }] }];
  const out = segmentPresence({ segments: segs, cards, scriptScenes: new Map([['s1', { place: 'bar', at: { node: 't1' } }]]), hold: 25 });
  assert.deepEqual(out.map(entry => entry.present.sort().join(',')), ['p,q', 'p,q', 'p,q', 'q', 'q'], 'p out of view 30 lines on; q named at d5, in view again');
  assert.deepEqual(out.map(entry => entry.held.sort().join(',')), ['p,q', 'p,q', 'p,q', 'p,q', 'p,q'], 'both still held at the bar');
});

test('each scene a segment (a reading whose tiler cut segments): its own id, its kind from the blocks over its sentences, presence by physics', () => {
  const block = (sentences, distribution) => ({ first: sentences[0], last: sentences.at(-1), sentences, distribution, confidence: 0.8, type: Object.keys(distribution)[0] });
  const reading = {
    scenes: [{ id: 's1', sentences: ['a1', 'a2'] }, { id: 's2', sentences: ['a3', 'a4'] }, { id: 's3', sentences: ['b1'] }],
    blocks: [block(['a1', 'a2', 'a3'], { routine: 0.9, confrontation: 0.1 }), block(['a3', 'a4', 'b1'], { confrontation: 0.8, routine: 0.2 })],
    cards: [{ id: 'action:a1', kind: 'action', first: 'a1', sentences: ['a1'], people: [{ id: 'p', how: ['acts'], at: ['a1'] }] }],
    time: { scenes: [{ scene: 's1', node: 't:1' }, { scene: 's2', node: 't:1' }, { scene: 's3', node: 't:1' }] },
  };
  const segments = scenesAsSegments(reading);
  assert.deepEqual(segments.map(segment => segment.type), ['routine', 'confrontation', 'confrontation']);
  assert.equal(segments[0].distribution.routine, 0.9);
  const script = { places: {}, scenes: [{ id: 's1', place: 'bar', present: ['p'], at: { node: 't:1' }, timeline: [] }, { id: 's2', place: 'bar', present: [], at: { node: 't:1' }, timeline: [] }, { id: 's3', place: 'street', present: [], at: { node: 't:1' }, timeline: [] }] };
  const world = segmentWorld({ reading, script, spawn: { scenes: reading.scenes.map(scene => ({ id: scene.id, spawn: 'new', starts: scene.id === 's1' ? [{ who: 'p', scene: 's1' }] : [] })) } });
  assert.deepEqual(world.ids, ['s1', 's2', 's3'], 'no scene~part');
  assert.deepEqual(world.script.scenes.map(scene => scene.present), [['p'], ['p'], []], 'p held in the bar into the fight, not carried to the street');
  assert.deepEqual(world.spawn.scenes.map(scene => scene.spawn), ['new', 'new', 'new']);
  assert.equal(world.reading.segments.length, 3, 'the gate reads them as segments');
});

test('a unit the reading typed whole keeps its own kind over the blocks', () => {
  const reading = { scenes: [{ id: 's1', sentences: ['a1', 'a2'], type: 'confrontation', confidence: 0.8, distribution: { confrontation: 0.8, routine: 0.2 } }], blocks: [{ first: 'a1', last: 'a2', sentences: ['a1', 'a2'], distribution: { routine: 1 }, confidence: 0.9 }] };
  const [unit] = scenesAsSegments(reading);
  assert.equal(unit.type, 'confrontation');
  assert.equal(unit.distribution.confrontation, 0.8);
});
