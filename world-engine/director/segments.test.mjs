import test from 'node:test';
import assert from 'node:assert/strict';
import { alignCards, segmentPresence, segmentWorld, sceneOfContainer } from './segments.mjs';

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

test('the world by segment: containers with their scene as parent, the scene\'s place and time', () => {
  const reading = { scenes: [{ id: 's1', sentences: segments.flatMap(segment => segment.sentences) }], segments, cards: [], time: { scenes: [{ scene: 's1', node: 't:1' }] } };
  const script = { places: {}, scenes: [{ id: 's1', place: 'loc', present: ['p'], at: { node: 't:1' }, timeline: [] }] };
  const world = segmentWorld({ reading, script, spawn: { scenes: [{ id: 's1', spawn: 'new', starts: [{ who: 'p', scene: 's1' }] }] } });
  assert.deepEqual(world.ids, ['s1~1', 's1~2', 's1~3']);
  assert.deepEqual(world.script.scenes.map(scene => [scene.place, scene.parent]), [['loc', 's1'], ['loc', 's1'], ['loc', 's1']]);
  assert.deepEqual(world.reading.time.scenes.map(entry => entry.scene), ['s1~1', 's1~2', 's1~3']);
  assert.deepEqual(world.spawn.scenes.map(scene => [scene.spawn, scene.starts.length]), [['new', 1], ['carry', 0], ['carry', 0]]);
  assert.equal(sceneOfContainer('s1~2'), 's1');
});
