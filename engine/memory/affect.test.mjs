import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectOf } from './affect.mjs';

const beat = (holder, order, stakes, expected, actual, probability = 1) => ({ holder, order, stakes, expected, actual, probability });
const one = (b, ...earlier) => affectOf([...earlier, b]).get(b);

test('arousal grows with the log of the surprise, not its size', () => {
  const small = one(beat('a', 1, 2, 0, -2)), big = one(beat('a', 1, 6, 0, -6));
  assert.ok(big.arousal > small.arousal && big.arousal <= 1);
  // Ten thousand times the harm is not ten thousand times the arousal.
  assert.ok(big.arousal / small.arousal < 4);
});

test('what was expected does not stir, however high the stakes', () => {
  const expected = one(beat('a', 1, 6, -6, -6)), sudden = one(beat('a', 1, 6, 0, -6));
  assert.equal(expected.arousal, 0);
  assert.ok(sudden.arousal > 0.9);
  assert.equal(expected.relevance, 1);
});

test('the same blow stirs less among blows (context)', () => {
  const fresh = one(beat('a', 10, 4, 0, -4));
  const hardened = one(beat('a', 10, 4, 0, -4), beat('a', 1, 5, 0, -5), beat('a', 2, 5, 0, -5), beat('a', 3, 5, 0, -5));
  assert.ok(hardened.arousal < fresh.arousal);
  assert.ok(hardened.context > 1);
});

test('satisfaction and scare come from comparison', () => {
  // The same outcome (a small loss) is a relief after expecting a large one, a scare after expecting none.
  assert.ok(one(beat('a', 1, 4, -4, -1)).valence > 0);
  assert.ok(one(beat('a', 1, 4, 0, -1)).valence < 0);
  // A threat that is only likely stirs less than one that has come.
  assert.ok(one(beat('a', 1, 5, 0, -5, 0.3)).arousal < one(beat('a', 1, 5, 0, -5, 1)).arousal);
});

test('holders keep their own context and mood', () => {
  const b = beat('b', 2, 3, 0, -3), a1 = beat('a', 1, 6, 0, -6);
  assert.equal(affectOf([a1, b]).get(b).context, 1);
});
