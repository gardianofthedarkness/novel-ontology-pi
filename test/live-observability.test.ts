import test from "node:test";
import assert from "node:assert/strict";
import { FacultyPool, type FacultyCall } from "../src/digger/processing/facultyPool.js";
import { touchedDraftIds, type WorkingDraft } from "../src/digger/processing/draft.js";
import { projectEvent } from "../src/ground/events/types.js";

test("faculty calls distinguish actual fallback work and correlate their starts with completions", async () => {
  const observed: FacultyCall[] = [];
  const pool = new FacultyPool({ modelId: "synthetic", generate: async () => "{}" }, { onCall: call => observed.push(call) });
  await Promise.all([
    pool.generate("scene-understanding", { system: "synthetic", prompt: "one", maxTokens: 10 }),
    pool.generate("dialogue-participants", { system: "synthetic", prompt: "two", maxTokens: 10 }, 2),
  ]);
  for (const system of ["work", "system2"]) {
    const records = observed.filter(call => call.system === system);
    assert.deepEqual(records.map(call => call.status), ["started", "completed"]);
    assert.equal(records[0].callId, records[1].callId);
  }
  const event = projectEvent({ type: "faculty.activity", blockId: "b0001", faculty: "dialogue-participants", callId: "1", system: "system2", status: "completed" });
  assert.equal(event.type, "faculty.activity");
});

test("draft touches identify only genuinely new or edited objects and provisional scene/dialogue records", () => {
  const before: WorkingDraft = { version: 1, blockId: "b0001", chapterIndex: 0, stage: "miniloop", patchId: "start", updatedAt: "", proposals: [], sceneSpans: [], dialogueUnits: [], turns: [], completedScenes: 0, totalScenes: 0 };
  const after: WorkingDraft = { ...before, sceneSpans: [["b0000_s0001"]], dialogueUnits: [["b0000_s0001"]] };
  assert.deepEqual(touchedDraftIds(before, after), ["draft:b0001:scene:b0000_s0001", "draft:b0001:dialogue:b0000_s0001"]);
  assert.deepEqual(touchedDraftIds(after, after), []);
  const projected = projectEvent({ type: "draft.updated", blockId: "b0001", patchId: "scene", stage: "miniloop", touchedIds: touchedDraftIds(before, after) });
  assert.equal(projected.type, "draft.updated");
  assert.ok(!JSON.stringify(projected).includes("proposals"));
});
