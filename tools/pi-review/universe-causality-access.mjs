import { loadUniverseContext, qualifyCausalUnit, universeCandidates, universeEvidence, universePacket } from '../../dist/src/solidifier/causality/universe.js';

export function createUniverseCausalityAccess(config) {
  const pages = new Map(), evidence = new Map(), candidates = new Set();
  const context = args => {
    if (!config || args[3] !== config.directory) throw new Error('Universe causality is outside the assigned library');
    return loadUniverseContext(config.directory, args[4], config);
  };
  const value = (args, name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  return {
    async before(args, skillsRead) {
      if (args[0] !== 'causality' || args[1] !== 'universe') return null;
      const current = await context(args);
      if (['propose', 'sweep'].includes(args[2]) && (!skillsRead || !candidates.has(current.revision) || value(args, '--revision') !== current.revision)) throw new Error('Read the ontology/library skills and causality reference, then the current universe candidates before proposing or sweeping');
      if (args[2] !== 'decide') return null;
      const inspected = await universePacket(current, args[5]);
      const covered = pages.get(args[5]);
      if (!skillsRead || inspected.stale || inspected.revision !== value(args, '--revision') || covered?.revision !== inspected.revision || covered.proposals.size !== inspected.packet.proposals.length) throw new Error('Read the skills/reference and EVERY current universe causal proposal before deciding');
      const decisions = JSON.parse(value(args, '--decisions'));
      const proofs = [];
      for (const decision of decisions.filter(decision => decision.verdict === 'accept')) {
        const proposal = inspected.packet.proposals.find(proposal => proposal.id === decision.proposalId);
        if (!proposal) throw new Error('Unknown causal proposal');
        const fromId = qualifyCausalUnit(proposal.from.sourceId, proposal.from.unitId), toId = qualifyCausalUnit(proposal.to.sourceId, proposal.to.unitId);
        const actual = await universeEvidence(current, fromId, toId, { packetId: args[5], limit: 1 });
        const observed = evidence.get(`${args[5]}:${proposal.id}`);
        if (!actual.available || observed?.revision !== actual.revision || actual.requiredSentenceIds.some(id => !observed.sentenceIds.has(id))) throw new Error('Read BOTH original book passages for this exact causal packet revision before accepting; missing, stale or spoofed evidence cannot count');
        proofs.push({ proposalId: proposal.id, revision: actual.revision, sourceSentences: actual.requiredSentenceIds.length });
      }
      return { policy: 'universe-causal-v1', packetId: args[5], revision: inspected.revision, inspectedProposals: covered.proposals.size, proofs };
    },
    async credit(args, output) {
      if (args[0] !== 'causality' || args[1] !== 'universe' || !['candidates', 'show', 'evidence'].includes(args[2])) return;
      const current = await context(args);
      const page = JSON.parse(output);
      if (args[2] === 'candidates') {
        const actual = await universeCandidates(current, Number(value(args, '--offset', 0)), Number(value(args, '--limit', 10)));
        if (JSON.stringify(actual) === JSON.stringify(page)) candidates.add(current.revision);
      } else if (args[2] === 'show') {
        const inspected = await universePacket(current, args[5]);
        const offset = Number(value(args, '--offset', 0)), limit = Number(value(args, '--limit', 10));
        if (inspected.stale || inspected.revision !== page.revision || JSON.stringify(page.proposals) !== JSON.stringify(inspected.packet.proposals.slice(offset, offset + limit))) return;
        const previous = pages.get(args[5]);
        const covered = previous?.revision === inspected.revision ? previous : { revision: inspected.revision, proposals: new Set() };
        for (const proposal of page.proposals) covered.proposals.add(proposal.id);
        pages.set(args[5], covered);
      } else if (args.includes('--packet')) {
        const packetId = value(args, '--packet');
        const actual = await universeEvidence(current, args[5], args[6], { packetId, offset: Number(value(args, '--offset', 0)), limit: Number(value(args, '--limit', 10)) });
        if (!actual.available || JSON.stringify(actual) !== JSON.stringify(page)) return;
        const inspected = await universePacket(current, packetId);
        const proposal = inspected.packet.proposals.find(proposal => qualifyCausalUnit(proposal.from.sourceId, proposal.from.unitId) === args[5] && qualifyCausalUnit(proposal.to.sourceId, proposal.to.unitId) === args[6]);
        const key = `${packetId}:${proposal.id}`;
        const previous = evidence.get(key);
        const covered = previous?.revision === actual.revision ? previous : { revision: actual.revision, sentenceIds: new Set() };
        for (const sentence of actual.sentences) covered.sentenceIds.add(sentence.id);
        evidence.set(key, covered);
      }
    },
  };
}
