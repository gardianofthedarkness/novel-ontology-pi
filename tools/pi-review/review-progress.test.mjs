import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewTracker, sessionReviewProgress } from './review-progress.mjs';

const volumes = [{ id: 2, workspace: '/private/book-2', input: '/private/book-2.txt', maxBlocks: 2, blocks: [{ id: 'b0001', chapterIndex: 3, evidence: '/private/evidence.txt', lines: 300 }] }];
const request = (id, command) => ({ type: 'message', timestamp: '2026-10-25T03:20:01Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE-REASONING' }, { type: 'toolCall', id, name: 'bash', arguments: { command } }] } });
const result = (id, value, isError = false) => ({ type: 'message', timestamp: '2026-10-25T03:20:02Z', message: { role: 'toolResult', toolCallId: id, isError, content: [{ type: 'text', text: JSON.stringify(value) }] } });
const command = "novel changeset facts '/private/book-2' cs_b0001 --offset 20 --limit 20";
const page = revision => ({ id: 'cs_b0001', revision, totalFacts: 100, accepted: 7, rejected: 2, explicitHolds: 1, unreviewed: 90, page: { offset: 20, limit: 2, total: 100 }, facts: [{ id: 'proposal-1/identity', field: 'identity', value: 'PRIVATE-VALUE' }, { id: 'proposal-2/dialogue-member/card/person', field: 'dialogue-member', value: 'PRIVATE-VALUE' }], evidence: { sentence: 'PRIVATE-SOURCE' }, labels: { person: 'PRIVATE-NAME' }, reason: 'PRIVATE-REASON' });

test('shared show/evidence/decide/apply retain safe live review focus and counts', () => {
  const tracker = createReviewTracker(volumes);
  tracker.consume(request('read', "novel review show '/private/book-2' cs_b0001 --scope book --offset 20 --limit 20"));
  const shown = tracker.consume(result('read', { ...page('a'.repeat(64)), policy: 'review-v1', scope: 'book', held: 91 }));
  assert.equal(shown.phase, 'facts');
  assert.equal(shown.inspectedFacts, 2);
  assert.equal(shown.held, 91);
  tracker.consume(request('evidence', "novel review evidence '/private/book-2' cs_b0001 --scope book --fact 'proposal-1/identity' --offset 0 --limit 10"));
  assert.equal(tracker.consume(result('evidence', { id: 'cs_b0001', revision: 'a'.repeat(64), factId: 'proposal-1/identity', sentences: [{ id: 's1', text: 'PRIVATE-SOURCE' }], page: { offset: 0, total: 1 } })).phase, 'evidence');
  tracker.consume(request('apply', `novel review apply '/private/book-2' cs_b0001 --scope book --revision ${'a'.repeat(64)}`));
  const applied = tracker.consume(result('apply', { id: 'cs_b0001', revision: 'a'.repeat(64), applied: true, accepted: 7, held: 91, rejected: 2 }));
  assert.equal(applied.phase, 'approve');
  assert.ok(!JSON.stringify(applied).includes('PRIVATE-'));
});

test('review exposes actual packet/page/field metadata, not model reasoning, evidence or decisions payloads', () => {
  const tracker = createReviewTracker(volumes);
  assert.equal(tracker.consume(request('call-1', command)).status, 'requested');
  const focus = tracker.consume(result('call-1', page('a'.repeat(64))));
  assert.equal(focus.volume, 2);
  assert.equal(focus.chapterIndex, 3);
  assert.equal(focus.offset, 20);
  assert.equal(focus.pageCount, 2);
  assert.equal(focus.total, 100);
  assert.equal(focus.inspectedFacts, 2);
  assert.deepEqual(focus.fields, ['identity', 'dialogue-member']);
  assert.equal(focus.accepted, 7);
  assert.ok(!JSON.stringify(focus).includes('PRIVATE-'));
});

