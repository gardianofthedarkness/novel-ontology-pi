import test from 'node:test';
import assert from 'node:assert/strict';
import { liveActivity } from './live-activity.mjs';

const fixture = () => ({ processing: [], agent: [], drafts: [], changesets: [], interiors: { chapter_0: { nodes: [{ id: 'scene_1' }, { id: 'char_1' }], edges: [] } }, blockChapters: new Map([['b0001', 0]]) });
const time = index => `2026-10-24T00:00:0${index}.000Z`;
test('one refresh highlights every touched record since its cursor without replaying historical writes', () => {
  const input = fixture();
  input.processing = [
    { id: 'old', timestamp: time(1), event: { type: 'draft.updated', blockId: 'b0001', touchedIds: ['scene_1'] } },
    { id: 'a', timestamp: time(2), event: { type: 'draft.updated', blockId: 'b0001', touchedIds: ['scene_1', 'removed'], patchId: 'segmentation' } },
    { id: 'b', timestamp: time(3), event: { type: 'draft.updated', blockId: 'b0001', touchedIds: ['char_1'], patchId: 'identity' } },
  ];
  const batch = liveActivity({ ...input, afterId: 'old' });
  assert.deepEqual(batch.batch.nodeIds, ['scene_1', 'char_1']);
  assert.deepEqual(batch.batch.faculties, ['segmentation', 'identity']);
  assert.equal(batch.cursor, 'b');
  assert.equal(liveActivity({ ...input, afterId: 'b' }).batch, null);
  assert.deepEqual(liveActivity(input).batch.nodeIds, ['char_1']);
  assert.deepEqual(liveActivity({ ...input, afterId: 'expired-cursor' }).batch.nodeIds, ['char_1']);
});
test('live activity pairs concurrent S1/S2/work calls without confusing completed history with active work', () => {
  const input = fixture();
  input.agent = [{ provider: 'jev', call: 1, label: 'System 1 / Jev · scene-boundaries', status: 'working', timestamp: time(1) }, { provider: 'jev', call: 1, status: 'ok', timestamp: time(2) }];
  input.processing = [
    { id: '1', timestamp: time(3), event: { type: 'faculty.activity', blockId: 'b0001', callId: 'a', faculty: 'dialogue-participants', system: 'system2', status: 'started' } },
    { id: '2', timestamp: time(4), event: { type: 'faculty.activity', blockId: 'b0001', callId: 'b', faculty: 'dialogue-participants', system: 'system2', status: 'started' } },
    { id: '3', timestamp: time(5), event: { type: 'faculty.activity', blockId: 'b0001', callId: 'a', faculty: 'dialogue-participants', system: 'system2', status: 'completed' } },
  ];
  const result = liveActivity(input);
  const s2 = result.faculties.find(row => row.system === 'system2');
  assert.equal(s2.calls, 2);
  assert.equal(s2.active, 1);
  assert.equal(s2.status, 'working');
  assert.equal(result.faculties.find(row => row.system === 'jev').status, 'ok');
  assert.equal(result.telemetryNote, null);
});

test('latest touch follows actual log order, ignores removed IDs, and never exports payloads or review reasons', () => {
  const input = fixture();
  input.processing = [
    { id: '1', timestamp: time(1), event: { type: 'draft.updated', blockId: 'b0001', touchedIds: ['scene_1', 'char_1'], patchId: 'identity' } },
    { id: '2', timestamp: time(2), event: { type: 'draft.updated', blockId: 'b0001', touchedIds: ['removed'], patchId: 'identity' } },
    { id: '3', timestamp: time(3), event: { type: 'entity.merged', keepId: 'scene_1', dropId: 'gone', privateReason: 'PRIVATE-REASON' } },
  ];
  const result = liveActivity(input);
  assert.equal(result.latestTouch.nodeId, 'scene_1');
  assert.equal(result.latestTouch.timestamp, time(3));
  assert.equal(result.count, 3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-REASON'));
  assert.match(result.telemetryNote, /not separately identifiable/);
});
