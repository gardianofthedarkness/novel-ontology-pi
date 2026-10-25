import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { semanticFacts, semanticRevision, validateStructure } from '../../dist/src/solidifier/merge/semantic.js';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyCounts = () => ({ facts: 0, acceptedUnchanged: 0, acceptedChanged: 0, rejected: 0, explicitHolds: 0, unreviewed: 0, noopReplacements: 0, orderOnlyReplacements: 0, changedStateFields: {} });
const sameSet = (first, second) => Array.isArray(first) && Array.isArray(second) && isDeepStrictEqual([...first].sort(), [...second].sort());
const sameValue = (fact, value) => {
  if (['presence', 'mention'].includes(fact.field)) return sameSet(fact.value, value);
  if (fact.field === 'actors') return sameSet(fact.value.primaryActors, value?.primaryActors) && sameSet(fact.value.affectedCharacters, value?.affectedCharacters);
  return isDeepStrictEqual(fact.value, value);
};
const modeOf = packet => {
  const scenes = packet.proposals.filter(proposal => proposal.kind === 'create_scene').map(proposal => proposal.payload);
  const cards = scenes.some(scene => scene.dialogues?.length);
  const turns = scenes.some(scene => scene.turns?.length);
  return cards && turns ? 'mixed' : cards ? 'dialogue-card' : turns ? 'legacy-turn' : 'no-dialogue';
};
const fieldOf = fact => {
  if (fact.field === 'dialogue-member') return `dialogue-member:${fact.candidateOnly ? 'unresolved-candidate' : 'initially-assigned'}`;
  return fact.field === 'relation' ? `relation:${['CAUSES', 'CAUSED_BY', 'PARTICIPATES_IN', 'PRESENT_IN', 'MENTIONED_IN', 'LOCATED_AT', 'KNOWS', 'SPEAKS_TO', 'ADDRESSES', 'OWNS', 'MEMBER_OF', 'STATE_BEFORE', 'STATE_AFTER', 'FORKS_FROM', 'PRECEDES'].includes(fact.value.type) ? fact.value.type : 'other'}` : fact.field;
};
const stateFields = ['characterId', 'afterEventId', 'emotions', 'knowledgeAdd', 'goalsAdd', 'relationships', 'location', 'possessionsAdd', 'possessionsRemove'];

export function summarizeReviewImpact(packet, audit = []) {
  const facts = semanticFacts(packet);
  const decisions = new Map((packet.semanticReview?.decisions ?? []).map(decision => [decision.factId, decision]));
  const fields = {};
  for (const fact of facts) {
    const counts = fields[fieldOf(fact)] ??= emptyCounts();
    counts.facts++;
    const decision = decisions.get(fact.id);
    if (!decision) counts.unreviewed++;
    else if (decision.verdict === 'hold') counts.explicitHolds++;
    else if (decision.verdict === 'reject') counts.rejected++;
    else if (decision.verdict === 'accept') {
      if (!('replacement' in decision) || sameValue(fact, decision.replacement)) {
        counts.acceptedUnchanged++;
        if ('replacement' in decision) {
          counts.noopReplacements++;
          if (!isDeepStrictEqual(fact.value, decision.replacement)) counts.orderOnlyReplacements++;
        }
      } else {
        counts.acceptedChanged++;
        if (fact.field === 'state') for (const field of stateFields) {
          if (!isDeepStrictEqual(fact.value[field], decision.replacement?.[field])) counts.changedStateFields[field] = (counts.changedStateFields[field] ?? 0) + 1;
        }
      }
    } else throw new Error('Invalid review verdict');
  }
  const previous = new Map();
  const logs = { batches: 0, updates: 0, repeatedActions: 0, unknownFactUpdates: 0 };
  const byFact = new Map(facts.map(fact => [fact.id, fact]));
  for (const entry of audit) {
    if (entry.op !== 'review-facts' || entry.args?.changesetId !== packet.id || entry.args.revision !== packet.semanticReview?.revision) continue;
    logs.batches++;
    for (const decision of entry.args.decisions ?? []) {
      logs.updates++;
      const fact = byFact.get(decision.factId);
      if (!fact) { logs.unknownFactUpdates++; continue; }
      const last = previous.get(decision.factId);
      const replacement = 'replacement' in decision ? decision.replacement : decision.verdict === 'accept' && last?.verdict === 'accept' ? last.replacement : undefined;
      const action = { verdict: decision.verdict, replacement };
      if (last && last.verdict === action.verdict && (action.verdict !== 'accept' || sameValue({ ...fact, value: last.replacement ?? fact.value }, replacement ?? fact.value))) logs.repeatedActions++;
      previous.set(decision.factId, action);
    }
  }
  return { mode: modeOf(packet), fields, logs };
}

