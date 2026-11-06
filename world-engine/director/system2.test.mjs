import test from 'node:test';
import assert from 'node:assert/strict';
import { withSystem2, workAnswers } from './system2.mjs';

const questions = [
  { key: 'moves', primitive: 'choice', instructions: 'Does she go?', options: ['goes', 'stays'], optionHints: { goes: 'changes place' } },
  { key: 'direction', primitive: 'choice', instructions: 'Which way?', options: ['A', 'B', 'with:char_2'], optionHints: { A: 'arrow A: the roof of a 5-floor building', B: 'arrow B: the street' } },
  { key: 'box', primitive: 'box', instructions: 'Box where she ends up on picture "plan".' },
];
const jev = async () => [
  { key: 'moves', value: 'goes', confidence: 0.9 },
  { key: 'direction', value: 'with:char_2', confidence: 0.42 },
  { key: 'box', value: 0.3, confidence: 0.3, box: [0.1, 0.2, 0.1, 0.2] },
];

test('below 0.5 the work model is asked the same question with the same state; its answer is used; both are noted', async () => {
  const seen = [], notes = [];
  const work = { generate: async request => { seen.push(JSON.parse(request.prompt)); return JSON.stringify({ answers: [{ key: 'direction', value: 'A', confidence: 0.8 }] }); } };
  const decide = withSystem2(jev, work, { note: entry => notes.push(entry) });
  const answers = await decide({ card: { lines: ['she leaps to the roof'] } }, questions, { images: { arrows: 'png' } });
  assert.deepEqual(answers.find(answer => answer.key === 'direction'), { key: 'direction', value: 'A', confidence: 0.8, by: 'work' });
  assert.equal(answers.find(answer => answer.key === 'moves').value, 'goes', 'a sure answer is Jev\'s');
  assert.equal(answers.find(answer => answer.key === 'box').box.length, 4, 'a box stays Jev\'s: the work model cannot draw');
  assert.deepEqual(seen[0].state, { card: { lines: ['she leaps to the roof'] } }, 'the same state');
  assert.deepEqual(seen[0].questions.map(question => question.key), ['direction'], 'only the unsure, answerable question');
  assert.match(seen[0].pictures, /arrows/);
  assert.deepEqual(seen[0].questions[0].options[0], { option: 'A', means: 'arrow A: the roof of a 5-floor building' });
  assert.deepEqual(notes, [{ key: 'direction', asked: 'Which way?', jev: { value: 'with:char_2', confidence: 0.42 }, work: { value: 'A', confidence: 0.8 }, used: 'work' }]);
});

test('a work answer that is not one of the options, or none at all, leaves Jev\'s; no work model, no system 2', async () => {
  assert.deepEqual(await workAnswers({ generate: async () => '{"answers":[{"key":"direction","value":"Z","confidence":1}]}' }, {}, [questions[1]]), []);
  assert.deepEqual(await workAnswers({ generate: async () => 'not json' }, {}, [questions[1]]), []);
  const notes = [], decide = withSystem2(jev, { generate: async () => '{"answers":[]}' }, { note: entry => notes.push(entry) });
  assert.equal((await decide({}, questions)).find(answer => answer.key === 'direction').value, 'with:char_2');
  assert.equal(notes[0].used, 'jev');
  assert.deepEqual(await withSystem2(jev, null)({}, questions), await jev());
});
