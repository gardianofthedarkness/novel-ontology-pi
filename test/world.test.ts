import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, ensure, inscribed, localCell, nodeId, nodeNear, nodePos, reachableIn, spotsNear, windowOf, worldGraph, worldSpot, CHUNK, type WorldSource } from "../apps/playground/src/data/world.js";
import { addPatch, fillLandscape, firstLandscape } from "../src/v2/world/landscape.js";
import { collapse, hallsOf, intervalPrecision, subwayOf, type Hall } from "../src/v2/world/underground.js";
import { solveWalk, sampleWalk, temperatureBound } from "../apps/playground/src/data/pathIntegral.js";
import { cellAt, skeletonStream } from "../apps/playground/src/data/skeleton.js";

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

test("ways between the layers (terrain-levels §3.4): every hall joined to the ground, a way within about 30 m of most of its floor, stairs where shallow and a lift where deep, and a hall the text gave no way still reached", () => {
  const halls: Hall[] = [
    ...hallsOf(firstLandscape("d", "commercial")).filter((hall) => hall.kind === "mall"),
    ...subwayOf([{ id: "a", x: -140, z: 30 }, { id: "b", x: 160, z: 30 }], "city", 400),
    { id: "tank", kind: "tank", depth: 40, height: 18, boxes: [{ x: 0, z: -60, w: 60, d: 40, angle: 0 }], bores: [], pillars: 10, lined: true, up: [[0, -60]] },
    // A deep lab the text gave no way up at all.
    { id: "bare", kind: "lab", depth: 90, height: 10, boxes: [{ x: -70, z: -70, w: 30, d: 24, angle: 0 }], bores: [], pillars: 0, lined: false, up: [] },
  ];
  const world = createWorld({ ...source(), underground: { halls } });
  ensure(world, 0, 0, 200, 0);
  const built = worldGraph(world, standingOf(world)), byHall = new Map<number, typeof built.ways>();
  for (const way of built.ways) (byHall.get(way.hall) ?? byHall.set(way.hall, []).get(way.hall)!).push(way);
  // Every hall with a floor in the graph is joined.
  const floors = new Map<number, number[]>();
  for (let id = 0; id < built.type.length; id++) if (built.type[id] === 5 && built.lot[id] >= 1_000_000 && built.graph.offsets[id + 1] > built.graph.offsets[id]) (floors.get(built.lot[id] - 1_000_000) ?? floors.set(built.lot[id] - 1_000_000, []).get(built.lot[id] - 1_000_000)!).push(id);
  assert.ok(floors.size >= 4);
  for (const [hall, cells] of floors) assert.ok(byHall.get(hall)?.length, `${halls[hall].id} (${cells.length} cells) has a way up`);
  // Dense: most of every floor within about 30 m of a way.
  for (const [hall, cells] of floors) {
    const feet = byHall.get(hall)!.map((way) => nodePos(world, way.foot)), near = cells.filter((id) => { const p = nodePos(world, id); return feet.some((q) => Math.hypot(p.x - q.x, p.z - q.z) <= 30); }).length;
    assert.ok(near / cells.length >= 0.9, `${halls[hall].id}: ${near} of ${cells.length} cells within 30 m of a way`);
  }
  // Stairs where shallow (a climb never cheaper than the solver's guide of 8 a metre), a lift where deep.
  for (const way of built.ways) {
    assert.equal(way.kind, way.rise > 20 ? "lift" : "stairs", `${halls[way.hall].id} at ${way.rise} m`);
    if (way.kind === "stairs") assert.ok(way.up >= 8 * way.rise, "a stair's climb at least the guide's");
  }
  // The lab the text gave no way: reached from the street on foot, by a lift of the world's own.
  const lab = halls.findIndex((hall) => hall.id === "bare"), from = nodeNear(world, built, 0, 0, 0)!, seen = reachableIn(built.graph, from);
  assert.ok(floors.get(lab)!.some((id) => seen[id]), "the bare lab is reached from the street");
});

test("a street walk's window leaves the deep layer out (terrain-levels §8.2): no deep facility's lift in it, and the walk still goes along the street", () => {
  const lab: Hall = { id: "lab", kind: "lab", depth: 90, height: 10, boxes: [{ x: -70, z: -70, w: 30, d: 24, angle: 0 }], bores: [], pillars: 0, lined: false, up: [[-70, -70]] };
  const world = createWorld({ ...source(), underground: { halls: [lab] } });
  ensure(world, 0, 0, 200, 0);
  const built = worldGraph(world, standingOf(world)), box = { x0: -150, x1: 150, z0: -150, z1: 150 };
  const whole = windowOf(built.graph, box), near = windowOf(built.graph, box, (n) => built.graph.y[n] > -20);
  assert.ok(Array.from(whole.graph.y).some((y) => y <= -20), "the whole window holds the lab");
  assert.ok(Array.from(near.graph.y).every((y) => y > -20), "the street's window holds nothing of the deep layer");
  const from = nodeNear(world, built, -60, 0, 0)!, to = nodeNear(world, built, 60, 0, 0)!, T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 });
  const path = sampleWalk(near.graph, solveWalk(near.graph, [near.local[to]], { T, kappa: 1, lambda: 8 }), near.local[from], 0, skeletonStream("street"));
  assert.ok(path && path.at(-1) === near.local[to], "a 120 m street walk is found");
});

