import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
const run = (job, home, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [runner, job, ...args], {
    env: { ...process.env, NOVEL_REVIEW_HOME: home, WORK_LLM_API_KEY: '', TYPESAFE_API_KEY: '', NOVEL_SECRETS_DIR: join(home, 'no-secrets') },
    stdio: 'ignore', timeout: 15000,
  });
  child.once('error', reject);
  child.once('close', resolve);
});

test('interactive mode fails closed without credentials and does not create a ready console or enqueue a continuation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-review-'));
  try {
    await writeFile(join(directory, 'source.txt'), 'Chapter 0\n\nA synthetic scene.');
    const job = join(directory, 'job.json');
    await writeFile(job, JSON.stringify({ chapters: 1, volumes: [{ input: 'source.txt', workspace: 'novel' }] }));
    const home = join(directory, 'home');
    assert.equal(await run(job, home, ['--interactive']), 1);
    await assert.rejects(access(join(home, 'runtime/pi-control.json')));
    await assert.rejects(access(join(home, 'runtime/pi-console/status.json')));
    await assert.rejects(access(join(home, 'runtime/full-loop.lock')));
    const manifest = JSON.parse(await readFile(join(home, 'runtime/NOVEL_JOB.json'), 'utf8'));
    assert.match(manifest.purpose, /Wait for user messages/);
    assert.equal(manifest.portraits.visualInput, false);
    assert.match(manifest.portraits.skill, /skills\/novel-portraits\/SKILL.md$/);
    assert.equal(manifest.portraits.command, 'novel album assign <workspace>');
    assert.match(manifest.animation.skill, /skills\/novel-stage\/SKILL.md$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('resume preserves all chapter metadata but assigns only unapplied blocks and rejects changed applied source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-review-'));
  try {
    const workspace = join(directory, 'novel');
    await mkdir(join(workspace, 'source'), { recursive: true });
    await mkdir(join(workspace, 'changesets'));
    const prefix = 'Chapter 0\n\nThe original first scene.\n\n';
    const input = prefix + 'Chapter 1\n\nThe new scene.\n';
    await writeFile(join(directory, 'source.txt'), input);
    await writeFile(join(workspace, 'source/source.txt'), prefix);
    await writeFile(join(workspace, 'changesets/cs_b0001.json'), JSON.stringify({ id: 'cs_b0001', blockId: 'b0001', status: 'approved' }));
    await writeFile(join(workspace, 'events.jsonl'), JSON.stringify({ event: { type: 'changeset.applied', changesetId: 'cs_b0001' } }) + '\n');
    const job = join(directory, 'job.json');
    await writeFile(job, JSON.stringify({ chapters: 2, volumes: [{ input: 'source.txt', workspace }] }));
    const home = join(directory, 'home');
    assert.equal(await run(job, home), 1);
    const manifest = JSON.parse(await readFile(join(home, 'runtime/NOVEL_JOB.json'), 'utf8'));
    assert.deepEqual(manifest.volumes[0].blocks.map(block => block.id), ['b0002']);
    assert.equal(manifest.volumes[0].maxBlocks, 2);
    const chapters = JSON.parse(await readFile(join(manifest.volumes[0].metadataDirectory, 'chapters.json'), 'utf8'));
    assert.deepEqual(chapters.map(chapter => chapter.blockIds), [['b0001'], ['b0002']]);
    await writeFile(join(workspace, 'source/source.txt'), prefix.replace('original', 'changed'));
    const changedHome = join(directory, 'changed-home');
    assert.equal(await run(job, changedHome), 1);
    const attempt = (await readdir(join(changedHome, 'runtime'))).find(name => name.startsWith('stability-'));
    const error = JSON.parse(await readFile(join(changedHome, 'runtime', attempt, 'error.json'), 'utf8'));
    assert.match(error.reason, /Applied source prefix differs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('portable runner stops before any paid work without a key and releases its locks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-review-'));
  try {
    await writeFile(join(directory, 'source.txt'), 'Chapter 0\n\nA short synthetic test sentence.');
    const job = join(directory, 'job.json');
    await writeFile(job, JSON.stringify({ chapters: 1, volumes: [{ input: 'source.txt', workspace: 'novel' }] }));
    const home = join(directory, 'home');
    assert.equal(await run(job, home), 1);
    await assert.rejects(access(join(home, 'runtime/full-loop.lock')));
    await assert.rejects(access(join(directory, 'novel.pi-review.lock')));
    await assert.rejects(access(join(directory, 'novel')));
    const attempts = (await readdir(join(home, 'runtime'))).filter((name) => name.startsWith('stability-'));
    const error = JSON.parse(await readFile(join(home, 'runtime', attempts[0], 'error.json'), 'utf8'));
    assert.match(error.reason, /WORK_LLM_API_KEY is required/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an existing writer lock is never deleted or bypassed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-review-'));
  try {
    const home = join(directory, 'home');
    await mkdir(join(home, 'runtime'), { recursive: true });
    const lock = join(home, 'runtime/full-loop.lock');
    await writeFile(lock, 'existing-writer');
    const job = join(directory, 'job.json');
    await writeFile(job, JSON.stringify({ volumes: [{ input: 'unused.txt' }] }));
    assert.equal(await run(job, home), 1);
    assert.equal(await readFile(lock, 'utf8'), 'existing-writer');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
