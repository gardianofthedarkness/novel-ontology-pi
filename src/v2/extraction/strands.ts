/**
 * Story strands in v2 (the user's call, 2026-11-01: "v1 has strands already proven to work to some extent, we can build it
 * directly"): v1's strands (apps/playground/src/data/storyStrands.ts, about 0.85 of scene pairs against hand-read gold)
 * on the v2 reading's world script, with no model call. Each person's scenes are a strand, nobody in two places at once;
 * one scene comes before another only with evidence (a shared person, a flashback, stated times that differ within one
 * top-level place); scenes with none are parallel, and strands merge where their people meet. Then v1's per-fork timeline
 * (src/digger/stage/environment.ts): who comes into each scene from where, at the same place or from elsewhere, which is
 * what spawning reads (a person carries their position from their own last scene at the same place, else arrives).
 *
 * From the script: who is present (`present`), where (`place`, its parents in `places`; `placeBy: "carried"` a place
 * carried from the scene before), its chapter, a flashback (`clock: null`), and its node on the time tree (`at`: its day
 * and part of the day, and whether the scene states it or inherits it). v1 compares only a scene's own stated times.
 */
import { storyStrands, type StoryStrands } from "../../../apps/playground/src/data/storyStrands.js";
import type { StoryPlace, StoryScene, StoryTime, TimePlaceProjection } from "../../../apps/playground/src/data/timePlace.js";
import { forkTimeline, type ForkTimeline } from "../../digger/stage/environment.js";
import type { ReadingScript } from "./script.js";

/** A clock time as v1's part of the day (its slots: late night to night). */
export function partOfClock(hour: number): string {
  return hour < 5 ? "late-night" : hour < 7 ? "dawn" : hour < 11 ? "morning" : hour < 14 ? "noon" : hour < 17 ? "afternoon" : hour < 20 ? "evening" : "night";
}
/** A time tree node's day and part of the day (`t:y1:12-24:late-night`, `t:y1:12-24:15:00`); null in the past or with no day. */
export function nodeTime(node: string | null | undefined): { month: number; day: number; part: string | null } | null {
  const match = node?.match(/^t:y\d+:(\d{1,2})-(\d{1,2})(?::(.+))?$/);
  if (!match) return null;
  const rest = match[3] ?? null, clock = rest?.match(/^(\d{1,2}):(\d{2})$/);
  return { month: Number(match[1]), day: Number(match[2]), part: clock ? partOfClock(Number(clock[1])) : rest };
}

/** The script as v1's time-and-place projection: its scenes, a time for each scene that has a day, its places with their paths. */
export function scriptProjection(script: ReadingScript): TimePlaceProjection {
  const times: StoryTime[] = [], scenes: StoryScene[] = [];
  script.scenes.forEach((scene, index) => {
    const at = nodeTime(scene.at?.node);
    if (at && scene.clock) times.push({ id: `time:${scene.id}`, label: scene.at!.node, gloss: "", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: null, toldFromId: null, date: { month: at.month, day: at.day, derived: false }, partOfDay: at.part, chapterIndex: scene.chapter, storyIndex: index, narrativeIndex: index, anchorSceneId: scene.id, sceneIds: [scene.id] });
    scenes.push({ id: scene.id, index, chapterIndex: scene.chapter, label: scene.id, times: at && scene.clock ? [{ id: `time:${scene.id}`, via: scene.at!.stated ? "anchor" : "inherited" }] : [], flashback: scene.clock === null, placeIds: scene.place ? [scene.place] : [], placeCarried: scene.placeBy === "carried", characterIds: scene.present });
  });
  const pathOf = (id: string): string[] => { const path: string[] = []; for (let at: string | null = id, n = 0; at && n < 16; at = script.places[at]?.parent ?? null, n++) path.unshift(at); return path; };
  const places: StoryPlace[] = Object.entries(script.places).map(([id, place]) => {
    const here = script.scenes.filter((scene) => scene.place === id);
    return { id, label: place.label, sceneIds: here.map((scene) => scene.id), statedScenes: here.filter((scene) => scene.placeBy !== "carried").length, characterIds: [...new Set(here.flatMap((scene) => scene.present))], parentId: place.parent, path: pathOf(id), depth: pathOf(id).length - 1 };
  });
  const counts = new Map<string, number>();
  for (const scene of script.scenes) for (const id of scene.present) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { available: true, times, scenes, places, characters: [...counts].map(([id, n]) => ({ id, label: id, scenes: n })), names: Object.fromEntries(Object.entries(script.places).map(([id, place]) => [id, place.label])) };
}

/** The script's strands (v1's, on the script) and its per-fork timeline: each scene's fork, and who comes in from where. */
export function scriptStrands(script: ReadingScript): { strands: StoryStrands; timeline: ForkTimeline } {
  const projection = scriptProjection(script), strands = storyStrands(projection);
  const timeline = forkTimeline(script.scenes.map((scene, index) => ({ id: scene.id, index, placeId: scene.place, flashback: scene.clock === null, cast: scene.present, events: scene.timeline.map((event) => ({ id: event.id, actors: event.actors })) })), strands);
  return { strands, timeline };
}
