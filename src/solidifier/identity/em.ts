import type { DecisionAnswer, DecisionModel, DecisionQuestion } from "../../ground/connectors/jev.js";
import { fullNames, isDescription, type CastForm } from "./cast.js";
import type { PoolEntry, Recommendation } from "./recommender.js";

/**
 * Universal EM: who is each newly extracted name?
 *
 * Two inputs, one decision. The universal recommender says who a scene
 * could be (this book, the universe's other books, the block's other new
 * names); the new names are what extraction just found. Then:
 *   1. A full proper name owned by exactly one candidate IS that
 *      candidate: bound by code, no model call ("林晓月" anywhere in the
 *      universe is the same person). Short forms, titles and descriptions
 *      never bind by themselves.
 *   2. Every other name with candidates gets one Jev choice over its
 *      passage: the candidates or NEW_PERSON. At EM_AUTO or above the name
 *      binds; between EM_REVIEW and EM_AUTO it stays new and is raised for
 *      review with its likely match; below, it is a new person.
 *   3. A name bound to another new name follows it, so a block's full
 *      name, short form and description end up as one identity.
 */
export const EM_AUTO = 0.92;
export const EM_REVIEW = 0.6;
/** Candidates offered per question. */
export const EM_OPTIONS = 12;
/** Below this recommender score a candidate is not offered. */
export const EM_MIN_SCORE = 0.3;

export interface NewName {
  key: string;
  name: string;
  aliases: string[];
  descriptive: boolean;
  sceneId: string;
  /** The scene text the question shows. */
  passage: string;
}
export interface Resolution {
  key: string;
  name: string;
  /** The identity the name is (null: a new person). */
  to: PoolEntry | null;
  method: "full-name" | "jev" | "new";
  confidence: number;
  /** A likely match too uncertain to act on: raised for review. */
  possible?: { entry: PoolEntry; confidence: number };
  note: string;
}

const NEW_PERSON = "NEW_PERSON";
const confidenceOf = (answer: DecisionAnswer | undefined) => answer?.confidence ?? (typeof answer?.value === "string" ? answer.distribution?.[answer.value] : undefined) ?? 0;
const nameForms = (name: NewName): CastForm[] => [{ text: name.name, kind: name.descriptive || isDescription(name.name) ? "description" : "canonical" }, ...name.aliases.map((text): CastForm => ({ text, kind: isDescription(text) ? "description" : "alias" }))];

