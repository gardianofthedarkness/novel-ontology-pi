import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { BundleStore } from "../connectors/bundle.js";
import { appendAudit } from "../maintenance/fixes.js";
import type { Entity } from "../ontology/types.js";
import { loadChangeSet, saveChangeSet } from "./changesetStore.js";
import type { ChangeSet } from "./changeset.js";
import { digest, factEvidence, materializeSemantic, semanticFacts, semanticRevision, validateStructure, type FactDecision } from "./semantic.js";

export async function semanticContext(novelDir: string) {
  const store = new BundleStore(join(novelDir, "ontology"));
  const entities = [...new Map((await store.loadFile<Entity>("entities.jsonl")).map(entity => [entity.id, entity])).values()];
  const objects: { id: string; kind: string }[] = [];
  for (const [file, kind] of [["events", "Event"], ["scenes", "Scene"], ["timelines", "Timeline"], ["branches", "Branch"]]) {
    for (const object of await store.loadFile<{ id: string }>(`${file}.jsonl`)) objects.push({ id: object.id, kind });
  }
  return { entities, objects: [...new Map(objects.map(object => [object.id, object])).values()] };
}

export async function semanticPage(novelDir: string, id: string, options: { offset?: number; limit?: number; factId?: string; summary?: boolean } = {}) {
  const changeset = await loadChangeSet(novelDir, id);
  validateStructure(changeset);
  const facts = semanticFacts(changeset);
  const context = await semanticContext(novelDir);
  const revision = semanticRevision(changeset, changeset.status === "approved" ? changeset.semanticReview?.contextDigest : digest(context));
  const { entities } = context;
  const names = new Map(entities.map(entity => [entity.id, entity.names.map(name => name.text)]));
  for (const proposal of changeset.proposals) if (proposal.kind === "upsert_entity") names.set((proposal.payload as Entity).id, (proposal.payload as Entity).names.map(name => name.text));
  const decisions = changeset.semanticReview?.revision === revision ? changeset.semanticReview.decisions : [];
  const log = await readFile(join(novelDir, "events.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
  const application = log.split("\n").filter(Boolean).map(line => JSON.parse(line)).reverse().find(record => record.event.type === "changeset.applied" && record.event.changesetId === id)?.event as { deferredFactIds?: string[]; verifiedFacts?: number } | undefined;
  const materialization = (factId: string) => !application ? "pending" : application.deferredFactIds?.includes(factId) ? "held" : decisions.find(decision => decision.factId === factId)?.verdict === "accept" ? "verified" : "rejected";
  const base = { id, revision, policy: "semantic-v1", totalFacts: facts.length, accepted: decisions.filter(decision => decision.verdict === "accept").length, rejected: decisions.filter(decision => decision.verdict === "reject").length, heldFacts: application?.deferredFactIds?.length ?? null, verifiedFacts: application?.verifiedFacts ?? null, defaultVerdict: "hold", structure: "code-validated; segmentation and small event detection are not semantic review targets" };
  if (options.summary) return base;
  if (options.factId) {
    const fact = facts.find(fact => fact.id === options.factId);
    if (!fact) throw new Error("Unknown semantic fact");
    return { ...base, factId: fact.id, materialization: materialization(fact.id), ...factEvidence(fact, changeset.reviewSource!, options.offset, options.limit) };
  }
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Fact pages require offset >= 0 and limit 1..50");
  const page: unknown[] = [];
  let pageLabels: Record<string, string[]> = {};
  let pageEvidence: Record<string, string> = {};
  let pageEvents: Record<string, unknown> = {};
  for (const fact of facts.slice(offset, offset + limit)) {
    const evidence = factEvidence(fact, changeset.reviewSource!, 0, 3);
    const decision = decisions.find(decision => decision.factId === fact.id);
    const reviewedValue = decision && "replacement" in decision ? decision.replacement : fact.value;
    const relevant = JSON.stringify([fact.value, reviewedValue]);
    const labels = Object.fromEntries([...names].filter(([entityId]) => relevant.includes(JSON.stringify(entityId))));
    const events = changeset.proposals.filter(proposal => proposal.kind === "create_event" && (proposal.id === fact.proposalId || relevant.includes(JSON.stringify((proposal.payload as { id: string }).id)))).map(proposal => {
      const event = proposal.payload as { id: string; eventType: string; summaryEn: string };
      return { id: event.id, eventType: event.eventType, derivedSummary: event.summaryEn };
    });
    const canonicalIdentity = fact.field === "identity" ? entities.find(entity => entity.id === (fact.value as Entity).id) : undefined;
    const row = { id: fact.id, field: fact.field, value: reviewedValue, ...(decision && "replacement" in decision ? { originalCandidate: fact.value } : {}), canonicalIdentity,
      sourceRange: { first: fact.sentenceIds[0] ?? null, last: fact.sentenceIds.at(-1) ?? null, count: fact.sentenceIds.length },
      eventIds: events.map(event => event.id), evidenceIds: evidence.sentences.map(sentence => sentence.id), evidencePage: evidence.page,
      verdict: decision?.verdict ?? "hold", materialization: materialization(fact.id) };
    const nextLabels = { ...pageLabels, ...labels };
    const nextEvidence = { ...pageEvidence, ...Object.fromEntries(evidence.sentences.map(sentence => [sentence.id, sentence.text])) };
    const nextEvents = { ...pageEvents, ...Object.fromEntries(events.map(event => [event.id, event])) };
    if (Buffer.byteLength(JSON.stringify({ ...base, labels: nextLabels, evidence: nextEvidence, events: nextEvents, facts: [...page, row] })) > 27500) break;
    page.push(row);
    pageLabels = nextLabels; pageEvidence = nextEvidence; pageEvents = nextEvents;
  }
  if (!page.length && facts.length > offset) throw new Error("One fact exceeds the review byte budget; hold it rather than truncating its value");
  return { ...base, labels: pageLabels, evidence: pageEvidence, events: pageEvents, facts: page, page: { offset, limit: page.length, total: facts.length, nextOffset: offset + page.length < facts.length ? offset + page.length : null } };
}

export async function decideFacts(novelDir: string, id: string, revision: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Decisions must be a batch of at most 50 fact decisions");
  const changeset = await loadChangeSet(novelDir, id);
  if (!["held", "pending_review", "revision_requested"].includes(changeset.status)) throw new Error("Only pending packets can receive fact decisions");
  const context = await semanticContext(novelDir);
  const contextDigest = digest(context);
  if (revision !== semanticRevision(changeset, contextDigest)) throw new Error("Stale semantic revision or canonical context; read current facts");
  const prior = changeset.semanticReview?.revision === revision && changeset.semanticReview.contextDigest === contextDigest ? changeset.semanticReview.decisions : [];
  const updates = value as FactDecision[];
  if (new Set(updates.map(decision => decision?.factId)).size !== updates.length) throw new Error("Duplicate decisions in batch");
  const merged = new Map(prior.map(decision => [decision.factId, decision]));
  updates.forEach(decision => {
    const previous = merged.get(decision?.factId);
    merged.set(decision?.factId, decision?.verdict === "accept" && !("replacement" in decision) && previous && "replacement" in previous ? { ...decision, replacement: previous.replacement } : decision);
  });
  changeset.semanticReview = { version: 1, revision, contextDigest, decisions: [...merged.values()] };
  const projection = materializeSemantic(changeset, context.entities, context.objects);
  await saveChangeSet(novelDir, changeset);
  await appendAudit(novelDir, "review-facts", { changesetId: id, revision, decisions: updates, deferredFactIds: projection.deferredFactIds }, "Source-grounded semantic decisions; structure unchanged");
  return { id, revision, verifiedFacts: projection.verifiedFacts, deferredFacts: projection.deferredFactIds.length, rejectedFacts: projection.rejectedFactIds.length };
}

export async function prepareSemantic(novelDir: string, changeset: ChangeSet) {
  const context = await semanticContext(novelDir);
  if (changeset.semanticReview?.contextDigest !== digest(context)) throw new Error("Canonical context changed or decisions are missing; review current facts before approval");
  materializeSemantic(changeset, context.entities, context.objects);
  return context;
}
