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
