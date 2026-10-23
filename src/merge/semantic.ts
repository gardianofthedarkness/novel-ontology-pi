import { createHash } from "node:crypto";
import type { ChangeProposal, ChangeSet } from "./changeset.js";
import type { Entity, OntEvent, Relation, Scene, StateChange } from "../ontology/types.js";
import type { Sentence } from "../text/sectioning.js";

export interface Fact {
  id: string;
  proposalId: string;
  field: "identity" | "alias" | "actors" | "presence" | "mention" | "location" | "turn" | "dialogue-member" | "relation" | "state";
  turnIndex?: number;
  cardId?: string;
  candidateOnly?: boolean;
  value: unknown;
  sentenceIds: string[];
}
export interface FactDecision {
  factId: string;
  verdict: "accept" | "hold" | "reject";
  reason: string;
  replacement?: unknown;
}
export interface SemanticReview {
  version: 1;
  revision: string;
  decisions: FactDecision[];
  contextDigest?: string;
}
export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const semanticRevision = (changeset: ChangeSet, contextDigest = changeset.semanticReview?.contextDigest): string => digest({ id: changeset.id, createdAt: changeset.createdAt, proposals: changeset.proposals, source: changeset.reviewSource, contextDigest });

export function semanticFacts(changeset: ChangeSet): Fact[] {
  const facts: Fact[] = [];
  const reviewedCards = new Set<string>();
  const push = (proposal: ChangeProposal, field: Fact["field"], value: unknown, sentenceIds = proposal.provenance.sentenceIds, turnIndex?: number) => {
    facts.push({ id: `${proposal.id}/${field}${turnIndex === undefined ? "" : `/${turnIndex}`}`, proposalId: proposal.id, field, value, sentenceIds, ...(turnIndex === undefined ? {} : { turnIndex }) });
  };
  const events = new Map(changeset.proposals.filter(proposal => proposal.kind === "create_event").map(proposal => [(proposal.payload as OntEvent).id, proposal]));
  for (const proposal of changeset.proposals) {
    if (proposal.kind === "upsert_entity") push(proposal, "identity", proposal.payload);
    if (proposal.kind === "add_alias") push(proposal, "alias", proposal.payload);
    if (proposal.kind === "set_state_change") push(proposal, "state", proposal.payload);
    if (proposal.kind === "create_event") {
      const event = proposal.payload as OntEvent;
      if (event.primaryActors.length || event.affectedCharacters.length) push(proposal, "actors", { primaryActors: event.primaryActors, affectedCharacters: event.affectedCharacters }, event.evidence.sentenceIds);
    }
    if (proposal.kind === "create_scene") {
      const scene = proposal.payload as unknown as Scene;
      if (scene.charactersPresent.length) push(proposal, "presence", scene.charactersPresent, scene.sentenceIds);
      if (scene.charactersMentioned.length) push(proposal, "mention", scene.charactersMentioned, scene.sentenceIds);
      if (scene.locationId) push(proposal, "location", scene.locationId, scene.sentenceIds);
      scene.turns.forEach((turn, index) => {
        if (turn.speakerId || turn.addresseeId) push(proposal, "turn", { speakerId: turn.speakerId, addresseeId: turn.addresseeId }, turn.sentenceIds, index);
      });
      for (const card of scene.dialogues ?? []) {
        if (reviewedCards.has(card.id)) continue;
        reviewedCards.add(card.id);
        const fragments = changeset.proposals.filter(entry => entry.kind === "create_scene").flatMap(entry => (entry.payload as Scene).dialogues ?? []).filter(entry => entry.id === card.id);
        const references = new Set(fragments.flatMap(entry => entry.sentenceIds));
        const sentenceIds = (changeset.reviewSource ?? []).filter(sentence => references.has(sentence.id)).map(sentence => sentence.id);
        for (const participantId of [...card.participantIds, ...card.unresolvedParticipantIds ?? []]) {
          facts.push({ id: `${proposal.id}/dialogue-member/${card.id}/${participantId}`, proposalId: proposal.id, field: "dialogue-member", cardId: card.id, value: participantId, sentenceIds, candidateOnly: !card.participantIds.includes(participantId) });
        }
      }
    }
    if (proposal.kind === "add_relation") {
      const relation = proposal.payload as Relation;
      const event = events.get(relation.toId)?.payload as OntEvent | undefined;
      if (relation.type === "PARTICIPATES_IN" && event?.primaryActors.includes(relation.fromId) && !Object.keys(relation.properties).length) continue;
      push(proposal, "relation", proposal.payload);
    }
  }
  if (new Set(facts.map(fact => fact.id)).size !== facts.length) throw new Error("Duplicate semantic fact ids");
  return facts;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string" && !!entry) && new Set(value).size === value.length;
const kinds = new Set(["Character", "Location", "Organization", "Item", "Concept"]);
const relationKinds: Record<string, [string[], string[]]> = {
  CAUSES: [["Event"], ["Event"]], CAUSED_BY: [["Event"], ["Event"]], PRECEDES: [["Event"], ["Event"]],
  PARTICIPATES_IN: [["Character"], ["Event"]], PRESENT_IN: [["Character"], ["Scene"]], MENTIONED_IN: [["Character"], ["Scene"]], LOCATED_AT: [["Scene"], ["Location"]],
  KNOWS: [["Character"], ["Character"]], SPEAKS_TO: [["Character"], ["Character"]], ADDRESSES: [["Character"], ["Character"]], OWNS: [["Character"], ["Item"]], MEMBER_OF: [["Character"], ["Organization"]],
  STATE_BEFORE: [["Character"], ["Event"]], STATE_AFTER: [["Character"], ["Event"]], FORKS_FROM: [["Branch"], ["Event"]],
};

export function validateStructure(changeset: ChangeSet): void {
  const source = changeset.reviewSource;
  if (!source?.length || source.some(sentence => typeof sentence.id !== "string" || !sentence.id || typeof sentence.text !== "string" || !sentence.text.trim()) || new Set(source.map(sentence => sentence.id)).size !== source.length) throw new Error("Semantic review requires unique original source sentences");
  const ids = new Set(source.map(sentence => sentence.id));
  const owners = new Map<string, number>();
  const proposalIds = new Set<string>();
  const objects = new Set<string>();
  const cardMemberships = new Map<string, string>();
  const validSpan = (span: string[], allowEmpty = false, ordered = false) => {
    if (!Array.isArray(span) || !allowEmpty && !span.length || span.some(id => !ids.has(id)) || new Set(span).size !== span.length) throw new Error("Invalid source references");
    const order = span.map(id => source.findIndex(sentence => sentence.id === id));
    if (ordered && order.some((index, position) => position > 0 && index <= order[position - 1])) throw new Error("Source spans must be ordered");
  };
  for (const proposal of changeset.proposals) {
    if (!proposal.id || proposalIds.has(proposal.id)) throw new Error("Duplicate proposal ids");
    proposalIds.add(proposal.id);
    if (!record(proposal.payload)) throw new Error("Invalid proposal payload");
    if (["upsert_entity", "create_event", "create_scene"].includes(proposal.kind)) {
      const id = proposal.payload.id;
      if (typeof id !== "string" || !id || objects.has(id)) throw new Error("Duplicate or invalid object ids");
      objects.add(id);
    }
    validSpan(proposal.provenance.sentenceIds, true);
    if (proposal.kind === "create_scene") {
      const scene = proposal.payload as unknown as Scene;
      if (!Number.isSafeInteger(scene.chapterIndex) || scene.chapterIndex < 0 || !Array.isArray(scene.turns)) throw new Error("Invalid scene structure");
      if (!strings(scene.charactersPresent) || !strings(scene.charactersMentioned) || scene.locationId !== null && typeof scene.locationId !== "string") throw new Error("Invalid scene reference structure");
      validSpan(scene.sentenceIds, false, true);
      if (scene.dialogues !== undefined && (!Array.isArray(scene.dialogues) || scene.turns.length)) throw new Error("Dialogue cards and legacy speaker turns cannot be mixed");
      const cardIds = new Set<string>();
      const cardSentences = new Set<string>();
      for (const card of scene.dialogues ?? []) {
        if (typeof card.id !== "string" || !card.id || cardIds.has(card.id) || !strings(card.participantIds) || !strings(card.unresolvedParticipantIds ?? []) || card.participantIds.some(id => card.unresolvedParticipantIds?.includes(id))) throw new Error("Invalid dialogue card membership structure");
        cardIds.add(card.id);
        validSpan(card.sentenceIds, false, true);
        for (const id of card.sentenceIds) {
          if (!scene.sentenceIds.includes(id) || cardSentences.has(id)) throw new Error("Dialogue card source leaves its scene or overlaps another card");
          cardSentences.add(id);
        }
        const signature = JSON.stringify([[...card.participantIds].sort(), [...card.unresolvedParticipantIds ?? []].sort()]);
        if (cardMemberships.has(card.id) && cardMemberships.get(card.id) !== signature) throw new Error("Shared dialogue card membership candidates disagree");
        cardMemberships.set(card.id, signature);
      }
      for (const id of scene.sentenceIds) owners.set(id, (owners.get(id) ?? 0) + 1);
      const spoken = new Set<string>();
      for (const turn of scene.turns) {
        validSpan(turn.sentenceIds, false, true);
        if (turn.sentenceIds.some(id => !scene.sentenceIds.includes(id) || spoken.has(id))) throw new Error("Dialogue spans must stay in one scene without overlaps");
        turn.sentenceIds.forEach(id => spoken.add(id));
      }
    }
    if (proposal.kind === "create_event") {
      const event = proposal.payload as unknown as OntEvent;
      validSpan(event.evidence?.sentenceIds);
      if (!Number.isFinite(event.chronologicalOrder) || !Number.isSafeInteger(event.chapterIndex) || event.chapterIndex < 0 || typeof event.summaryEn !== "string" || !event.timelineId) throw new Error("Invalid event structure");
      if (!strings(event.primaryActors) || !strings(event.affectedCharacters) || typeof event.evidence.text !== "string" || !Number.isFinite(event.importance) || event.importance < 0 || event.importance > 1 || !["dialogue", "action", "revelation", "conflict", "movement", "decision", "introduction", "resolution", "other"].includes(event.eventType)) throw new Error("Invalid event detection metadata");
    }
  }
  if (owners.size && source.some(sentence => owners.get(sentence.id) !== 1)) throw new Error("Scenes must cover each original source sentence exactly once");
}

export function materializeSemantic(changeset: ChangeSet, knownEntities: Entity[], knownObjects: { id: string; kind: string }[] = []) {
  validateStructure(changeset);
  if (changeset.semanticReview?.contextDigest && changeset.semanticReview.contextDigest !== digest({ entities: knownEntities, objects: knownObjects })) throw new Error("Canonical context changed; refresh semantic decisions");
  if (changeset.semanticReview?.version !== 1 || changeset.semanticReview.revision !== semanticRevision(changeset)) throw new Error("Missing or stale semantic review; read facts and record decisions first");
  const facts = semanticFacts(changeset);
  const byFact = new Map(facts.map(fact => [fact.id, fact]));
  const decisions = new Map<string, FactDecision>();
  for (const decision of changeset.semanticReview.decisions) {
    if (!record(decision) || !byFact.has(decision.factId) || decisions.has(decision.factId) || !["accept", "hold", "reject"].includes(decision.verdict) || typeof decision.reason !== "string" || !decision.reason.trim()) throw new Error("Invalid, duplicate or unknown fact decision");
    if (decision.verdict !== "accept" && decision.replacement !== undefined) throw new Error("Only accepted facts can have a replacement");
    decisions.set(decision.factId, decision);
  }
  const available = new Map(knownEntities.map(entity => [entity.id, entity]));
  const objectKinds = new Map([...knownObjects.map(object => [object.id, object.kind] as const), ...knownEntities.map(entity => [entity.id, entity.kind] as const)]);
  const proposed = new Map(changeset.proposals.filter(proposal => proposal.kind === "upsert_entity").map(proposal => [(proposal.payload as Entity).id, proposal.payload as Entity]));
  const deferred = new Set(facts.filter(fact => decisions.get(fact.id)?.verdict !== "reject").map(fact => fact.id));
  const accepted = (fact: Fact) => decisions.get(fact.id)?.verdict === "accept";
  if (facts.some(fact => accepted(fact) && !fact.sentenceIds.length)) throw new Error("Accepted semantic facts require original source evidence");
  const value = (fact: Fact): unknown => {
    const decision = decisions.get(fact.id);
    return decision && "replacement" in decision ? decision.replacement : fact.value;
  };
  const typed = (id: unknown, allowed: string[]): boolean => {
    if (typeof id !== "string" || !id) throw new Error("Invalid fact endpoint");
    const kind = objectKinds.get(id) ?? proposed.get(id)?.kind;
    if (kind && !allowed.includes(kind)) throw new Error(`Fact endpoint ${id} has the wrong type`);
    return objectKinds.has(id);
  };
  const resolveIds = (ids: unknown, allowed: string[]): boolean => {
    if (!strings(ids)) throw new Error("Fact endpoints must be unique ids");
    return ids.map(id => typed(id, allowed)).every(Boolean);
  };
  const projected = structuredClone(changeset.proposals).filter(proposal => ["create_scene", "create_event"].includes(proposal.kind));
  for (const proposal of projected) {
    const payload = proposal.payload as unknown as Record<string, unknown>;
    const id = payload.id as string;
    if (objectKinds.has(id)) throw new Error("Semantic application cannot overwrite existing scenes or events");
    objectKinds.set(id, proposal.kind === "create_scene" ? "Scene" : "Event");
    if (proposal.kind === "create_event") { payload.primaryActors = []; payload.affectedCharacters = []; }
    else {
      payload.charactersPresent = []; payload.charactersMentioned = []; payload.locationId = null;
      payload.turns = (payload.turns as Scene["turns"]).map(turn => ({ ...turn, speakerId: null, addresseeId: null }));
      if (payload.dialogues) payload.dialogues = (payload.dialogues as NonNullable<Scene["dialogues"]>).map(card => ({ ...card, participantIds: [], unresolvedParticipantIds: [] }));
    }
  }
  const output = new Map(projected.map(proposal => [proposal.id, proposal]));
  for (const fact of facts.filter(fact => fact.field === "identity" && accepted(fact))) {
    const entity = value(fact) as Entity;
    const original = fact.value as Entity;
    const originalNames = new Set([...original.names.map(name => name.text), ...available.get(original.id)?.names.map(name => name.text) ?? []]);
    if (!record(entity) || entity.id !== original.id || !kinds.has(entity.kind) || !Array.isArray(entity.names) || !entity.names.length || entity.names.some(name => !name || !originalNames.has(name.text) || typeof name.lang !== "string" || !["canonical", "alias", "nickname", "title"].includes(name.kind)) || !record(entity.properties)) throw new Error("Invalid identity replacement; ids and source candidate names cannot be invented");
    const canonicalNames = new Set(available.get(original.id)?.names.map(name => name.text) ?? []);
    if (entity.names.some(name => !canonicalNames.has(name.text) && !changeset.reviewSource!.some(sentence => sentence.text.includes(name.text)))) throw new Error("New identity forms must occur in the original source");
    if (objectKinds.has(entity.id) && !available.has(entity.id)) throw new Error("Identity id collides with an event or scene");
    available.set(entity.id, entity); objectKinds.set(entity.id, entity.kind);
    projected.unshift({ ...changeset.proposals.find(proposal => proposal.id === fact.proposalId)!, payload: structuredClone(entity) });
    deferred.delete(fact.id);
  }
  const originalRelations = changeset.proposals.filter(proposal => proposal.kind === "add_relation");
  const remaining = facts.filter(fact => fact.field !== "identity" && accepted(fact));
  remaining.sort((first, second) => Number(first.field === "relation") - Number(second.field === "relation"));
  for (const fact of remaining) {
    const next = value(fact);
    const proposal = changeset.proposals.find(proposal => proposal.id === fact.proposalId)!;
    const target = output.get(fact.proposalId)?.payload as unknown as Record<string, unknown> | undefined;
    let resolved = true;
    if (fact.field === "actors") {
      if (!record(next) || Object.keys(next).some(key => !["primaryActors", "affectedCharacters"].includes(key))) throw new Error("Invalid actor fact");
      resolved = resolveIds(next.primaryActors, ["Character"]) && resolveIds(next.affectedCharacters, ["Character"]);
      if (resolved) Object.assign(target!, next);
    } else if (fact.field === "presence" || fact.field === "mention") {
      resolved = resolveIds(next, ["Character"]);
      if (resolved) target![fact.field === "presence" ? "charactersPresent" : "charactersMentioned"] = structuredClone(next);
    } else if (fact.field === "location") {
      resolved = typed(next, ["Location"]); if (resolved) target!.locationId = next;
    } else if (fact.field === "dialogue-member") {
      resolved = typed(next, ["Character"]);
      if (resolved) for (const projectedScene of projected.filter(entry => entry.kind === "create_scene")) {
        for (const card of (projectedScene.payload as Scene).dialogues ?? []) if (card.id === fact.cardId && !card.participantIds.includes(next as string)) card.participantIds.push(next as string);
      }
    } else if (fact.field === "turn") {
      if (!record(next) || Object.keys(next).some(key => !["speakerId", "addresseeId"].includes(key)) || !("speakerId" in next) || !("addresseeId" in next)) throw new Error("Invalid dialogue assignment");
      const speaker = next.speakerId === null || typed(next.speakerId, ["Character"]);
      const addressee = next.addresseeId === null || typed(next.addresseeId, ["Character"]);
      resolved = speaker && addressee;
      if (resolved) Object.assign((target!.turns as Scene["turns"])[fact.turnIndex!], next);
    } else if (fact.field === "alias") {
      if (!record(next) || next.entityId !== (fact.value as { entityId: string }).entityId || next.aliasText !== (fact.value as { aliasText: string }).aliasText) throw new Error("Alias facts cannot invent a different identity or form");
      if (typeof next.aliasText !== "string" || !changeset.reviewSource!.some(sentence => sentence.text.includes(next.aliasText as string))) throw new Error("Alias must occur in original source evidence");
      resolved = typed(next.entityId, [...kinds]);
      if (resolved) projected.push({ ...proposal, payload: structuredClone(next) });
    } else if (fact.field === "state") {
      const state = next as Omit<StateChange, "id">;
      const scores = (scores: unknown) => record(scores) && Object.values(scores).every(score => typeof score === "number" && Number.isFinite(score) && Math.abs(score) <= 1);
      if (!record(state) || !scores(state.emotions) || !scores(state.relationships) || ![state.knowledgeAdd, state.goalsAdd, state.possessionsAdd, state.possessionsRemove].every(strings) || state.location !== null && typeof state.location !== "string") throw new Error("Invalid character state");
      resolved = typed(state.characterId, ["Character"]) && typed(state.afterEventId, ["Event"]) && resolveIds(Object.keys(state.relationships), ["Character"]);
      if (resolved) projected.push({ ...proposal, payload: structuredClone(state) });
    } else if (fact.field === "relation") {
      const relation = next as Relation;
      const expected = relationKinds[relation.type];
      if (!record(relation) || !expected || !record(relation.properties)) throw new Error("Invalid relation fact");
      resolved = typed(relation.fromId, expected[0]) && typed(relation.toId, expected[1]);
      const scene = projected.find(entry => entry.kind === "create_scene" && (entry.payload as Scene).id === (relation.type === "LOCATED_AT" ? relation.fromId : relation.toId))?.payload as Scene | undefined;
      const event = projected.find(entry => entry.kind === "create_event" && (entry.payload as OntEvent).id === relation.toId)?.payload as OntEvent | undefined;
      if (relation.type === "PARTICIPATES_IN" && event) resolved = event.primaryActors.includes(relation.fromId) && resolved;
      if (relation.type === "PRESENT_IN" && scene) resolved = scene.charactersPresent.includes(relation.fromId) && resolved;
      if (relation.type === "MENTIONED_IN" && scene) resolved = scene.charactersMentioned.includes(relation.fromId) && resolved;
      if (relation.type === "LOCATED_AT" && scene) resolved = scene.locationId === relation.toId && resolved;
      if (resolved) projected.push({ ...proposal, payload: structuredClone(relation) });
    }
    if (resolved) deferred.delete(fact.id);
  }
  for (const proposal of projected.filter(proposal => proposal.kind === "create_scene")) {
    const scene = proposal.payload as Scene;
    if (scene.charactersPresent.some(id => scene.charactersMentioned.includes(id))) throw new Error("Presence and mention assertions conflict; resolve only the affected facts");
  }
  for (const proposal of originalRelations) {
    if (facts.some(fact => fact.proposalId === proposal.id)) continue;
    const relation = proposal.payload as Relation;
    const event = projected.find(entry => entry.kind === "create_event" && (entry.payload as OntEvent).id === relation.toId)?.payload as OntEvent | undefined;
    if (event?.primaryActors.includes(relation.fromId)) projected.push(structuredClone(proposal));
  }
  return { proposals: projected, deferredFactIds: [...deferred], rejectedFactIds: facts.filter(fact => decisions.get(fact.id)?.verdict === "reject").map(fact => fact.id), verifiedFacts: facts.length - deferred.size - facts.filter(fact => decisions.get(fact.id)?.verdict === "reject").length };
}

export function factEvidence(fact: Fact, source: Sentence[], offset = 0, limit = 12) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error("Evidence pagination requires offset >= 0 and limit 1..30");
  const anchors = new Set(fact.sentenceIds);
  const selected = source.filter((sentence, index) => anchors.has(sentence.id) || source.slice(Math.max(0, index - 2), index + 3).some(neighbor => anchors.has(neighbor.id)));
  const sentences: Pick<Sentence, "id" | "text">[] = [];
  for (const sentence of selected.slice(offset, offset + limit)) {
    if (Buffer.byteLength(JSON.stringify([...sentences, sentence])) > 24000) break;
    sentences.push({ id: sentence.id, text: sentence.text });
  }
  if (!sentences.length && selected.length > offset) throw new Error("Single source sentence exceeds evidence budget; hold the fact, never truncate silently");
  return { sentences, page: { offset, total: selected.length, nextOffset: offset + sentences.length < selected.length ? offset + sentences.length : null } };
}
