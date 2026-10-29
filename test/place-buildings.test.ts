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

test("a simulated place as of a moment: named lots from their scene, damage from the hits so far, things where they last stood", async () => {
  const { simulationAt, migrationsAt } = await import("../apps/playground/src/data/placeBuildings.js");
  const lot = (name: string | null, since: string | null) => ({ name, since, model: "tower-c", i0: 0, j0: 0, nx: 2, nz: 2, floors: 5, cells: 20 });
  const simulated = { ...data, simulation: {
    strands: [{ id: "k", title: "白井", from: "s1", to: "s2" }],
    places: { tower: { strand: "k", label: "钟塔", kind: "site", grid: { nx: 32, nz: 24 }, lots: [lot("钟塔", null), lot("仓库", "s2"), lot(null, null)] } },
    things: [{ id: "k:t1", name: "直升机", model: null, shape: "oval", placements: [{ scene: "s2", place: "tower", x: 9, y: 20, z: 9, w: 12, h: 4, d: 8, turn: 0 }, { scene: "s1", place: "tower", x: 1, y: 0, z: 1, w: 12, h: 4, d: 8, turn: 0 }] }],
    hits: [{ scene: "s1", place: "tower", event: 2, x: 4, y: 6, z: 4, r: 4, strength: 0.9, lots: [{ lot: 0, lost: 5 }], things: [] }, { scene: "s2", place: "tower", event: 1, x: 4, y: 6, z: 4, r: 8, strength: 0.9, lots: [{ lot: 0, lost: 10 }], things: ["k:t1"] }],
    migrations: [{ scene: "s2", person: "a", from: "tower", to: "station" }, { scene: "s2", person: "b", from: "tower", to: "station" }],
  } } as unknown as TimePlaceProjection;
  const early = simulationAt(simulated, "t1").get("tower")!, late = simulationAt(simulated, null).get("tower")!;
  assert.deepEqual(early.lots.map((entry) => [entry.name, entry.standing, entry.damage]), [["钟塔", true, 0.25], ["仓库", false, 0], [null, true, 0]]);
  assert.deepEqual(late.lots[0].damage, 0.75, "damage adds up over the hits so far");
  assert.deepEqual([early.things[0].x, early.things[0].broken, late.things[0].x, late.things[0].broken], [1, false, 9, true], "a thing stands where it last stood, and breaks with the hit that breaks it");
  assert.deepEqual(early.hits.map((hit) => hit.standing), [true, false]);
  assert.deepEqual(migrationsAt(simulated, "t1"), [{ scene: "s2", from: "tower", to: "station", people: ["a", "b"], standing: false }], "people moving together in one scene are one move");
});
