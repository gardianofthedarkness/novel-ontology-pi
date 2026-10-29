import type { Entity } from "../../ground/ontology/types.js";
import { CAST_CANDIDATE_LIMIT, castCandidates, type CastCandidate, type CastSceneInput } from "../../digger/processing/castCandidates.js";
import { castForms, formKeys, fullNames, type CastBook, type CastFile } from "./cast.js";

/**
 * The universal recommender: for a scene, who it could be, best first.
 *
 * One candidate pool for the whole universe:
 *   - "book": this book's characters;
 *   - "universe": people from the universe's other books, not yet in this
 *     book (a person already in this book is represented by its record);
 *   - "new": names extraction just found in this block, so names born
 *     together (a full name, its short form, a description) see each other.
 * Scored like castCandidates (named in the scene 1.0, nearby scenes, the
 * chapter, the book), plus a small prior for the universe's central people
 * when this book has not named them: they can still be the one a
 * description refers to. Scores are reasons to ask, never sameness.
 */
export type PoolKind = "book" | "universe" | "new";
export interface PoolEntry {
  /** Book entity id, `person:<id>` or `new:<key>`. */
  ref: string;
  kind: PoolKind;
  /** The name itself. */
  name: string;
  /** Unique display label (the choice text Jev answers with): the name, plus where it is known when names collide. */
  label: string;
  forms: string[];
  /** Full proper names (cast.fullNames): the forms that bind by themselves. */
  full: string[];
  /** Where this candidate is known from, for the reader of the question. */
  where: string;
  /** Universe prior when not named in this book (0..0.3). */
  prior?: number;
}
export interface Recommendation extends CastCandidate { entry: PoolEntry }
export interface FreshName { key: string; name: string; aliases: string[] }

export const personRef = (personId: string) => `person:${personId}`;
export const freshRef = (key: string) => `new:${key}`;

/** The pool for one book: its characters, the universe's other people, and the block's new names. */
export function identityPool(input: { book: Entity[]; cast?: CastFile | null; sourceId: string; books?: CastBook[]; fresh?: FreshName[] }): PoolEntry[] {
  const entries: PoolEntry[] = [];
  for (const entity of input.book.filter((entry) => entry.kind === "Character")) {
    const name = entity.names.find((form) => form.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id;
    // A record that is a person of the universe answers to every name the universe knows for them.
    const person = input.cast?.persons.find((entry) => entry.members.some((member) => member.sourceId === input.sourceId && member.entityId === entity.id));
    const forms = [...castForms(entity), ...(person?.forms ?? [])];
    entries.push({ ref: entity.id, kind: "book", name, label: name, forms: [...new Set(forms.flatMap((form) => formKeys(form.text)))], full: fullNames(forms), where: person && person.members.some((member) => member.sourceId !== input.sourceId) ? "this book and earlier books" : "this book" });
  }
  const titles = new Map((input.books ?? []).map((book) => [book.sourceId, book.title]));
  const bookCount = Math.max(1, new Set((input.cast?.persons ?? []).flatMap((person) => person.members.map((member) => member.sourceId))).size);
  for (const person of input.cast?.persons ?? []) {
    if (person.members.some((member) => member.sourceId === input.sourceId)) continue;
    const books = [...new Set(person.members.map((member) => member.sourceId))];
    entries.push({ ref: personRef(person.id), kind: "universe", name: person.name, label: person.name, forms: [...new Set(person.forms.flatMap((form) => formKeys(form.text)))], full: fullNames(person.forms), where: books.map((id) => titles.get(id) ?? id).join(", "), prior: 0.05 + 0.25 * (books.length / bookCount) });
  }
  for (const name of input.fresh ?? []) entries.push({ ref: freshRef(name.key), kind: "new", name: name.name, label: name.name, forms: [...new Set([name.name, ...name.aliases].flatMap(formKeys))], full: [], where: "new in this block" });
  // Labels are answers: make them unique.
  const seen = new Map<string, number>();
  for (const entry of entries) seen.set(entry.label, (seen.get(entry.label) ?? 0) + 1);
  for (const entry of entries) if (seen.get(entry.label)! > 1) entry.label = `${entry.label} (${entry.where})`;
  return entries;
}

/** Scored candidates per scene over the whole pool, best first, at most `limit` (default 32). */
export function recommend(scenes: CastSceneInput[], pool: PoolEntry[], options: { limit?: number } = {}): Map<string, Recommendation[]> {
  const limit = options.limit ?? CAST_CANDIDATE_LIMIT;
  const byRef = new Map(pool.map((entry) => [entry.ref, entry]));
  const scored = castCandidates(scenes, pool.map((entry) => ({ id: entry.ref, forms: entry.forms })), { limit: Number.MAX_SAFE_INTEGER });
  const result = new Map<string, Recommendation[]>();
  for (const scene of scenes) {
    const best = new Map((scored.get(scene.id) ?? []).map((candidate) => [candidate.id, candidate]));
    for (const entry of pool) if (entry.prior && (best.get(entry.ref)?.score ?? 0) < entry.prior) best.set(entry.ref, { id: entry.ref, score: entry.prior, evidence: "universe" });
    result.set(scene.id, [...best.values()].sort((first, second) => second.score - first.score || first.id.localeCompare(second.id)).slice(0, limit).map((candidate) => ({ ...candidate, entry: byRef.get(candidate.id)! })));
  }
  return result;
}
