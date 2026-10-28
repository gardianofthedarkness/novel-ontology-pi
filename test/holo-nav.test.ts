import { test } from "node:test";
import assert from "node:assert/strict";
import { navGrid, navPath, navPositions, spotsAfter, type MovePlan } from "../apps/playground/src/data/holoNav.js";
import { ARCHITECTURE_LABEL, type ArchitectureKind } from "../apps/playground/src/data/placeArchitecture.js";

test("every kind of building has a connected nav grid", () => {
  for (const kind of Object.keys(ARCHITECTURE_LABEL) as ArchitectureKind[]) {
    const grid = navGrid(kind), ids = new Set(grid.spots.map((spot) => spot.id));
    assert.equal(ids.size, grid.spots.length, `${kind}: spot ids are unique`);
    for (const [a, b] of grid.links) assert.ok(ids.has(a) && ids.has(b), `${kind}: ${a}–${b} links known spots`);
    for (const spot of grid.spots) assert.ok(navPath(grid, grid.spots[0].id, spot.id).length >= 1 && navPath(grid, grid.spots[0].id, spot.id).at(-1) === spot.id, `${kind}: ${spot.id} is reachable`);
    for (const spot of grid.spots) { const path = navPath(grid, grid.spots[0].id, spot.id); for (let i = 1; i < path.length; i++) assert.ok(grid.links.some(([a, b]) => (a === path[i - 1] && b === path[i]) || (b === path[i - 1] && a === path[i])), `${kind}: ${path.join(" → ")} walks along links`); }
  }
});

test("a tower is climbed by its stairs, floor by floor, and left by either door", () => {
  const grid = navGrid("skyscraper");
  assert.deepEqual(navPath(grid, "street", "floor-3"), ["street", "front-door", "floor-1", "stairs-1", "stairs-2", "stairs-3", "floor-3"]);
  assert.deepEqual(navPath(grid, "roof", "alley"), ["roof", "stairs-6", "stairs-5", "stairs-4", "stairs-3", "stairs-2", "stairs-1", "floor-1", "back-door", "alley"]);
  const at = navPositions(grid, { x: 0, z: 0, width: 60, depth: 60, height: 200 }, -944);
  assert.equal(at.get("roof")![1], -744, "the roof is at the top of the box");
  assert.ok(at.get("street")![2] > 30 && at.get("alley")![2] < -30, "street in front, alley behind");
  assert.ok(at.get("floor-4")![1] > at.get("floor-2")![1], "floors go up");
});

test("where people stand after a beat: scene start, then the moves so far in that scene", () => {
  const plan: MovePlan = { place: "tower", kind: "skyscraper", starts: { s1: { a: "street", b: "floor-1" }, s2: { a: "roof" } }, moves: { e1: [{ actor: "a", to: "floor-1", how: "walk", p: 0.9 }], e2: [{ actor: "a", to: "floor-3", how: "climb up", p: 0.8 }, { actor: "b", to: "back-door", how: "run", p: 0.7 }] } };
  const beats = [{ id: "c1", sceneId: "s1" }, { id: "e1", sceneId: "s1" }, { id: "e2", sceneId: "s1" }, { id: "c2", sceneId: "s2" }];
  assert.deepEqual(Object.fromEntries(spotsAfter(plan, beats, 0)), { a: "street", b: "floor-1" });
  assert.deepEqual(Object.fromEntries(spotsAfter(plan, beats, 1)), { a: "floor-1", b: "floor-1" });
  assert.deepEqual(Object.fromEntries(spotsAfter(plan, beats, 2)), { a: "floor-3", b: "back-door" });
  assert.deepEqual(Object.fromEntries(spotsAfter(plan, beats, 3)), { a: "roof" }, "a new scene starts from its own spots");
});