test('observed reads deduplicate within a revision and reset after a fresh revision; failed reads are not credited', () => {
  const tracker = createReviewTracker(volumes);
  for (const id of ['first', 'repeat']) {
    tracker.consume(request(id, command));
    assert.equal(tracker.consume(result(id, page('a'.repeat(64)))).inspectedFacts, 2);
  }
  tracker.consume(request('failed', command));
  assert.equal(tracker.consume(result('failed', page('a'.repeat(64)), true)).status, 'error');
  tracker.consume(request('fresh', command));
  const updated = page('b'.repeat(64));
  updated.facts = updated.facts.slice(0, 1);
  assert.equal(tracker.consume(result('fresh', updated)).inspectedFacts, 1);
  tracker.consume(request('oversized', command));
  assert.equal(tracker.consume(result('oversized', 'Output too large; this read was not credited.')).status, 'unavailable');
});

test('source locations and evidence are bounded; rejected commands and unrelated outputs have no review location', () => {
  const tracker = createReviewTracker(volumes);
  const source = tracker.consume(request('source', "sed -n '151,300p' '/private/evidence.txt'"));
  assert.equal(source.sourceStart, 151);
  assert.equal(source.sourceEnd, 300);
  tracker.consume(result('source', 'PRIVATE-SOURCE'));
  assert.equal(tracker.consume(request('bad', "cat '/Users/owner/.ssh/id_rsa'")), null);
  assert.equal(tracker.consume(result('bad', { secret: 'PRIVATE-KEY' })), null);
});

test('parallel requests remain labelled requested, not falsely claimed as simultaneous execution', () => {
  const tracker = createReviewTracker(volumes);
  tracker.consume(request('first', command));
  assert.equal(tracker.consume(request('second', command)).id, 'first');
  assert.equal(tracker.consume(result('first', page('a'.repeat(64)))).id, 'second');
  assert.equal(tracker.consume(result('second', page('a'.repeat(64)))).status, 'ok');
});

test('decision telemetry retains revision-scoped fact positions and total without exporting correction reasons', () => {
  const tracker = createReviewTracker(volumes);
  tracker.consume(request('read', command));
  tracker.consume(result('read', page('a'.repeat(64))));
  tracker.consume(request('decide', `novel changeset decide '/private/book-2' cs_b0001 --revision '${'a'.repeat(64)}' --decisions '[{"factId":"proposal-2/dialogue-member/card/person","verdict":"hold","reason":"PRIVATE-REASON"}]'`));
  const progress = tracker.consume(result('decide', { id: 'cs_b0001', revision: 'a'.repeat(64), verifiedFacts: 7, rejectedFacts: 2, deferredFacts: 91 }));
  assert.deepEqual(progress.factPositions, [22]);
  assert.equal(progress.totalFacts, 100);
  assert.equal(progress.inspectedFacts, 2);
  assert.deepEqual(progress.fields, ['dialogue-member']);
  assert.ok(!JSON.stringify(progress).includes('PRIVATE-REASON'));
});

test('journal observer handles partial records, appends and truncation without modifying the worker log', async () => {
  const home = await fs.mkdtemp(join(tmpdir(), 'pi-review-progress-'));
  const metadata = join(home, 'volume-2');
  try {
    await fs.mkdir(join(home, 'sessions'));
    await fs.writeFile(join(home, 'job.json'), JSON.stringify({ volumes }));
    const filename = join(home, 'sessions', 'session.jsonl');
    const line = JSON.stringify(result('first', page('a'.repeat(64))));
    await fs.writeFile(filename, `${JSON.stringify(request('first', command))}\n${line.slice(0, 40)}`);
    assert.equal((await sessionReviewProgress(metadata)).status, 'requested');
    await fs.appendFile(filename, `${line.slice(40)}\n`);
    const before = await fs.readFile(filename);
    const simultaneous = await Promise.all(Array.from({ length: 5 }, () => sessionReviewProgress(metadata)));
    assert.ok(simultaneous.every(progress => progress.inspectedFacts === 2));
    assert.deepEqual(await fs.readFile(filename), before);
    await fs.writeFile(filename, `${JSON.stringify(request('new', "sed -n '1,100p' '/private/evidence.txt'"))}\n`);
    assert.equal((await sessionReviewProgress(metadata)).id, 'new');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
