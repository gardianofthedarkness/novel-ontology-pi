import test from 'node:test';
import assert from 'node:assert/strict';
import { bookOf, peopleOf } from './evidence.mjs';
import { lookAt, lookQuestion, menuOf, packOf, START, startOf, STEP } from './look.mjs';

const line = n => `b0001_s${String(n).padStart(4, '0')}`;
const text = n => (n === 150 ? 'Alice said hello.' : n === 120 ? 'Bob waved at Alice.' : n === 190 ? 'Alice nodded.' : n === 260 ? 'Alice again.' : `line ${n}`);
const book = bookOf(Array.from({ length: 300 }, (_, n) => ({ id: line(n), text: text(n) })));
const roles = { [line(150)]: { kind: 'spoken', who: { id: null } }, [line(60)]: { kind: 'spoken', who: { id: 'char_2' } }, [line(170)]: { kind: 'spoken', who: { id: 'char_2' } } };
const people = peopleOf({ entities: [{ id: 'char_1', names: ['Alice'] }, { id: 'char_2', names: ['Bob'] }], roles });
const scenes = new Map([['scene_000009', { id: 'scene_000009', sentences: Array.from({ length: 60 }, (_, n) => line(130 + n)) }]]);
const ctx = { book, people, roles, scenes };
const item = { id: 'wi_1', kind: 'who-speaks', line: line(150), subjects: ['char_1', 'char_2'], question: 'Who says b0001_s0150?' };

test('looks start at the item\'s line and a few lines each side', () => {
  const state = startOf(item, ctx, line(150));
  assert.equal(state.seen.size, 2 * START + 1);
  assert.equal(packOf(state).lines[0], line(150));
  assert.deepEqual([state.lo, state.hi], [150 - START, 150 + START]);
});

test('the menu: answer, before, after, each person\'s name and lines, the scene, the work model once, the main agent', () => {
  const state = startOf(item, ctx, line(150));
  const keys = menuOf(state, ctx, { work: true }).map(move => move.key);
  assert.deepEqual(keys, ['answer', 'before', 'after', 'name:char_1', 'name:char_2', 'said:char_2', 'scene', 'work', 'pi']);
  assert.ok(!menuOf(state, ctx).some(move => move.key === 'work'), 'no work model, no such move');
  state.done.push({ move: 'work', added: 0 });
  assert.ok(!menuOf(state, ctx, { work: true }).some(move => move.key === 'work'), 'asked once');
  const question = lookQuestion(state, menuOf(state, ctx), 2);
  assert.match(question.instructions, /2 looks left/);
  assert.match(question.optionHints['name:char_1'], /Alice within 100 lines/);
});

test('each move reads what it says, and nothing twice', () => {
  const state = startOf(item, ctx, line(150));
  assert.deepEqual(lookAt(state, 'before', ctx).length, STEP);
  assert.equal(state.lo, 150 - START - STEP);
  assert.deepEqual(lookAt(state, 'name:char_1', ctx), [line(120), line(190)], 'Alice named within 100 lines, nearest first, not 260');
  assert.deepEqual(lookAt(state, 'name:char_1', ctx), []);
  assert.deepEqual(lookAt(state, 'said:char_2', ctx), [line(170), line(60)], 'what Bob says, nearest first');
  const scene = lookAt(state, 'scene', ctx);
  assert.ok(scene.length > 0 && scene.every(id => !scene.slice(0, scene.indexOf(id)).includes(id)));
  assert.deepEqual(state.done.map(look => look.move), ['before', 'name:char_1', 'name:char_1', 'said:char_2', 'scene']);
});

test('with no line of its own, looks start from each person\'s own lines nearest the scenes asked', () => {
  const state = startOf({ id: 'wi_2', kind: 'identity', subjects: ['char_2'], question: 'Is Bob ... ? scene_000009' }, ctx, null);
  assert.deepEqual(packOf(state).lines, [line(170), line(60)]);
  assert.ok(!menuOf(state, ctx).some(move => move.key === 'before'));
});
