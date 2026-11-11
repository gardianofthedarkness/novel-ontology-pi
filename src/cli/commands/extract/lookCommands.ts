/**
 * `novel look context` (milestones M14; docs/v3/design.html#models-and-settings \u00a710): what the main agent needs for the look pass,
 * the step after a book's reading and before its terrain loop that sets the world generator for the book's places from
 * the text alone. The place tree top down (the book, its cities, districts, streets), each place with its environment
 * sentences (the reading's kinds), the words in them that a setting can answer, the warehouse parts the text names (a
 * model written for this universe is named by its label), and the keys a place may set. Bounded; no model call.
 */
import { resolve } from "node:path";
import { schema } from "../../../v2/settings.js";
import { ownParts, findParts, type Part } from "../../../v2/models/warehouse.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";
import { stageInputs } from "./stageCommands.js";
import { readingOf } from "../../../v2/models/models.js";

export interface LookPlace { id: string; label?: string; parentId?: string | null; sceneIds: string[] }
export interface LookInputs { places: LookPlace[]; scenes: { id: string; sentences: string[] }[]; kinds: Record<string, { kind: string }>; names?: Record<string, string> }

/** Words a setting can answer, in the languages the books come in (escaped: the repository is public). */
const WORDS: Record<string, RegExp> = {
  street: /street|road|avenue|boulevard|\u8857|\u9053\u8def|\u9a6c\u8def|\u5927\u9053|\u5c0f\u5df7/i,
  building: /building|tower|skyscraper|block|\u5efa\u7b51|\u5927\u697c|\u9ad8\u697c|\u5927\u53a6|\u6469\u5929/i,
  tree: /tree|forest|park|green|\u6811|\u68ee\u6797|\u516c\u56ed|\u7eff\u5316|\u8349\u576a/i,
  light: /lamp|street ?light|neon|sign|screen|\u8def\u706f|\u706f|\u9713\u8679|\u5c4f\u5e55|\u62db\u724c/i,
  vehicle: /car|bus|truck|train|tram|\u6c7d\u8f66|\u5df4\u58eb|\u516c\u4ea4|\u7535\u8f66|\u5217\u8f66|\u5361\u8f66/i,
  turbine: /turbine|windmill|wind\s?farm|\u98ce\u529b|\u98ce\u8f66|\u98ce\u7535/i,
  water: /river|canal|bridge|harbou?r|\u6cb3|\u8fd0\u6cb3|\u6865|\u6e2f/i,
  sky: /sky|cloud|rain|snow|fog|storm|\u5929\u7a7a|\u4e91|\u96e8|\u96ea|\u96fe|\u98ce\u66b4/i,
  underground: /underground|subway|metro|tunnel|\u5730\u4e0b|\u5730\u94c1|\u96a7\u9053/i,
  industry: /factory|chimney|plant|warehouse|\u5de5\u5382|\u70df\u56f1|\u4ed3\u5e93/i,
  crowd: /crowd|busy|bustling|deserted|empty|\u4eba\u7fa4|\u70ed\u95f9|\u7e41\u534e|\u7a7a\u8361|\u51b7\u6e05/i,
};
const KIND_SCORE: Record<string, number> = { environment: 3, fact: 1, narration: 1 };
const clip = (text: string, most = 160) => (text.length > most ? `${text.slice(0, most - 1)}\u2026` : text);

