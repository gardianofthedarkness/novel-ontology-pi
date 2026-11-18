import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectOf } from './affect.mjs';

let n = 0;
const beat = (holder, scene, stakes, actual, probability = 1) => ({ holder, scene, order: ++n, stakes, actual, probability });
const last = (...beats) => affectOf(beats).get(beats.at(-1));

test('arousal grows with the log of the surprise, not its size', () => {
  const small = last(beat('a', 's1', 2, -2)), big = last(beat('a', 's1', 6, -6));
  assert.ok(big.arousal > small.arousal && big.arousal <= 1);
  // A million times the harm is not a million times the arousal.
  assert.ok(big.arousal / small.arousal < 4);
});

test('what was foreseen does not stir, however high the stakes', () => {
  // The threat looms in one beat and comes in the next: the coming is no surprise.
  const foreseen = last(beat('a', 's1', 6, -6), beat('a', 's1', 6, -6));
  const sudden = last(beat('a', 's1', 6, -6));
  assert.equal(foreseen.arousal, 0);
  assert.ok(sudden.arousal > 0.9);
  assert.equal(foreseen.relevance, 1);
});

test('the same blow stirs less among blows (context)', () => {
  const fresh = last(beat('a', 's9', 4, -4));
  const hardened = last(beat('a', 's1', 5, -5), beat('a', 's2', 0, 0), beat('a', 's3', 5, -5), beat('a', 's4', 0, 0), beat('a', 's9', 4, -4));
  assert.ok(hardened.context > 1);
  assert.ok(hardened.arousal < fresh.arousal);
});

test('satisfaction and scare come from comparison', () => {
  // The same small loss: a relief after a looming large one, a scare out of nothing.
  assert.ok(last(beat('a', 's1', 4, -4), beat('a', 's1', 4, -1)).surprise > 0);
  assert.ok(last(beat('a', 's1', 4, -1)).valence < 0);
  // A threat that is only likely stirs less than one that has come.
  assert.ok(last(beat('a', 's1', 5, -5, 0.3)).arousal < last(beat('a', 's1', 5, -5, 1)).arousal);
});

test('an expectation fades across scenes, and holders keep their own', () => {
  const same = last(beat('a', 's1', 5, -5), beat('a', 's1', 5, -5));
  const later = last(beat('a', 's1', 5, -5), beat('a', 's2', 5, -5));
  assert.ok(later.arousal > same.arousal);
  const b = beat('b', 's1', 3, -3);
  assert.equal(affectOf([beat('a', 's1', 6, -6), b]).get(b).context, 1);
});
