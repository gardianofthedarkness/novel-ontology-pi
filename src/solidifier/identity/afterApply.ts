import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { EventSink } from "../../ground/events/types.js";
import type { Entity, Scene } from "../../ground/ontology/types.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import { causalSource } from "../causality/evidence.js";
import { mergeEntities } from "../maintenance/fixes.js";
import type { ChangeSet } from "../merge/changeset.js";
import {
  castForms, castScope, fullNames, hasHonorific, isDescription, isPersonNoun, isDistinct, survivor, joinPerson, loadCast, markDistinct, memberRef, mergePersons, personOf, removeMember, saveCast, syncBook,
  type CastFile, type CastScope,
} from "./cast.js";
import { checkPairs, EM_AUTO, EM_REVIEW, type Dossier } from "./em.js";
import { identityPool, recommend, type PoolEntry } from "./recommender.js";

/**
 * Universal EM after a book's packet is applied.
 *
 *  1. The book's characters join the universe's shared list (cast.ts):
 *     records bound at birth join their person, a unique full proper name
 *     joins its person automatically, anyone else is a new person.
 *  2. The packet's new characters (every character, for a sweep) are
 *     checked against the universal recommender over the whole book: the
 *     strongest candidates are asked about in one Jev batch.
 *  3. Same at EM_AUTO or above, not shown as two people, and tied by the
 *     names themselves (a shared name, one inside the other, apposition):
 *     merged now —
 *     inside the book through the audited merge, across books in the list.
 *     Same between EM_REVIEW and EM_AUTO: raised in an identity review
 *     packet (`um_*`). Clearly two people: remembered, not asked again.
 *  Candidates come from the recommender, ranked by what the names say
 *  (same form, one inside the other, a shared word, named side by side).
 */