/** The look pass's context for a book (or one place and its children): top down, each place's telling sentences, the words, the parts, the keys. */
export async function lookContext(novelDir: string, options: { place?: string; top?: number; inputs?: LookInputs; sentences?: Map<string, { text: string }>; parts?: Part[] } = {}) {
  const top = Math.min(40, Math.max(1, options.top ?? 8));
  // The places and which scenes stand in them: the stage's inputs (the world's places for a world-first book); the scenes'
  // sentence ids and each sentence's kind: the reading's own data file.
  const inputs = options.inputs ?? (await (async () => {
    const got = await stageInputs(resolve(novelDir)) as unknown as { data: { places: LookPlace[] }; names: Record<string, string> };
    const reading = await readingOf(resolve(novelDir)) as { scenes?: { id: string; sentences: string[] }[]; kinds?: Record<string, { kind: string }> };
    return { places: got.data.places, scenes: (reading.scenes ?? []).map((scene) => ({ id: scene.id, sentences: scene.sentences ?? [] })), kinds: reading.kinds ?? {}, names: got.names };
  })());
  const sentences = options.sentences ?? (await loadWorkspaceSentences(resolve(novelDir)));
  const parts = options.parts ?? (await ownParts(resolve(novelDir)));
  const sceneSentences = new Map(inputs.scenes.map((scene) => [scene.id, scene.sentences ?? []]));
  const nameOf = (id: string) => inputs.names?.[id] ?? inputs.places.find((place) => place.id === id)?.label ?? id;
  // One place's sentences, scored: environment first, then facts and narration that name something a setting answers.
  const telling = (sceneIds: string[]) => {
    const rows: { id: string; scene: string; kind: string; text: string; score: number; words: string[] }[] = [];
    for (const scene of sceneIds) for (const id of sceneSentences.get(scene) ?? []) {
      const kind = inputs.kinds[id]?.kind ?? "narration", text = sentences.get(id)?.text ?? "";
      if (!text || !(kind in KIND_SCORE)) continue;
      const words = Object.entries(WORDS).filter(([, pattern]) => pattern.test(text)).map(([word]) => word);
      const score = KIND_SCORE[kind] + words.length;
      if (kind === "environment" || words.length) rows.push({ id, scene, kind, text, score, words });
    }
    rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const counts: Record<string, number> = {}; for (const row of rows) for (const word of row.words) counts[word] = (counts[word] ?? 0) + 1;
    return { rows, counts };
  };
  // The parts the text names: a model of this universe by its label in the sentences; a kit part by the words found.
  const namedParts = (rows: { text: string }[], counts: Record<string, number>) => {
    const own = parts.filter((part) => part.note && rows.some((row) => part.note!.split(" ").some((piece) => piece.length >= 2 && row.text.includes(piece)))).map((part) => ({ ref: part.ref, label: part.note, size: [part.footprint[0], part.height, part.footprint[1]] }));
    return { own, words: Object.keys(counts) };
  };
  const byParent = new Map<string | null, LookPlace[]>();
  for (const place of inputs.places) { const key = place.parentId && inputs.places.some((other) => other.id === place.parentId) ? place.parentId : null; (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(place); }
  const subtreeScenes = (id: string): string[] => [...(inputs.places.find((place) => place.id === id)?.sceneIds ?? []), ...(byParent.get(id) ?? []).flatMap((child) => subtreeScenes(child.id))];
  const roots = options.place ? inputs.places.filter((place) => place.id === options.place) : (byParent.get(null) ?? []);
  if (options.place && !roots.length) throw new Error(`No place ${options.place} in the book's places (novel look context ${novelDir} lists them).`);
  const tree: unknown[] = [];
  const walk = (place: LookPlace, depth: number) => {
    const ownScenes = place.sceneIds ?? [], all = subtreeScenes(place.id);
    if (!all.length) return;
    const { rows, counts } = telling(ownScenes), named = namedParts(rows, counts);
    tree.push({ id: place.id, label: nameOf(place.id), parent: place.parentId ?? null, depth, scenes: ownScenes.length, scenesBelow: all.length - ownScenes.length, words: counts, parts: named.own, environment: rows.slice(0, top).map((row) => ({ id: row.id, scene: row.scene, kind: row.kind, words: row.words, text: clip(row.text) })) });
    for (const child of (byParent.get(place.id) ?? []).sort((a, b) => subtreeScenes(b.id).length - subtreeScenes(a.id).length)) walk(child, depth + 1);
  };
  for (const root of roots.sort((a, b) => subtreeScenes(b.id).length - subtreeScenes(a.id).length)) walk(root, 0);
  // The book as a whole: every scene's telling sentences, for the look every place shares.
  const whole = telling(inputs.scenes.map((scene) => scene.id)), wholeParts = namedParts(whole.rows, whole.counts);
  const kitHints: Record<string, string[]> = {};
  for (const word of Object.keys(whole.counts).filter((word) => ["tree", "light", "vehicle", "turbine", "industry"].includes(word))) kitHints[word] = (await findParts(word === "light" ? "lamp street light" : word === "vehicle" ? "car bus" : word === "industry" ? "factory chimney" : word, { top: 3, novelDir: resolve(novelDir) })).parts.map((part) => part.ref);
  const all = schema();
  return {
    novel: resolve(novelDir), places: inputs.places.length, shown: tree.length, top,
    book: { scenes: inputs.scenes.length, words: whole.counts, parts: wholeParts.own, kitParts: kitHints, environment: whole.rows.slice(0, top).map((row) => ({ id: row.id, scene: row.scene, kind: row.kind, words: row.words, text: clip(row.text) })) },
    tree,
    settable: { book: Object.entries(all.keys).filter(([, entry]) => entry.layers.includes("book")).map(([key]) => key), place: Object.entries(all.keys).filter(([, entry]) => entry.layers.includes("place")).map(([key]) => key) },
    next: `novel settings explain <key>; novel settings set ${novelDir} <key> '<JSON>' [--place <id>] --why "<sentence ids>: <what they say>"; novel warehouse use <part> for <slot> ${novelDir} [--place <id>] --why ...; the last change with --before`,
  };
}
