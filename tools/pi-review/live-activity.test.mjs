import test from 'node:test';
import assert from 'node:assert/strict';
import { liveActivity } from './live-activity.mjs';

const fixture = () => ({ processing: [], agent: [], drafts: [], changesets: [], interiors: { chapter_0: { nodes: [{ id: 'scene_1' }, { id: 'char_1' }], edges: [] } }, blockChapters: new Map([['b0001', 0]]) });
const time = index => `2026-10-24T00:00:0${index}.000Z`;
test('causal proposals touch both real endpoints and their actual chapters, including dialogue scene anchors', () => {
  const input = fixture();
  input.interiors.chapter_3 = { nodes: [{ id: 'event_3' }], edges: [] };
  input.changesets = [{ proposals: [{ id: 'causal', payload: { type: 'CAUSES', fromId: 'event_3', toId: 'card' } }] }];
  input.processing = [{ id: 'new', timestamp: time(4), event: { type: 'proposal.added', proposal: { id: 'causal', provenance: { patchId: 'causality-faculty' } } } }];
  const result = liveActivity({ ...input, dialogueScenes: { card: 'scene_1' } });
  assert.deepEqual(result.batch.nodeIds, ['event_3', 'scene_1']);
  assert.deepEqual(result.batch.chapterIds.sort(), ['chapter_0', 'chapter_3']);
});
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

test('actual Pi review metadata highlights proposal targets without claiming a graph mutation or acceptance', () => {
  const input = fixture();
  input.agent = [{ type: 'pi.status', status: 'working', timestamp: time(1) }];
  input.changesets = [{ proposals: [{ id: 'proposal', payload: { id: 'scene_1' } }] }];
  const focus = { id: 'read', timestamp: time(2), volume: 1, chapterIndex: 0, blockId: 'b0001', changesetId: 'cs_b0001', phase: 'facts', status: 'ok', factIds: ['proposal/presence'], offset: 20, pageCount: 2, total: 100, privateReason: 'PRIVATE-REASON' };
  const activity = liveActivity({ ...input, reviewProgress: focus });
  assert.equal(activity.review.active, true);
  assert.deepEqual(activity.review.nodeIds, ['scene_1']);
  assert.equal(activity.count, 0);
  assert.equal(activity.latestTouch, null);
  assert.match(activity.phase, /21–22 \/ 100/);
  assert.ok(!JSON.stringify(activity).includes('PRIVATE-REASON'));
  input.agent.push({ type: 'pi.status', status: 'idle', timestamp: time(3) });
  assert.equal(liveActivity({ ...input, reviewProgress: focus }).review.active, false);
});

test('working faculties carry their block, chapter and newest draft scene, and stay live briefly after quick calls', () => {
  const input = fixture();
  input.interiors.chapter_0.nodes.push({ id: 'draft:b0001:scene:12' }, { id: 'draft:b0001:scene:4' }, { id: 'draft:b0001:dialogue:12' });
  input.blockChapters.set('b0002', 3);
  input.processing = [
    { id: '1', timestamp: time(1), event: { type: 'faculty.activity', blockId: 'b0001', callId: 'a', faculty: 'speaker', system: 'system1', status: 'started' } },
    { id: '2', timestamp: time(2), event: { type: 'faculty.activity', blockId: 'b0001', callId: 'a', faculty: 'speaker', system: 'system1', status: 'completed' } },
    { id: '3', timestamp: time(3), event: { type: 'faculty.activity', blockId: 'b0002', callId: 'b', faculty: 'scene-understanding', system: 'work', status: 'started' } },
  ];
  const result = liveActivity({ ...input, now: Date.parse(time(4)) });
  const speaker = result.faculties.find(row => row.faculty === 'speaker');
  assert.equal(speaker.active, 0);
  assert.equal(speaker.recent, true, 'a call that just finished still shows');
  assert.equal(speaker.chapterId, 'chapter_0');
  assert.deepEqual(speaker.anchorIds, ['draft:b0001:scene:12'], 'newest draft scene of the block');
  const reading = result.faculties.find(row => row.faculty === 'scene-understanding');
  assert.equal(reading.chapterId, 'chapter_3');
  assert.deepEqual(reading.anchorIds, [], 'no visible draft scene: chapter only');
  assert.equal(liveActivity({ ...input, now: Date.parse(time(1)) + 60000 }).faculties.find(row => row.faculty === 'speaker').recent, false);
  assert.equal(result.faculties.some(row => 'startedAt' in row), false);
});

test('resolved entity candidates become join events; unresolved and known ones do not', () => {
  const input = fixture();
  input.drafts = [{ blockId: 'b0001', updatedAt: time(5), stage: 'extraction', entityCandidates: [
    { key: 'character-abc', name: 'K', kind: 'Character', aliases: [], status: 'new', faculty: 'entities-participants', resolvedId: 'char_7' },
    { key: 'character-def', name: 'S', kind: 'Character', aliases: [], status: 'new', faculty: 'entities-participants' },
    { key: 'existing:char_1', name: 'R', kind: 'Character', aliases: [], status: 'existing', existingId: 'char_1', resolvedId: 'char_1', faculty: 'entities-participants' },
  ] }];
  const events = liveActivity(input).identityEvents;
  assert.deepEqual(events, [{ id: 'candidate:b0001:character-abc', timestamp: time(5), event: { type: 'candidate.resolved', keepId: 'char_7', dropId: 'draft:b0001:entity:character-abc' } }]);
});
