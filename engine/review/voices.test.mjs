import test from 'node:test';
import assert from 'node:assert/strict';
import { combined, decodeExchange, gramsOf, lookupScores, normalised, pick, quoteOf, trainVoices, voiceScores } from './voices.mjs';

test('the words said are what stands in the quotation marks', () => {
  assert.equal(quoteOf('"Wait!" she said. "Now."'), 'Wait!｜Now.');
  assert.equal(quoteOf('No marks at all'), 'No marks at all');
  assert.ok(gramsOf('ab').includes('b$') && gramsOf('ab').includes('^a'));
});

test('a voice: the person whose words a line shares scores highest', () => {
  const voices = trainVoices([
    { who: 'a', quote: 'desu wa, onee-sama' }, { who: 'a', quote: 'onee-sama, desu wa' }, { who: 'a', quote: 'kuroko desu wa' },
    { who: 'b', quote: 'fukou da' }, { who: 'b', quote: 'ore wa fukou da' }, { who: 'b', quote: 'nande da yo' },
  ]);
  assert.equal(pick(voiceScores(voices, 'sou desu wa', ['a', 'b'])).who, 'a');
  assert.equal(pick(voiceScores(voices, 'fukou da yo', ['a', 'b'])).who, 'b');
});

test('the lookup votes by the nearest known lines', () => {
  const index = [{ who: 'a', vector: [1, 0] }, { who: 'a', vector: [0.9, 0.1] }, { who: 'b', vector: [0, 1] }];
  assert.equal(pick(lookupScores(index, [0.95, 0.05], ['a', 'b'])).who, 'a');
  assert.equal(pick(lookupScores(index, [0.1, 0.9], ['a', 'b'])).who, 'b');
});

test('normalised scores are log-probabilities; combined weighs them', () => {
  const p = normalised({ a: 2, b: 0 });
  assert.ok(Math.abs(Math.exp(p.a) + Math.exp(p.b) - 1) < 1e-9);
  assert.deepEqual(combined([{ scores: { a: -1 }, weight: 2 }, { scores: { a: -1, b: -3 } }]), { a: -3, b: -3 });
});

test('an exchange decoded together: turns pass, known lines clamp, the one spoken to answers', () => {
  const flat = { a: Math.log(0.5), b: Math.log(0.5) };
  assert.deepEqual(decodeExchange([{ scores: flat, known: 'a' }, { scores: flat }, { scores: flat }]), ['a', 'b', 'a']);
  assert.deepEqual(decodeExchange([{ scores: { a: Math.log(0.6), b: Math.log(0.4) }, to: 'a' }, { scores: flat }]), ['b', 'a']);
});