test("what a walk reaches (terrain-levels §8.2): the deep lab by its lift and the basements by their stairs on the whole window, nothing deep on the street's, and only what its own window holds", () => {
  const lab: Hall = { id: "lab", kind: "lab", depth: 90, height: 10, boxes: [{ x: -70, z: -70, w: 30, d: 24, angle: 0 }], bores: [], pillars: 0, lined: false, up: [[-70, -70]] };
  const world = createWorld({ ...source(), underground: { halls: [lab] } });
  ensure(world, 0, 0, 200, 0);
  const built = worldGraph(world, standingOf(world)), box = { x0: -150, x1: 150, z0: -150, z1: 150 }, from = nodeNear(world, built, -60, 0, 0)!;
  const whole = windowOf(built.graph, box), near = windowOf(built.graph, box, (n) => built.graph.y[n] > -20);
  const reached = (part: ReturnType<typeof windowOf>) => { const seen = reachableIn(part.graph, part.local[from]); return Array.from(part.ids).filter((_, n) => seen[n]); };
  const all = reached(whole), street = reached(near);
  assert.ok(all.some((n) => built.graph.y[n] <= -80), "the lab's floor, by its lift");
  assert.ok(all.some((n) => built.type[n] === 5 && built.lot[n] >= 0 && built.lot[n] < 1_000_000), "a basement, by its building's stairs");
  assert.ok(street.length > 1000 && street.every((n) => built.graph.y[n] > -20), "the street's window reaches the street and nothing deep");
  const tight = windowOf(built.graph, { x0: -64, x1: -56, z0: -4, z1: 4 }), small = reached(tight);
  assert.ok(small.length > 0 && small.every((n) => Math.abs(built.graph.x[n] + 60) <= 4 && Math.abs(built.graph.z[n]) <= 4), "a tight window reaches only inside itself");
});

test("a street laid underground, built out (terrain-levels §8): its buildings stand on its floor under the skin, their doors open onto it, the street above keeps its own, and a walk from the street reaches a room under it", () => {
  // A shopping street laid 30 m under (terrain spawning answered its height below 0), beside a commercial district.
  const landscape = addPatch(firstLandscape("d", "commercial"), "shopping", [200, 0]), street = landscape.patches.at(-1)!;
  street.median = -30;
  const fill = fillLandscape(landscape), sunk = fill.landmarks.filter((b) => (b.y0 ?? 0) < 0);
  assert.ok(sunk.length >= 6, `its own buildings: ${sunk.length}`);
  assert.ok(sunk.every((b) => b.y0 === -30 && (b.floors + 1) * 3 <= 30 - 3), "each on its floor, its roof under the 3 m skin");
  // Compatible with the layer above (the user, 2026-11-06: "placing it down won't affect the streets on top"): the surface
  // is the same, building for building, as without the street under it.
  const surfaceOf = (fill: ReturnType<typeof fillLandscape>) => [...fill.fabric.buildings, ...fill.landmarks.filter((b) => !((b.y0 ?? 0) < 0))].map((b) => `${b.lot}|${b.x}|${b.z}|${b.floors}|${b.kind}`).sort();
  assert.deepEqual(surfaceOf(fill), surfaceOf(fillLandscape(firstLandscape("d", "commercial"))), "the surface over it as it was");
  const hall = hallsOf(landscape).find((entry) => entry.street)!;
  assert.ok(hall && hall.depth === 30 && hall.height === 27 && hall.pillars === 0, "its hall is its open ground, open up to the skin");
  const buildings = [...fill.fabric.buildings, ...fill.landmarks].map((b, n) => ({ ...b, id: `b${n}` }));
  const world = createWorld({ buildings, roads: fill.fabric.roads.map((road) => ({ a: road.a, b: road.b, width: road.width, level: road.level })), plazas: fill.plazas, anchors: [], underground: { halls: hallsOf(landscape) } });
  ensure(world, street.x, street.z, 260, 0);
  const built = worldGraph(world, standingOf(world)), below = world.lots.filter((lot) => (lot.k0 ?? 0) < 0);
  assert.ok(below.length >= 4, `standing under the street: ${below.length}`);
  assert.ok(below.every((lot) => lot.k0 === -10 && lot.k0 + lot.floors <= -1), "on the street's floor (level -10), the roofs under the skin");
  // The street above keeps its own: a cell held below is held above too where a building of the surface stands over it.
  const twice = [...world.lotBelow.keys()].filter((key) => world.lotAt.has(key)).length;
  assert.ok(twice > 0, `the street above keeps its own buildings, over those under it: ${twice} cells held twice`);
  // Its rooms, and a walk to one from the street by the street's stairs.
  const rooms: number[] = [];
  for (let id = 0; id < built.type.length; id++) if (built.type[id] === 3 && built.lot[id] >= 0 && built.lot[id] < world.lots.length && (world.lots[built.lot[id]].k0 ?? 0) < 0) rooms.push(id);
  assert.ok(rooms.length > 0 && rooms.every((id) => nodePos(world, id).y < -20), "rooms under the street, at their own levels");
  const [ux, uz] = hall.up[0], from = nodeNear(world, built, ux, uz, 0)!, T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 });
  const seen = reachableIn(built.graph, from), reached = rooms.filter((id) => seen[id]);
  assert.ok(reached.length > 0, `a room under the street is reached from the street on foot (${reached.length} of ${rooms.length})`);
  const path = sampleWalk(built.graph, solveWalk(built.graph, reached.slice(0, 12), { T, kappa: 1, lambda: 8 }), from, 0, skeletonStream("sunk"));
  assert.ok(path && reached.includes(path.at(-1)!), "a walk goes down the stairs, along the street under, through a door into the room");
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
      // In a turned building a door no world cell holds is walked through the nearest corridor cell (its representative).
      const door = cellIndex(here.skeleton, ti, tj, k), unheld = (cell: number) => { const d = cellAt(here.skeleton, cell); return ![...world.lotAt].some(([key, index]) => world.lots[index] === here && (localCell(here, Math.floor(key / 65536) - 32768, (key % 65536) - 32768) ?? []).join() === [d.i, d.j].join()); };
      assert.ok(room.doors.includes(door) || (!!here.frame && room.doors.some(unheld)), "out of a room only through one of its doors (in a turned building, a door no world cell holds through the nearest corridor)");
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

