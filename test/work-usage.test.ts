import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FacultyPool, usageTotal, type UsageLedger } from "../src/digger/processing/facultyPool.js";
import { bookUsage, recordUsage } from "../src/ground/workspace/usage.js";

const request = (prompt: string) => ({ system: "s", prompt });

test("the faculty pool meters work-model tokens per faculty; a model without usage counts as unmetered", async () => {
  const usage: UsageLedger = {};
  const metered = { modelId: "m", generate: async () => "x", generateWithInfo: async () => ({ text: "{}", usage: { promptTokens: 1000, cachedTokens: 600, completionTokens: 50, totalTokens: 1050 } }) };
  const pool = new FacultyPool(metered, { usage });
  await Promise.all([pool.generate("scene-understanding", request("a")), pool.generate("scene-understanding", request("b")), pool.generate("dialogue-structure", request("c"))]);
  await pool.generate("scene-understanding", request("a")); // a cached repeat makes no call
  assert.deepEqual(usage["scene-understanding"], { calls: 2, promptTokens: 2000, cachedTokens: 1200, completionTokens: 100, unmetered: 0 });
  assert.deepEqual(usageTotal(usage), { calls: 3, promptTokens: 3000, cachedTokens: 1800, completionTokens: 150, unmetered: 0 });
  const plain = new FacultyPool({ modelId: "p", generate: async () => "{}" }, { usage });
  await plain.generate("dialogue-structure", request("d"));
  assert.deepEqual(usage["dialogue-structure"], { calls: 2, promptTokens: 1000, cachedTokens: 600, completionTokens: 50, unmetered: 1 });
});

test("a book's usage adds every extraction run and its time-place runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "usage-"));
  const tokens = { calls: 2, promptTokens: 100, cachedTokens: 40, completionTokens: 10, unmetered: 0 };
  await recordUsage(dir, { at: "t1", kind: "extraction", model: "m", ...tokens, byFaculty: { "scene-understanding": tokens } });
  await recordUsage(dir, { at: "t2", kind: "extraction", model: "m", ...tokens, byFaculty: { "scene-understanding": tokens } });
  await recordUsage(dir, { at: "t3", kind: "extraction", model: "m", ...tokens, calls: 0, byFaculty: {} }); // nothing spent: not recorded
  await mkdir(join(dir, "timeplace"));
  await writeFile(join(dir, "timeplace", "run-1.json"), JSON.stringify({ usage: { workCalls: 5, promptTokens: 300, completionTokens: 30 } }));
  const usage = await bookUsage(dir);
  assert.deepEqual([usage.extraction.runs, usage.extraction.promptTokens, usage.extraction.cachedTokens, usage.extraction.byFaculty["scene-understanding"].calls], [2, 200, 80, 4]);
  assert.deepEqual(usage.timePlace, { runs: 1, calls: 5, promptTokens: 300, completionTokens: 30 });
});
