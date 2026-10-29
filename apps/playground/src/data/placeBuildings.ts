import { dateLine, scenePeriod, type StoryTime, type TimePlaceProjection } from "./timePlace.js";

/**
 * The buildings a story names at its places (the building log the viewer
 * builds from `novel stage objects`), seen as of a moment of story time. A
 * named building stands from the scene that first names it (earliest in story
 * order) and stays. The generic buildings each place draws by its kind are
 * not in the log: they always stand. Not canon: the names come from a work
 * model reading event summaries.
 */
export interface NamedBuilding {
  id: string; name: string; placeId: string;
  /** The kind of building the stage draws it as, when it matched one. */
  model: string | null;
  /** Standing at the chosen moment (named by then); otherwise it comes later. */
  standing: boolean;
  /** The story moment it first appears (period id, or null before any time word) and that moment's label. */
  since: string | null; sinceLabel: string;
}
export interface BuildingMoment { id: string; label: string; storyIndex: number }

const timeLabel = (time: StoryTime) => dateLine(time) || time.label;

/** The moments a reader can view the places at: every period not told as a flashback, in story order. */
export function buildingMoments(data: TimePlaceProjection): BuildingMoment[] {
  return data.times.filter((time) => !time.flashback).sort((first, second) => first.storyIndex - second.storyIndex).map((time) => ({ id: time.id, label: timeLabel(time), storyIndex: time.storyIndex }));
}

/** Each place's named buildings as of `at` (a period id; null: the end of the story, everything standing). */
export function buildingsAt(data: TimePlaceProjection, at: string | null): Map<string, NamedBuilding[]> {
  const times = new Map(data.times.map((time) => [time.id, time]));
  const scenes = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const cutoff = at && times.has(at) ? times.get(at)!.storyIndex : Infinity;
  const byPlace = new Map<string, NamedBuilding[]>();
  for (const building of data.buildings ?? []) {
    // Its first appearance: the earliest of its scenes in story order (a scene before any time word comes first).
    const first = building.sceneIds.map((id) => { const scene = scenes.get(id), period = scene ? scenePeriod(scene) : null; return { period, index: period ? times.get(period)?.storyIndex ?? -1 : -1 }; })
      .sort((a, b) => a.index - b.index)[0];
    if (!first) continue;
    const since = first.period, sinceTime = since ? times.get(since) : undefined;
    const entry: NamedBuilding = { id: building.id, name: building.name, placeId: building.placeId, model: building.model, standing: first.index <= cutoff, since, sinceLabel: sinceTime ? timeLabel(sinceTime) : "before the first time word" };
    byPlace.set(building.placeId, [...byPlace.get(building.placeId) ?? [], entry]);
  }
  return byPlace;
}
