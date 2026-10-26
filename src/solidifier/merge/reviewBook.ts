import { loadChangeSet } from "./changesetStore.js";
import { causalSource, causalityEvidence } from "../causality/evidence.js";
import type { Relation } from "../../ground/ontology/types.js";

export async function reviewBook(directory: string, id: string) {
  const packet = await loadChangeSet(directory, id);
  if (packet.reviewSource) return packet;
  if (!/^cs_causality_(agent|sweep)_\d+$/.test(id) || !packet.proposals.length || packet.proposals.some(proposal => proposal.kind !== "add_relation" || !["CAUSES", "CAUSED_BY"].includes((proposal.payload as Relation).type))) {
    throw new Error("Legacy packet needs a source-bound review adapter; it cannot bypass the shared fact gate.");
  }
  const wanted = new Set(packet.proposals.flatMap(proposal => proposal.provenance.sentenceIds));
  for (const proposal of packet.proposals) {
    const relation = proposal.payload as Relation;
    const proof = await causalityEvidence(directory, relation.fromId, relation.toId, { changesetId: id, limit: 1 });
    if (!proof.available) throw new Error("Causal review requires original evidence for both endpoints; hold missing provenance.");
    proof.requiredSentenceIds.forEach(sentence => wanted.add(sentence));
  }
  const source = await causalSource(directory);
  const reviewSource = source.sentences.filter(sentence => wanted.has(sentence.id));
  if (reviewSource.length !== wanted.size) throw new Error("Causal proposal references missing original sentences.");
  return { ...packet, reviewSource };
}
