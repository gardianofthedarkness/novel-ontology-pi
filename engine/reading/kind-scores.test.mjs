import test from 'node:test';
import assert from 'node:assert/strict';
import { withScores } from './kind-scores.mjs';

test("a reading's kinds take their cached distributions: the answer that gave the kind, the top three, nothing asked", () => {
  const cached = new Map([['s1', [{ value: 'narration', confidence: 0.3, distribution: { narration: 0.5, thought: 0.5 } }, { value: 'action', confidence: 0.41, distribution: { action: 0.51, narration: 0.47, spoken: 0.02, fact: 0 } }]]]);
  const { kinds, kept, missing } = withScores({ s1: { kind: 'narration', was: 'action', confidence: 0.41, turn: 0.2 }, s2: { kind: 'spoken', confidence: 0.9, turn: 0 } }, cached);
  assert.deepEqual(kinds.s1.top, [['action', 0.51], ['narration', 0.47], ['spoken', 0.02]], 'the answer that gave the kind (action, before the action rule)');
  assert.equal(kinds.s1.kind, 'narration', "the reading's kind is untouched");
  assert.deepEqual([kept, missing], [1, 1]);
  assert.equal(kinds.s2.distribution, undefined);
});
