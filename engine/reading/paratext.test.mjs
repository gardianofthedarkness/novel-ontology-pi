import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edges } from './paratext.mjs';

// Made-up scenes: an id, how many sentences, and Jev's chance that it is story.
const book = (rows) => {
  const scenes = rows.map(([id, n], i) => ({ id, index: i, sentences: Array.from({ length: n }, (_, k) => `${id}_${k}`) }));
  const verdicts = Object.fromEntries(rows.map(([id, , story]) => [id, { story }]));
  return edges(scenes, verdicts);
};

test('front and back matter are cut at the edges; the story between is kept', () => {
  const { paratext, doubtful } = book([['cover', 4, 0], ['credits', 6, 0], ['contents', 4, 0], ['s1', 30, 0.99], ['s2', 25, 0.98], ['afterword', 40, 0]]);
  assert.deepEqual(paratext, ['cover', 'credits', 'contents', 'afterword']);
  assert.deepEqual(doubtful, []);
});

test('one misjudged scene at an edge does not hold it open', () => {
  // A two-line blurb taken for story before the credits; a one-line teaser after the afterword.
  const { paratext } = book([['cover', 4, 0], ['blurb', 2, 0.7], ['credits', 8, 0], ['s1', 30, 1], ['s2', 30, 1], ['afterword', 23, 0], ['teaser', 1, 0.6]]);
  assert.deepEqual(paratext, ['cover', 'blurb', 'credits', 'afterword', 'teaser']);
});

test('a heading does not break the story, and a note-like scene in the middle is only doubtful', () => {
  const { paratext, doubtful } = book([['contents', 4, 0], ['prologue', 12, 0.95], ['chapter 1', 1, 0.3], ['s1', 15, 0.99], ['letter', 9, 0.2], ['s2', 30, 1]]);
  assert.deepEqual(paratext, ['contents'], 'a short prologue, a heading, then more story: one stretch');
  assert.deepEqual(doubtful, ['chapter 1', 'letter']);
});
