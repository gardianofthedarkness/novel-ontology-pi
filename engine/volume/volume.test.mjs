// A whole volume step by step (volume.mjs): where a book stands, a free step run in the background, the agent's step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STEPS, execute, lastRun, markDone, placesOf, previousBook, run, status } from './volume.mjs';

const library = async () => { const root = await mkdtemp(join(tmpdir(), 'volume-')), novel = join(root, 'vol-2', 'novel'); await mkdir(join(novel, 'source'), { recursive: true }); return { root, novel }; };
const until = async (check, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise(done => setTimeout(done, 50)); } return false; };

test('the steps in order, the place tree, the rooms and the look pass the agent\'s, before terrain', () => {
  const ids = STEPS.map(step => step.id);
  assert.deepEqual(ids.slice(0, 8), ['prepare', 'read', 'workspace', 'places', 'rooms', 'strands', 'carry', 'look']);
  assert.ok(ids.indexOf('look') < ids.indexOf('terrain') && ids.indexOf('snapshot') < ids.indexOf('direct') && ids.at(-1) === 'kept');
  assert.deepEqual(STEPS.filter(step => step.who === 'agent').map(step => [step.id, step.workflow]), [['places', 'places'], ['rooms', 'rooms'], ['look', 'look']]);
  assert.deepEqual([previousBook('vol-2'), previousBook('vol-1'), previousBook('vol-10')], ['vol-1', null, 'vol-9']);
});

test('a new book: everything waits; prepare runs in the background and sets the folder aside as the source', async () => {
  const { novel } = await library(), at = placesOf(novel);
  const before = await status(novel);
  assert.deepEqual([before.next, before.steps.every(step => step.status === 'waiting' || step.id === 'carry')], [{ id: 'prepare', who: 'runner', status: 'waiting' }, true]);
  const started = await run(novel, { step: 'prepare' });
  assert.deepEqual(started.started, ['prepare']);
  assert.ok(await until(async () => (await status(novel)).steps[0].status === 'done'), 'prepare done');
  assert.ok(existsSync(at.source) && !existsSync(novel));
  assert.equal((await status(novel)).next.id, 'read');
});

test('by hand (NOVEL_VOLUME_AGENT=hand) the agent\'s step is not started by the runner; it is marked done with a why', async () => {
  const { novel } = await library(), at = placesOf(novel);
  await writeFile(at.state, JSON.stringify({ book: 'vol-2', steps: Object.fromEntries(['prepare', 'read', 'workspace', 'places', 'rooms', 'strands', 'carry'].map(id => [id, { status: 'done' }])) }));
  process.env.NOVEL_VOLUME_AGENT = 'hand';
  try { await assert.rejects(run(novel), /the next step, look, is yours/); } finally { delete process.env.NOVEL_VOLUME_AGENT; }
  await assert.rejects(markDone(novel, 'terrain', 'no'), /only the agent's steps/);
  await assert.rejects(markDone(novel, 'look', ' '), /say why/);
  assert.equal((await markDone(novel, 'look', 'models and settings set')).status, 'done');
  assert.equal((await status(novel)).next.id, 'sky');
});

test('a failed step is recorded with its error and stops the chain', async () => {
  const { novel } = await library(), at = placesOf(novel);
  await writeFile(at.state, JSON.stringify({ book: 'vol-2', steps: { prepare: { status: 'done' } } }));
  // The workspace step with no reading: its script fails.
  assert.equal(await execute(novel, ['workspace', 'strands']), false);
  const now = await status(novel), workspace = now.steps.find(step => step.id === 'workspace');
  assert.equal(workspace.status, 'failed');
  assert.match(workspace.error, /exited/);
  assert.equal(now.steps.find(step => step.id === 'strands').status, 'waiting');
  assert.ok((await readFile(join(at.logs, 'workspace.out'), 'utf8')).startsWith('== '));
});

test('a book\'s last run that can be kept: its page and its smoothing both there', async () => {
  const { root } = await library(), novel = join(root, 'vol-1', 'novel');
  for (const id of ['d20261109073558', 'd20261109081436']) await mkdir(join(novel, 'stage', 'director', 'runs', id), { recursive: true });
  await mkdir(join(novel, 'stage', 'simulation', 'runs', 'director'), { recursive: true }); await mkdir(join(novel, 'stage', 'world', 'smoothed'), { recursive: true });
  await writeFile(join(novel, 'stage', 'simulation', 'runs', 'director', 'd20261109073558.page.json'), '{}');
  assert.equal(await lastRun(novel), null, 'a page with no smoothing (a run that died) cannot be kept');
  await writeFile(join(novel, 'stage', 'simulation', 'runs', 'director', 'd20261109081436.page.json'), '{}');
  await writeFile(join(novel, 'stage', 'world', 'smoothed', 'd20261109081436.json'), '{}');
  assert.equal(await lastRun(novel), 'd20261109081436');
});

test('a step asks the models directly: the host\'s local observer is left out, the models pinned', async () => {
  const { stepEnvironment } = await import('./volume.mjs');
  const env = stepEnvironment({ HOME: '/nowhere', JEV_ENDPOINT: 'http://127.0.0.1:51234/jev', WORK_LLM_BASE_URL: 'http://127.0.0.1:51234/v1', TYPESAFE_API_KEY: 'k', JEV_MODEL: 'jev-1.13.0' });
  assert.deepEqual([env.JEV_ENDPOINT, env.WORK_LLM_BASE_URL, env.TYPESAFE_API_KEY, env.JEV_MODEL, env.WORK_LLM_MODEL], [undefined, undefined, 'k', 'jev-1.14.0', 'deepseek-chat']);
  assert.equal(stepEnvironment({ JEV_ENDPOINT: 'https://example.test/jev' }).JEV_ENDPOINT, 'https://example.test/jev', 'another endpoint stays');
});

test('a step run again after it failed knows it (the director then sets the dead run\'s edits aside)', async () => {
  const { novel } = await library(), at = placesOf(novel);
  await writeFile(at.state, JSON.stringify({ book: 'vol-2', steps: { prepare: { status: 'done' }, workspace: { status: 'failed' } } }));
  await execute(novel, ['workspace']);
  assert.equal(JSON.parse(await readFile(at.state, 'utf8')).steps.workspace.failedBefore, true);
  const direct = STEPS.find(step => step.id === 'direct');
  await mkdir(join(novel, 'stage', 'world'), { recursive: true }); await writeFile(join(novel, 'stage', 'world', 'script.json'), JSON.stringify({ scenes: [{ id: 's1' }, { id: 's2' }] }));
  await writeFile(at.state, JSON.stringify({ book: 'vol-2', steps: { direct: { status: 'running', failedBefore: true } } }));
  assert.ok((await direct.commands(at))[0].args.includes('--discard-edits'));
  await writeFile(at.state, JSON.stringify({ book: 'vol-2', steps: { direct: { status: 'running' } } }));
  assert.ok(!(await direct.commands(at))[0].args.includes('--discard-edits'));
});
