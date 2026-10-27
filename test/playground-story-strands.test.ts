import { test } from "node:test";
import assert from "node:assert/strict";
import { storyStrands } from "../apps/playground/src/data/storyStrands.js";
import { spiralArrangement, spiralNodeId } from "../apps/playground/src/data/orbitalTimePlace.js";
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

test("Story time strands lay parallel scenes on one ruling of a helicoid, at different radii", () => {
  const arrangement = spiralArrangement(data, undefined, null, "strands");
  const strands = storyStrands(data);
  const radius = (id: string) => { const point = arrangement.anchors!.get(spiralNodeId(id))!; return Math.hypot(point[1], point[2]); };
  const angle = (id: string) => { const point = arrangement.anchors!.get(spiralNodeId(id))!; return Math.atan2(point[2], point[1]); };
  const sameLayer = ["m1", "l1"].every((id) => strands.layer.get(id) === strands.layer.get("m1"));
  if (sameLayer) assert.ok(Math.abs(angle("m1") - angle("l1")) < 1e-9);
  assert.notEqual(Math.round(radius("m1")), Math.round(radius("l1")));
  assert.equal(arrangement.timeKey.label, "STORY STRANDS →");
  const line = spiralArrangement(data, undefined, null, "line");
  assert.equal(line.timeKey.label, "STORY TIME →");
});