export async function auditReviewImpact(workspaces) {
  const result = { capturedAt: new Date().toISOString(), accuracy: null, interpretation: 'Interventions are not verified improvements. Holds and missing facts are not corrected facts. Modes and independent runs are separate; copied packets are deduplicated.', workspaces: [], excluded: { notApplied: 0, nonSemantic: 0, invalidStructure: 0, staleReview: 0, duplicateCopies: 0 }, modes: {} };
  const seen = new Map();
  const reads = [];
  for (const [index, workspace] of workspaces.entries()) {
    const names = (await readdir(`${workspace}/changesets`)).filter(name => /^cs_[^.]+\.json$/.test(name)).sort();
    const auditText = await readFile(`${workspace}/maintenance.jsonl`, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const audit = auditText.split('\n').filter(Boolean).map(JSON.parse);
    const eventsText = await readFile(`${workspace}/events.jsonl`, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const applications = new Set(eventsText.split('\n').filter(Boolean).map(JSON.parse).filter(entry => entry.event?.type === 'changeset.applied').map(entry => entry.event.changesetId));
    let appliedPackets = 0;
    for (const name of names) {
      const filename = `${workspace}/changesets/${name}`;
      const raw = await readFile(filename, 'utf8');
      const packet = JSON.parse(raw);
      if (packet.status !== 'approved') { result.excluded.notApplied++; continue; }
      if (!packet.reviewSource) { result.excluded.nonSemantic++; continue; }
      try { validateStructure(packet); } catch { result.excluded.invalidStructure++; continue; }
      if (!packet.semanticReview || packet.semanticReview.revision !== semanticRevision(packet)) { result.excluded.staleReview++; continue; }
      if (!applications.has(packet.id)) { result.excluded.notApplied++; continue; }
      const key = fingerprint({ id: packet.id, createdAt: packet.createdAt, proposals: packet.proposals, source: packet.reviewSource });
      const reviewHash = fingerprint(packet.semanticReview);
      if (seen.has(key)) {
        if (seen.get(key) !== reviewHash) throw new Error('Copied packets have conflicting review decisions; select one historical snapshot per extraction');
        result.excluded.duplicateCopies++;
        continue;
      }
      seen.set(key, reviewHash);
      reads.push({ filename, hash: fingerprint(raw) });
      const summary = summarizeReviewImpact(packet, audit);
      const group = result.modes[summary.mode] ??= { packets: 0, fields: {}, logs: { batches: 0, updates: 0, repeatedActions: 0, unknownFactUpdates: 0 } };
      group.packets++;
      appliedPackets++;
      for (const [field, counts] of Object.entries(summary.fields)) {
        const target = group.fields[field] ??= emptyCounts();
        for (const [metric, value] of Object.entries(counts)) {
          if (metric === 'changedStateFields') for (const [stateField, amount] of Object.entries(value)) target.changedStateFields[stateField] = (target.changedStateFields[stateField] ?? 0) + amount;
          else target[metric] += value;
        }
      }
      for (const [metric, count] of Object.entries(summary.logs)) group.logs[metric] += count;
    }
    result.workspaces.push({ index, appliedPackets });
  }
  for (const entry of reads) if (fingerprint(await readFile(entry.filename, 'utf8')) !== entry.hash) throw new Error('An applied packet changed during capture; retry against an immutable snapshot');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspaces = process.argv.slice(2);
  if (!workspaces.length) throw new Error('Usage: node tools/pi-review/review-impact.mjs <workspace> [workspace ...]');
  process.stdout.write(`${JSON.stringify(await auditReviewImpact(workspaces), null, 2)}\n`);
}
