import assert from 'node:assert/strict';
import test from 'node:test';
import { accepted, endsOf, KINDS, ledgerOf } from './miniloop.mjs';
import { heldItems } from '../review/review.mjs';

const item = { options: ['arrives', 'stays', 'another way'] };

test('an answer is applied only when sure: Jev at 0.7, or Jev and the work model agreeing', () => {
  assert.deepEqual(accepted({ jev: { value: 'stays', confidence: 0.82 } }, item), { verdict: 'stays', by: 'jev', confidence: 0.82 });
  assert.equal(accepted({ jev: { value: 'stays', confidence: 0.6 } }, item), null);
  assert.deepEqual(accepted({ jev: { value: 'arrives', confidence: 0.4 }, work: { value: 'arrives' } }, item), { verdict: 'arrives', by: 'jev+work', confidence: 0.4 });
  assert.equal(accepted({ jev: { value: 'arrives', confidence: 0.4 }, work: { value: 'stays' } }, item), null);
  // Not an option, or turned back by the laws: left for the review at the end.
  assert.equal(accepted({ jev: { value: 'flies', confidence: 0.95 } }, item), null);
  assert.equal(accepted({ jev: { value: 'stays', confidence: 0.95 }, law: 'L2: elsewhere' }, item), null);
});

test("a card's held laws become the review's items, one kind for each", () => {
  let n = 0;
  const ledger = ledgerOf([
    { law: 'L10', who: 'char_a', why: 'no walk there', scene: 'scene_000003', card: 'action:b0001_s0010' },
    { law: 'L9', who: 'char_b', why: 'acts or speaks, but is not present', scene: 'scene_000003', card: 'action:b0001_s0010' },
    { law: 'L6', who: 'char_c', why: 'public, but 40 m away: out of earshot', scene: 'scene_000003', card: 'dialogue:b0001_s0012', to: 'char_a' },
    { law: 'L6', who: 'char_d', why: 'is not present', scene: 'scene_000003', card: 'dialogue:b0001_s0012' },
  ], () => `ml_${++n}`);
  const items = heldItems({ ledger });
  assert.deepEqual(items.map(entry => entry.kind).sort(), ['actor', 'reach', 'speaker', 'talk']);
  assert.ok(items.every(entry => KINDS.has(entry.kind) && entry.scene === 'scene_000003'));
  assert.deepEqual(items.find(entry => entry.kind === 'talk').subjects, ['char_c', 'char_a']);
  assert.equal(items.find(entry => entry.kind === 'reach').card, 'action:b0001_s0010');
});

test("the smoothing's end of a unit: the last moment there, moved more than 2 m and at most the limit", () => {
  const smoothed = { people: {
    char_a: [{ scene: 'scene_000003', card: null, shift: 9, map: { x: 1, y: 0, z: 2 } }, { scene: 'scene_000003', card: 'c1', shift: 5, map: { x: 3, y: 0, z: 4 } }],
    char_b: [{ scene: 'scene_000003', card: 'c1', shift: 1.5, map: { x: 0, y: 0, z: 0 } }],
    char_c: [{ scene: 'scene_000003', card: 'c1', shift: 80, map: { x: 0, y: 0, z: 0 } }],
    char_d: [{ scene: 'scene_000002', card: 'c1', shift: 6, map: { x: 0, y: 0, z: 0 } }],
  } };
  assert.deepEqual(endsOf(smoothed, 'scene_000003', { most: 50 }), { char_a: { to: { x: 3, y: 0, z: 4 }, shift: 5 } });
});

test("a card's picture goes to Jev with the verdict and its line, and the prompt says what it is", async () => {
  const { reviewItems } = await import('../review/jev-review.mjs');
  const { bookOf, peopleOf } = await import('../review/evidence.mjs');
  const sentences = [{ id: 'b0001_s0001', text: 'Ann walks to the gate.' }, { id: 'b0001_s0002', text: 'Ben waits by the wall.' }];
  const card = { id: 'action:b0001_s0001', first: 'b0001_s0001', sentences: ['b0001_s0001'], people: [{ id: 'char_a', how: ['acts'] }] };
  const [item] = heldItems({ ledger: ledgerOf([{ law: 'L10', who: 'char_a', why: 'no walk there', scene: 'scene_000001', card: card.id }], () => 'ml_1') });
  const sent = [];
  const decide = async (state, questions, request) => { sent.push({ state, request }); return questions.map(question => ({ key: question.key, value: question.options[0], confidence: 0.9 })); };
  const stores = { book: bookOf(sentences), people: peopleOf({ entities: [{ id: 'char_a', names: ['Ann'], proper: ['Ann'] }] }), roles: {}, cards: new Map([[card.id, card]]), scenes: new Map([['scene_000001', { id: 'scene_000001', sentences: sentences.map(s => s.id) }]]), ledger: new Map(), script: { scenes: [] }, pins: {} };
  const [answer] = await reviewItems([{ ...item, images: { camera: 'iVBORw0KGgo=' }, picture: 'The picture "camera" is the director\'s camera on this card.' }], { ...stores, decide, concurrency: 1 });
  assert.equal(sent.length, 2);
  assert.ok(sent.every(entry => entry.request?.images?.camera === 'iVBORw0KGgo='));
  assert.match(JSON.stringify(sent[0].state), /director's camera on this card/);
  assert.deepEqual(answer.pictures, ['camera']);
  // Without a picture, nothing is sent beside the text.
  sent.length = 0;
  await reviewItems([item], { ...stores, decide, concurrency: 1 });
  assert.ok(sent.every(entry => entry.request === undefined));
});

test("a unit's law breaks become the review's items, with the same ids as the end of a run's; who says a line is not asked", async () => {
  const { UNIT_LAWS } = await import('./miniloop.mjs');
  assert.ok(['L1', 'L2', 'L5', 'L6', 'L9', 'L10', 'L13'].every(law => UNIT_LAWS.has(law)));
  assert.ok(!KINDS.has('who-speaks'));
  const ledger = [
    { id: 'e1', state: 'held', kind: 'held', law: 'L2', subject: 'char_a', value: { what: 'scene_000004 & scene_000009 \u00b7 char_a', why: 'two places at 0910' } },
    { id: 'e2', state: 'held', kind: 'held', law: 'L5', subject: 'char_b', value: { what: 'scene_000009 \u00b7 char_b', why: '1200 m in 2 min' } },
  ];
  const items = heldItems({ ledger }), byKind = Object.fromEntries(items.map(item => [item.kind, item]));
  assert.deepEqual(Object.keys(byKind).sort(), ['travel', 'two-places']);
  assert.deepEqual(byKind['two-places'].scenes, ['scene_000004', 'scene_000009']);
  // The same break found again at the end of the run is the same item (its id), so the review skips it once settled.
  assert.equal(heldItems({ ledger: [{ ...ledger[0], id: 'other' }] })[0].id, byKind['two-places'].id);
});
