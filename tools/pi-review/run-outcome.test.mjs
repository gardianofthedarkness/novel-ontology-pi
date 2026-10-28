import test from 'node:test';
import assert from 'node:assert/strict';
import { progressLine, runOutcome } from './run-outcome.mjs';

test('a hold is a pause with zero applications, never a completed run or fabricated deferral', () => {
  const result = runOutcome([{ id: 'cs_b0001', status: 'held' }], []);
  assert.equal(result.status, 'review');
  assert.match(result.label, /paused.*cs_b0001 held.*0\/2 chapters applied/);
  assert.ok(!result.label.includes('complete'));
  assert.equal(result.deferred, 0);
});

test('only recorded applications count and actual unsupported proposals remain explicit', () => {
  const changesets = [{ id: 'cs_b0001', status: 'approved' }, { id: 'cs_b0002', status: 'approved' }];
  const records = [{ event: { type: 'changeset.applied', changesetId: 'cs_b0001', unsupportedProposalIds: ['p1'] } }];
  assert.equal(runOutcome(changesets, records).status, 'review');
  records.push({ event: { type: 'changeset.applied', changesetId: 'cs_b0002', unsupportedProposalIds: [] } });
  const result = runOutcome(changesets, records);
  assert.equal(result.status, 'complete');
  assert.equal(result.deferred, 1);
  assert.match(result.label, /2\/2 chapters applied.*1 proposals deferred/);
});

test('processed blocks with held facts are not presented as fully verified review', () => {
  const result = runOutcome([{ id: 'cs_b0001', status: 'approved' }], [{ event: { type: 'changeset.applied', changesetId: 'cs_b0001', unsupportedProposalIds: [], deferredFactIds: ['emotion', 'relationship'] } }], 1);
  assert.equal(result.status, 'complete');
  assert.equal(result.heldFacts, 2);
  assert.match(result.label, /processing complete.*2 semantic facts held/);
  assert.ok(!result.label.includes('review complete'));
});

test('the after-turn line counts a book\'s blocks applied before the session, for the book Pi worked on and for all books', () => {
  // Vol 1 was complete before the session; vol 3 had 1 of 12 applied; vol 4 had none.
  const volumes = [{ id: 1, maxBlocks: 8, blocks: [] }, { id: 3, maxBlocks: 12, blocks: Array.from({ length: 11 }, (_, index) => ({ id: `b${index + 2}` })) }, { id: 4, maxBlocks: 10, blocks: Array.from({ length: 10 }, (_, index) => ({ id: `b${index + 1}` })) }];
  const states = [{ volume: 3, applied: true, deferredFacts: 2, deferred: 1 }, ...Array.from({ length: 20 }, () => ({ volume: 4, applied: false, deferredFacts: 0, deferred: 0 }))];
  assert.equal(progressLine(volumes, states, 1), 'Vol 1: 8/8 blocks applied · all 3 books: 10/30 · 2 semantic facts held · 1 proposals deferred');
  assert.match(progressLine(volumes, states, 3), /^Vol 3: 2\/12 blocks applied/);
  assert.equal(progressLine([volumes[0]], [], 1), 'Vol 1: 8/8 blocks applied · 0 semantic facts held · 0 proposals deferred');
});