test("the world stands the same whatever order its chunks are reached in: the same cells held by the same buildings, the same walks", () => {
  const stream = (order: [number, number][]) => { const world = createWorld(source()); for (const [x, z] of order) ensure(world, x, z, 60, 0); ensure(world, 0, 0, 160, 0); return world; };
  const a = stream([[-120, -80], [120, 90], [0, 0]]), b = stream([[120, 90], [0, 0], [-120, -80]]);
  const holdings = (world: ReturnType<typeof createWorld>) => new Map([...world.lotAt].map(([key, index]) => [key, world.lots[index].source]));
  const [ha, hb] = [holdings(a), holdings(b)];
  assert.ok(ha.size > 1000, `a city's worth of held cells (${ha.size})`);
  assert.deepEqual([...hb].filter(([key, owner]) => ha.get(key) !== owner).length, 0, "every cell held by the same building in both");
  assert.equal(hb.size, ha.size);
  const walks = (world: ReturnType<typeof createWorld>) => { const { graph } = worldGraph(world, standingOf(world)), out = new Set<string>(); for (let n = 0; n < graph.nodes; n++) for (let e = graph.offsets[n]; e < graph.offsets[n + 1]; e++) { const t = graph.to[e]; out.add(`${graph.x[n]},${graph.z[n]},${graph.y[n]}>${graph.x[t]},${graph.z[t]},${graph.y[t]}`); } return out; };
  const [wa, wb] = [walks(a), walks(b)];
  assert.ok(wa.size > 10000);
  assert.deepEqual([...wb].filter((edge) => !wa.has(edge)).length, 0, "every step of one world is a step of the other");
  assert.equal(wb.size, wa.size);
});

test("the world's own check: every building whole in the graph is entered from the street, every room reached", async () => {
  const { worldIssues } = await import("../apps/playground/src/data/world.js");
  const { clearOverlaps } = await import("../src/v2/world/tall.js");
  // The city as the export builds it: no building inside another (an overlapped one is swallowed, and the check says so).
  const raw = source(), world = createWorld({ ...raw, buildings: clearOverlaps(raw.buildings as never, () => false).buildings as never });
  ensure(world, 0, 0, 160, 0);
  assert.deepEqual(worldIssues(world, worldGraph(world, standingOf(world))), [], "a generated city has no shut building or room");
  // A building whose corridors are all gone (standing nothing) cannot be entered.
  const standing = standingOf(world), shut = world.lots.findIndex((lot) => lot.floors >= 2 && lot.skeleton.nx * lot.skeleton.nz > 30);
  standing[shut] = standing[shut].map(() => 0);
  const issues = worldIssues(world, worldGraph(world, standing));
  assert.ok(issues.some((issue) => issue.lot === shut && issue.code === "NO_ENTRANCE"), JSON.stringify(issues.slice(0, 3)));
});
