import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE, keepRun } from './export-strand-demo.mjs';

const record = (exportedAt, hits) => ({ kind: 'stage-simulation', version: 1, exportedAt, strand: { id: 'k', title: 'K' }, things: [], scenes: [{ id: 's1', events: Array.from({ length: hits }, () => ({ hit: { sphere: { x: 0, y: 0, z: 0, r: 1 } } })) }] });

test('simulation records are kept as versioned runs: never overwritten, the same outcome once, one accepted run where readers look', async (context) => {
  const folder = await mkdtemp(join(tmpdir(), 'strand-runs-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  // A strand recorded before runs existed.
  await writeFile(join(folder, 'k.json'), JSON.stringify(record('2026-10-29T02:14:00.000Z', 1)));
  await writeFile(join(folder, 'index.json'), JSON.stringify({ strands: { k: { file: 'k.json', title: 'K' } } }));
  const strand = { id: 'k', from: 's1', to: 's9', fork: null };

  const second = await keepRun(folder, strand, record('2026-10-29T10:00:00.000Z', 2), { inputs: 'abc' });
  assert.equal(second.fresh, true);
  assert.notEqual(second.accepted, second.run, 'the earlier record stays accepted until a run is accepted on purpose');
  let index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8'));
  assert.equal(index.version, 2);
  assert.deepEqual(index.strands.k.runs.map(run => [run.hits, run.engine, run.inputs]), [[1, null, null], [2, ENGINE, 'abc']], 'the old record is the first run');
  assert.equal(JSON.parse(await readFile(join(folder, 'k.json'), 'utf8')).scenes[0].events.length, 1, 'readers still see the accepted one');

  const again = await keepRun(folder, strand, record('2026-10-29T11:00:00.000Z', 2), { inputs: 'abc' });
  assert.deepEqual([again.fresh, again.run], [false, second.run], 'the same outcome exported again is the same run');

  const accepted = await keepRun(folder, strand, record('2026-10-29T12:00:00.000Z', 2), { inputs: 'abc', accept: true });
  assert.equal(accepted.accepted, second.run);
  index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8'));
  assert.equal(index.strands.k.hits, 2);
  const shown = JSON.parse(await readFile(join(folder, 'k.json'), 'utf8'));
  assert.deepEqual([shown.scenes[0].events.length, shown.run.id, shown.run.engine], [2, second.run, ENGINE], 'the accepted run, with what it was made from');
  assert.equal((await readdir(join(folder, 'runs', 'k'))).length, 2, 'every run kept, none overwritten');
});
