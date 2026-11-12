// The reviewer segment: a fixed prompt with each unit's picture, a fixed reply, the verdicts kept with the block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeReviewer, reviewBlock, reviewPrompt, standInReviewer, verdictsOf } from './reviewer.mjs';

const units = [
  { unit: 'scene_000011', still: '/x/011-review.png', place: 'the bridge', people: ['A', 'B'], cards: 3, moves: 4, held: [], lines: ['A runs onto the bridge.'] },
  { unit: 'scene_000012', still: null, place: 'the city', people: ['A'], cards: 1, moves: 0, held: ['L10 A (no way there)'], lines: [] },
];

test('the prompt names each unit, its picture and the fixed reply; a reply in the format gives one verdict a unit', () => {
  const prompt = reviewPrompt(units);
  for (const text of ['Unit scene_000011', 'picture: /x/011-review.png', '(no picture: judge from the notes)', 'L10 A (no way there)', '"verdict": "keep" | "retake"']) assert.ok(prompt.includes(text), text);
  const reply = 'Looked.\n```json\n[{"unit": "scene_000011", "verdict": "keep", "note": ""}, {"unit": "scene_000012", "verdict": "retake", "note": "A stands in the street; put A on the bridge."}]\n```';
  assert.deepEqual(verdictsOf(reply, units), [{ unit: 'scene_000011', verdict: 'keep', note: '' }, { unit: 'scene_000012', verdict: 'retake', note: 'A stands in the street; put A on the bridge.' }]);
  assert.equal(verdictsOf('keep them all', units), null);
  assert.equal(verdictsOf('```json\n[{"unit": "scene_000011", "verdict": "keep"}]\n```', units), null, 'every unit needs a verdict');
});

test('the stand-in retakes what the laws held; the block is kept with its prompt and verdicts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'review-')), { retakes, file } = await reviewBlock({ reviewer: standInReviewer(), units, folder, block: 1 });
  assert.deepEqual(retakes.map(entry => entry.unit), ['scene_000012']);
  const kept = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([kept.block, kept.reviewer, kept.verdicts.length], [1, 'stand-in', 2]);
});

test('Claude Code is asked with its Read tool on the review folder only, and asked once more when out of format', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'review-')), fake = join(folder, 'claude'), calls = join(folder, 'calls.jsonl');
  await writeFile(fake, `#!${process.execPath}\nconst fs = require('fs'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');\nconst again = args.includes('--resume');\nconsole.log(JSON.stringify({ is_error: false, session_id: 's1', result: again ? '\`\`\`json\\n[{"unit":"scene_000011","verdict":"retake","note":"closer"},{"unit":"scene_000012","verdict":"keep","note":""}]\\n\`\`\`' : 'they look fine' }));\n`);
  await chmod(fake, 0o755);
  const result = await claudeReviewer({ command: fake }).review(units, folder);
  assert.deepEqual(result.verdicts.map(entry => entry.verdict), ['retake', 'keep']);
  const asked = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(asked.length, 2);
  assert.ok(asked[0].includes(`Read(${folder}/**)`) && !asked[0].includes('Bash'), 'only reading the review folder');
  assert.deepEqual(asked[1].slice(asked[1].indexOf('--resume'), asked[1].indexOf('--resume') + 2), ['--resume', 's1']);
});
