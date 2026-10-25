import test from "node:test";
import assert from "node:assert/strict";
import { activityFocus, type LiveActivity } from "../apps/playground/src/data/liveActivity.js";

const activity = (): LiveActivity => ({
  count: 12, chapterId: "chapter_3", blockId: "b0001", phase: "Review", faculties: [], identityEvents: [], telemetryNote: null,
  latestTouch: { id: "touch", nodeId: "old-edit", timestamp: "2026-10-25T03:00:00Z", faculty: "extraction", precision: "record" },
  review: { id: "review", timestamp: "2026-10-25T03:00:01Z", active: true, volume: 2, chapterIndex: 3, blockId: "b0001", changesetId: "cs_b0001", phase: "facts", status: "ok", nodeIds: ["current-review"] },
});

test("live review highlights and captions use the observed review targets, never the previous extraction edit", () => {
  const input = activity();
  const before = structuredClone(input);
  const focus = activityFocus(input);
  assert.deepEqual(focus.nodeIds, ["current-review"]);
  assert.equal(focus.kind, "review");
  assert.equal(focus.faculty, "Pi review");
  assert.equal(focus.timestamp, input.review!.timestamp);
  assert.equal(input.count, 12);
  assert.deepEqual(input, before);
});

test("completion retains the last review location instead of replaying old edits; newer construction takes over", () => {
  const input = activity();
  input.review!.active = false;
  assert.deepEqual(activityFocus(input).nodeIds, ["current-review"]);
  assert.equal(activityFocus(input).historical, true);
  input.review!.active = true;
  input.latestTouch!.timestamp = "2026-10-25T03:00:02Z";
  assert.equal(activityFocus(input).kind, "edit");
  assert.equal(activityFocus(null).nodeIds.length, 0);
});

test("source and pending review actions without a drawable target never jump back to an old extraction edit", () => {
  const input = activity();
  input.review!.nodeIds = [];
  const focus = activityFocus(input);
  assert.equal(focus.kind, "review");
  assert.deepEqual(focus.nodeIds, []);
  assert.equal(focus.timestamp, input.review!.timestamp);
});
