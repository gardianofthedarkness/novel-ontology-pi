import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageObjectsChangesetIds, timePlaceChangesetIds } from './timeplace-access.mjs';

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

test('standalone-run packets carry the digit suffix the filter requires', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tp-access-standalone-'));
  await mkdir(join(workspace, 'changesets'));
  const packet = (id) => writeFile(join(workspace, 'changesets', `${id}.json`), JSON.stringify({ id, blockId: 'time-place', status: 'pending_review', reviewSource: [{ id: 'b0000_s0000', text: '夜。' }], proposals: [{ id: 'p1', kind: 'upsert_entity', payload: { id: 't1', kind: 'TimePoint' } }] }));
  // Real standalone-run id as produced by `novel timeplace run --propose`
  // (ISO stamp + epoch suffix); the pre-fix bare-stamp id ends in "Z" and
  // never passed the packetId filter, so hosted-Pi review refused it.
  await packet('cs_timeplace_2026-10-26T22-59-25-869Z_1761501565000');
  await packet('cs_timeplace_2026-10-26T22-59-25-869Z');
  assert.deepEqual(await timePlaceChangesetIds(workspace), ['cs_timeplace_2026-10-26T22-59-25-869Z_1761501565000']);
  await rm(workspace, { recursive: true, force: true });
});

test('place-tree sweep packets of PART_OF links are reviewable too', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tp-access-tree-'));
  await mkdir(join(workspace, 'changesets'));
  const packet = (id, blockId, type) => writeFile(join(workspace, 'changesets', `${id}.json`), JSON.stringify({ id, blockId, status: 'pending_review', reviewSource: [{ id: 'b0000_s0000', text: '城里的医院。' }], proposals: [{ id: 'p1', kind: 'add_relation', payload: { type, fromId: 'loc_a', toId: 'loc_b' } }] }));
  await packet('cs_timeplace_place-tree_1', 'place-tree', 'PART_OF');
  await packet('cs_timeplace_place-tree_2', 'other-faculty', 'PART_OF');
  await packet('cs_timeplace_place-tree_3', 'place-tree', 'KNOWS');
  assert.deepEqual(await timePlaceChangesetIds(workspace), ['cs_timeplace_place-tree_1']);
  await rm(workspace, { recursive: true, force: true });
});

test('stage-objects packets are reviewable only when they carry their sentences and hold only named buildings and things', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'objects-access-'));
  await mkdir(join(workspace, 'changesets'));
  const facts = [
    { id: 'so_ent_1', kind: 'upsert_entity', payload: { id: 'loc_obj_1', kind: 'Location', properties: { source: 'stage-objects' } } },
    { id: 'so_rel_1', kind: 'add_relation', payload: { type: 'PART_OF', fromId: 'loc_obj_1', toId: 'p7' } },
    { id: 'so_rel_2', kind: 'add_relation', payload: { type: 'MENTIONED_IN', fromId: 'item_obj_1', toId: 's1' } },
    { id: 'so_alias_1', kind: 'add_alias', payload: { entityId: 'item_1', aliasText: 'K.L.D.' } },
  ];
  const packet = (id, extra = {}) => writeFile(join(workspace, 'changesets', `${id}.json`), JSON.stringify({ id, blockId: 'stage-objects', status: 'pending_review', reviewSource: [{ id: 'b0000_s0000', text: '车站。' }], proposals: facts, ...extra }));
  await packet('cs_stage_objects_1');
  await packet('cs_stage_objects_2', { reviewSource: [] });
  await packet('cs_stage_objects_3', { proposals: [{ id: 'p', kind: 'upsert_entity', payload: { id: 'c1', kind: 'Character', properties: {} } }] });
  await packet('cs_stage_objects_4', { blockId: 'time-place' });
  await packet('cs_stage_objects_x');
  assert.deepEqual(await stageObjectsChangesetIds(workspace), ['cs_stage_objects_1']);
  assert.deepEqual(await timePlaceChangesetIds(workspace), [], 'never listed as time-place packets');
  await rm(workspace, { recursive: true, force: true });
});
