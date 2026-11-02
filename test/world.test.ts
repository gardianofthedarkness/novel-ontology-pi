import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, ensure, inscribed, localCell, nodeId, nodeNear, nodePos, spotsNear, worldGraph, worldSpot, CHUNK, type WorldSource } from "../apps/playground/src/data/world.js";
import { addPatch, fillLandscape, firstLandscape } from "../src/v2/world/landscape.js";
import { collapse, hallsOf, intervalPrecision, subwayOf, type Hall } from "../src/v2/world/underground.js";
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
  // A world cell is held by one lot at most (lotAt), and lies inside that lot's own plan.
  for (const [key, index] of world.lotAt) { const lot = world.lots[index], i = Math.floor(key / 65536) - 32768, j = (key % 65536) - 32768; assert.ok(localCell(lot, i, j), "a held cell lies in its lot's plan"); }
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

test("a building stands at its true size and turn (its plan in its own frame), over a road the terrain left under it, and built into a neighbour with what is its own; one under a staged building is dropped", () => {
  const road = { a: [-200, 40] as [number, number], b: [200, 40] as [number, number], width: 12, level: "street" };
  const world = createWorld({ roads: [road], plazas: [], anchors: [{ place: "inn", label: "Inn", x: 100, z: 0, own: true, role: "office", floors: 6 }], buildings: [
    { id: "thin", x: 9, z: 9, w: 22, d: 9, angle: 0.35, floors: 6, kind: "office" },
    { id: "edge", x: 41, z: 31, w: 16, d: 16, angle: 0, floors: 6, kind: "office" },
    { id: "road", x: 70, z: 40, w: 8, d: 8, angle: 0, floors: 4, kind: "office" },
    { id: "under", x: 100, z: 2, w: 10, d: 10, angle: 0, floors: 4, kind: "office" },
    { id: "into", x: 49, z: 31, w: 16, d: 16, angle: 0, floors: 6, kind: "office" },
  ] });
  ensure(world, 50, 20, 100, 0);
  const lot = (id: string) => world.lots.find((entry) => entry.source === id);
  assert.ok(lot("thin")?.frame && Math.abs(lot("thin")!.frame!.angle - 0.35) < 1e-9 && lot("thin")!.skeleton.nx === 11 && lot("thin")!.skeleton.nz > 3, "the thin turned building stands at its true turn and size (22 m by 9 m)");
  const held = (id: string) => [...world.lotAt].filter(([, index]) => world.lots[index] === lot(id)).map(([key]) => key);
  assert.equal(held("edge").length, 64, "the crossed one holds its whole footprint, the road under it too");
  assert.ok(lot("road") && held("road").length === 16, "one wholly on a road stands");
  assert.ok(lot("into") && held("into").length === 32 && held("into").every((key) => ((Math.floor(key / 65536) - 32768) + 0.5) * 2 >= 49), "one built into a neighbour holds what is its own");
  assert.ok(!lot("under") && world.dropped.has("under"));
});

test("under the street: halls in the ground, each kind reached on foot from the street (a station, a mall, a basement, the storm water, a deep facility)", () => {
  const halls: Hall[] = [
    ...hallsOf(firstLandscape("d", "commercial")).filter((hall) => hall.kind === "mall"),
    ...subwayOf([{ id: "a", x: -140, z: 30 }, { id: "b", x: 160, z: 30 }], "city", 400),
    { id: "tank", kind: "tank", depth: 40, height: 18, boxes: [{ x: 0, z: -60, w: 60, d: 40, angle: 0 }], bores: [], pillars: 10, lined: true, up: [[0, -60]] },
    { id: "channel", kind: "channel", depth: 50, height: 10, boxes: [], bores: [{ a: [0, -60], b: [90, -60], width: 10 }], pillars: 0, lined: false, up: [[90, -60]] },
    { id: "lab", kind: "lab", depth: 90, height: 10, boxes: [{ x: -70, z: -70, w: 30, d: 24, angle: 0 }], bores: [], pillars: 0, lined: false, up: [[-70, -70]] },
  ];
  const world = createWorld({ ...source(), underground: { halls } });
  ensure(world, 0, 0, 200, 0);
  const built = worldGraph(world, standingOf(world)), spots = spotsNear(world, built, 0, 0, 200, null);
  for (const spot of ["under", "subway", "deep", "mall", "basement", "water", "facility"]) assert.ok(spots[spot]?.length, spot);
  assert.equal(worldSpot(spots, "sewer"), "water");
  assert.equal(worldSpot(spots, "under"), "under");
  // From the street, each kind is reached on foot: a walk sampled toward its spots ends there.
  const street = nodeNear(world, built, 0, 0, 0)!, T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 });
  for (const spot of ["subway", "mall", "basement", "water", "facility"]) {
    const path = sampleWalk(built.graph, solveWalk(built.graph, spots[spot], { T, kappa: 1, lambda: 8 }), street, 0, skeletonStream(spot));
    assert.ok(path && spots[spot].includes(path.at(-1)!), `${spot} reached from the street`);
  }
});

