import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveFrames, livePicture, liveState, playableRuns, simulationLivePage, simulationPage, simulationVendor } from './sim-play.mjs';

test('the player plays each line\'s accepted run, with exactly its own inline scripts allowed and three.js served from the app', async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), 'sim-play-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal(await simulationPage(workspace), null, 'no runs: nothing to play');
  const folder = join(workspace, 'stage', 'simulation');
  await mkdir(join(folder, 'runs', 'line_a'), { recursive: true });
  const data = { title: 'Line A', places: {}, scenes: [], people: {}, things: [], notes: {} };
  await writeFile(join(folder, 'runs', 'line_a', 'r2.page.json'), JSON.stringify(data));
  await writeFile(join(folder, 'index.json'), JSON.stringify({ version: 2, strands: {
    line_a: { title: 'Line A', accepted: 'r2', runs: [{ id: 'r1', scenes: 3 }, { id: 'r2', scenes: 4, page: 'runs/line_a/r2.page.json' }] },
    // A run without the player's data, and a page path outside the runs folder, are never played.
    line_b: { title: 'Line B', accepted: 'r1', runs: [{ id: 'r1', scenes: 2 }] },
    line_c: { title: 'Line C', accepted: 'r1', runs: [{ id: 'r1', scenes: 2, page: '../../ontology/entities.jsonl' }] },
  } }));
  assert.deepEqual((await playableRuns(workspace)).map(run => [run.id, run.run, run.label]), [['line_a', 'r2', 'Line A · 4 scenes']]);
  const page = await simulationPage(workspace);
  assert.match(page.html, /"strands":\[\{"id":"line_a"/);
  assert.ok(page.html.includes('./vendor/three.module.js') && !page.html.includes('cdn.jsdelivr.net'), 'three.js beside the page, no CDN');
  const inline = [...page.html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  assert.ok(inline.length >= 2 && inline.every(hash => page.policy.includes(hash)), 'the import map and the player, by hash');
  assert.ok(!page.policy.match(/script-src ([^;]*)/)[1].includes('unsafe-inline'), 'scripts only by hash, never unsafe-inline');
  assert.ok((await simulationVendor('three.module.js')).length > 1000);
  assert.ok((await simulationVendor('addons/controls/OrbitControls.js')).length > 1000);
  for (const file of ['../package.json', 'three.cjs', 'addons/loaders/GLTFLoader.js']) assert.equal(await simulationVendor(file), null, file);
});

test('newest runs and the live page: the latest run of each line labelled when not accepted, the live record read safely', async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), 'sim-live-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const folder = join(workspace, 'stage', 'simulation');
  await mkdir(join(folder, 'runs', 'line_a'), { recursive: true });
  for (const id of ['r1', 'r2']) await writeFile(join(folder, 'runs', 'line_a', `${id}.page.json`), JSON.stringify({ title: id, places: {}, scenes: [], people: {}, things: [], notes: {} }));
  await writeFile(join(folder, 'index.json'), JSON.stringify({ version: 2, strands: { line_a: { title: 'Line A', accepted: 'r1', runs: [{ id: 'r1', scenes: 3, page: 'runs/line_a/r1.page.json' }, { id: 'r2', scenes: 3, page: 'runs/line_a/r2.page.json' }] } } }));
  assert.deepEqual((await playableRuns(workspace)).map(run => run.run), ['r1']);
  assert.deepEqual((await playableRuns(workspace, { newest: true })).map(run => [run.run, run.label]), [['r2', 'Line A · 3 scenes · newest run, not accepted']]);

  // Before any command the live record is idle; a running command whose process is gone is stopped; the pid never leaves the host.
  assert.deepEqual(await liveState(workspace), { status: 'idle' });
  assert.equal(await liveFrames(workspace), '');
  const record = { version: 2, command: 'pick', status: 'running', pid: process.pid, updatedAt: new Date().toISOString(), calls: 3, lines: [] };
  await writeFile(join(folder, 'live.json'), JSON.stringify(record));
  const { pid, ...shown } = record;
  assert.deepEqual(await liveState(workspace), shown);
  await writeFile(join(folder, 'live.json'), JSON.stringify({ ...record, pid: 2 ** 22 + 12345 }));
  assert.equal((await liveState(workspace)).status, 'stopped');
  await writeFile(join(folder, 'live.json'), JSON.stringify({ ...record, updatedAt: new Date(Date.now() - 3600000).toISOString() }));
  assert.equal((await liveState(workspace)).status, 'stopped', 'silent for an hour');
  const page = await simulationPage(workspace, { live: 'live?volume=1' });
  assert.match(page.html, /href="live\?volume=1"[^>]*>Replay Jev's picks<\/a>/);

  // Only recorded pictures, by their exact names.
  await mkdir(join(folder, 'live', 'frames'), { recursive: true });
  await writeFile(join(folder, 'live', 'frames', '7-1.jpg'), 'jpeg');
  assert.deepEqual(await livePicture(workspace, 'frames/7-1.jpg'), { body: Buffer.from('jpeg'), type: 'image/jpeg' });
  for (const file of ['frames/7-4.jpg', 'frames/../../index.json', '../live.json', 'frames/7-1.jpg.bak', 'frames/x-1.png']) assert.equal(await livePicture(workspace, file), null, file);

  const live = await simulationLivePage();
  const inline = [...live.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  assert.ok(inline.length === 1 && live.policy.includes(inline[0]) && !live.policy.match(/script-src ([^;]*)/)[1].includes('unsafe-inline'));
});
