import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeTime, partOfClock, scriptStrands } from "../../src/reading/strands.js";
import type { ReadingScript, ScriptScene } from "../../src/reading/script.js";

// Story strands in v2 (src/reading/strands.ts): v1's strands on the world script, and the per-fork timeline.
const scene = (id: string, chapter: number, place: string, present: string[], node: string, extra: Partial<ScriptScene> = {}): ScriptScene => ({ id, chapter, place, placeBy: "environment", clock: [0, 0], present, stayed: [], firstSeen: [], timeline: [], at: { node, stated: true }, ...extra });

test("a time tree node's day and part of the day, a clock time as v1's part", () => {
  assert.deepEqual(nodeTime("t:y1:12-24:late-night"), { month: 12, day: 24, part: "late-night" });
  assert.deepEqual(nodeTime("t:y1:12-24:15:00"), { month: 12, day: 24, part: "afternoon" });
  assert.deepEqual(nodeTime("t:y1:12-25"), { month: 12, day: 25, part: null });
  assert.equal(nodeTime("t:past:2day"), null);
  assert.deepEqual([partOfClock(2), partOfClock(9), partOfClock(21)], ["late-night", "morning", "night"]);
});

test("two people apart are two strands that meet; each person enters from their own last scene", () => {
  const script: ReadingScript = { version: 2, from: "v2-reading", places: { city: { label: "city", scale: "city", parent: null }, school: { label: "school", scale: "building", parent: "city" }, station: { label: "station", scale: "building", parent: "city" }, plaza: { label: "plaza", scale: "street", parent: "city" } }, scenes: [
    scene("s1", 0, "school", ["a", "b"], "t:y1:12-24:morning"),
    scene("s2", 0, "school", ["a"], "t:y1:12-24:noon"),
    scene("s3", 0, "station", ["b"], "t:y1:12-24:noon"),
    scene("s4", 0, "school", ["a"], "t:y1:12-24:afternoon"),
    scene("s5", 0, "plaza", ["a", "b"], "t:y1:12-24:evening"),
  ] };
  const { strands, timeline } = scriptStrands(script);
  assert.equal(strands.parallelPairs, 1, "s3 (b at the station at noon) is parallel to s2 (a at the school at noon) only: its stated time puts it before s4");
  assert.ok(timeline.forks.length >= 2, "b's line forks off");
  const into = (id: string) => Object.fromEntries((timeline.handoffs.get(id) ?? []).map((entry) => [entry.person, entry]));
  assert.deepEqual([into("s4").a.from, into("s4").a.samePlace], ["s2", true], "a carries on at the school");
  assert.deepEqual([into("s5").b.from, into("s5").b.samePlace], ["s3", false], "b comes to the plaza from the station, not from a's scenes");
  assert.equal(into("s1").a.from, null, "a first appears");
});
