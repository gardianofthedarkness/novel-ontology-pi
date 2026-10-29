import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingMoments, buildingsAt } from "../apps/playground/src/data/placeBuildings.js";
import type { StoryScene, StoryTime, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

const time = (id: string, storyIndex: number, extra: Partial<StoryTime> = {}) => ({ id, label: id, gloss: "", family: "date", role: "ADVANCE", flashback: false, storyIndex, narrativeIndex: storyIndex, date: null, partOfDay: null, ...extra }) as unknown as StoryTime;
const scene = (id: string, index: number, period: string | null): StoryScene => ({ id, index, chapterIndex: 0, label: id, times: period ? [{ id: period, via: "anchor" }] : [], flashback: false, placeIds: ["tower"], placeCarried: false, characterIds: [] });
const data = { available: true, characters: [], names: {}, places: [],
  times: [time("t1", 0, { date: { month: 12, day: 24 } } as Partial<StoryTime>), time("t2", 1), time("fb", -1, { flashback: true })],
  scenes: [scene("s0", 0, null), scene("s1", 1, "t1"), scene("s2", 2, "t2"), scene("s3", 3, "fb")],
  buildings: [
    { id: "tower|钟塔", name: "钟塔", placeId: "tower", model: "skyscraper", size: 40, sceneIds: ["s2", "s1"] },
    { id: "tower|仓库", name: "仓库", placeId: "tower", model: null, size: null, sceneIds: ["s2"] },
    { id: "tower|旧楼", name: "旧楼", placeId: "tower", model: "office", size: 20, sceneIds: ["s0"] },
  ] } as unknown as TimePlaceProjection;

test("named buildings stand from the story moment that first names them, and stay", () => {
  assert.deepEqual(buildingMoments(data).map((moment) => moment.id), ["t1", "t2"], "flashback periods are not moments to view the places at");
  const standing = (at: string | null) => (buildingsAt(data, at).get("tower") ?? []).filter((entry) => entry.standing).map((entry) => entry.name).sort();
  assert.deepEqual(standing("t1"), ["旧楼", "钟塔"], "named before any time word, or in the first period");
  assert.deepEqual(standing("t2"), ["仓库", "旧楼", "钟塔"]);
  assert.deepEqual(standing(null), ["仓库", "旧楼", "钟塔"], "the end of the story: everything");
  const tower = buildingsAt(data, "t1").get("tower")!.find((entry) => entry.name === "钟塔")!;
  assert.deepEqual([tower.since, tower.sinceLabel], ["t1", "12-24"], "its first appearance is the earliest in story order, not reading order");
});