export const EM_PAIRS_PER_CHARACTER = 3;
export const EM_PAIRS_PER_CALL = 12;
const PASSAGE_CHARS = 160;
/** A pair the text shows as two people this strongly is never merged automatically. */
const DISTINCT_BLOCKS = 0.3;
/** Remembered as two people (never asked again) only when Jev is this sure, and sure they are not one. */
const DISTINCT_REMEMBERS = 0.8;
const SAME_FORGETS = 0.2;
/** Two names joined by these words read as one person named twice ("名为X的Y", "Y——X", "X即Y"); nearness alone is not apposition. */
const APPOSITION = /^(?:——|—|－|的|是|即|，即|名为|名叫|叫做|也就是|就是|（|\(|：|:)$/;

export interface IdentityProposal {
  id: string;
  /** The book record that may be someone else. */
  a: { sourceId: string; entityId: string };
  /** Who it may be: another record of the same book, or a person of the universe. */
  b: { kind: "entity"; sourceId: string; entityId: string } | { kind: "person"; personId: string };
  confidence: number;
  method: "jev";
  reason: string;
}
export interface IdentityPacket {
  id: string;
  universeId: string;
  sourceId: string;
  createdAt: string;
  proposals: IdentityProposal[];
  decisions: { proposalId: string; verdict: "accept" | "hold" | "reject"; reason: string; at: string }[];
}
export interface IdentitySummary {
  universeId: string;
  joined: number;
  created: number;
  checked: number;
  merged: { keep: string; drop: string; confidence: number; across: boolean }[];
  review: { packetId: string; proposals: number } | null;
  distinct: number;
  note?: string;
}

const packetDir = (scope: Pick<CastScope, "root">) => join(scope.root, "cast", "packets");
export const packetPath = (scope: Pick<CastScope, "root">, id: string) => join(packetDir(scope), `${id}.json`);

export async function loadIdentityPacket(scope: Pick<CastScope, "root">, id: string): Promise<IdentityPacket> {
  if (!/^um_[a-f0-9]{24}$/.test(id)) throw new Error("Unknown identity packet.");
  return JSON.parse(await readFile(packetPath(scope, id), "utf8")) as IdentityPacket;
}
export async function saveIdentityPacket(scope: Pick<CastScope, "root">, packet: IdentityPacket) {
  await mkdir(packetDir(scope), { recursive: true, mode: 0o700 });
  await writeFile(packetPath(scope, packet.id), JSON.stringify(packet, null, 1), { mode: 0o600 });
}
/** Packets with proposals still undecided or held. */
export async function openIdentityPackets(scope: Pick<CastScope, "root">, sourceId?: string): Promise<IdentityPacket[]> {
  const names = await readdir(packetDir(scope)).catch(() => [] as string[]);
  const packets = await Promise.all(names.filter((name) => /^um_[a-f0-9]{24}\.json$/.test(name)).map((name) => loadIdentityPacket(scope, name.slice(0, -5))));
  return packets.filter((packet) => (!sourceId || packet.sourceId === sourceId) && packet.proposals.some((proposal) => !packet.decisions.some((decision) => decision.proposalId === proposal.id && decision.verdict !== "hold")));
}

const canonical = (entity: Entity) => entity.names.find((name) => name.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id;
/**
 * Which of two records of one book survives a merge: the one named by a
 * plain full proper name (not a description or "X同学"), then the one the
 * book refers to more, then the longer name, then the older record.
 */
function keeper(first: Entity, second: Entity, references: Map<string, number>): [Entity, Entity] {
  const rank = (entity: Entity) => [fullNames(castForms(entity)).includes(canonical(entity)) && !hasHonorific(canonical(entity)) ? 1 : 0, references.get(entity.id) ?? 0, [...canonical(entity)].length];
  const [a, b] = [rank(first), rank(second)];
  const at = a.findIndex((value, index) => value !== b[index]);
  const firstWins = at >= 0 ? a[at] > b[at] : first.id.localeCompare(second.id) < 0;
  return firstWins ? [first, second] : [second, first];
}

const usableForms = (forms: string[]) => forms.filter((form) => [...form].length >= 2);
/** Sentences naming both sides, and how many join the two names as apposition. */
function bridges(sentences: Sentence[], first: string[], second: string[]): { lines: string[]; appositions: number } {
  const [a, b] = [usableForms(first), usableForms(second)];
  // A description's core word stands for it in apposition ("被造出的幽灵——X" for "人造幽灵").
  const cores = a.filter((form) => isDescription(form) || [...form].length >= 4).map((form) => form.slice(-2)).filter((core) => !a.includes(core) && !isPersonNoun(core));
  const lines: string[] = [];
  let appositions = 0;
  for (const sentence of sentences) {
    const at = (forms: string[]) => forms.flatMap((form) => { const found: [number, number][] = []; for (let index = sentence.text.indexOf(form); index >= 0; index = sentence.text.indexOf(form, index + 1)) found.push([index, index + form.length]); return found; });
    const [named, right] = [at(a), at(b)];
    const left = [...named, ...at(cores)];
    if (!left.length || !right.length) continue;
    // Overlapping occurrences are one name inside another, not two names; the words between two names say whether they are one person.
    const between = left.flatMap(([start, end]) => right.flatMap(([otherStart, otherEnd]) => otherStart >= end ? [sentence.text.slice(end, otherStart)] : start >= otherEnd ? [sentence.text.slice(otherEnd, start)] : []));
    if (!between.length) continue;
    const apposed = between.some((words) => APPOSITION.test(words));
    if (apposed) appositions++;
    if (!named.length && !apposed) continue;
    if (lines.length < 2) lines.push(sentence.text.length > PASSAGE_CHARS * 1.5 ? `${sentence.text.slice(0, PASSAGE_CHARS * 1.5)}…` : sentence.text);
  }
  return { lines, appositions };
}

/**
 * How much the names themselves say two records are one person: the same
 * form, one name inside the other ("晓月" in "林晓月"), a shared word of
 * two or more characters ("眼镜"), or the two named side by side.
 */
function nameEvidence(first: string[], second: string[], appositions: number): { score: number; byName: boolean } {
  const [a, b] = [usableForms(first), usableForms(second)];
  const names = (forms: string[]) => forms.filter((form) => !isDescription(form) && !isPersonNoun(form));
  const [nameA, nameB] = [names(a), names(b)];
  const shared = (x: string, y: string) => { for (let start = 0; start + 2 <= x.length; start++) if (y.includes(x.slice(start, start + 2))) return true; return false; };
  // A shared real name, or one name inside the other, is evidence by name; a shared description ("女老师") or word is only a hint.
  const sameName = nameA.some((form) => nameB.includes(form));
  const inside = !sameName && nameA.some((form) => nameB.some((other) => form.includes(other) || other.includes(form)));
  let score = sameName ? 3 : inside ? 2 : 0;
  if (!score && (a.some((form) => b.includes(form)) || a.some((form) => b.some((other) => shared(form, other))))) score = 1;
  return { score: score + 1.5 * Math.min(appositions, 3), byName: sameName || inside || appositions > 0 };
}

/** Up to two short passages where any of the forms is written. */
function passages(sentences: Sentence[], forms: string[]): string[] {
  const usable = forms.filter((form) => [...form].length >= 2);
  const found: string[] = [];
  for (const sentence of sentences) {
    if (!usable.some((form) => sentence.text.includes(form))) continue;
    found.push(sentence.text.length > PASSAGE_CHARS ? `${sentence.text.slice(0, PASSAGE_CHARS)}…` : sentence.text);
    if (found.length === 2) break;
  }
  return found;
}

export async function runIdentityAfterApply(input: {
  novelDir: string;
  decisions?: DecisionModel | null;
  changeset?: ChangeSet | null;
  /** Check every character of the book, not only the packet's new ones. */
  all?: boolean;
  /** Most characters to check this run (a sweep continues on the next). */
  limit?: number;
  events?: EventSink;
  env?: NodeJS.ProcessEnv;
}): Promise<IdentitySummary> {
  const scope = await castScope(input.novelDir, input.env);
  const cast = await loadCast(scope);
  const bundle = new BundleStore(join(input.novelDir, "ontology"));
  const fold = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
  let entities = fold(await bundle.loadFile<Entity>("entities.jsonl"));
  const scenes = fold(await bundle.loadFile<Scene>("scenes.jsonl"));
  const synced = syncBook(cast, scope.sourceId, entities);
  const summary: IdentitySummary = { universeId: scope.universeId, joined: synced.joined.length, created: synced.created.length, checked: 0, merged: [], review: null, distinct: 0 };
  const settled = new Set(synced.joined.map((entry) => entry.entityId));
  const minted = new Set((input.changeset?.proposals ?? []).filter((proposal) => proposal.kind === "upsert_entity" && proposal.id.includes("_mint_")).map((proposal) => (proposal.payload as Entity).id));
  const characters = entities.filter((entity) => entity.kind === "Character");
  const targets = characters.filter((entity) => !settled.has(entity.id) && (input.all || minted.has(entity.id))).slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);
  if (!targets.length || !input.decisions) {
    await saveCast(scope, cast);
    return { ...summary, ...(targets.length ? { note: "No decision model: new characters were added to the shared list unchecked." } : {}) };
  }

  // The universal recommender over the whole book: who each scene could be.
  const sentences = await causalSource(input.novelDir).then((source) => source.sentences).catch(() => [] as Sentence[]);
  const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const pool = identityPool({ book: entities, cast, sourceId: scope.sourceId, books: scope.books });
  const byRef = new Map(pool.map((entry) => [entry.ref, entry]));
  const sceneInputs = scenes.map((scene, index) => ({ id: scene.id, chapterIndex: scene.chapterIndex, index, text: scene.sentenceIds.map((id) => sentenceById.get(id)?.text ?? "").join("\n"), present: scene.charactersPresent ?? [], mentioned: scene.charactersMentioned ?? [] }));
  const ranked = recommend(sceneInputs, pool, { limit: 64 });
  const otherBook = new Map<string, Sentence[]>();
  const bookSentences = async (sourceId: string) => {
    if (!otherBook.has(sourceId)) {
      const book = scope.books.find((entry) => entry.sourceId === sourceId);
      otherBook.set(sourceId, book ? await causalSource(book.workspace).then((source) => source.sentences).catch(() => []) : []);
    }
    return otherBook.get(sourceId)!;
  };
  const dossier = async (entry: PoolEntry): Promise<Dossier> => {
    if (entry.kind === "book") return { label: entry.label, forms: entry.forms, where: "this book", passages: passages(sentences, entry.forms) };
    const person = cast.persons.find((candidate) => `person:${candidate.id}` === entry.ref);
    const first = person?.members[0];
    return { label: entry.label, forms: entry.forms, where: entry.where, passages: first ? passages(await bookSentences(first.sourceId), entry.forms) : [] };
  };

  const pairs: { target: Entity; candidate: PoolEntry; byName: boolean; a: Dossier; b: Dossier }[] = [];
  for (const target of targets) {
    const own = byRef.get(target.id)!;
    const scores = new Map<string, number>();
    for (const scene of sceneInputs) {
      if (![...scene.present, ...scene.mentioned].includes(target.id) && !own.forms.some((form) => [...form].length >= 2 && scene.text.includes(form))) continue;
      for (const candidate of ranked.get(scene.id) ?? []) if (candidate.id !== target.id) scores.set(candidate.id, Math.max(scores.get(candidate.id) ?? 0, candidate.score));
    }
    const hinted = Array.isArray(target.properties?.possibleSame) ? (target.properties.possibleSame as { ref?: string }[]).flatMap((entry) => typeof entry.ref === "string" && byRef.has(entry.ref) ? [entry.ref] : []) : [];
    const memberOf = (ref: string) => { const entry = byRef.get(ref)!; return entry.kind === "book" ? memberRef({ sourceId: scope.sourceId, entityId: ref }) : ref; };
    // Everyone the recommender offers scores alike when named nearby; the names and the lines that name both say who could be the same person.
    const choices = [...scores].filter(([ref, score]) => score >= 0.5 && byRef.get(ref)?.kind !== "new" && !isDistinct(cast, memberRef({ sourceId: scope.sourceId, entityId: target.id }), memberOf(ref)))
      .map(([ref, score]) => { const entry = byRef.get(ref)!; const bridge = entry.kind === "book" ? bridges(sentences, own.forms, entry.forms) : { lines: [], appositions: 0 }; const names = nameEvidence(own.forms, entry.forms, bridge.appositions); return { ref, score, bridge, byName: names.byName, evidence: names.score + (hinted.includes(ref) ? 3 : 0) }; })
      .filter((entry) => entry.evidence > 0)
      .sort((first, second) => second.evidence - first.evidence || second.score - first.score)
      .slice(0, EM_PAIRS_PER_CHARACTER);
    summary.checked++;
    const a = await dossier(own);
    for (const choice of choices) { const b = await dossier(byRef.get(choice.ref)!); pairs.push({ target, candidate: byRef.get(choice.ref)!, byName: choice.byName, a, b: { ...b, passages: [...choice.bridge.lines.map((line) => `(names both) ${line}`), ...b.passages].slice(0, 3) } }); }
  }

  // One Jev batch per call-sized group; act on the best pair of each character.
  const verdicts: { same: number; distinct: number }[] = [];
  for (let start = 0; start < pairs.length; start += EM_PAIRS_PER_CALL) verdicts.push(...await checkPairs(input.decisions, pairs.slice(start, start + EM_PAIRS_PER_CALL).map(({ a, b }) => ({ a, b }))));
  const proposals: IdentityProposal[] = [];
  const gone = new Set<string>();
  for (const target of targets) {
    const own = pairs.map((pair, index) => ({ ...pair, verdict: verdicts[index] })).filter((pair) => pair.target.id === target.id);
    for (const pair of own) if (pair.verdict.distinct >= DISTINCT_REMEMBERS && pair.verdict.same < SAME_FORGETS) {
      markDistinct(cast, memberRef({ sourceId: scope.sourceId, entityId: target.id }), pair.candidate.kind === "book" ? memberRef({ sourceId: scope.sourceId, entityId: pair.candidate.ref }) : pair.candidate.ref, `Jev: distinct ${pair.verdict.distinct.toFixed(2)}`);
      summary.distinct++;
    }
    const best = own.filter((pair) => !gone.has(pair.candidate.ref)).sort((first, second) => second.verdict.same - first.verdict.same)[0];
    if (!best || best.verdict.same < EM_REVIEW || gone.has(target.id)) continue;
    const reason = `Jev: same ${best.verdict.same.toFixed(2)}, distinct ${best.verdict.distinct.toFixed(2)}`;
    // Automatic only when Jev is sure, nothing says two people, and the names themselves tie them; anything less is reviewed.
    if (best.verdict.same >= EM_AUTO && best.verdict.distinct < DISTINCT_BLOCKS && best.byName) {
      const merged = await mergeIdentity(input.novelDir, scope, cast, entities, target.id, best.candidate.kind === "book" ? { kind: "entity", sourceId: scope.sourceId, entityId: best.candidate.ref } : { kind: "person", personId: best.candidate.ref.slice("person:".length) }, best.verdict.same, "jev", reason);
      entities = merged.entities;
      gone.add(merged.drop);
      summary.merged.push({ keep: merged.keep, drop: merged.drop, confidence: best.verdict.same, across: best.candidate.kind !== "book" });
      if (!merged.across) await input.events?.({ type: "entity.merged", keepId: merged.keep, dropId: merged.drop });
      continue;
    }
    // One proposal per pair, whichever side raised it.
    const pairKey = [target.id, best.candidate.ref].sort().join("|");
    if (proposals.some((proposal) => [proposal.a.entityId, proposal.b.kind === "entity" ? proposal.b.entityId : `person:${proposal.b.personId}`].sort().join("|") === pairKey)) continue;
    proposals.push({
      id: `id_${createHash("sha256").update(pairKey).digest("hex").slice(0, 16)}`,
      a: { sourceId: scope.sourceId, entityId: target.id },
      b: best.candidate.kind === "book" ? { kind: "entity", sourceId: scope.sourceId, entityId: best.candidate.ref } : { kind: "person", personId: best.candidate.ref.slice("person:".length) },
      confidence: best.verdict.same, method: "jev", reason,
    });
  }
  await saveCast(scope, cast);
  if (proposals.length) {
    const packet: IdentityPacket = { id: `um_${createHash("sha256").update(JSON.stringify([scope.sourceId, proposals.map((proposal) => proposal.id)])).digest("hex").slice(0, 24)}`, universeId: scope.universeId, sourceId: scope.sourceId, createdAt: new Date().toISOString(), proposals, decisions: [] };
    await saveIdentityPacket(scope, packet);
    summary.review = { packetId: packet.id, proposals: proposals.length };
  }
  return summary;
}

/**
 * Make one book record the same as someone: another record of the same
 * book (the audited merge rewires every reference, the list follows), or
 * a person of the universe (the record's person joins that person).
 */
export async function mergeIdentity(novelDir: string, scope: CastScope, cast: CastFile, entities: Entity[], entityId: string, other: IdentityProposal["b"], confidence: number, method: "jev" | "review", reason: string): Promise<{ keep: string; drop: string; across: boolean; entities: Entity[] }> {
  // Earlier merges may have moved either side to a survivor.
  entityId = survivor(cast, scope.sourceId, entityId);
  if (other.kind === "entity") other = { ...other, entityId: survivor(cast, scope.sourceId, other.entityId) };
  if (other.kind === "entity" && other.entityId === entityId) return { keep: entityId, drop: entityId, across: false, entities };
  const self = entities.find((entity) => entity.id === entityId);
  if (!self) throw new Error(`No character ${entityId} in this book.`);
  if (other.kind === "person") {
    const mine = personOf(cast, scope.sourceId, entityId);
    const target = cast.persons.find((person) => person.id === other.personId);
    if (!target) throw new Error("Unknown person in the shared character list.");
    if (target.members.some((member) => member.sourceId === scope.sourceId && member.entityId !== entityId)) throw new Error("That person already has a record in this book; merge the two records instead.");
    if (mine && mine.id !== target.id) mergePersons(cast, target.id, mine.id, { method, confidence, reason });
    else if (!mine) joinPerson(target, { sourceId: scope.sourceId, entityId }, castForms(self));
    return { keep: target.id, drop: memberRef({ sourceId: scope.sourceId, entityId }), across: true, entities };
  }
  const partner = entities.find((entity) => entity.id === other.entityId);
  if (!partner) throw new Error(`No character ${other.entityId} in this book.`);
  const references = new Map<string, number>();
  for (const scene of await new BundleStore(join(novelDir, "ontology")).loadFile<Scene>("scenes.jsonl")) for (const id of [...scene.charactersPresent ?? [], ...scene.charactersMentioned ?? []]) references.set(id, (references.get(id) ?? 0) + 1);
  const [keep, drop] = keeper(partner, self, references);
  await mergeEntities(novelDir, keep.id, drop.id, `universal EM (${method}): ${reason}`);
  const keepPerson = personOf(cast, scope.sourceId, keep.id), dropPerson = personOf(cast, scope.sourceId, drop.id);
  removeMember(cast, scope.sourceId, drop.id);
  if (keepPerson) joinPerson(keepPerson, { sourceId: scope.sourceId, entityId: keep.id }, castForms(drop));
  if (dropPerson && keepPerson && dropPerson.id !== keepPerson.id && cast.persons.some((person) => person.id === dropPerson.id)) mergePersons(cast, keepPerson.id, dropPerson.id, { method, confidence, reason });
  cast.merges.push({ keep: memberRef({ sourceId: scope.sourceId, entityId: keep.id }), drop: memberRef({ sourceId: scope.sourceId, entityId: drop.id }), method, confidence, reason, at: new Date().toISOString() });
  const fold = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
  return { keep: keep.id, drop: drop.id, across: false, entities: fold(await new BundleStore(join(novelDir, "ontology")).loadFile<Entity>("entities.jsonl")).filter((entity) => entity.id !== drop.id) };
}
