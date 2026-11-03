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

test('presence by the cards\' evidence: people enter where they first act and stay; a memory places nobody now', () => {
  const cards = [
    { id: 'action:a1', kind: 'action', first: 'a1', sentences: ['a1'], people: [{ id: 'p', how: ['acts'], at: ['a1'] }] },
    { id: 'action:a5', kind: 'action', first: 'a5', sentences: ['a5'], people: [{ id: 'q', how: ['acts'], at: ['a5'] }] },
    { id: 'action:a7', kind: 'action', first: 'a7', sentences: ['a7'], people: [{ id: 'r', how: ['acts'], at: ['a7'] }] },
  ];
  const present = segmentPresence({ segments, cards, scriptScenes: new Map([['s1', { present: ['p', 'q', 's'] }]]) });
  assert.deepEqual(present.map(entry => entry.present.sort().join(',')), ['p,s', 'p,q,s', 'p,q,s']);
  assert.equal(present[2].evidence.length, 0, 'the memory\'s actor is in the past');
  assert.equal(present[1].now, 0.9);
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
