import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, ensure, inscribed, nodeNear, nodePos, spotsNear, worldGraph, worldSpot, CHUNK, type WorldSource } from "../apps/playground/src/data/world.js";
import { fillLandscape, firstLandscape } from "../src/ground/stage/landscape.js";
import { solveWalk, sampleWalk, temperatureBound } from "../apps/playground/src/data/pathIntegral.js";
import { skeletonStream } from "../apps/playground/src/data/skeleton.js";

// A filled commercial district as the world's source, with a staged building of its own at its middle.
function source(): WorldSource {
  const filled = fillLandscape(firstLandscape("d", "commercial"));
  return { buildings: filled.fabric.buildings.map((b, n) => ({ ...b, id: `b${n}` })), roads: filled.fabric.roads.map((road) => ({ a: road.a, b: road.b, width: road.width, level: road.level })), plazas: filled.plazas,
    anchors: [{ place: "inn", label: "Inn", x: 0, z: 0, own: true, role: "office", floors: 6 }] };
}
const standingOf = (world: ReturnType<typeof createWorld>) => world.lots.map((lot) => lot.skeleton.cells.map((value) => (value ? 1 : 0)));

test("the world streams in by chunks as the action reaches it: the city's own buildings become lots, the staged building stands on its spot", () => {
  const world = createWorld(source());
  assert.ok(ensure(world, 0, 0, 40, 0) > 0);
  const near = world.lots.length;
  assert.ok(world.lots.some((lot) => lot.place === "inn" && lot.label === "Inn"), "the staged building on its spot");
  assert.ok(near > 1, `the city's buildings around it (${near} lots)`);
  assert.equal(ensure(world, 0, 0, 40, 1), 0, "nothing new where the world already is");
  const more = ensure(world, 120, 0, 40, 5);
  assert.ok(more > 0 && world.lots.length > near, "going further streams in more of the city");
  assert.ok(world.lots.filter((lot) => lot.born === 5).length > 0 && [...world.chunks.values()].includes(5), "what was explored later remembers when");
  for (const a of world.lots) for (const b of world.lots) if (a !== b) assert.ok(a.i0 + a.nx <= b.i0 || b.i0 + b.nx <= a.i0 || a.j0 + a.nz <= b.j0 || b.j0 + b.nz <= a.j0, "lots never overlap");
});

test("node ids are never renumbered as the world grows, so positions kept from earlier moments stay valid", () => {
  const world = createWorld(source());
  ensure(world, 0, 0, 40, 0);
  const first = worldGraph(world, standingOf(world)), node = nodeNear(world, first, 0, 30, 0)!, before = nodePos(world, node);
  ensure(world, 0, 150, 60, 1);
  const second = worldGraph(world, standingOf(world));
  assert.deepEqual(nodePos(world, node), before);
  assert.ok(second.type.length > first.type.length);
});

test("people walk out of the explored ground into newly streamed city: a path from the middle to a street 100 m off, once it is there", () => {
  const world = createWorld(source());
  ensure(world, 0, 0, 40, 0);
  ensure(world, 0, 100, 48, 1);
  const built = worldGraph(world, standingOf(world)), from = nodeNear(world, built, 0, 20, 0)!;
  const spots = spotsNear(world, built, 0, 100, 30, null), target = worldSpot(spots, "street")!;
  assert.ok(spots[target].length, "a street near where they are going");
  const field = solveWalk(built.graph, spots[target], { T: 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 }), kappa: 1, lambda: 8 }), path = sampleWalk(built.graph, field, from, 0, skeletonStream("w"));
  assert.ok(path && path.length > 10, "a walk there");
  assert.ok(nodePos(world, path!.at(-1)!).z > 60, "ending far from where they began");
  assert.ok(spots["main:floor1"]?.length || spots.rooftop.length, "buildings near the target to go into or onto");
});

test("a building turned in its lot stands as the largest square-on rectangle inside its footprint", () => {
  assert.deepEqual(inscribed(20, 10, 0).map(Math.round), [10, 5]);
  assert.deepEqual(inscribed(20, 10, Math.PI / 2).map(Math.round), [5, 10]);
  const [a, b] = inscribed(20, 20, Math.PI / 4);
  assert.ok(Math.abs(a - 7.07) < 0.1 && Math.abs(b - 7.07) < 0.1);
  assert.equal(CHUNK, 16);
});
