import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import type { Scene } from "../../../ground/ontology/types.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";

/**
 * Searching a book's original text, sentence by sentence, for an agent answering the world's questions
 * (docs/world-first-design.md): `novel source grep` (a regular expression) and `novel source similar` (the passages
 * most like a text). Every hit names its sentence and scene, so an answer can cite them. Read-only, no model calls.
 */
const SNIPPET = 220;
const clip = (text: string, length = SNIPPET) => ([...text].length > length ? `${[...text].slice(0, length - 1).join("")}…` : text);

async function bookText(novelDir: string) {
  const sentences = await loadWorkspaceSentences(novelDir);
  const scenes = await new BundleStore(join(novelDir, "ontology")).loadFile<Scene>("scenes.jsonl");
  const sceneOf = new Map<string, string>();
  for (const scene of scenes) for (const id of scene.sentenceIds ?? []) sceneOf.set(id, scene.id);
  return { sentences: [...sentences.entries()].map(([id, sentence]) => ({ id, text: sentence.text, scene: sceneOf.get(id) ?? null })) };
}

/** Sentences matching a regular expression (at most 200 characters long), in reading order. */
export async function sourceGrep(novelDir: string, pattern: string, limit = 20): Promise<Record<string, unknown>> {
  if (!pattern || pattern.length > 200) throw new Error("novel source grep needs a regular expression of 1–200 characters.");
  let regex: RegExp;
  try { regex = new RegExp(pattern, "u"); } catch (error) { throw new Error(`Not a regular expression: ${(error as Error).message}`); }
  const { sentences } = await bookText(novelDir), hits = sentences.filter((sentence) => regex.test(sentence.text));
  return { pattern, total: hits.length, shown: Math.min(limit, hits.length), hits: hits.slice(0, limit).map((sentence) => ({ sentence: sentence.id, scene: sentence.scene, text: clip(sentence.text) })) };
}

/** Character pairs of a text, counted (Chinese reads by them better than by words). */
const pairs = (text: string) => { const chars = [...text.replace(/\s+/g, "")], out = new Map<string, number>(); for (let index = 0; index + 1 < chars.length; index++) { const pair = chars[index] + chars[index + 1]; out.set(pair, (out.get(pair) ?? 0) + 1); } return out; };

/**
 * The passages (three sentences running) most like a text: by the character pairs they share, each weighted by how rare
 * it is in the book (TF-IDF, cosine). A lexical retrieval: it finds passages that word things alike, not ones that only
 * mean the same.
 */
export async function sourceSimilar(novelDir: string, text: string, limit = 10): Promise<Record<string, unknown>> {
  if (!text.trim() || text.length > 400) throw new Error("novel source similar needs a text of 1–400 characters.");
  const { sentences } = await bookText(novelDir);
  const passages = sentences.map((sentence, index) => ({ first: sentence, text: sentences.slice(index, index + 3).map((entry) => entry.text).join("") }));
  const counted = passages.map((passage) => pairs(passage.text)), seen = new Map<string, number>();
  for (const counts of counted) for (const pair of counts.keys()) seen.set(pair, (seen.get(pair) ?? 0) + 1);
  const weight = (pair: string) => Math.log((passages.length + 1) / ((seen.get(pair) ?? 0) + 1));
  const vector = (counts: Map<string, number>) => { const out = new Map<string, number>(); let norm = 0; for (const [pair, count] of counts) { const value = count * weight(pair); out.set(pair, value); norm += value * value; } return { out, norm: Math.sqrt(norm) || 1 }; };
  const query = vector(pairs(text));
  const scored = counted.map((counts, index) => { const passage = vector(counts); let dot = 0; for (const [pair, value] of query.out) dot += value * (passage.out.get(pair) ?? 0); return { index, score: dot / (query.norm * passage.norm) }; })
    .filter((entry) => entry.score > 0).sort((first, second) => second.score - first.score).slice(0, limit);
  return { text, method: "lexical (character pairs, TF-IDF)", hits: scored.map(({ index, score }) => ({ sentence: passages[index].first.id, scene: passages[index].first.scene, score: Math.round(score * 1000) / 1000, text: clip(passages[index].text) })) };
}
