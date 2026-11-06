import { sentenceKey, type HoloScript } from "./holoScript.js";
import type { MovePlan } from "./holoNav.js";
import type { TimePlaceProjection } from "./timePlace.js";
import type { WorldNode } from "../types.js";

/**
 * Read mode: the book's text on one side, its places replayed on the other.
 * Pages are cut from the source sentences (the ids every record cites), so a
 * page knows which scenes and events it tells; when the reader rests on a
 * page, its beats replay once in the place's hologram, then the stage is
 * theirs to explore. Pure helpers; the page is ReadMode.tsx.
 */
export interface ReadSentence { id: string; text: string; paragraph?: boolean }
export interface ReadPage {
  index: number;
  /** sentenceKey of its first and last sentence. */
  from: number; to: number;
  /** Paragraphs; the first continues the previous page's when it does not start one. */
  paragraphs: ReadSentence[][];
  chars: number;
}

/** About a screenful of text per page, ended at a paragraph when one comes soon enough (else at a sentence). */
export function paginate(sentences: ReadSentence[], size = 620): ReadPage[] {
  const pages: ReadPage[] = [];
  let current: ReadPage | null = null;
  for (const sentence of sentences) {
    const key = sentenceKey(sentence.id);
    if (!Number.isFinite(key)) continue;
    const length = [...sentence.text].length;
    if (!current || current.chars >= size && sentence.paragraph || current.chars + length > size * 1.6) {
      current = { index: pages.length, from: key, to: key, paragraphs: [], chars: 0 };
      pages.push(current);
    }
    if (sentence.paragraph || !current.paragraphs.length) current.paragraphs.push([]);
    current.paragraphs.at(-1)!.push(sentence);
    current.to = key;
    current.chars += length;
  }
  return pages;
}

export interface SceneSpan { id: string; placeId: string | null; from: number; to: number }
/** Where each scene of the book sits in the text, and its place (most specific). */
export function sceneSpans(data: TimePlaceProjection, world: { interiors: Record<string, { nodes: WorldNode[] }> }): SceneSpan[] {
  const ranges = new Map<string, WorldNode["sourceRange"]>();
  for (const graph of Object.values(world.interiors)) for (const node of graph.nodes) if (node.kind === "scene" && node.sourceRange) ranges.set(node.id, node.sourceRange);
  return data.scenes.flatMap((scene) => {
    const range = ranges.get(scene.id);
    return range ? [{ id: scene.id, placeId: scene.placeIds[0] ?? null, from: range.startBlock * 1_000_000 + range.startSentence, to: range.endBlock * 1_000_000 + range.endSentence }] : [];
  }).sort((first, second) => first.from - second.from);
}

const overlap = (a: { from: number; to: number }, b: { from: number; to: number }) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from) + 1);

/** The scene a page mostly tells (its place is the stage), and every scene it touches. */
export function pageScene(page: Pick<ReadPage, "from" | "to">, scenes: SceneSpan[]): { main: SceneSpan | null; touched: SceneSpan[] } {
  const touched = scenes.filter((scene) => overlap(scene, page) > 0);
  const main = [...touched].sort((first, second) => overlap(second, page) - overlap(first, page) || Number(!!second.placeId) - Number(!!first.placeId))[0] ?? null;
  return { main, touched };
}

/**
 * The beats a page replays in its place's script: the records it tells, and
 * a scene's title card when the scene starts on it. Null when the page tells
 * nothing of this place (narration between scenes).
 */
export function reelWindow(script: HoloScript, page: Pick<ReadPage, "from" | "to">, sceneIds: string[]): { from: number; to: number } | null {
  const scenes = new Set(sceneIds);
  const hits = script.beats.flatMap((beat, index) => {
    if (!scenes.has(beat.sceneId) || !beat.source) return [];
    if (beat.kind === "scene") return beat.source.from >= page.from && beat.source.from <= page.to ? [index] : [];
    return overlap(beat.source, page) > 0 ? [index] : [];
  });
  if (hits.length) return { from: Math.min(...hits), to: Math.max(...hits) };
  // Only narration of a scene here: its title card, with everyone where they are.
  const card = script.beats.findIndex((beat) => beat.kind === "scene" && scenes.has(beat.sceneId));
  return card >= 0 ? { from: card, to: card } : null;
}

/** A book's own id under a universe's book prefix ("3:scene_000008" → "scene_000008"). */
export const localId = (id: string) => id.slice(id.lastIndexOf(":") + 1);

/** The prepared plan keys moves by stored event id and starts by the book's scene id; the stage's beats are `<scene>:<record>`, scenes maybe book-prefixed.
 * A beat telling several records (the same moment told twice) carries the moves of each, a person's last one standing. */
export function keyedPlan(plan: MovePlan, script: HoloScript): MovePlan {
  const moves: MovePlan["moves"] = {}, starts: MovePlan["starts"] = {}, notes: NonNullable<MovePlan["notes"]> = {};
  for (const beat of script.beats) {
    const records = [beat.id.slice(beat.sceneId.length + 1), ...beat.also ?? []], scene = localId(beat.sceneId);
    const planned = beat.kind === "scene" ? [] : records.flatMap((record) => plan.moves[record] ?? []);
    if (planned.length) moves[beat.id] = [...new Map(planned.map((move) => [move.actor, move])).values()];
    if (plan.starts[scene]) starts[beat.sceneId] = plan.starts[scene];
    if (plan.notes?.[scene]) notes[beat.sceneId] = plan.notes[scene];
  }
  return { ...plan, moves, starts, notes };
}

/** The prepared plan of a stage's place: by its id, or by its book id when the stage shows the loaded book's place under a universe prefix. */
export function placePlan(stage: StagePlan, placeId: string, volume: number | null): MovePlan | null {
  if (stage.places[placeId]) return stage.places[placeId];
  const [book] = placeId.split(":");
  return volume !== null && book === String(volume) ? stage.places[localId(placeId)] ?? null : null;
}

/** Read mode's prepared animation as served (novel stage prep). */
export interface StagePlan { inputs: string; preparedAt: string; architecture: Record<string, string>; places: Record<string, MovePlan>; counts: Record<string, number> }
