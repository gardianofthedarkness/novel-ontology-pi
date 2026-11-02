import test from 'node:test';
import assert from 'node:assert/strict';
import { bundlesOf, heldItems, lawAgainst, pinsFrom } from './review.mjs';
import { leastChange, spansOf } from './backprop.mjs';

const ledger = [
  { id: 'r:p1', kind: 'held', state: 'held', law: 'L6', subject: 'a', value: { what: 's2 · b0_s1', why: 'a speaks to b from 40 m: remote, or someone is misplaced (kind not asked yet)' } },
  { id: 'r:p2', kind: 'held', state: 'held', law: 'L6', subject: 'a', value: { what: 's2 · b0_s2', why: 'a speaks to b from 41 m: remote, or someone is misplaced (kind not asked yet)' } },
  { id: 'r:p3', kind: 'law', state: 'held', source: 'play', law: 'L9', subject: 'c', value: { scene: 's2', card: 'action:b0_s3', verdict: 'held', why: 'acts or speaks, but is not present' } },
  { id: 'r:p4', kind: 'law', state: 'held', source: 'play', law: 'L10', subject: 'a', value: { scene: 's3', card: 'action:b0_s9', verdict: 'held', why: 'no way there on foot', code: 'NO_PATH' } },
  { id: 'r:p5', kind: 'law', state: 'applied', source: 'play', law: 'L1', subject: 'a', value: { scene: 's2', verdict: 'amend' } },
  { id: 'r:p6', kind: 'world', state: 'held', subject: 'b1', value: { scene: 's2', code: 'SHUT_ROOM' } },
];

test('held items: one question per person or pair and scene, its lines gathered; only what is held; the world\'s faults not asked', () => {
  const items = heldItems({ ledger, notes: [{ at: 't', card: 'dialogue:b0_s1', scene: 's2', text: 'she is on the roof here' }], name: id => id.toUpperCase() });
  assert.deepEqual(items.map(item => item.kind).sort(), ['actor', 'note', 'reach', 'talk']);
  const talk = items.find(item => item.kind === 'talk');
  assert.deepEqual([talk.subjects, talk.lines, talk.options], [['a', 'b'], ['b0_s1', 'b0_s2'], ['live', 'group', 'remote', 'public']]);
  assert.match(talk.question, /A speaks to B/);
  assert.equal(heldItems({ ledger }).find(item => item.kind === 'talk').id, talk.id, 'the same question has the same id run after run');
});

test('bundles by scene, the one reaching furthest first, within a budget', () => {
  const items = heldItems({ ledger });
  const log = [{ kind: 'presence', who: 'a', scene: 's3' }, { kind: 'presence', who: 'a', scene: 's4' }];
  const strands = { scenes: [{ id: 's2', fork: 'f' }, { id: 's3', fork: 'f' }, { id: 's4', fork: 'f' }] };
  const bundles = bundlesOf(items, { log, strands });
  assert.deepEqual(bundles.map(bundle => bundle.scene), ['s2', 's3']);
  assert.equal(bundlesOf(items, { log, strands, budget: 1 }).length, 1);
});

test('answers into pins: a talk face to face is a meeting to back-propagate from; an arrival; an answer the laws turn back', () => {
  const items = heldItems({ ledger }), of = kind => items.find(item => item.kind === kind);
  const pins = { present: {}, remote: {}, kind: {}, arrive: {}, stays: {}, meet: [], revise: {}, notSpeaker: {}, notes: {}, abilities: [], strands: [], time: [], same: [], different: [], landscape: {} };
  const script = { scenes: [{ id: 's2', place: 'p1', present: [], clock: true, at: { node: 't:y1:12-24:15:00', stated: true } }, { id: 's9', place: 'p2', present: ['c'], clock: true, at: { node: 't:y1:12-24:15:00', stated: true } }] };
  const { failed } = pinsFrom(pins, [
    { item: of('talk'), answer: { verdict: 'live', reason: 'b0_s1' } },
    { item: of('reach'), answer: { verdict: 'arrives', reason: 'b0_s9' } },
    { item: of('actor'), answer: { verdict: 'present', reason: 'b0_s3' } },
  ], { script });
  assert.deepEqual(pins.meet.map(meet => [meet.scene, meet.who, meet.to]), [['s2', 'a', 'b']]);
  assert.equal(pins.kind['line:b0_s2'], 'live');
  assert.equal(pins.arrive['s3|action:b0_s9|a'], true);
  assert.match(failed.get(of('actor').id), /^L2/, 'present in s2 while s9 has them elsewhere at the same moment');
  assert.equal(pins.present['s2|c'], undefined);
  assert.equal(lawAgainst({ item: of('actor'), verdict: 'remote' }, { script, pins }), null);
});

test('back-propagation: the span from the last anchor to a pinned meeting, at its place; the draw that changes the history least', () => {
  const log = [
    { id: 'r:1', kind: 'presence', strand: 'f', scene: 's1', place: 'p', who: 'a', at: { x: -100, y: 0, z: 0 }, rank: 'stated' },
    { id: 'r:2', kind: 'presence', strand: 'f', scene: 's2', place: 'p', who: 'a', at: { x: 50, y: 0, z: 0 }, rank: 'ruled' },
    { id: 'r:3', kind: 'presence', strand: 'f', scene: 's2b', place: 'p', who: 'a', at: { x: 900, y: 0, z: 0 }, rank: 'ruled' },
    { id: 'r:4', kind: 'presence', strand: 'f', scene: 's2c', place: 'p', who: 'a', at: { x: 40, y: 0, z: 0 }, rank: 'ruled' },
    { id: 'r:5', kind: 'presence', strand: 'f', scene: 's2', place: 'p', who: 'b', at: { x: 100, y: 0, z: 0 }, rank: 'ruled' },
    { id: 'r:6', kind: 'presence', strand: 'f', scene: 's3', place: 'p', who: 'a', at: { x: 60, y: 0, z: 0 }, rank: 'ruled' },
    { id: 'r:7', kind: 'position', strand: 'f', scene: 's3', place: 'p', card: 'dialogue:x', who: 'b', at: { x: 100, y: 0, z: 10 }, rank: 'ruled' },
  ];
  const [span] = spansOf({ pins: { meet: [{ scene: 's3', cards: ['dialogue:x'], who: 'a', to: 'b' }] }, log });
  assert.deepEqual([span.from, span.target, span.moments.map(moment => moment.scene)], [{ x: 40, y: 0, z: 0 }, { x: 100, y: 0, z: 10 }, ['s2c', 's3']], 'their stay round the meeting, not the scene far off before it');
  const straight = Array.from({ length: 11 }, (_, n) => ({ x: n * 10, y: 0, z: 0 })), wide = straight.map(p => ({ ...p, z: 40 }));
  const best = leastChange([wide, straight], span.moments);
  assert.equal(best.draw, 1, 'the draw nearer the old history');
  assert.ok(best.J < leastChange([wide], span.moments).J);
});
