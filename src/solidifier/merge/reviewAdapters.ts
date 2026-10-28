import { libraryDecide, libraryEvidence, libraryPlan, libraryReviewItems, libraryShow, type OrganizationEvidence } from "../../ground/workspace/library.js";
import { loadUniverseContext, qualifyCausalUnit, universeBindings, universeDecide, universeEvidence, universePacket } from "../causality/universe.js";
import { causalityEvidence } from "../causality/evidence.js";
import { alreadyLinked, compareOrder, loadCausalityUniverse } from "../causality/units.js";
import { digest, materializeSemantic, semanticFacts, semanticRevision, validateStructure } from "./semantic.js";
import { semanticContext, decideFacts } from "./semanticCommands.js";
import { normalizeFactDecisions, semanticIdentityCodec } from "./semanticIdentity.js";
import { reviewBook } from "./reviewBook.js";
import { atlasContext, atlasDecide, atlasEvidence, atlasLinks, atlasPacket, atlasPacketApplied, atlasViolation } from "../atlas/universeAtlas.js";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import { treeViolation } from "../../ground/ontology/placeTree.js";
import { approveBook } from "./approve.js";
import { identityAdapter } from "../identity/review.js";
import { STANDALONE } from "../identity/cast.js";
import type { OntEvent, Relation, Scene } from "../../ground/ontology/types.js";
import type { ReviewAdapter, ReviewEvidence, ReviewFact, ReviewTarget } from "./reviewTypes.js";

