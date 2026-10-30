import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, ensure, inscribed, nodeNear, nodePos, spotsNear, worldGraph, worldSpot, CHUNK, DEEP, SUBWAY, UNDER, WATER, type WorldSource } from "../apps/playground/src/data/world.js";
import { fillLandscape, firstLandscape, undergroundOf } from "../src/ground/stage/landscape.js";
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

test("every source building in the explored ground either stands as a lot or is settled as dropped, so no faint copy is left among the lots", () => {
  const world = createWorld(source());
  ensure(world, 0, 0, 120, 0);
  const span = CHUNK * 2, inChunks = (b: WorldSource["buildings"][number]) => [-1, 1].every((sx) => [-1, 1].every((sz) => world.chunks.has((Math.floor((b.x + sx * b.w / 2) / span) + 32768) * 65536 + (Math.floor((b.z + sz * b.d / 2) / span) + 32768))));
  const stood = new Set(world.lots.map((lot) => lot.source));
  const settled = world.source.buildings.filter(inChunks);
  assert.ok(settled.length > 10);
  for (const b of settled) assert.ok(stood.has(b.id) || world.dropped.has(b.id), `${b.id} stands or is dropped`);
  assert.ok(settled.filter((b) => stood.has(b.id)).length >= settled.length * 0.85, `most stand (${settled.filter((b) => stood.has(b.id)).length} of ${settled.length})`);
});

test("a thin building turned off the grid stands turned to the nearest axis, and one a road crosses stands on the free part; one wholly on a road, or under a staged building, is dropped", () => {
  const road = { a: [-200, 40] as [number, number], b: [200, 40] as [number, number], width: 12, level: "street" };
  const world = createWorld({ roads: [road], plazas: [], anchors: [{ place: "inn", label: "Inn", x: 100, z: 0, own: true, role: "office", floors: 6 }], buildings: [
    { id: "thin", x: 9, z: 9, w: 22, d: 9, angle: 0.35, floors: 6, kind: "office" },
    { id: "edge", x: 41, z: 31, w: 16, d: 16, angle: 0, floors: 6, kind: "office" },
    { id: "road", x: 70, z: 40, w: 8, d: 8, angle: 0, floors: 4, kind: "office" },
    { id: "under", x: 100, z: 2, w: 10, d: 10, angle: 0, floors: 4, kind: "office" },
  ] });
  ensure(world, 50, 20, 100, 0);
  const lot = (id: string) => world.lots.find((entry) => entry.source === id);
  assert.ok(lot("thin") && lot("thin")!.nx > lot("thin")!.nz, "the thin turned building stands, long along x");
  assert.ok(lot("edge") && (lot("edge")!.j0 + lot("edge")!.nz) * 2 <= 34, "the crossed one stands short of the road");
  assert.ok(!lot("road") && world.dropped.has("road"));
  assert.ok(!lot("under") && world.dropped.has("under"));
});

test("under the street: tunnels under the roads (an underground mall in a commercial quarter), every building's underground floors, storm-water channels and a tank, a deep facility; all reached on foot", () => {
  const landscape = firstLandscape("d", "commercial"), under = undergroundOf(landscape);
  assert.equal(under.tanks.length, 1);
  assert.equal(under.arcades.length, 1);
  const facility = { x: under.tanks[0].x + 40, z: under.tanks[0].z, w: 30, d: 24, kind: "lab" };
  const world = createWorld({ ...source(), underground: { ...under, facilities: [facility] } });
  ensure(world, 0, 0, 90, 0);
  const built = worldGraph(world, standingOf(world)), levels = new Map<number, number>();
  for (let id = 0; id < built.type.length; id++) if (built.type[id] === 5) levels.set(nodePos(world, id).k, (levels.get(nodePos(world, id).k) ?? 0) + 1);
  for (const level of [SUBWAY, UNDER, WATER, DEEP]) assert.ok((levels.get(level) ?? 0) > 0, `nodes at level ${level}`);
  const spots = spotsNear(world, built, 0, 0, 90, null);
  for (const spot of ["subway", "arcade", "underground", "water", "deep", "facility"]) assert.ok(spots[spot].length, spot);
  assert.equal(worldSpot(spots, "basement"), "main:underground", "a basement is the nearest building's own underground floors");
  assert.equal(worldSpot(spots, "sewer"), "water");
  // From the street, every level is reached on foot: a walk sampled toward each level's spots ends there.
  const street = nodeNear(world, built, 0, 0, 0)!, T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 });
  for (const spot of ["subway", "arcade", "underground", "water", "facility"]) {
    const path = sampleWalk(built.graph, solveWalk(built.graph, spots[spot], { T, kappa: 1, lambda: 8 }), street, 0, skeletonStream(spot));
    assert.ok(path && spots[spot].includes(path.at(-1)!), `${spot} reached from the street`);
  }
});

test("each modern landscape has what lies under it, drawn from its seed: ancient ground has nothing below", () => {
  assert.deepEqual(undergroundOf(firstLandscape("x", "skyscrapers")), undergroundOf(firstLandscape("x", "skyscrapers")));
  assert.ok(undergroundOf(firstLandscape("x", "skyscrapers")).facilities.length >= 2);
  assert.equal(undergroundOf(firstLandscape("x", "residential")).facilities.length, 0);
  assert.deepEqual(undergroundOf(firstLandscape("x", "castle")), { tanks: [], arcades: [], facilities: [] });
});
