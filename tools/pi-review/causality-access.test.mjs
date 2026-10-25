import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sectionBlock } from '../../dist/src/digger/intake/sectioning.js';
import { causalityEvidence } from '../../dist/src/solidifier/causality/evidence.js';
import { proposeCausalityLink } from '../../dist/src/cli/commands/extract/causalityCommands.js';
import { createCausalityAccess } from './causality-access.mjs';
import { reviewRevision } from './review-coverage.mjs';
import { snapshot } from './snapshot.mjs';

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'causal-review-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['ontology', 'source', 'changesets', 'runtime']) await mkdir(join(directory, folder));
  const original = '甲推倒了门。\n乙说：「门开了。」\n甲走了进去。';
  await writeFile(join(directory, 'source', 'novel.txt'), original);
  const sentences = sectionBlock(original, 0).sentences;
  assert.ok(sentences.length >= 3);
  const event = { id: 'ev_1', timelineId: 'tl_canon', chapterIndex: 0, chronologicalOrder: 0, summaryEn: '甲推倒门', eventType: 'action', importance: 0.5, primaryActors: ['char_a'], affectedCharacters: [], evidence: { sentenceIds: [sentences[0].id], text: sentences[0].text }, confidence: 1 };
  const scene = { id: 'sc_1', chapterIndex: 0, sentenceIds: sentences.map(sentence => sentence.id), charactersPresent: ['char_a'], charactersMentioned: [], locationId: null, turns: [], dialogues: [{ id: 'card_2', sentenceIds: [sentences[1].id], participantIds: ['char_a'], summary: '乙说门开了' }] };
  for (const [name, rows] of Object.entries({ entities: [], events: [event], scenes: [scene], relations: [], 'state-changes': [] })) await writeFile(join(directory, 'ontology', `${name}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n'));
  await writeFile(join(directory, 'runtime', 'chapters.json'), JSON.stringify([{ index: 0, title: '序章', blockIds: ['b0001'] }]));
  const proposed = await proposeCausalityLink(directory, 'ev_1', 'card_2', { reason: 'synthetic test only' });
  const packet = JSON.parse(await readFile(join(directory, 'changesets', `${proposed.changesetId}.json`), 'utf8'));
  return { directory, packet, original, sentences };
}

test('standalone causal approval requires both original endpoints, full packet review, and fresh reads', async context => {
  const { directory, packet } = await fixture(context);
  const access = createCausalityAccess();
  assert.deepEqual(await access.changesetIds(directory), [packet.id]);
  const options = { skillsRead: true, coverage: { revision: reviewRevision(packet), proposals: new Set([0]), notes: new Set([0]) } };
  await assert.rejects(() => access.requireReview(directory, packet, options), /BOTH causal endpoints/);
  const first = await causalityEvidence(directory, 'ev_1', 'card_2', { changesetId: packet.id, limit: 1 });
  assert.equal(first.available, true);
  assert.equal(first.from.kind, 'event');
  assert.equal(first.to.kind, 'dialogue');
  const args = ['causality', 'evidence', directory, 'ev_1', 'card_2', '--changeset', packet.id];
  await access.credit(args, JSON.stringify(first));
  await assert.rejects(() => access.requireReview(directory, packet, options), /BOTH causal endpoints/);
  let offset = 0;
  do {
    const page = await causalityEvidence(directory, 'ev_1', 'card_2', { changesetId: packet.id, offset, limit: 1 });
    await access.credit(args, JSON.stringify(page));
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.equal((await access.requireReview(directory, packet, options))[0].sourceSentences, 2);
  await assert.rejects(() => access.requireReview(directory, packet, { ...options, skillsRead: false }), /skill/);
  await assert.rejects(() => access.requireReview(directory, packet, { ...options, coverage: { ...options.coverage, proposals: new Set() } }), /ALL current/);
  const changed = { ...packet, createdAt: 'new revision' };
  await writeFile(join(directory, 'changesets', `${packet.id}.json`), JSON.stringify(changed));
  await assert.rejects(() => access.requireReview(directory, changed, { ...options, coverage: { ...options.coverage, revision: reviewRevision(changed) } }), /stale reads/);
});

test('missing provenance and spoofed evidence never earn review credit', async context => {
  const { directory, packet } = await fixture(context);
  const access = createCausalityAccess();
  const page = await causalityEvidence(directory, 'ev_1', 'card_2', { changesetId: packet.id });
  await access.credit(['causality', 'evidence', directory, 'ev_1', 'card_2', '--changeset', packet.id], JSON.stringify({ ...page, sentences: page.sentences.map(sentence => ({ ...sentence, text: 'fake' })) }));
  const options = { skillsRead: true, coverage: { revision: reviewRevision(packet), proposals: new Set([0]), notes: new Set([0]) } };
  await assert.rejects(() => access.requireReview(directory, packet, options), /BOTH/);
  await writeFile(join(directory, 'source', 'novel.txt'), 'Different original.');
  assert.equal((await causalityEvidence(directory, 'ev_1', 'card_2', { changesetId: packet.id })).available, false);
  await assert.rejects(() => access.requireReview(directory, packet, options), /missing provenance/);
  await writeFile(join(directory, 'changesets', 'cs_causality_sweep_999.json'), JSON.stringify({ ...packet, id: 'cs_causality_sweep_999', blockId: 'causality-sweep', proposals: [{ kind: 'upsert_entity', payload: {} }] }));
  assert.deepEqual(await access.changesetIds(directory), [packet.id]);
});

test('standalone pending and held causal edges project live onto their dialogue scene, not canon', async context => {
  const { directory, packet } = await fixture(context);
  let view = await snapshot(directory, join(directory, 'runtime'));
  assert.equal(view.world.causal.links.length, 1);
  assert.equal(view.world.causal.links[0].state, 'proposed');
  assert.equal(view.world.causal.dialogueScenes.card_2, 'sc_1');
  assert.equal(view.gates.find(gate => gate.id === packet.id).status, 'pending');
  await writeFile(join(directory, 'changesets', `${packet.id}.json`), JSON.stringify({ ...packet, status: 'held' }));
  view = await snapshot(directory, join(directory, 'runtime'));
  assert.equal(view.world.causal.links[0].state, 'held');
  assert.equal(view.counts.relations, 0);
});
