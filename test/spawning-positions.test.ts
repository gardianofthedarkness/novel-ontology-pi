import assert from "node:assert/strict";
import { test } from "node:test";
import { closeInTime, floorByWords, spawnScenes, type Entry, type Target } from "../src/v2/spawning/positions.js";
import type { ScriptScene } from "../src/v2/extraction/script.js";

// Spawning positions (docs/v2/spawning.md): people and things in one pass, by rule.
const scene = (id: string, place: string, present: string[], node: string, extra: Partial<ScriptScene> = {}): ScriptScene => ({ id, chapter: 0, place, placeBy: "environment", clock: [0, 0], present, stayed: [], firstSeen: [], timeline: [], at: { node, stated: true }, ...extra });
const world: Record<string, Target> = {
  tower: { place: "tower", kind: "building", box: [0, 0, 40, 30, 0], bottom: 0, floors: 20 },
  shop: { place: "shop", kind: "part", box: [5, 5, 10, 8, 0], bottom: 0, floors: 1 },
  plaza: { place: "plaza", kind: "area", box: [200, 0, 60, 60, 0], bottom: 0, floors: 0 },
};
const target = (_: string, place: string) => world[place] ?? null;

test("close in time: the same day, the same or the next part of it", () => {
  assert.ok(closeInTime("t:y1:12-24:morning", "t:y1:12-24:noon"));
  assert.ok(!closeInTime("t:y1:12-24:morning", "t:y1:12-24:evening"));
  assert.ok(!closeInTime("t:y1:12-24:night", "t:y1:12-25:late-night"), "another day");
  assert.ok(closeInTime("t:y1:12-24:15:00", "t:y1:12-24:evening"), "a clock time by its hour");
});

test("a floor by a spatial word: the roof, under the street, a numbered floor, the street in front", () => {
  assert.deepEqual(floorByWords([{ text: "楼顶", level: "roof" }], 20), { floor: 20, outside: true });
  assert.deepEqual(floorByWords([{ text: "地下二层", level: "underground" }], 20), { floor: -2, outside: false });
  assert.deepEqual(floorByWords([{ text: "三楼", level: "inside" }], 20), { floor: 3, outside: false });
  assert.deepEqual(floorByWords([{ text: "街上", level: "street" }], 20), { floor: 0, outside: true });
  assert.equal(floorByWords([{ text: "走廊", level: "inside" }], 20), null, "inside, but which floor the text does not say");
});

test("people carry on at the same place close in time, else start fresh; things stay until picked up", () => {
  const scenes = [
    scene("s1", "tower", ["a", "b"], "t:y1:12-24:morning", { things: [{ id: "car", holder: null }], spatial: [{ text: "楼顶", sentence: "x", level: "roof", who: ["b"] }] }),
    scene("s2", "tower", ["a"], "t:y1:12-24:noon", { things: [{ id: "sword", holder: "a" }] }),
    scene("s3", "plaza", ["b", "c"], "t:y1:12-24:noon", { timeline: [{ type: "event", id: "e1", actors: ["b", "c"] }] }),
    scene("s4", "tower", ["a"], "t:y1:12-24:night", { things: [{ id: "car", holder: null }] }),
    scene("s5", "shop", ["a"], "t:y1:12-24:night", { clock: null }),
  ];
  const entries = new Map<string, Entry[]>([["s2", [{ person: "a", from: "s1", samePlace: true }]], ["s3", [{ person: "b", from: "s1", samePlace: false }, { person: "c", from: null, samePlace: false }]], ["s4", [{ person: "a", from: "s2", samePlace: true }]], ["s5", [{ person: "a", from: null, samePlace: false }]]]);
  const starts = spawnScenes(scenes, entries, target), of = (id: string, who: string) => starts.get(id)!.find((start) => start.who === who)!;
  assert.equal(of("s1", "b").floor, 20, "on the roof, as the text says");
  assert.ok(["default", "speaking"].includes(of("s1", "a").by) && of("s1", "a").floor! >= 1 && of("s1", "a").floor! <= 20, "no clue: a random floor");
  assert.deepEqual([of("s2", "a").by, of("s2", "a").at], ["carried", of("s1", "a").at], "the same place, the next part of the day: carried on");
  assert.equal(of("s2", "sword").by, "holder");
  assert.equal(of("s3", "b").by, "ground", "from another place: fresh, on the plaza's ground");
  assert.ok(Math.hypot(of("s3", "c").at[0] - of("s3", "b").at[0], of("s3", "c").at[1] - of("s3", "b").at[1]) <= 5.01, "the first event's actors within speaking distance");
  assert.notEqual(of("s4", "a").by, "carried", "the same place, but evening is not close to noon: fresh");
  assert.deepEqual([of("s4", "car").by, of("s4", "car").at], ["stays", of("s1", "car").at], "the car stays where it was left");
  assert.equal(of("s5", "a").by, "part", "in a shop: inside it");
});

test("Jev's spot question reads the scene's own text: the lines naming those asked about or saying where, their neighbours, its opening", async () => {
  const { spawnLines, spawnSpotMode } = await import("../src/v2/context/spawnModes.js");
  const { compose } = await import("../src/v2/context/engine.js");
  const lines = Array.from({ length: 20 }, (_, n) => ({ id: `s${n}`, text: n === 10 ? "A走上了楼顶。" : `line ${n}` }));
  const kept = spawnLines(lines, ["A"], ["s15"]);
  assert.deepEqual(kept.map((line) => line.id), ["s0", "s1", "s2", "s3", "s9", "s10", "s11", "s14", "s15", "s16"]);
  assert.ok(kept[4].text.startsWith("……"), "a break where lines are skipped");
  const composed = await compose(spawnSpotMode, { scene: { id: "x", label: "4", when: null }, place: { name: "a school", kind: "building", floors: 5 }, subjects: [{ id: "a", name: "A", kind: "person" }], spots: [{ letter: "A", said: "floor 1" }, { letter: "B", said: "on its roof" }], lines: kept }, null);
  assert.deepEqual(Object.keys(composed.document as object), ["task", "scene", "who", "spots"]);
  assert.deepEqual(composed.questions.map((question) => [question.key, question.options]), [["a", ["A", "B"]]]);
});