test("a city's halls and basements: a box finds its hall at least 90% of the time just under the street, in the subway, and deep, over six generated cities", () => {
  for (const seed of ["city", "tokyo", "gakuen", "harbor", "osaka", "kyoto"]) {
    let landscape = firstLandscape(seed, "skyscrapers");
    landscape = addPatch(landscape, "commercial", [300, 0]);
    landscape = addPatch(landscape, "residential", [-300, 100]);
    landscape = addPatch(landscape, "industrial", [0, -350]);
    const fill = fillLandscape(landscape), basements = fill.fabric.buildings.filter((b) => b.floors >= 2).map((b) => ({ boxes: [{ x: b.x, z: b.z, w: b.w, d: b.d, angle: b.angle }], bores: [], depth: b.floors >= 20 ? 9 : b.floors >= 10 ? 6 : 3, height: b.floors >= 20 ? 9 : b.floors >= 10 ? 6 : 3 }));
    const halls = [...hallsOf(landscape), ...subwayOf(landscape.patches.map((patch) => ({ id: patch.id, x: patch.x, z: patch.z })), landscape.seed, fill.radius)];
    for (const interval of ["shallow", "subway", "deep"] as const) {
      const { boxes, share } = intervalPrecision([...halls, ...basements], interval);
      assert.ok(boxes > 1000 && share >= 0.9, `${seed} ${interval}: ${(share * 100).toFixed(1)}% of ${boxes} boxes find one hall`);
    }
  }
});

test("halls stand at rest; a blast that breaks a shallow hall's lining dents the street over it, a deep hall's lost pillars leave a dome, and nothing reaches the street from deep", () => {
  // A hall's cells, `n` across and `rows` deep (2 m), with pillars every `every` cells, reached from its middle.
  const line = (n: number, every = 0, rows = 10) => Array.from({ length: n * rows }, (_, index) => ({ i: index % n, j: Math.floor(index / n), pillar: every > 0 && index % n % every === Math.floor(every / 2) && Math.floor(index / n) % every === Math.floor(every / 2), reach: Math.hypot(index % n - n / 2, Math.floor(index / n) - rows / 2) * 2 }));
  // A station, 20 m wide and lined, in soil: stable at rest.
  const station = { depth: 12, height: 7, lined: true, pillars: 8, width: 20 };
  assert.deepEqual(collapse(station, line(10, 4), 0).failed, []);
  const broken = collapse(station, line(10, 4), 4000);
  assert.ok(broken.lining.length > 0 && broken.failed.length > 0);
  assert.equal(broken.stopped, "dent");
  assert.ok(Object.values(broken.dent).every((depth) => depth > 0 && depth <= 3));
  // A deep lab, 40 m square in hard rock on pillars every 12 m: stable at rest; with its pillars gone, a dome holds below.
  const lab = { depth: 90, height: 10, lined: false, pillars: 12, width: 40 };
  assert.deepEqual(collapse(lab, line(20, 6, 20), 0).failed, []);
  const caved = collapse(lab, line(20, 6, 20), 20000);
  assert.ok(caved.pillars.length > 0 && caved.failed.length > 0);
  assert.notEqual(caved.stopped, "dent");
  assert.deepEqual(caved.dent, {});
});

test("rooms are walked through their doors only, on their own floor; a room of several floors is open air above it", async () => {
  const { cellIndex } = await import("../apps/playground/src/data/skeleton.js");
  const world = createWorld(source());
  ensure(world, 0, 0, 60, 0);
  const built = worldGraph(world, standingOf(world)), { graph, type, lot } = built;
  let roomNodes = 0, ways = 0;
  for (let node = 0; node < graph.nodes; node++) {
    if (type[node] !== 3) continue;
    roomNodes++;
    const here = world.lots[lot[node]], [i, j] = localCell(here, Math.floor(graph.x[node] / 2), Math.floor(graph.z[node] / 2))!, k = Math.round(graph.y[node] / 3);
    const room = here.rooms.find((box) => box.floor === k && i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1)!;
    assert.ok(room, "a room node is in a room, on its own floor");
    for (let e = graph.offsets[node]; e < graph.offsets[node + 1]; e++) {
      const to = graph.to[e];
      if (type[to] !== 2) continue;
      ways++;
      const [ti, tj] = localCell(here, Math.floor(graph.x[to] / 2), Math.floor(graph.z[to] / 2))!;
      const door = cellIndex(here.skeleton, ti, tj, k);
      assert.ok(room.doors.includes(door), "out of a room only through one of its doors");
    }
  }
  assert.ok(roomNodes > 50 && ways > 0, `rooms walked (${roomNodes} room cells, ${ways} ways out)`);
  let tall = 0;
  for (const [n, here] of world.lots.entries()) for (const room of here.rooms.filter((box) => box.top > box.floor)) for (let k = room.floor + 1; k <= room.top; k++) {
    // The world cells over the room's plan cells, on its upper floors: none stands as a room of it.
    for (let id = 0; id < type.length; id++) if (type[id] === 3 && lot[id] === n && Math.round(graph.y[id] / 3) === k) { const at = localCell(here, Math.floor(graph.x[id] / 2), Math.floor(graph.z[id] / 2)); assert.ok(!at || !(at[0] >= room.i0 && at[0] <= room.i1 && at[1] >= room.j0 && at[1] <= room.j1), "no floor to stand on above a room of several floors"); }
    tall++;
  }
});
