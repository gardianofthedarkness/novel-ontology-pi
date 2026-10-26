import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timePlaceChangesetIds } from './timeplace-access.mjs';

test('only source-bound time-place packets are reviewable by Pi', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tp-access-'));
  await mkdir(join(workspace, 'changesets'));
  const packet = (id, extra = {}) => writeFile(join(workspace, 'changesets', `${id}.json`), JSON.stringify({ id, blockId: 'time-place', status: 'pending_review', reviewSource: [{ id: 'b0000_s0000', text: '夜。' }], proposals: [{ id: 'p1', kind: 'upsert_entity', payload: { id: 't1', kind: 'TimePoint' } }, { id: 'p2', kind: 'add_relation', payload: { type: 'OCCURS_DURING', fromId: 's1', toId: 't1' } }], ...extra }));
  await packet('cs_timeplace_time-place_1');
  await packet('cs_timeplace_time-place_2', { reviewSource: [] });
  await packet('cs_timeplace_time-place_3', { proposals: [{ id: 'p', kind: 'add_relation', payload: { type: 'CAUSES', fromId: 'a', toId: 'b' } }] });
  await packet('cs_b0001');
  assert.deepEqual(await timePlaceChangesetIds(workspace), ['cs_timeplace_time-place_1']);
  assert.deepEqual(await timePlaceChangesetIds(join(workspace, 'missing')), []);
  await rm(workspace, { recursive: true, force: true });
});