export async function resolveNewNames(input: {
  names: NewName[];
  pool: PoolEntry[];
  candidates: (name: NewName) => Recommendation[];
  decisions?: DecisionModel | null;
}): Promise<Resolution[]> {
  const resolutions = new Map<string, Resolution>();
  // 1. Full proper names, unique in the pool (this book and the universe).
  const owners = new Map<string, Set<PoolEntry>>();
  for (const entry of input.pool.filter((item) => item.kind !== "new")) for (const name of entry.full) owners.set(name, (owners.get(name) ?? new Set()).add(entry));
  const pending: NewName[] = [];
  for (const name of input.names) {
    const matches = new Set(fullNames(nameForms(name)).flatMap((form) => owners.get(form)?.size === 1 ? [...owners.get(form)!] : []));
    if (matches.size === 1) {
      const entry = [...matches][0];
      resolutions.set(name.key, { key: name.key, name: name.name, to: entry, method: "full-name", confidence: 1, note: `full name "${name.name}" is ${entry.label} (${entry.where})` });
    } else pending.push(name);
  }
  // 2. One Jev choice per remaining name, batched per scene passage.
  const asks = pending.map((name) => ({ name, options: input.candidates(name).filter((candidate) => candidate.entry.ref !== `new:${name.key}` && candidate.score >= EM_MIN_SCORE).slice(0, EM_OPTIONS) }));
  for (const { name } of asks.filter((ask) => !ask.options.length)) resolutions.set(name.key, { key: name.key, name: name.name, to: null, method: "new", confidence: 0, note: `"${name.name}": no candidate in the universe; new person` });
  const byScene = new Map<string, typeof asks>();
  for (const ask of asks.filter((entry) => entry.options.length)) byScene.set(ask.name.sceneId, [...(byScene.get(ask.name.sceneId) ?? []), ask]);
  for (const group of byScene.values()) {
    const listed = [...new Map(group.flatMap((ask) => ask.options.map((option) => [option.entry.ref, option.entry]))).values()];
    const state = `PASSAGE:\n${group[0].name.passage}\n\nCANDIDATES (who these names could be):\n${listed.map((entry) => `- ${entry.label} — names: ${entry.forms.slice(0, 6).join(" / ")} — ${entry.where}`).join("\n")}`;
    const questions: DecisionQuestion[] = group.map(({ name, options }) => ({
      key: `who:${name.key}`, primitive: "choice",
      instructions: `In the passage, someone is called "${name.name}"${name.aliases.length ? ` (also: ${name.aliases.join(", ")})` : ""}. Is this one of the listed candidates under another name, a short form or a description? Choose that candidate's exact label. Choose ${NEW_PERSON} if it is a different or newly introduced person, or if the passage does not establish who it is. Appearing in the same scene as someone, or talking to them, does not make two people the same.`,
      options: [...new Set([...options.map((option) => option.entry.label), NEW_PERSON])],
    }));
    let answers: DecisionAnswer[] = [];
    try { answers = input.decisions ? await input.decisions.decide(state, questions) : []; } catch { answers = []; }
    for (const { name, options } of group) {
      const answer = answers.find((entry) => entry.key === `who:${name.key}`);
      const value = typeof answer?.value === "string" ? answer.value : NEW_PERSON;
      const entry = options.find((option) => option.entry.label === value)?.entry;
      const confidence = confidenceOf(answer);
      if (!input.decisions || !answer) resolutions.set(name.key, { key: name.key, name: name.name, to: null, method: "new", confidence: 0, note: `"${name.name}": identity check unavailable; kept new for review`, ...(options[0] ? { possible: { entry: options[0].entry, confidence: 0 } } : {}) });
      else if (entry && confidence >= EM_AUTO) resolutions.set(name.key, { key: name.key, name: name.name, to: entry, method: "jev", confidence, note: `"${name.name}" is ${entry.label} (Jev ${confidence.toFixed(2)})` });
      else if (entry && confidence >= EM_REVIEW) resolutions.set(name.key, { key: name.key, name: name.name, to: null, method: "new", confidence, possible: { entry, confidence }, note: `"${name.name}" may be ${entry.label} (Jev ${confidence.toFixed(2)}); kept new and raised for review` });
      else resolutions.set(name.key, { key: name.key, name: name.name, to: null, method: "new", confidence, note: `"${name.name}": new person (Jev ${value === NEW_PERSON ? "NEW_PERSON" : value} ${confidence.toFixed(2)})` });
    }
  }
  // 3. Names bound to another new name follow it (cycles stop at the first name seen).
  const final = (key: string, seen = new Set<string>()): Resolution => {
    const resolution = resolutions.get(key)!;
    if (resolution.to?.kind !== "new" || seen.has(key)) return resolution;
    seen.add(key);
    const next = resolutions.get(resolution.to.ref.slice(4));
    if (!next || seen.has(next.key)) return resolution;
    const target = final(next.key, seen);
    return target.to ? { ...resolution, to: target.to } : resolution;
  };
  return input.names.map((name) => final(name.key));
}

/** One side of a sameness question: who, under which names, where, in which words. */
export interface Dossier { label: string; forms: string[]; where: string; passages: string[] }
export interface PairVerdict { same: number; distinct: number }

/**
 * After apply: is each pair one person recorded twice? One Jev batch for
 * all pairs; `same` and `distinct` are probabilities.
 */
export async function checkPairs(decisions: DecisionModel, pairs: { a: Dossier; b: Dossier }[]): Promise<PairVerdict[]> {
  if (!pairs.length) return [];
  const side = (dossier: Dossier) => `${dossier.label} — names: ${dossier.forms.slice(0, 8).join(" / ")} — ${dossier.where}\n    ${dossier.passages.map((passage) => `「${passage}」`).join("\n    ") || "(no passage)"}`;
  const state = `Identity check: is each pair one character recorded twice?\n${pairs.map((pair, index) => `PAIR ${index}:\n  A: ${side(pair.a)}\n  B: ${side(pair.b)}`).join("\n")}`;
  const questions: DecisionQuestion[] = pairs.flatMap((_, index): DecisionQuestion[] => [
    { key: `same:${index}`, primitive: "noul", instructions: `PAIR ${index}: are A and B the same character — one person under two names, a short form or a description?` },
    { key: `distinct:${index}`, primitive: "noul", instructions: `PAIR ${index}: does the text show A and B as two different people — both present and acting at once, related to each other, or otherwise clearly separate?` },
  ]);
  const answers = await decisions.decide(state, questions);
  const probability = (key: string) => { const answer = answers.find((entry) => entry.key === key); return typeof answer?.value === "number" ? answer.value : 0; };
  return pairs.map((_, index) => ({ same: probability(`same:${index}`), distinct: probability(`distinct:${index}`) }));
}