async function book(target: ReviewTarget, env: NodeJS.ProcessEnv): Promise<ReviewAdapter> {
  // A standalone book's identity packets (universal EM): its own shared character list.
  if (target.packetId.startsWith("um_")) return identityAdapter(target.directory, STANDALONE, target.packetId, env);
  const packet = await reviewBook(target.directory, target.packetId);
  validateStructure(packet);
  const context = await semanticContext(target.directory);
  const causalContext = await loadCausalityUniverse(target.directory, {
    events: packet.proposals.filter(proposal => proposal.kind === "create_event").map(proposal => proposal.payload as OntEvent),
    scenes: packet.proposals.filter(proposal => proposal.kind === "create_scene").map(proposal => proposal.payload as Scene),
  });
  const semanticReviewRevision = semanticRevision(packet, digest(context));
  const codec = semanticIdentityCodec(packet, context.entities);
  const facts: ReviewFact[] = [];
  for (const fact of semanticFacts(packet)) {
    let evidence: ReviewEvidence[] = packet.reviewSource!.filter(sentence => fact.sentenceIds.includes(sentence.id));
    let requiredEvidence = fact.sentenceIds;
    const relation = fact.field === "relation" ? fact.value as Relation : null;
    const causal = relation && ["CAUSES", "CAUSED_BY"].includes(relation.type);
    if (causal) {
      evidence = [];
      let offset: number | null = 0;
      do {
        const page = await causalityEvidence(target.directory, relation.fromId, relation.toId, { changesetId: packet.id, offset, limit: 20 });
        if (!page.available) throw new Error("Both causal endpoints need original source evidence.");
        evidence.push(...page.sentences);
        requiredEvidence = page.requiredSentenceIds;
        offset = page.page.nextOffset;
      } while (offset !== null);
    }
    const meaning = causal && relation ? {
      type: relation.type,
      from: { summary: causalContext.byId.get(relation.fromId)?.summary, chapterIndex: causalContext.byId.get(relation.fromId)?.chapterIndex },
      to: { summary: causalContext.byId.get(relation.toId)?.summary, chapterIndex: causalContext.byId.get(relation.toId)?.chapterIndex },
    } : codec.meaning(fact);
    facts.push({ id: fact.id, field: fact.field, value: fact.value, meaning, evidence, requiredEvidence, requireAllEvidence: !!causal,
      ...(/^cs_causality_/.test(packet.id) ? { context: { proposal: packet.proposals.find(proposal => proposal.id === fact.proposalId), notes: packet.reviewNotes } } : {}) });
  }
  const validate: ReviewAdapter["validate"] = async decisions => {
    if (!["pending_review", "held", "revision_requested"].includes(packet.status)) throw new Error("Only pending packets can receive review decisions.");
    const normalized = normalizeFactDecisions(packet, context.entities, decisions);
    for (const decision of normalized) {
      const fact = facts.find(fact => fact.id === decision.factId)!;
      if (fact.field === "relation" && decision.replacement) {
        const original = fact.value as Relation, replacement = decision.replacement as Relation;
        if (original.fromId !== replacement.fromId || original.toId !== replacement.toId || original.type !== replacement.type) throw new Error("Relation endpoint/type corrections require a new evidence-bound proposal.");
      }
    }
    materializeSemantic({ ...packet, semanticReview: { version: 1, revision: semanticReviewRevision, contextDigest: digest(context), decisions: normalized } }, context.entities, context.objects);
    const adjacency = new Map<string, Set<string>>();
    const add = (from: string, to: string) => adjacency.set(from, new Set([...(adjacency.get(from) ?? []), to]));
    for (const relation of causalContext.relations) {
      if (relation.type === "CAUSES") add(relation.fromId, relation.toId);
      if (relation.type === "CAUSED_BY") add(relation.toId, relation.fromId);
    }
    for (const decision of normalized.filter(decision => decision.verdict === "accept")) {
      const fact = facts.find(fact => fact.id === decision.factId)!;
      const relation = fact.field === "relation" ? decision.replacement ?? fact.value : null;
      if (!relation || !["CAUSES", "CAUSED_BY"].includes((relation as Relation).type)) continue;
      const value = relation as Relation;
      const fromId = value.type === "CAUSES" ? value.fromId : value.toId, toId = value.type === "CAUSES" ? value.toId : value.fromId;
      const from = causalContext.byId.get(fromId), to = causalContext.byId.get(toId);
      if (!from || !to || fromId === toId || alreadyLinked(causalContext, fromId, toId) || compareOrder(from, to, causalContext) === 1) throw new Error("Causal endpoints are missing, already linked, or contradict novel-sequence direction.");
      const pending = [toId], visited = new Set<string>();
      while (pending.length) {
        const next = pending.pop()!;
        if (next === fromId) throw new Error("Acceptance creates a causal cycle; hold contradictory directions.");
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(...adjacency.get(next) ?? []);
      }
      add(fromId, toId);
    }
    // Places form a strict tree: accepted PART_OF links keep one parent per place and no loops.
    const accepted = normalized.filter(decision => decision.verdict === "accept").map(decision => (decision.replacement ?? facts.find(fact => fact.id === decision.factId)!.value) as Relation).filter(relation => relation?.type === "PART_OF");
    if (accepted.length) {
      const stored = await new BundleStore(join(target.directory, "ontology")).loadFile<Relation>("relations.jsonl");
      const violation = treeViolation(stored, accepted);
      if (violation) throw new Error(violation);
    }
    return normalized;
  };
  const revision = digest({ semanticReviewRevision, facts, relations: causalContext.relations, stateChanges: causalContext.stateChanges });
  return { revision, stale: false, applied: packet.status === "approved", facts, validate, requireFullReview: /^cs_causality_/.test(packet.id),
    async apply(decisions) {
      // The fact writer takes batches of at most 50: replace with the first, merge the rest.
      for (let start = 0; start === 0 || start < decisions.length; start += 50) await decideFacts(target.directory, packet.id, semanticReviewRevision, decisions.slice(start, start + 50), start === 0);
      const result = await approveBook(target.directory, packet.id, env);
      return { verified: result.verifiedFacts ?? 0, held: result.deferredFacts ?? 0, rejected: result.rejectedFacts ?? 0, deferredProposals: result.deferred, result };
    } };
}

