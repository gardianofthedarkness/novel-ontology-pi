import { createHash } from "node:crypto";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import { buildGraphFromBundle } from "../../ground/connectors/ladybug.js";
import type { Entity } from "../../ground/ontology/types.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import { causalSource } from "../causality/evidence.js";
import type { ReviewAdapter, ReviewEvidence, ReviewFact } from "../merge/reviewTypes.js";
import { loadCast, markDistinct, memberRef, rootCastScope, saveCast, survivor, type CastScope } from "./cast.js";
import { loadIdentityPacket, mergeIdentity, saveIdentityPacket, type IdentityProposal } from "./afterApply.js";

/**
 * Identity review packets (`um_*`): matches universal EM was not confident
 * enough to make. Reviewed through the shared gate — `--scope universe
 * --universe <id>` at the library, or `--scope book` for a standalone book.
 * Accept makes the two one (audited merge inside a book; one person in the
 * shared list across books); reject remembers them as different people.
 */
const EVIDENCE_PER_SIDE = 2;
const fold = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];

export async function identityAdapter(root: string, universeId: string, packetId: string, env: NodeJS.ProcessEnv): Promise<ReviewAdapter> {
  const base = await rootCastScope(root, universeId, env);
  const packet = await loadIdentityPacket(base, packetId);
  if (packet.universeId !== base.universeId) throw new Error("Packet belongs to another universe.");
  const book = base.books.find((entry) => entry.sourceId === packet.sourceId);
  if (!book) throw new Error("The packet's book is not assigned to this host.");
  const scope: CastScope = { ...base, sourceId: packet.sourceId };
  const cast = await loadCast(scope);
  const entities = fold(await new BundleStore(join(book.workspace, "ontology")).loadFile<Entity>("entities.jsonl"));
  const sentenceCache = new Map<string, Sentence[]>();
  const sentencesOf = async (sourceId: string) => {
    if (!sentenceCache.has(sourceId)) { const workspace = base.books.find((entry) => entry.sourceId === sourceId)?.workspace; sentenceCache.set(sourceId, workspace ? await causalSource(workspace).then((source) => source.sentences).catch(() => []) : []); }
    return sentenceCache.get(sourceId)!;
  };
  const evidenceFor = async (sourceId: string, forms: string[]): Promise<ReviewEvidence[]> => {
    const usable = forms.filter((form) => [...form].length >= 2);
    return (await sentencesOf(sourceId)).filter((sentence) => usable.some((form) => sentence.text.includes(form))).slice(0, EVIDENCE_PER_SIDE).map((sentence) => ({ id: `${sourceId}:${sentence.id}`, text: sentence.text }));
  };
  const titleOf = (sourceId: string) => base.books.find((entry) => entry.sourceId === sourceId)?.title ?? sourceId;
  const describe = async (side: IdentityProposal["a"] | IdentityProposal["b"]) => {
    if ("kind" in side && side.kind === "person") {
      const person = cast.persons.find((entry) => entry.id === side.personId);
      const first = person?.members[0];
      return { meaning: person ? { name: person.name, forms: person.forms.map((form) => form.text), books: [...new Set(person.members.map((member) => titleOf(member.sourceId)))] } : null, evidence: person && first ? await evidenceFor(first.sourceId, person.forms.map((form) => form.text)) : [] };
    }
    const entity = entities.find((entry) => entry.id === survivor(cast, side.sourceId, side.entityId));
    return { meaning: entity ? { name: entity.names[0]?.text ?? entity.id, forms: entity.names.map((name) => name.text), books: [titleOf(side.sourceId)] } : null, evidence: entity ? await evidenceFor(side.sourceId, entity.names.map((name) => name.text)) : [] };
  };
  const facts: ReviewFact[] = [];
  let stale = false;
  for (const proposal of packet.proposals) {
    const [a, b] = [await describe(proposal.a), await describe(proposal.b)];
    if (!a.meaning || !b.meaning) stale = true;
    const evidence = [...a.evidence, ...b.evidence];
    facts.push({ id: proposal.id, field: "identity-match", value: { a: memberRef(proposal.a), b: proposal.b.kind === "person" ? `person:${proposal.b.personId}` : memberRef(proposal.b) },
      meaning: { question: "Are these the same character?", a: a.meaning, b: b.meaning, confidence: proposal.confidence, method: proposal.method, reason: proposal.reason },
      evidence, requiredEvidence: evidence.map((entry) => entry.id), requireAllEvidence: true, context: { proposal } });
  }
  const decided = new Set(packet.decisions.filter((decision) => decision.verdict !== "hold").map((decision) => decision.proposalId));
  return {
    revision: createHash("sha256").update(JSON.stringify({ packet: packet.id, decisions: packet.decisions, members: packet.proposals.map((proposal) => [proposal.a, proposal.b]), stale })).digest("hex"),
    stale, applied: packet.proposals.every((proposal) => decided.has(proposal.id)), facts, requireFullReview: true,
    async validate(decisions) {
      if (decisions.some((decision) => "replacement" in decision || "semanticReplacement" in decision)) throw new Error("Identity matches change only by accept, hold or reject.");
      return decisions;
    },
    async apply(decisions) {
      let verified = 0, held = 0, rejected = 0;
      let current = entities;
      for (const decision of decisions) {
        const proposal = packet.proposals.find((entry) => entry.id === decision.factId);
        if (!proposal || decided.has(proposal.id)) continue;
        if (decision.verdict === "accept") { current = (await mergeIdentity(book.workspace, scope, cast, current, proposal.a.entityId, proposal.b, proposal.confidence, "review", decision.reason)).entities; verified++; }
        else if (decision.verdict === "reject") { markDistinct(cast, memberRef(proposal.a), proposal.b.kind === "person" ? `person:${proposal.b.personId}` : memberRef(proposal.b), decision.reason); rejected++; }
        else held++;
        packet.decisions = [...packet.decisions.filter((entry) => entry.proposalId !== proposal.id), { proposalId: proposal.id, verdict: decision.verdict, reason: decision.reason, at: new Date().toISOString() }];
      }
      await saveCast(scope, cast);
      await saveIdentityPacket(scope, packet);
      if (verified) await buildGraphFromBundle(join(book.workspace, "ontology"), join(book.workspace, "ontology", "graph.lbug")).catch(() => undefined);
      return { verified, held, rejected, deferredProposals: 0, result: { packetId: packet.id, merged: verified, distinct: rejected, held } };
    },
  };
}
