import { test } from "node:test";
import assert from "node:assert/strict";
import { projectProcessingEvent } from "../apps/playground/src/events/project.js";

test("playground projection: entity match facts become join/distinct view events", () => {
  assert.deepEqual(
    projectProcessingEvent({ type: "entity.merged", keepId: "char_a", dropId: "char_b" }),
    [{ type: "entity.merged", keepId: "char_a", dropId: "char_b" }],
  );
  assert.deepEqual(
    projectProcessingEvent({ type: "entity.distinct", aId: "char_a", bId: "char_b" }),
    [{ type: "entity.distinct", aId: "char_a", bId: "char_b" }],
  );
});
