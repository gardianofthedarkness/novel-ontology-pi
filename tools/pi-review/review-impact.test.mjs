import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { semanticRevision } from '../../dist/src/solidifier/merge/semantic.js';
import { auditReviewImpact, summarizeReviewImpact } from './review-impact.mjs';

function packet() {
  const source = [{ id: 's1', text: 'PRIVATE ORIGINAL TEXT' }];
  const proposal = (id, kind, payload) => ({ id, kind, payload, confidence: 0.7, provenance: { blockId: 'b0001', patchId: 'extraction', sentenceIds: ['s1'] } });
  const result = { id: 'cs_b0001', blockId: 'b0001', createdAt: '2026-01-01T00:00:00Z', status: 'approved', reviewNotes: {}, reviewSource: source, proposals: [
    proposal('entity', 'upsert_entity', { id: 'char1', kind: 'Character', names: [{ text: 'PRIVATE NAME', kind: 'canonical', lang: 'en' }], properties: {}, confidence: 0.7 }),
    proposal('scene', 'create_scene', { id: 'scene1', chapterIndex: 0, sentenceIds: ['s1'], turns: [], dialogues: [{ id: 'card1', sentenceIds: ['s1'], participantIds: ['char1'], unresolvedParticipantIds: ['char2'] }], charactersPresent: ['char1', 'char2'], charactersMentioned: [], locationId: null }),
    proposal('state', 'set_state_change', { characterId: 'char1', afterEventId: 'evt1', emotions: { happy: 0.5 }, relationships: {}, location: null, knowledgeAdd: [], goalsAdd: [], possessionsAdd: [], possessionsRemove: [] }),
  ] };
  result.semanticReview = { version: 1, revision: semanticRevision(result), decisions: [] };
  return result;
}

test('review impact separates replacements, no-ops, rejects, holds and unreviewed without claiming accuracy', () => {
  const current = packet();
  current.semanticReview.decisions = [
    { factId: 'entity/identity', verdict: 'reject', reason: 'PRIVATE REASON' },
    { factId: 'scene/presence', verdict: 'accept', replacement: ['char2', 'char1'], reason: 'reordering' },
    { factId: 'scene/dialogue-member/card1/char1', verdict: 'accept', replacement: 'char3', reason: 'correction' },
    { factId: 'scene/dialogue-member/card1/char2', verdict: 'hold', reason: 'unknown' },
  ];
  const report = summarizeReviewImpact(current);
  assert.equal(report.mode, 'dialogue-card');
  assert.equal(report.fields.identity.rejected, 1);
  assert.equal(report.fields.presence.acceptedChanged, 0);
  assert.equal(report.fields.presence.orderOnlyReplacements, 1);
  assert.equal(report.fields['dialogue-member:initially-assigned'].acceptedChanged, 1);
  assert.equal(report.fields['dialogue-member:unresolved-candidate'].explicitHolds, 1);
  assert.equal(report.fields.state.unreviewed, 1);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
});

test('repeated log actions honor retained replacements and ignore stale revisions and reason-only changes', () => {
  const current = packet();
  const entry = decisions => ({ op: 'review-facts', args: { changesetId: current.id, revision: current.semanticReview.revision, decisions } });
  const decision = { factId: 'state/state', verdict: 'accept', replacement: { ...current.proposals[2].payload, characterId: 'char2' }, reason: 'one' };
  current.semanticReview.decisions = [decision];
  const report = summarizeReviewImpact(current, [entry([decision]), entry([{ ...decision, reason: 'two' }]), entry([{ factId: decision.factId, verdict: 'accept', reason: 'three' }]), { ...entry([decision]), args: { ...entry([]).args, revision: 'stale', decisions: [decision] } }]);
  assert.deepEqual(report.logs, { batches: 3, updates: 3, repeatedActions: 2, unknownFactUpdates: 0 });
  assert.equal(report.fields.state.acceptedChanged, 1);
  assert.deepEqual(report.fields.state.changedStateFields, { characterId: 1 });
});

test('offline capture deduplicates copied packets, excludes pending and stale work and never exposes source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-impact-'));
  try {
    const current = packet();
    for (const folder of ['first', 'copy']) {
      await mkdir(join(root, folder, 'changesets'), { recursive: true });
      await writeFile(join(root, folder, 'changesets', 'cs_b0001.json'), JSON.stringify(current));
      await writeFile(join(root, folder, 'events.jsonl'), JSON.stringify({ event: { type: 'changeset.applied', changesetId: current.id } }) + '\n');
    }
    await writeFile(join(root, 'first', 'changesets', 'cs_b0002.json'), JSON.stringify({ ...current, id: 'cs_b0002', status: 'held' }));
    await writeFile(join(root, 'first', 'changesets', 'cs_b0003.json'), JSON.stringify({ ...current, id: 'cs_b0003' }));
    const notApplied = { ...current, id: 'cs_b0004' };
    notApplied.semanticReview = { ...current.semanticReview, revision: semanticRevision(notApplied) };
    await writeFile(join(root, 'first', 'changesets', 'cs_b0004.json'), JSON.stringify(notApplied));
    await writeFile(join(root, 'first', 'changesets', 'cs_b0001.superseded-revision-old.json'), 'not an active packet');
    const report = await auditReviewImpact([join(root, 'first'), join(root, 'copy')]);
    assert.equal(report.accuracy, null);
    assert.equal(report.modes['dialogue-card'].packets, 1);
    assert.deepEqual(report.excluded, { notApplied: 2, nonSemantic: 0, invalidStructure: 0, staleReview: 1, duplicateCopies: 1 });
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|char1|s1|cs_b0001/);
    const conflicting = structuredClone(current);
    conflicting.semanticReview.decisions = [{ factId: 'entity/identity', verdict: 'hold', reason: 'different historical decision' }];
    await writeFile(join(root, 'copy', 'changesets', 'cs_b0001.json'), JSON.stringify(conflicting));
    await assert.rejects(auditReviewImpact([join(root, 'first'), join(root, 'copy')]), /conflicting review decisions/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('state content changes are separate from endpoint changes and legacy turns are not card results', () => {
  const current = packet();
  const scene = current.proposals[1].payload;
  delete scene.dialogues;
  scene.turns = [{ sentenceIds: ['s1'], speakerId: 'char1', addresseeId: null }];
  current.semanticReview.decisions = [{ factId: 'state/state', verdict: 'accept', replacement: { ...current.proposals[2].payload, emotions: {} }, reason: 'unsupported emotion' }];
  const report = summarizeReviewImpact(current);
  assert.equal(report.mode, 'legacy-turn');
  assert.equal(report.fields.turn.facts, 1);
  assert.deepEqual(report.fields.state.changedStateFields, { emotions: 1 });
  assert.equal(report.fields.state.acceptedChanged, 1);
});
