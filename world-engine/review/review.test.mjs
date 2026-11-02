import test from 'node:test';
import assert from 'node:assert/strict';
import { bundlesOf, heldItems, lawAgainst, pinsFrom } from './review.mjs';

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

test('identity from the world: one description met twice in a strand, never together; a description beside a named person sharing companions', async () => {
  const { identityProposals } = await import('./identity.mjs');
  const presence = (scene, ...who) => who.map(id => ({ kind: 'presence', scene, who: id }));
  const log = [...presence('s1', 'char_1', 'char_2', 'slot_1_1'), ...presence('s2', 'char_1', 'char_2', 'char_9'), ...presence('s3', 'char_1', 'char_2', 'slot_3_1'), ...presence('s4', 'char_1', 'slot_4_1', 'slot_4_2')];
  const slots = [{ id: 'slot_1_1', kind: 'person', label: 'girl' }, { id: 'slot_3_1', kind: 'person', label: 'girl' }, { id: 'slot_4_1', kind: 'person', label: 'girl' }, { id: 'slot_4_2', kind: 'crowd', label: 'crowd' }];
  const strands = { scenes: ['s1', 's2', 's3', 's4'].map(id => ({ id, fork: 'f' })) };
  const found = identityProposals({ log, slots, strands }).map(entry => `${entry.a}~${entry.b}`);
  assert.ok(found.includes('slot_1_1~slot_3_1') && found.includes('slot_3_1~slot_4_1'), found.join(' '));
  assert.ok(!found.includes('slot_1_1~slot_4_1'), 'only the next of a label in the strand');
  assert.ok(found.includes('slot_1_1~char_9') && found.includes('slot_3_1~char_9'), 'never with char_9, beside it, both with char_1 and char_2');
  assert.ok(!found.some(pair => pair.includes('slot_4_2')), 'a crowd is not a person');
});

test('answers on what the world settled: who says a line, an audit counted and its "wrong" ruling the speaker out', () => {
  const pins = { present: {}, remote: {}, kind: {}, arrive: {}, stays: {}, meet: [], revise: {}, speaker: {}, audits: {}, notSpeaker: {}, notes: {}, abilities: [], strands: [], time: [], same: [], different: [], landscape: {} };
  const items = heldItems({ ledger: [
    { id: 'r:s1', kind: 'speaker', state: 'held', subject: 'b0_s5', value: { scene: 's2', card: 'dialogue:b0_s5', line: 'b0_s5', who: null, to: 'b', why: '2 there the card says speak', candidates: ['a', 'b', 'c'] } },
    { id: 'r:s2', kind: 'audit', class: 'speaker', state: 'held', subject: 'b0_s6', value: { scene: 's2', card: 'dialogue:b0_s5', line: 'b0_s6', who: 'a', why: 'Jev\'s guess (40%), there' } },
  ] });
  const who = items.find(item => item.kind === 'who-speaks'), audit = items.find(item => item.kind === 'audit');
  assert.deepEqual(who.options, ['a', 'c', 'none of them'], 'those there, not the one spoken to');
  pinsFrom(pins, [{ item: who, answer: { verdict: 'c' } }, { item: audit, answer: { verdict: 'wrong' } }], { script: { scenes: [] } });
  assert.deepEqual([pins.speaker.b0_s5, pins.notSpeaker.b0_s6, pins.audits.speaker], ['c', 'a', { right: 0, wrong: 1 }]);
});
