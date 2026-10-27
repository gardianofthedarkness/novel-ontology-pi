import { test } from "node:test";
import assert from "node:assert/strict";
import { storyStrands } from "../apps/playground/src/data/storyStrands.js";
import { spiralArrangement, spiralNodeId, strandSummary } from "../apps/playground/src/data/orbitalTimePlace.js";
import type { StoryScene, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

// Invented: Ming and Lan leave the station together (s1), then the story cuts
// between Ming at the port (m1, m2) and Lan at the hill (l1, l2) until they
// meet at the bridge (s6). A recap scene (fb) is told after s6. Lan's second
// scene has no recorded cast and carries hers.
const scene = (id: string, index: number, characterIds: string[], placeIds: string[], flashback = false): StoryScene =>
  ({ id, index, chapterIndex: 0, label: id, times: [{ id: "t_day", via: index ? "inherited" : "anchor" }], flashback, placeIds, placeCarried: false, characterIds });
const data: TimePlaceProjection = {
  available: true,
  times: [{ id: "t_day", label: "that day", gloss: "day", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "rule", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex: 0, narrativeIndex: 0, anchorSceneId: "s1", sceneIds: [] } as never],
  scenes: [
    scene("s1", 0, ["ming", "lan"], ["station"]),
    scene("m1", 1, ["ming"], ["port"]),
    scene("l1", 2, ["lan"], ["hill"]),
    scene("m2", 3, ["ming"], ["port"]),
    scene("l2", 4, [], ["hill"]),
    scene("s6", 5, ["ming", "lan"], ["bridge"]),
    scene("fb", 6, ["ming"], [], true),
    scene("s7", 7, ["ming"], ["bridge"]),
  ],
  places: [], characters: [], names: {},
};

test("strands split where casts part, stay parallel, and merge where they meet", () => {
  const strands = storyStrands(data);
  assert.ok(strands.before("s1", "m1") && strands.before("s1", "l1"));
  assert.ok(strands.before("m2", "s6") && strands.before("l2", "s6"));
  for (const [a, b] of [["m1", "l1"], ["m1", "l2"], ["m2", "l1"], ["m2", "l2"]]) assert.ok(!strands.before(a, b) && !strands.before(b, a), `${a} ∥ ${b}`);
  assert.ok(strands.carried.has("l2"));
  assert.ok(strands.forks.has("s1"));
  assert.ok(strands.merges.has("s6"));
  assert.notEqual(strands.lane.get("m1"), strands.lane.get("l1"));
  assert.equal(strands.parallelPairs >= 4, true);
});

test("a flashback is placed before the scene it is told at, not after its teller", () => {
  const strands = storyStrands(data);
  assert.ok(strands.before("fb", "s7"));
  assert.ok(!strands.before("s6", "fb"));
});

test("Story time strands put parallel strands on separate coils, one moment at one angle", () => {
  const arrangement = spiralArrangement(data, undefined, null, "strands");
  const strands = storyStrands(data);
  const at = (id: string) => arrangement.anchors!.get(spiralNodeId(id))!;
  if (strands.layer.get("m1") === strands.layer.get("l1")) {
    assert.equal(at("m1")[0], at("l1")[0]);
    assert.equal(at("m1")[2], at("l1")[2]);
  }
  assert.ok(Math.abs(at("m1")[1] - at("l1")[1]) > 400);
  assert.equal(arrangement.timeKey.label, "STORY STRANDS →");
  const line = spiralArrangement(data, undefined, null, "line");
  assert.equal(line.timeKey.label, "STORY TIME →");
});

test("time and place check each other: splits and meetings by place, open ends, one person in two places", () => {
  const strands = storyStrands(data);
  assert.deepEqual(strands.checks.find((check) => check.kind === "split"), { kind: "split", sceneId: "s1", status: "places differ" });
  assert.deepEqual(strands.checks.find((check) => check.kind === "merge"), { kind: "merge", sceneId: "s6", status: "meets" });
  // Lan goes to Ming at the port instead: she joins his strand's place.
  const joins = storyStrands({ ...data, scenes: data.scenes.map((entry) => entry.id === "s6" ? { ...entry, placeIds: ["port"] } : entry) });
  assert.equal(joins.checks.find((check) => check.kind === "merge")?.status, "joins");
  // The chapter ends before they meet.
  const apart = storyStrands({ ...data, scenes: data.scenes.slice(0, 5) });
  assert.equal(apart.checks.find((check) => check.kind === "apart")?.count, 2);
  // Both scenes state the same evening, at two places, with Ming in each.
  const evening = { ...data.times[0], id: "t_eve", date: { month: 12, day: 24, derived: false }, partOfDay: "evening" };
  const twice = storyStrands({ ...data, times: [...data.times, evening], scenes: data.scenes.map((entry) => ["m1", "m2"].includes(entry.id) ? { ...entry, times: [{ id: "t_eve", via: "anchor" as const }], placeIds: [entry.id === "m1" ? "port" : "hill"] } : entry) });
  assert.equal(twice.checks.filter((check) => check.kind === "conflict").length, 1);
  assert.match(strandSummary(strands.checks), /splits: 1 at different places/);
});

test("the arrangement changes shape with a signature and shreds in story order", () => {
  const line = spiralArrangement(data, undefined, null, "line"), strands = spiralArrangement(data, undefined, null, "strands");
  assert.notEqual(line.morphKey, strands.morphKey);
  const draws = ["s1", "s6"].map((id) => ({ node: { id: spiralNodeId(id) }, position: [0, 0, 0], radius: 1, role: "main" })) as never;
  const delays = strands.morphDelays!(draws);
  assert.ok(delays.get(spiralNodeId("s1"))! < delays.get(spiralNodeId("s6"))!);
});