/** Universe atlas packets (`ua_*`): cross-book place identity and containment. */
async function atlas(target: ReviewTarget, env: NodeJS.ProcessEnv): Promise<ReviewAdapter> {
  const context = await atlasContext(target.directory, target.universeId!, await universeBindings(env));
  const packet = await atlasPacket(target.directory, target.packetId);
  if (packet.universeId !== context.universeId) throw new Error("Packet belongs to another universe.");
  const stale = packet.revision !== context.revision;
  const label = (qualified: string) => { const place = context.byQualified.get(qualified); return { name: place?.label ?? null, book: context.books.find((book) => book.sourceId === place?.sourceId)?.title ?? null }; };
  const facts: ReviewFact[] = [];
  for (const proposal of packet.proposals) {
    const evidence = stale ? [] : await atlasEvidence(context, proposal);
    facts.push({ id: proposal.id, field: "relation", value: { type: proposal.kind === "same_place" ? "SAME_PLACE" : "PART_OF", from: proposal.a, to: proposal.b },
      meaning: { type: proposal.kind === "same_place" ? "SAME_PLACE" : "PART_OF", from: label(proposal.a), to: label(proposal.b), method: proposal.method, confidence: proposal.confidence },
      evidence, requiredEvidence: evidence.map((entry) => entry.id), requireAllEvidence: true, context: { proposal } });
  }
  return { revision: digest({ packet: packet.id, revision: context.revision }), stale, applied: await atlasPacketApplied(target.directory, packet.id), facts, requireFullReview: true,
    async validate(decisions) {
      if (decisions.some(decision => "replacement" in decision || "semanticReplacement" in decision)) throw new Error("Place links change only through a new evidence-bound proposal.");
      const accepted = (await atlasLinks(target.directory, context.universeId));
      const violation = atlasViolation(context, accepted, decisions.filter(decision => decision.verdict === "accept").map(decision => packet.proposals.find(proposal => proposal.id === decision.factId)!).filter(Boolean));
      if (violation) throw new Error(violation);
      return decisions;
    },
    async apply(decisions) {
      const result = await atlasDecide(context, packet.id, decisions.map(({ factId, verdict, reason }) => ({ proposalId: factId, verdict, reason })));
      return { verified: result.applied, held: result.held, rejected: result.rejected, deferredProposals: 0, result };
    } };
}

async function universe(target: ReviewTarget, env: NodeJS.ProcessEnv): Promise<ReviewAdapter> {
  if (!target.universeId) throw new Error("Universe review requires --universe <reviewed-universe-id>.");
  if (target.packetId.startsWith("ua_")) return atlas(target, env);
  if (target.packetId.startsWith("um_")) return identityAdapter(target.directory, target.universeId, target.packetId, env);
  const context = await loadUniverseContext(target.directory, target.universeId, await universeBindings(env));
  const data = await universePacket(context, target.packetId);
  const facts: ReviewFact[] = [];
  for (const proposal of data.packet.proposals) {
    const from = qualifyCausalUnit(proposal.from.sourceId, proposal.from.unitId), to = qualifyCausalUnit(proposal.to.sourceId, proposal.to.unitId);
    const evidence: ReviewEvidence[] = [];
    let requiredEvidence: string[] = [];
    let offset: number | null = 0;
    if (!data.stale) do {
      const page = await universeEvidence(context, from, to, { packetId: target.packetId, offset, limit: 20 });
      if (!page.available) throw new Error("Both book passages must be available for causal review.");
      evidence.push(...page.sentences);
      requiredEvidence = page.requiredSentenceIds;
      offset = page.page.nextOffset;
    } while (offset !== null);
    facts.push({ id: proposal.id, field: "relation", value: { type: "CAUSES", from, to },
      meaning: { type: "CAUSES", from: { title: context.universe.byId.get(from)?.origin?.title, summary: context.universe.byId.get(from)?.summary }, to: { title: context.universe.byId.get(to)?.origin?.title, summary: context.universe.byId.get(to)?.summary } },
      evidence, requiredEvidence, requireAllEvidence: true, temporalReasonRequired: true, context: { proposal } });
  }
  return { revision: data.revision, stale: data.stale, applied: data.decisions.some(decision => decision.verdict === "accept"), facts, requireFullReview: true,
    async validate(decisions) {
      if (decisions.some(decision => "replacement" in decision || "semanticReplacement" in decision)) throw new Error("Relation endpoint changes need a new evidence-bound proposal.");
      return decisions;
    },
    async apply(decisions) {
      const result = await universeDecide(context, target.packetId, data.revision, facts.map(fact => {
        const decision = decisions.find(entry => entry.factId === fact.id) ?? { factId: fact.id, verdict: "hold" as const, reason: "Unreviewed assertion; default hold." };
        const { factId, ...value } = decision;
        return { ...value, proposalId: factId };
      }));
      return { verified: result.applied, held: result.held, rejected: result.rejected, deferredProposals: 0, result };
    } };
}

