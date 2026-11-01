/**
 * The building level's inventory and its search (docs/v2/borrow-and-spawn.md §6; the user, 2026-11-01): a universe has too
 * many kinds of building to offer Jev them all, so a building's name and the sentences round it in its scenes are searched
 * against the inventory (config/spawning/building-types.json), and Jev chooses among the ten nearest, given the scenes.
 *
 * The search is semantic when an embedding model is configured (the OpenAI-compatible connector,
 * src/ground/connectors/embeddings.ts: the name and the sentences against each type's description and words); without one
 * it is by words: a type's words in the building's own name count most, then their characters' pairs shared with the name
 * (Chinese names compound: 回转寿司店 is a 寿司 shop), then its words in the sentences round it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A type: what it is (saying nothing of its height: that is its scenes'), what the text may call it, its coarse use. */
export interface BuildingType { use: string; describe: string; words: string[] }
const DEFAULT = fileURLToPath(new URL("../../../../config/spawning/building-types.json", import.meta.url));
/** The inventory: every building type, by id. */
export const loadBuildingTypes = (file = DEFAULT): Record<string, BuildingType> => JSON.parse(readFileSync(file, "utf8")).types;

/** What the search reads of a building: its name, and the sentences round it in its scenes. */
export interface BuildingQuery { label: string; around: string[]; /** The uses of the lots round it (its holder's streets'), by how many: what the rest of its ten leans to. */ nearby?: Record<string, number> }
export interface Found { id: string; score: number }

const pairs = (text: string) => { const out = new Set<string>(); const chars = [...text.replace(/[\s\p{P}]/gu, "")]; chars.forEach((c, n) => { if (n) out.add(chars[n - 1] + c); }); return out; };
const cjk = (word: string) => /[぀-ヿ一-鿿]/.test(word);
const has = (text: string, word: string) => (cjk(word) ? text.includes(word) : new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

/** A type's score by words (no model): a word of it in the name (6, and 1 a character of its longest: 便利商店 beats 店), shared character pairs (3 × the share), its words in the sentences (1 each, up to 3). */
export function wordScore(type: BuildingType, query: BuildingQuery): number {
  const label = query.label.replace(/ \(scene \d+\)$/, ""), around = query.around.join("\n");
  const inName = type.words.filter((word) => has(label, word)), longest = Math.max(0, ...inName.map((word) => [...word].length));
  const mine = pairs(label), shared = Math.max(0, ...type.words.filter(cjk).map((word) => { const theirs = pairs(word); return theirs.size ? [...theirs].filter((pair) => mine.has(pair)).length / theirs.size : 0; }));
  const inAround = Math.min(3, type.words.filter((word) => has(around, word)).length);
  return round((inName.length ? 6 : 0) + longest + 3 * shared + inAround);
}
const round = (value: number) => Math.round(value * 1000) / 1000;
const cosine = (a: number[], b: number[]) => { let dot = 0, na = 0, nb = 0; a.forEach((v, n) => { dot += v * b[n]; na += v * v; nb += b[n] * b[n]; }); return na && nb ? dot / Math.sqrt(na * nb) : 0; };

/** Something that turns texts into vectors (the embedding connector's Embedder). */
export interface Embeds { embed(texts: string[]): Promise<number[][]> }
const typeText = (type: BuildingType) => `${type.describe}. ${type.words.join(", ")}`;
const cache = new WeakMap<Embeds, Map<string, number[]>>();

/**
 * The `k` types nearest a building: by meaning when an embedder is given (the name and its sentences against each type's
 * text, the name's own words added on so a type it names stays near), else by words. Ties go to the inventory's order.
 */
export async function searchBuildingTypes(query: BuildingQuery, types: Record<string, BuildingType> = loadBuildingTypes(), k = 10, embedder: Embeds | null = null): Promise<Found[]> {
  const ids = Object.keys(types);
  let scores = ids.map((id) => ({ id, score: wordScore(types[id], query) }));
  if (embedder) {
    const known = cache.get(embedder) ?? new Map<string, number[]>(), missing = ids.filter((id) => !known.has(id));
    if (missing.length) (await embedder.embed(missing.map((id) => typeText(types[id])))).forEach((vector, n) => known.set(missing[n], vector));
    cache.set(embedder, known);
    const [asked] = await embedder.embed([`${query.label.replace(/ \(scene \d+\)$/, "")}\n${query.around.slice(0, 6).join("\n")}`]);
    scores = scores.map(({ id, score }) => ({ id, score: round(10 * cosine(asked, known.get(id)!) + score / 6) }));
  }
  // The rest of the ten, after what the name and its sentences found: the types sharing a use with those, then the uses of
  // the lots round it (what its streets hold), so Jev is never offered a list padded at random.
  const found = new Set(scores.filter((entry) => entry.score > 0).map((entry) => types[entry.id].use)), total = Object.values(query.nearby ?? {}).reduce((sum, n) => sum + n, 0);
  const lean = (id: string) => (found.has(types[id].use) ? 0.5 : 0) + (total ? (0.4 * (query.nearby![types[id].use] ?? 0)) / total : 0);
  return scores.map((entry, n) => ({ ...entry, lean: lean(entry.id), n })).sort((a, b) => b.score - a.score || b.lean - a.lean || a.n - b.n).slice(0, k).map(({ id, score }) => ({ id, score }));
}
