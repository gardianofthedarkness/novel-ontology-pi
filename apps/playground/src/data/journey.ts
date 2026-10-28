import type { TimePlaceProjection } from "./timePlace.js";

/**
 * A character's journey (view only): the existing Story time and Places views
 * narrowed to the scenes one character is in, with that character traced.
 * Story time becomes their own spiral (a tunnel through their life in story
 * order); Places shows only those scenes above the map, their path through
 * them. Ids are the book's own; a universe projection prefixes them with the
 * volume (`2:scene_001`), so both forms match.
 */
export interface Journey { volume: number; characterId: string; label: string; sceneIds: string[] }

const forms = (volume: number, id: string) => [id, `${volume}:${id}`];

/** The projection with only the journey's scenes (times, places and names stay, so labels still read). */
export function journeyProjection(data: TimePlaceProjection, journey: Journey): TimePlaceProjection {
  const wanted = new Set(journey.sceneIds.flatMap((id) => forms(journey.volume, id)));
  return { ...data, scenes: data.scenes.filter((scene) => wanted.has(scene.id)) };
}

/** The journey's character as the projection names it, to trace through Places and Story time. */
export function journeyCharacter(data: TimePlaceProjection, journey: Journey): string | null {
  const ids = new Set(data.characters.map((character) => character.id));
  return forms(journey.volume, journey.characterId).find((id) => ids.has(id)) ?? null;
}
