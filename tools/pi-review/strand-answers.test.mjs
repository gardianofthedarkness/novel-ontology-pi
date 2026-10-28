import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStrandAnswers } from './strand-answers.mjs';
import { timePlaceProjection } from './time-place.mjs';

const person = (id, label) => ({ id, kind: 'Character', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const time = { id: 't1', kind: 'TimePoint', names: [{ text: 'that day', kind: 'canonical' }], properties: { storyIndex: 0, narrativeIndex: 0 }, confidence: 1 };
const scene = (id, block, charactersPresent = []) => ({ id, chapterIndex: 0, sentenceIds: [`b${String(block).padStart(4, '0')}_s0000`], charactersPresent, locationId: null });

test('the latest answered strands report is read; a plan-only report is skipped', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'strand-answers-'));
  assert.equal(await readStrandAnswers(workspace), null);
  await mkdir(join(workspace, 'timeplace'));
  await writeFile(join(workspace, 'timeplace', 'strands-2026-10-27T10-00-00-000Z.json'), JSON.stringify({ after: { lanes: 2 }, casts: { s2: ['c_1'] }, alone: [] }));
  await writeFile(join(workspace, 'timeplace', 'strands-2026-10-28T10-00-00-000Z.json'), JSON.stringify({ after: null, casts: {} }));
  assert.deepEqual(await readStrandAnswers(workspace), { casts: { s2: ['c_1'] }, alone: [] });
  await writeFile(join(workspace, 'timeplace', 'strands-2026-10-29T10-00-00-000Z.json'), JSON.stringify({ after: { lanes: 3 }, casts: { s1: ['c_2', 7] }, alone: ['s3'] }));
  assert.deepEqual(await readStrandAnswers(workspace), { casts: { s1: ['c_2'] }, alone: ['s3'] });
});

test('answered casts replace recorded ones in the story view, and a lone scene is marked', () => {
  const entities = [time, person('c_1', 'Ming'), person('c_2', 'Lan')];
  const scenes = [scene('s1', 1, ['c_1']), scene('s2', 2), scene('s3', 3)];
  const relations = scenes.map(entry => ({ type: 'OCCURS_DURING', fromId: entry.id, toId: 't1', properties: { via: 'anchor' }, confidence: 1 }));
  const plain = timePlaceProjection({ entities, scenes, relations });
  assert.deepEqual(plain.scenes.map(entry => entry.characterIds), [['c_1'], [], []]);
  const answered = timePlaceProjection({ entities, scenes, relations, strands: { casts: { s2: ['c_2', 'not_a_character'] }, alone: ['s3'] } });
  assert.deepEqual(answered.scenes.map(entry => entry.characterIds), [['c_1'], ['c_2'], []]);
  assert.deepEqual(answered.scenes.map(entry => entry.alone ?? false), [false, false, true]);
});
