import type { HoloScript } from "./holoScript.js";
import type { MovePlan } from "./holoNav.js";
import type { ArchitectureKind } from "./placeArchitecture.js";

/**
 * Stage clips: a book's prepared animation cut into short pieces to flip
 * through (phones too). A clip is one scene of one place, cut to the run of
 * beats where the most people move; the picks spread over the book's
 * buildings, a couple per place at most, and play in reading order.
 */
export interface StageClip {
  id: string; placeId: string; sceneId: string;
  /** What the scene is (its summary), its number on the place's stage ("Scene 4") and time, from its title card. */
  title: string; scene: string; when?: string;
  place: string; kind: ArchitectureKind | null;
  /** Beat indices of the place's script the clip replays (inclusive). */
  from: number; to: number;
  moves: number; movers: number;
  /** Where it starts in the text (sentenceKey), for reading order. */
  at: number;
}

const CLIP_BEATS = 9;

/** The best clip of each scene of a place: its stretch of at most CLIP_BEATS beats with the most moves (none without moves). */
export function sceneClips(script: HoloScript, plan: MovePlan): StageClip[] {
  const scenes = new Map<string, number[]>();
  script.beats.forEach((beat, index) => { const list = scenes.get(beat.sceneId) ?? scenes.set(beat.sceneId, []).get(beat.sceneId)!; list.push(index); });
  const place = script.places[0];
  return [...scenes].flatMap(([sceneId, indices]) => {
    const moved = (index: number) => plan.moves[script.beats[index].id]?.length ?? 0;
    let best = { from: indices[0], to: Math.min(indices.at(-1)!, indices[0] + CLIP_BEATS - 1), moves: -1 };
    for (const start of indices) {
      const to = Math.min(indices.at(-1)!, start + CLIP_BEATS - 1);
      let moves = 0;
      for (let index = start; index <= to; index++) moves += moved(index);
      if (moves > best.moves) best = { from: start, to, moves };
    }
    if (best.moves <= 0) return [];
    const movers = new Set<string>();
    for (let index = best.from; index <= best.to; index++) for (const move of plan.moves[script.beats[index].id] ?? []) movers.add(move.actor);
    const card = script.beats[indices[0]];
    const at = script.beats.slice(best.from, best.to + 1).find((beat) => beat.source)?.source?.from ?? card.source?.from ?? Infinity;
    return [{ id: `${place?.id ?? script.title}:${sceneId}`, placeId: place?.id ?? "", sceneId, title: card.text || card.title, scene: card.title, when: card.when, place: place?.label ?? script.title, kind: place?.kind ?? null, from: best.from, to: best.to, moves: best.moves, movers: movers.size, at }];
  });
}

/** A book's clips: the busiest per building kind first, then the busiest overall, at most `perPlace` per place (by default a fair share, two or more) and `max` in all; in reading order. */
export function pickClips(candidates: StageClip[], { max = 10, perPlace = Math.max(2, Math.ceil(max / Math.max(1, new Set(candidates.map((clip) => clip.placeId)).size))) } = {}): StageClip[] {
  const score = (clip: StageClip) => clip.moves + clip.movers;
  const ranked = [...candidates].sort((first, second) => score(second) - score(first) || first.at - second.at);
  const chosen: StageClip[] = [], perPlaceCount = new Map<string, number>();
  const take = (clip: StageClip) => { chosen.push(clip); perPlaceCount.set(clip.placeId, (perPlaceCount.get(clip.placeId) ?? 0) + 1); };
  const kinds = new Set<string>();
  for (const clip of ranked) if (chosen.length < max && !kinds.has(String(clip.kind))) { kinds.add(String(clip.kind)); take(clip); }
  for (const clip of ranked) if (chosen.length < max && !chosen.includes(clip) && (perPlaceCount.get(clip.placeId) ?? 0) < perPlace) take(clip);
  return chosen.sort((first, second) => first.at - second.at);
}
