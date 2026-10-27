import { reviewRevision } from './review-coverage.mjs';

export function requireSharedReviewSkills(args, loaded, packet) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'book';
  // Cross-book causal packets (uc_) need the causality reference; universe atlas packets (ua_) do not.
  const causal = scope === 'universe' && !String(args[3] ?? '').startsWith('ua_') || packet?.proposals.some(proposal => proposal.kind === 'add_relation' && ['CAUSES', 'CAUSED_BY'].includes(proposal.payload.type));
  if (scope !== 'library' && !loaded.ontology || scope !== 'book' && !loaded.library || scope === 'library' && !loaded.schema || causal && !loaded.causality) throw new Error('Read the assigned review skill and relevant source/domain reference before using the shared gate');
  return scope;
}

export function sharedReviewReceipt(args, outcome, volume, packet, timestamp = new Date().toISOString()) {
  return { ...outcome.proof, policy: 'review-v1', operation: args[1], scope: outcome.scope, packetId: args[3], revision: outcome.revision, volume: volume?.id ?? null,
    ...(packet ? { blockId: args[3].replace(/^cs_/, ''), packetRevision: reviewRevision(packet) } : {}),
    accepted: outcome.accepted, verified: outcome.verified, held: outcome.held, rejected: outcome.rejected, deferredProposals: outcome.deferredProposals, applied: outcome.applied, timestamp };
}