async function library(target: ReviewTarget): Promise<ReviewAdapter> {
  const plan = await libraryPlan(target.directory, target.packetId);
  const catalog = await libraryShow(target.directory);
  const facts: ReviewFact[] = [];
  for (const [index, item] of libraryReviewItems(plan.organization).entries()) {
    const evidence: ReviewEvidence[] = [];
    for (const [supportIndex, support] of ((item.value as { evidence: OrganizationEvidence[] }).evidence ?? []).entries()) {
      const source = catalog.sources.find(source => source.id === support.sourceId);
      if (!source) throw new Error("Unknown organization evidence source.");
      let text: string;
      if (support.field === "text") {
        const original = await libraryEvidence(target.directory, source.id, support.offset, support.quote.length);
        if (original.text !== support.quote) throw new Error("Organization evidence changed.");
        text = original.text;
      } else {
        text = source[support.field];
        if (!text.includes(support.quote)) throw new Error("Organization metadata evidence changed.");
      }
      evidence.push({ id: `${source.id}:${support.field}:${index}:${supportIndex}`, text });
    }
    facts.push({ id: `organization:${index}`, field: item.type, value: item.value, meaning: item.value, evidence, requiredEvidence: evidence.map(entry => entry.id), requireAllEvidence: true });
  }
  return { revision: plan.revision, stale: plan.stale, applied: false, facts, requireFullReview: true,
    async validate(decisions) {
      if (decisions.some(decision => "replacement" in decision || "semanticReplacement" in decision)) throw new Error("Organization corrections require a new validated plan.");
      return decisions;
    },
    async apply(decisions) {
      const verdict = decisions.some(decision => decision.verdict === "reject") ? "reject" : facts.every(fact => decisions.some(decision => decision.factId === fact.id && decision.verdict === "accept")) ? "approve" : "hold";
      const result = await libraryDecide(target.directory, target.packetId, plan.revision, verdict, `Shared semantic gate: ${decisions.map(decision => decision.reason).join("; ").slice(0, 1800) || "Unreviewed organization remains held."}`);
      const rejected = decisions.filter(decision => decision.verdict === "reject").length;
      return { verified: result.appliedOrganization ? facts.length : 0, held: result.appliedOrganization ? 0 : facts.length - rejected, rejected, deferredProposals: 0, result };
    } };
}

const adapters = { book, universe, library };
export async function reviewAdapter(target: ReviewTarget, env: NodeJS.ProcessEnv = process.env): Promise<ReviewAdapter> {
  if (!Object.hasOwn(adapters, target.scope)) throw new Error("Unregistered review scope; register a shared-gate adapter, never a faculty-specific gate.");
  if (target.scope !== "universe" && target.universeId) throw new Error("--universe is only valid for universe scope.");
  return adapters[target.scope](target, env);
}
