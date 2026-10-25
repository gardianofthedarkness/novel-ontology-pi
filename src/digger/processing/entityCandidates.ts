import type { Entity } from "../../ground/ontology/types.js";
import type { LlmScene } from "../extraction/extraction.js";
import type { ChangeProposal } from "../../solidifier/merge/changeset.js";

/**
 * Entity candidates (working-draft contract, 2026-10-25).
 *
 * Entity faculties find characters, places, groups, items and concepts scene
 * by scene, long before extraction mints entity records at the end of the
 * block. Every faculty that identifies entities records what it found here as
 * soon as it knows, so the live view can show the cast assembling instead of
 * all at once:
 *  - a name that is already a recorded form of a known entity is that entity
 *    (`existingId`); no new candidate is invented for it;
 *  - otherwise it is a NEW candidate, keyed by kind and name;
 *  - `firstSentenceId` is where it was first seen (the scene's first sentence);
 *  - extraction later links each candidate to the entity it became
 *    (`resolvedId`), so the view can morph one into the other.
 *
 * Candidates are view telemetry: ids, names copied from the source, and
 * offsets. They never become canonical without the normal extraction and
 * merge gate, and they hold no model reasoning or summaries.
 */
export type CandidateKind = "Character" | "Location" | "Organization" | "Item" | "Concept";
export interface EntityCandidate {
  /** Stable within a block: `existing:<id>` or `<kind>:<hash of name>`. */
  key: string;
  name: string;
  kind: CandidateKind;
  aliases: string[];
  status: "new" | "existing";
  existingId?: string;
  presence?: "present" | "mentioned" | "location";
  firstSentenceId?: string;
  faculty: string;
  resolvedId?: string;
}

const KINDS = new Set<CandidateKind>(["Character", "Location", "Organization", "Item", "Concept"]);

/** Short, id-safe, deterministic key for a new candidate. */
export function candidateKey(kind: string, name: string): string {
  let hash = 2166136261;
  for (const character of `${kind}|${name}`) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return `${kind.toLowerCase()}-${hash.toString(36)}`;
}

/** The view id a candidate is drawn and announced under. */
export function candidateNodeId(blockId: string, candidate: EntityCandidate): string {
  return candidate.existingId ?? `draft:${blockId}:entity:${candidate.key}`;
}

const PRESENCE_RANK = { location: 3, present: 2, mentioned: 1 } as const;

/**
 * Fold one scene's identity result (after birth checks) into the candidate
 * list. Pure: returns a new list, leaving the input untouched.
 */
export function addSceneCandidates(list: EntityCandidate[], scene: LlmScene, knownEntities: Entity[], options: { firstSentenceId?: string; faculty: string }): EntityCandidate[] {
  const next = list.map(candidate => ({ ...candidate, aliases: [...candidate.aliases] }));
  const known = (name: string, kind?: string) => knownEntities.find(entity => (!kind || entity.kind === kind) && entity.names.some(form => form.text === name));
  const findNew = (name: string, kind?: string) => next.find(candidate => candidate.status === "new" && (!kind || candidate.kind === kind) && (candidate.name === name || candidate.aliases.includes(name)));
  const upsert = (candidate: EntityCandidate) => {
    const current = next.find(entry => entry.key === candidate.key);
    if (!current) { next.push(candidate); return; }
    for (const alias of candidate.aliases) if (alias !== current.name && !current.aliases.includes(alias)) current.aliases.push(alias);
    if (candidate.presence && (!current.presence || PRESENCE_RANK[candidate.presence] > PRESENCE_RANK[current.presence])) current.presence = candidate.presence;
    current.firstSentenceId ??= candidate.firstSentenceId;
  };
  const existing = (entity: Entity, presence?: EntityCandidate["presence"]): EntityCandidate => ({
    key: `existing:${entity.id}`, name: entity.names[0]?.text ?? entity.id, kind: entity.kind as CandidateKind, aliases: [], status: "existing",
    existingId: entity.id, ...(presence ? { presence } : {}), ...(options.firstSentenceId ? { firstSentenceId: options.firstSentenceId } : {}), faculty: options.faculty,
  });
  for (const declaration of scene.newEntities ?? []) {
    if (typeof declaration.name !== "string" || !declaration.name || !KINDS.has(declaration.kind as CandidateKind)) continue;
    const kind = declaration.kind as CandidateKind;
    const aliases = (declaration.aliases ?? []).flatMap(alias => typeof alias.text === "string" && alias.text && alias.text !== declaration.name ? [alias.text] : []);
    const match = [declaration.name, ...aliases].map(name => known(name, kind)).find(Boolean);
    if (match) { upsert(existing(match)); continue; }
    const prior = [declaration.name, ...aliases].map(name => findNew(name, kind)).find(Boolean);
    upsert(prior ? { ...prior, aliases: [...new Set([...aliases, ...(prior.name === declaration.name ? [] : [declaration.name])])] } : {
      key: candidateKey(kind, declaration.name), name: declaration.name, kind, aliases, status: "new",
      ...(options.firstSentenceId ? { firstSentenceId: options.firstSentenceId } : {}), faculty: options.faculty,
    });
  }
  // Rosters only refer to identities: a name that is neither known nor
  // declared stays unresolved here; nothing is invented from it.
  const refer = (name: string, presence: NonNullable<EntityCandidate["presence"]>, kind?: CandidateKind) => {
    const match = known(name, kind);
    if (match) { upsert(existing(match, presence)); return; }
    const candidate = findNew(name, kind);
    if (candidate) upsert({ ...candidate, aliases: [], presence });
  };
  for (const name of scene.charactersPresent ?? []) refer(name, "present", "Character");
  for (const name of scene.charactersMentioned ?? []) refer(name, "mentioned", "Character");
  if (scene.locationName) refer(scene.locationName, "location", "Location");
  return next;
}

/**
 * Link candidates to the entities extraction proposed (or the known entity
 * they already were). Pure. A candidate whose name or alias is a form of a
 * proposed entity of the same kind resolves to it.
 */
export function resolveCandidates(list: EntityCandidate[], proposals: ChangeProposal[]): EntityCandidate[] {
  const entities = proposals.filter(proposal => proposal.kind === "upsert_entity").map(proposal => proposal.payload as Entity).filter(entity => typeof entity?.id === "string" && Array.isArray(entity.names));
  return list.map(candidate => {
    if (candidate.existingId) return candidate.resolvedId === candidate.existingId ? candidate : { ...candidate, resolvedId: candidate.existingId };
    const forms = [candidate.name, ...candidate.aliases];
    const match = entities.find(entity => entity.kind === candidate.kind && entity.names.some(form => forms.includes(form.text)));
    return match && match.id !== candidate.resolvedId ? { ...candidate, resolvedId: match.id } : candidate;
  });
}
