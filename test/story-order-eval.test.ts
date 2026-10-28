import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scoreStoryOrder, timeplacePrediction } from "../src/cli/commands/extract/storyOrderEval.js";

// Two strands split after s1 and meet again at s6: a1,a2 (one place) and b1,b2 (another).
const gold = {
  policy: "story-order-gold-v1",
  scenes: ["s0", "s1", "a1", "a2", "b1", "b2", "s6"],
  excluded: [{ sceneId: "s0", reason: "heading" }],
  strands: [
    { id: "a", sceneIds: ["s1", "a1", "a2", "s6"] },
    { id: "b", sceneIds: ["s1", "b1", "b2", "s6"] },
  ],
  edges: [] as { from: string; to: string; certain?: boolean }[],
};

test("a single story line orders every parallel pair and scores them as errors", () => {
  const report = scoreStoryOrder(gold, { kind: "order", sceneIds: ["s1", "a1", "b1", "a2", "b2", "s6"] });
  assert.equal(report.scoredPairs, 15);
  assert.equal(report.goldParallelPairs, 4);
  assert.equal(report.orderedAccuracy, 1);
  assert.equal(report.parallelRecall, 0);
  assert.equal(report.falseOrderPairs, 4);
  assert.equal(report.pairAccuracy, Math.round((11 / 15) * 10000) / 10000);
});

test("a strand graph that splits and merges matches the gold exactly", () => {
  const report = scoreStoryOrder(gold, { kind: "dag", edges: [["s1", "a1"], ["a1", "a2"], ["a2", "s6"], ["s1", "b1"], ["b1", "b2"], ["b2", "s6"]] });
  assert.equal(report.pairAccuracy, 1);
  assert.equal(report.parallelRecall, 1);
  assert.equal(report.parallelPrecision, 1);
});

test("equal ranks are unordered, reversed pairs are counted, missing scenes are reported", () => {
  const report = scoreStoryOrder(gold, { kind: "ranks", ranks: { s1: 0, a1: 1, a2: 2, b1: 1, b2: 2, s6: 1 } });
  assert.ok(report.reversedPairs > 0);
  const partial = scoreStoryOrder(gold, { kind: "order", sceneIds: ["s1", "a1"] });
  assert.equal(partial.missingPairs, 14);
});

test("likely edges and listed pairs are left out of scoring; cycles are refused", () => {
  const withLikely = { ...gold, edges: [{ from: "a2", to: "b2", certain: false }], uncertainPairs: [["a1", "b1"]] as [string, string][] };
  const report = scoreStoryOrder(withLikely, { kind: "dag", edges: [] });
  assert.equal(report.uncertainPairs, 3);
  assert.equal(report.scoredPairs, 12);
  assert.throws(() => scoreStoryOrder({ ...gold, edges: [{ from: "s6", to: "s1" }] }, { kind: "dag", edges: [] }), /cycle/);
  assert.throws(() => scoreStoryOrder({ ...gold, edges: [{ from: "x", to: "s1" }] }, { kind: "dag", edges: [] }), /Unknown scene/);
});

test("a time-place run report becomes one story line, or period ties", () => {
  const run = {
    sceneTimes: [{ sceneId: "s1", periodIds: ["p1"] }, { sceneId: "a1", periodIds: ["p2"] }, { sceneId: "b1", periodIds: ["p0"] }],
    periods: [{ id: "p0", storyIndex: 0 }, { id: "p1", storyIndex: 1 }, { id: "p2", storyIndex: 1 }],
  };
  assert.deepEqual(timeplacePrediction(run), { kind: "order", sceneIds: ["b1", "s1", "a1"] });
  assert.deepEqual(timeplacePrediction(run, true), { kind: "ranks", ranks: { s1: 1, a1: 1, b1: 0 } });
});

test("actual eval story-order CLI reads gold and a time-place report without network", async context => {
  const directory = await mkdtemp(join(tmpdir(), "story-order-eval-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const goldPath = join(directory, "gold.json"), runPath = join(directory, "run.json");
  await writeFile(goldPath, JSON.stringify(gold));
  await writeFile(runPath, JSON.stringify({ sceneTimes: ["s1", "a1", "a2", "b1", "b2", "s6"].map((sceneId) => ({ sceneId, periodIds: ["p"] })), periods: [{ id: "p", storyIndex: 0 }] }));
  const disableNetwork = "data:text/javascript," + encodeURIComponent('globalThis.fetch = () => { throw new Error("Unexpected network request"); };');
  const result = await promisify(execFile)(process.execPath, ["--import", disableNetwork, "dist/src/cli/cli.js", "eval", "story-order", goldPath, runPath, "--timeplace"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scoredPairs, 15);
  assert.equal(report.parallelRecall, 0);
});
