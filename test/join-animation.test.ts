import { test } from "node:test";
import assert from "node:assert/strict";
import { freshIdentityEvents, planJoins, preimageId, type IdentityEvent, type LastPose, type PendingJoin } from "../apps/playground/src/data/joinAnimation.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode } from "../apps/playground/src/types.js";

// Synthetic, real-event-shaped fixtures: no live entity.merged event exists in
// the assigned Vol1/Vol2 logs, so these never claim an observed merge.
const merged = (id: string, dropId: string, keepId: string): IdentityEvent => ({ id, timestamp: "2026-10-25T00:00:00Z", event: { type: "entity.merged", dropId, keepId } });
const node = (id: string): WorldNode => ({ id, kind: "character", label: id, chrono: 0, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const draw = (id: string, position: [number, number, number], role: OrbitalDraw["role"] = "nebula"): OrbitalDraw => ({ node: node(id), position, radius: 40, role });
const pose = (id: string, position: [number, number, number]): [string, LastPose] => [id, { node: node(id), position, radius: 36 }];
const join = (dropId: string, keepId: string, seq: number): PendingJoin => ({ id: `${dropId}>${keepId}`, dropId, keepId, seq });

test("first connect is a baseline; only later merges are live; reconnects never replay", () => {
  const seen = new Set<string>();
  const historical = [merged("m1", "a", "b"), merged("m2", "c", "d")];
  const first = freshIdentityEvents(historical, seen, false);
  assert.deepEqual(first.events, [], "historical merges are not animated on first connect");
  const second = freshIdentityEvents([...historical, merged("m3", "e", "f")], seen, first.baselineDone);
  assert.deepEqual(second.events.map((record) => record.id), ["m3"]);
  assert.deepEqual(freshIdentityEvents([...historical, merged("m3", "e", "f")], seen, true).events, [], "a reconnect re-delivering the same ids replays nothing");
  const switched = new Set<string>();
  assert.deepEqual(freshIdentityEvents(historical, switched, false).events, [], "a new book re-baselines");
});

test("removal before render: a dropped entity glides from its last pose as a view-only preimage", () => {
  const last = new Map([pose("drop", [100, 0, 0]), pose("keep", [400, 0, 0])]);
  const current = [draw("keep", [420, 10, 0])];
  const plan = planJoins([join("drop", "keep", 1)], last, current);
  assert.equal(plan.preimages.length, 1);
  const preimage = plan.preimages[0];
  assert.equal(preimage.node.id, preimageId("drop"));
  assert.equal(preimage.role, "preimage");
  assert.deepEqual(preimage.position, [420, 10, 0], "ends on the survivor's current pose");
  assert.deepEqual(plan.from.get(preimageId("drop"))?.position, [100, 0, 0], "starts from the last drawn pose");
  assert.ok(!current.some((entry) => entry.node.id === "drop"), "canonical draws are not resurrected");
});

test("coalesced merges in one refresh all animate; a still-drawn record moves instead", () => {
  const last = new Map([pose("a", [0, 0, 0]), pose("c", [50, 0, 0]), pose("keep", [300, 0, 0])]);
  const current = [draw("keep", [300, 0, 0]), draw("c", [50, 0, 0]), draw("other", [900, 0, 0])];
  const plan = planJoins([join("a", "keep", 1), join("c", "other", 2)], last, current);
  assert.deepEqual(plan.animated.map((entry) => entry.seq), [1, 2]);
  assert.equal(plan.preimages.length, 1);
  assert.deepEqual(plan.moves.get("c"), [900, 0, 0]);
  assert.deepEqual(plan.offscreen, []);
});

test("joins that cannot be shown on this level settle at once instead of pulling the reader away", () => {
  const current = [draw("keep", [0, 0, 0])];
  const plan = planJoins([join("never-drawn", "keep", 1), join("x", "survivor-elsewhere", 2)], new Map([pose("x", [5, 5, 5])]), current);
  assert.deepEqual(plan.offscreen.map((entry) => entry.seq), [1, 2]);
  assert.deepEqual(plan.preimages, []);
  assert.equal(plan.moves.size, 0);
});
