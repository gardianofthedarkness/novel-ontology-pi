import { test } from "node:test";
import assert from "node:assert/strict";
import { centreSpot, navGrid, navPath, navPositions, solveChain, spotsAfter, type MovePlan } from "../apps/playground/src/data/holoNav.js";
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

test("the centre of a building: a middle floor of a tower, the nave of a church, the plaza of a district", () => {
  assert.ok(["floor-3", "floor-4"].includes(centreSpot(navGrid("skyscraper"))), centreSpot(navGrid("skyscraper")));
  assert.equal(centreSpot(navGrid("church")), "nave");
  assert.equal(centreSpot(navGrid("city")), "plaza");
});

test("an unstated start is the centre, and stays when the moves follow from it", () => {
  const grid = navGrid("skyscraper"), centre = centreSpot(grid);
  const chain = solveChain(grid, { start: { street: 0.8 }, stated: 0.1, steps: [
    { to: { "floor-1": 0.8, street: 0.2 }, how: "go down", direction: { down: 0.9 } },
    { to: { street: 0.9 }, how: "run", direction: { "out of the building": 0.8 } },
  ] });
  assert.deepEqual([chain.start, chain.assumed, chain.revised], [centre, true, false]);
  assert.deepEqual(chain.spots.slice(1), ["floor-1", "street"]);
});

test("a start the later moves cannot follow from is revised backwards, with the reason", () => {
  const grid = navGrid("skyscraper");
  // Climbing up to 2F cannot start on a middle floor: they were lower.
  const climb = solveChain(grid, { start: {}, stated: 0, steps: [{ to: { "floor-2": 0.9 }, how: "climb up", direction: { up: 0.9 } }] });
  assert.ok(climb.revised && grid.spots.find((spot) => spot.id === climb.start)!.v < grid.spots.find((spot) => spot.id === "floor-2")!.v, climb.start);
  assert.match(climb.why ?? "", /climb up to 2F needs a start lower/);
  // Falling to the street, then climbing back up to the roof: the fall needs height, so the chain keeps them up high to begin with.
  const fall = solveChain(grid, { start: { "floor-1": 0.9 }, stated: 0.3, steps: [{ to: { street: 0.9 }, how: "fall", direction: { down: 0.9 } }] });
  assert.ok(grid.spots.find((spot) => spot.id === fall.start)!.v > 0.03, `a fall to the street starts above it, not at ${fall.start}`);
});

test("underground only when a step says so", () => {
  const grid = navGrid("skyscraper");
  const down = solveChain(grid, { start: {}, stated: 0, steps: [{ to: { basement: 0.4, "floor-1": 0.6 }, how: "go down", direction: { down: 0.9 } }] });
  assert.equal(down.spots[1], "floor-1");
  const said = solveChain(grid, { start: {}, stated: 0, steps: [{ to: { basement: 0.9, "floor-1": 0.1 }, how: "go down", direction: { down: 0.9 } }] });
  assert.equal(said.spots[1], "basement");
});
