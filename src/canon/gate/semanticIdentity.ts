import type { Entity } from "../../ground/ontology/types.js";
import { identityChoices } from "../../ground/language/identityLabels.js";
import type { ChangeSet } from "./changeset.js";
import type { Fact, FactDecision } from "./semantic.js";
import { semanticFacts } from "./semantic.js";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function semanticIdentityCodec(packet: ChangeSet, knownEntities: Entity[]) {
  const entities = new Map(knownEntities.map(entity => [entity.id, entity]));
  for (const proposal of packet.proposals) if (proposal.kind === "upsert_entity") {
    const entity = proposal.payload as Entity;
    const existing = entities.get(entity.id);
    entities.set(entity.id, { ...entity, names: [...entity.names, ...existing?.names.filter(name => !entity.names.some(form => form.text === name.text)) ?? []] });
  }
  const choices = identityChoices([...entities.values()]);
  const unresolved = new Map<string, string>();
  const display = (id: unknown) => {
    if (typeof id !== "string") return null;
    const label = choices.labelFor(id);
    if (label) return label;
    if (!unresolved.has(id)) unresolved.set(id, `[unresolved identity ${unresolved.size + 1}]`);
    return unresolved.get(id)!;
  };
  const resolve = (label: unknown, kind?: Entity["kind"]) => {
    const entity = choices.resolve(label, kind);
    if (!entity) throw new Error("Unknown, ambiguous or wrong-kind semantic identity label; use the current displayed choice or hold the fact");
    return entity.id;
  };
  const mapValue = (fact: Fact, input: unknown, decode: boolean): unknown => {
    const endpoint = (value: unknown, kind?: Entity["kind"]) => decode ? resolve(value, kind) : display(value);
    const list = (value: unknown, kind: Entity["kind"]) => {
      if (!Array.isArray(value)) throw new Error("Semantic identity list must be an array");
      return [...new Set(value.map(label => endpoint(label, kind)))];
    };
    if (["presence", "mention"].includes(fact.field)) return list(input, "Character");
    if (fact.field === "dialogue-member") return endpoint(input, "Character");
    if (fact.field === "location") return endpoint(input, "Location");
    if (!record(input)) throw new Error("Semantic replacement must preserve the fact's object shape");
    if (fact.field === "identity") {
      if (decode) {
        if ("id" in input) throw new Error("Semantic identity replacements cannot supply storage IDs");
        return { ...input, id: (fact.value as Entity).id };
      }
      return { label: display(input.id), kind: input.kind, names: input.names };
    }
    if (fact.field === "actors") return { ...input, primaryActors: list(input.primaryActors, "Character"), affectedCharacters: list(input.affectedCharacters, "Character") };
    if (fact.field === "turn") return { ...input, speakerId: input.speakerId === null ? null : endpoint(input.speakerId, "Character"), addresseeId: input.addresseeId === null ? null : endpoint(input.addresseeId, "Character") };
    if (fact.field === "alias") return { ...input, entityId: endpoint(input.entityId) };
    if (fact.field === "state") {
      if (!record(input.relationships)) throw new Error("Semantic state relationships must be a label-to-delta map");
      const relationships: Record<string, unknown> = Object.create(null);
      for (const [label, delta] of Object.entries(input.relationships)) {
        const target = endpoint(label, "Character") as string;
        if (target in relationships) throw new Error("Multiple relationship labels resolve to the same identity; do not silently sum deltas");
        relationships[target] = delta;
      }
      if (!decode) return { character: endpoint(input.characterId, "Character"), relationships: { ...relationships } };
      if (input.afterEventId !== (fact.value as Record<string, unknown>).afterEventId) throw new Error("Semantic identity correction cannot reassign a state's event");
      return { ...input, characterId: endpoint(input.characterId, "Character"), relationships: { ...relationships } };
    }
    if (fact.field === "relation") {
      if (decode) throw new Error("Semantic relation endpoint edits require the relation evidence workflow; identity label correction cannot change causal endpoints");
      return { type: input.type, from: entities.has(input.fromId as string) ? display(input.fromId) : input.fromId, to: entities.has(input.toId as string) ? display(input.toId) : input.toId };
    }
    throw new Error("Unsupported semantic identity field");
  };
  return {
    meaning: (fact: Fact, value: unknown = fact.value) => mapValue(fact, value, false),
    decode: (fact: Fact, value: unknown) => mapValue(fact, value, true),
  };
}

export function normalizeFactDecisions(packet: ChangeSet, entities: Entity[], input: unknown[]): FactDecision[] {
  const facts = new Map(semanticFacts(packet).map(fact => [fact.id, fact]));
  const codec = semanticIdentityCodec(packet, entities);
  return input.map(value => {
    if (!record(value) || typeof value.factId !== "string" || !facts.has(value.factId)) throw new Error("Invalid or unknown fact decision");
    if (!("semanticReplacement" in value)) return value as unknown as FactDecision;
    if (value.verdict !== "accept" || "replacement" in value) throw new Error("Semantic replacement requires accept and cannot be combined with a raw replacement");
    const { semanticReplacement, ...decision } = value;
    return { ...decision, replacement: codec.decode(facts.get(value.factId)!, semanticReplacement) } as unknown as FactDecision;
  });
}
