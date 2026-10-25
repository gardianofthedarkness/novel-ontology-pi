import { test } from "node:test";
import assert from "node:assert/strict";
import { morphProgress, morphSpan, openingMorph, OPENING_MS, OPENING_STAGGER_MS, type OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import { classifySwipe } from "../apps/playground/src/data/gestures.js";
import { piBusy, type LiveActivity } from "../apps/playground/src/data/liveActivity.js";
import { heartbeatRoute, pointAlong } from "../apps/playground/src/data/orbitalMotion.js";
import type { WorldNode } from "../apps/playground/src/types.js";

const node = (id: string): WorldNode => ({ id, kind: "scene", label: id, chrono: 0, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const draw = (id: string, x: number, role: OrbitalDraw["role"] = "main"): OrbitalDraw => ({ node: node(id), position: [x, 0, 0], radius: 100, role });

test("the opening uncoils everything from the head of the spine, earlier records first", () => {
  const draws = [draw("b", 1000), draw("a", 0), draw("c", 2000), draw("moon", 1000, "nebula")];
  const opening = openingMorph(draws, 5000)!;
  for (const entry of draws) assert.deepEqual(opening.from.get(entry.node.id)!.position, [0, 0, 0], "all start at the head");
  assert.equal(opening.delays!.get("a"), 0);
  assert.equal(opening.delays!.get("c"), OPENING_STAGGER_MS);
  assert.ok(opening.delays!.get("moon")! > opening.delays!.get("b")!, "surroundings follow their spine sphere");
  assert.equal(morphProgress(opening, "c", 5000 + OPENING_STAGGER_MS, 1100), 0, "c waits for its turn");
  assert.equal(morphProgress(opening, "a", 5000 + OPENING_MS, 1100), 1);
  assert.equal(morphSpan(opening, 1100), OPENING_MS + OPENING_STAGGER_MS, "runs until the last record has uncoiled");
  assert.equal(openingMorph([draw("moon", 0, "nebula")], 0), null, "nothing to uncoil without a spine");
});

test("ordinary morphs keep their old timing", () => {
  const morph = { startedAt: 100, from: new Map() };
  assert.equal(morphProgress(morph, "x", 650, 1100), 0.5);
  assert.equal(morphSpan(morph, 1100), 1100);
});

test("swipes are quick, long and clearly along one axis", () => {
  assert.equal(classifySwipe(-120, 10, 200), "left");
  assert.equal(classifySwipe(120, -20, 200), "right");
  assert.equal(classifySwipe(5, -90, 300), "up");
  assert.equal(classifySwipe(-8, 90, 300), "down");
  assert.equal(classifySwipe(20, 10, 100), null, "a tap");
  assert.equal(classifySwipe(-200, 0, 1200), null, "a slow drag");
  assert.equal(classifySwipe(100, 90, 200), null, "a diagonal");
});

test("Pi counts as working only with a live review or calls in flight", () => {
  const base = { count: 0, chapterId: "c", blockId: null, phase: "idle", latestTouch: null, faculties: [], identityEvents: [], telemetryNote: null } as LiveActivity;
  assert.equal(piBusy(null), false);
  assert.equal(piBusy(base), false);
  assert.equal(piBusy({ ...base, faculties: [{ id: "f", label: "f", faculty: "f", system: "s", status: "idle", active: 0, calls: 9 }] }), false);
  assert.equal(piBusy({ ...base, faculties: [{ id: "f", label: "f", faculty: "f", system: "s", status: "busy", active: 1, calls: 9 }] }), true);
  assert.equal(piBusy({ ...base, review: { active: true } as LiveActivity["review"] }), true);
});

test("the heartbeat runs along the spine to the nearest point, then hops to the record", () => {
  const spine: [number, number, number][] = [[0, 0, 0], [1000, 0, 0], [2000, 0, 0], [3000, 0, 0]];
  assert.deepEqual(heartbeatRoute(spine, [2000, 0, 0]), spine.slice(0, 3));
  assert.deepEqual(heartbeatRoute(spine, [1100, 400, 0]), [[0, 0, 0], [1000, 0, 0], [1100, 400, 0]]);
  assert.deepEqual(heartbeatRoute([], [5, 5, 5]), [[5, 5, 5]]);
  const route = spine.slice(0, 3);
  assert.deepEqual(pointAlong(route, 0), [0, 0, 0]);
  assert.deepEqual(pointAlong(route, 0.25), [500, 0, 0]);
  assert.deepEqual(pointAlong(route, 0.75), [1500, 0, 0]);
  assert.deepEqual(pointAlong(route, 1), [2000, 0, 0]);
  assert.deepEqual(pointAlong(route, 2), [2000, 0, 0], "clamped");
});
