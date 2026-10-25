import { readFile, readdir } from 'node:fs/promises';
import { causalityEvidence } from '../../dist/src/solidifier/causality/evidence.js';
import { semanticFacts } from '../../dist/src/solidifier/merge/semantic.js';
import { reviewRevision } from './review-coverage.mjs';

const standaloneId = /^cs_causality_(agent|sweep)_\d+$/;
const causal = relation => ['CAUSES', 'CAUSED_BY'].includes(relation?.type);
const key = (workspace, changesetId, fromId, toId) => JSON.stringify([workspace, changesetId, fromId, toId]);

export function createCausalityAccess() {
  const evidence = new Map();
  return {
    async changesetIds(workspace) {
      const names = await readdir(`${workspace}/changesets`).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const ids = [];
      for (const name of names.filter(name => standaloneId.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))) {
        const packet = JSON.parse(await readFile(`${workspace}/changesets/${name}`, 'utf8'));
        if (packet.id !== name.slice(0, -5) || packet.blockId !== `causality-${packet.id.split('_')[2]}` || packet.reviewSource || !packet.proposals?.length || !packet.proposals.every(proposal => proposal.kind === 'add_relation' && causal(proposal.payload))) continue;
        ids.push(packet.id);
      }
      return ids;
    },
    async credit(args, output) {
      if (args[0] !== 'causality' || args[1] !== 'evidence' || !args.includes('--changeset')) return;
      const page = JSON.parse(output);
      const changesetId = args[args.indexOf('--changeset') + 1];
      const actual = await causalityEvidence(args[2], args[3], args[4], { changesetId, offset: page.page.offset, limit: page.page.limit });
      if (!actual.available || JSON.stringify(page) !== JSON.stringify(actual)) return;
      const address = key(args[2], changesetId, args[3], args[4]);
      const previous = evidence.get(address);
      const coverage = previous?.revision === actual.revision ? previous : { revision: actual.revision, sentenceIds: new Set() };
      for (const sentence of actual.sentences) coverage.sentenceIds.add(sentence.id);
      evidence.set(address, coverage);
    },
    async requireReview(workspace, packet, { skillsRead, coverage, decisions } = {}) {
      const standalone = standaloneId.test(packet.id);
      if (standalone && (!skillsRead || coverage?.revision !== reviewRevision(packet) || coverage.proposals.size !== packet.proposals.length || coverage.notes.size !== Object.keys(packet.reviewNotes).length)) throw new Error('Read the ontology skill, causality reference, and ALL current proposal/note pages before causal approval');
      const reviewed = packet.reviewSource ? semanticFacts(packet).filter(fact => fact.field === 'relation').flatMap(fact => {
        const decision = (decisions ?? packet.semanticReview?.decisions ?? []).find(entry => entry.factId === fact.id);
        return decision?.verdict === 'accept' ? [decision.replacement ?? fact.value] : [];
      }) : packet.proposals.filter(proposal => proposal.kind === 'add_relation').map(proposal => proposal.payload);
      const proof = [];
      for (const relation of reviewed.filter(causal)) {
        const actual = await causalityEvidence(workspace, relation.fromId, relation.toId, { changesetId: packet.id, limit: 1 });
        const covered = evidence.get(key(workspace, packet.id, relation.fromId, relation.toId));
        if (!skillsRead || !actual.available || covered?.revision !== actual.revision || actual.requiredSentenceIds.some(id => !covered.sentenceIds.has(id))) throw new Error('Read current original evidence for BOTH causal endpoints, using causality evidence --changeset; missing provenance or stale reads cannot be approved');
        proof.push({ fromId: relation.fromId, toId: relation.toId, revision: actual.revision, sourceSentences: actual.requiredSentenceIds.length });
      }
      return proof;
    },
  };
}
