import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeRelationships, relationshipAffinities, type Position3 } from "../apps/playground/src/data/spatialLayout.js";
import { arrangeTimeline } from "../apps/playground/src/data/timelineLayout.js";
import { cameraFrame } from "../apps/playground/src/data/cameraFraming.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const node = (id: string, kind: WorldNode["kind"] = "character", chrono = 0): WorldNode => ({ id, kind, chrono, label: id, state: "canon", parent: null, lane: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const edge = (from: string, to: string, weight = 1): WorldEdge => ({ id: `${from}:${to}`, from, to, weight, kind: "contains", state: "canon", parent: null });
const distance = (first: Position3, second: Position3) => Math.hypot(...first.map((value, axis) => value - second[axis]));

test("affinity counts weighted direct edges and normalized shared connections, not unrelated pairs", () => {
  const nodes = [node("first"), node("second"), node("third"), node("isolated"), node("scene-1", "scene"), node("scene-2", "scene")];
  const edges = [edge("first", "scene-1"), edge("second", "scene-1"), edge("third", "scene-1"), edge("first", "scene-2"), edge("second", "scene-2")];
  const affinities = relationshipAffinities(nodes, edges);
  const strength = (from: string, to: string) => affinities.find((pair) => pair.from === from && pair.to === to)?.strength ?? 0;
  assert.ok(strength("first", "second") > strength("first", "third"));
  assert.equal(strength("first", "isolated"), 0);
  assert.ok(relationshipAffinities(nodes, [edge("first", "second", 9)])[0].strength > relationshipAffinities(nodes, [edge("first", "second")])[0].strength);
  assert.ok(relationshipAffinities(nodes, [edge("first", "first"), edge("first", "missing")]).length === 0);
});

test("stronger relationships shorten spring distances while anchors never move", () => {
  const nodes = [node("scene", "scene"), node("person")];
  const anchors = new Map<string, Position3>([["scene", [0, 0, 0]]]);
  const weak = arrangeRelationships(nodes, [edge("scene", "person", 1)], anchors);
  const strong = arrangeRelationships(nodes, [edge("scene", "person", 30)], anchors);
  assert.ok(distance(strong.get("scene")!, strong.get("person")!) < distance(weak.get("scene")!, weak.get("person")!));
  assert.deepEqual(strong.get("scene"), [0, 0, 0]);
  assert.deepEqual(anchors.get("scene"), [0, 0, 0]);
});

test("scene satellites occupy all three axes, stay distinct and are deterministic across input order and gate states", () => {
  const nodes = [node("scene", "scene"), ...Array.from({ length: 24 }, (_, index) => node(`person-${index}`))];
  const edges = nodes.slice(1).map((record) => edge("scene", record.id));
  const anchors = new Map<string, Position3>([["scene", [0, 0, 0]]]);
  const first = arrangeRelationships(nodes, edges, anchors);
  const reordered = arrangeRelationships([...nodes].reverse().map((record) => ({ ...record, state: "proposed" })), [...edges].reverse(), anchors);
  assert.deepEqual(first, reordered);
  const positions = nodes.slice(1).map((record) => first.get(record.id)!);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.min(...positions.map((point) => point[axis])) < -40);
    assert.ok(Math.max(...positions.map((point) => point[axis])) > 40);
  }
  for (let firstIndex = 0; firstIndex < positions.length; firstIndex++) for (let secondIndex = firstIndex + 1; secondIndex < positions.length; secondIndex++) assert.ok(distance(positions[firstIndex], positions[secondIndex]) > 50);
});

test("explicit story identifiers seed separate scene clouds without pinning scenes to rails", () => {
  const nodes = [
    { ...node("a1", "scene", 1), trackId: "battle-a" }, { ...node("a2", "scene", 2), trackId: "battle-a" },
    { ...node("b1", "scene", 1), trackId: "battle-b" }, { ...node("b2", "scene", 2), trackId: "battle-b" }, node("place", "location"), node("person"),
  ];
  const result = arrangeTimeline(nodes, [edge("place", "a1"), edge("place", "b1"), edge("a1", "b1"), edge("person", "a1")], true);
  const positions = new Map(result.nodes.map((record) => [record.id, record.interiorPos]));
  assert.equal(result.tracks.length, 0);
  assert.notEqual(positions.get("a1")![1], positions.get("a2")![1]);
  assert.notEqual(positions.get("b1")![2], positions.get("b2")![2]);
  assert.deepEqual(result.nodes.map((record) => record.chrono), nodes.map((record) => record.chrono));
  assert.ok(result.nodes.every((record) => record.interiorPos.every(Number.isFinite)));
});

test("forty-two disconnected scenes never create forty-three parallel rails or a chronological line", () => {
  const nodes = Array.from({ length: 42 }, (_, index) => node(`scene-${index}`, "scene", index));
  const result = arrangeTimeline(nodes, [], true);
  assert.equal(result.tracks.length, 0);
  for (let axis = 0; axis < 3; axis++) {
    const values = result.nodes.map((record) => record.interiorPos[axis]);
    assert.ok(Math.max(...values) - Math.min(...values) > 100);
  }
  const [first, second] = result.nodes;
  assert.notEqual(first.interiorPos[1], second.interiorPos[1]);
  assert.notEqual(first.interiorPos[2], second.interiorPos[2]);
});

test("hub expansion is bounded and malformed weights cannot make positions non-finite", () => {
  const nodes = [node("hub", "scene"), ...Array.from({ length: 250 }, (_, index) => node(`satellite-${index}`))];
  const edges = nodes.slice(1).map((record, index) => edge("hub", record.id, index % 2 ? Infinity : -2));
  assert.ok(relationshipAffinities(nodes, edges).length <= edges.length + nodes.length * 12);
  const result = arrangeRelationships(nodes.slice(0, 20), edges, new Map([["hub", [0, 0, 0]]]));
  assert.ok([...result.values()].every((position) => position.every(Number.isFinite)));
});

test("camera framing includes depth and shifts inspection into the unobscured viewport", () => {
  const options = { width: 1200, height: 800, fov: 45, direction: [0, 0, 1] as Position3 };
  const shallow = cameraFrame([[0, 0, 0]], options)!;
  const deep = cameraFrame([[0, 0, -900], [0, 0, 900]], options)!;
  assert.ok(deep.position[2] > shallow.position[2]);
  const panel = cameraFrame([[100, 200, 300]], { ...options, inset: { left: 20, right: 380, top: 160, bottom: 180 } })!;
  assert.deepEqual(panel.center, [100, 200, 300]);
  assert.ok(panel.target[0] > panel.center[0]);
  const mobile = cameraFrame([[0, 0, 0]], { ...options, width: 390, height: 844, inset: { left: 20, right: 40, top: 170, bottom: 420 } })!;
  assert.ok(mobile.target[1] < mobile.center[1]);
  assert.ok(mobile.position.every(Number.isFinite));
  assert.equal(cameraFrame([], options), null);
  assert.equal(cameraFrame([[NaN, 0, 0]], options), null);
});
