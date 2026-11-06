import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingAt, cellKey, createWorld, ensure, nodeId, nodeNear, reachableIn, windowOf, worldGraph, type WorldSource } from "../apps/playground/src/data/world.js";
import { fillLandscape, firstLandscape } from "../src/v2/world/landscape.js";
import { BANDS, LINING, breach, ceilingOf, hallsOf, type Hall } from "../src/v2/world/underground.js";
import { EDGE } from "../apps/playground/src/data/pathIntegral.js";
import { BLAST_ENERGY } from "../apps/playground/src/data/structure.js";

// Stage 2 of docs/v2/terrain-levels.md: the ceilings (§8.3), the ground skin and its breaches (§8.4), the deep layer's hard
// ceiling (§8.6).

function source(halls: Hall[]): WorldSource {
  const filled = fillLandscape(firstLandscape("d", "commercial"));
  return { buildings: filled.fabric.buildings.map((b, n) => ({ ...b, id: `b${n}` })), roads: filled.fabric.roads.map((road) => ({ a: road.a, b: road.b, width: road.width, level: road.level })), plazas: filled.plazas, anchors: [], underground: { halls } };
}
const standingOf = (world: ReturnType<typeof createWorld>) => world.lots.map((lot) => lot.skeleton.cells.map((value) => (value ? 1 : 0)));
const energyOf = (r: number, strength = 0.9) => BLAST_ENERGY * strength * (2 * r / 8) ** 3;
// A hall's cells (2 m squares) over a box.
const cellsOf = (x0: number, z0: number, w: number, d: number) => Array.from({ length: (w / 2) * (d / 2) }, (_, n) => ({ i: Math.floor(x0 / 2) + (n % (w / 2)), j: Math.floor(z0 / 2) + Math.floor(n / (w / 2)) }));

test("each level's ceiling (§8.3): the ground skin over a real hall, its bond the band's and a lining's; the deep layer's hard ceiling a floor above its tallest building at least; a deck's and an orbit's the sky", () => {
  const mall = ceilingOf({ depth: 7, height: 5, lined: true });
  assert.deepEqual(mall, { kind: "skin", at: -2, cover: 2, bond: BANDS[0].bond + LINING.bond });
  assert.equal(ceilingOf({ depth: 7, height: 5, lined: false }).bond, 3, "unlined: the soil's 3");
  assert.equal(ceilingOf({ depth: 90, height: 10, lined: false }).bond, BANDS[2].bond, "80 m of cover is hard rock");
  const deep = { depth: 180, height: 60, lined: true, layer: "deep" as const };
  assert.deepEqual(ceilingOf(deep), { kind: "hard", at: -120, cover: Infinity, bond: Infinity });
  assert.equal(ceilingOf(deep, 66).at, -180 + 69, "a floor above a 66 m tower");
  assert.equal(ceilingOf({ depth: -150, height: 60, lined: true, layer: "air" }).kind, "sky");
  assert.equal(ceilingOf({ depth: -1200, height: 60, lined: true, layer: "space" }).kind, "sky");
});

test("the skin a blast breaks (§8.4): only where its sphere takes in the whole cover and its blow is over the bond; a small blast, a deep hall and the hard ceiling never", () => {
  const cells = cellsOf(-20, -20, 40, 40), skin = ceilingOf({ depth: 7, height: 5, lined: false });
  // A blast 16 m across a metre under a mall's ceiling: a hole round it, no wider than its sphere.
  const big = breach(skin, cells, { x: 0, y: -3, z: 0 }, 8, energyOf(8));
  assert.ok(big.length > 0, `${big.length} cells`);
  assert.ok(big.every((n) => Math.hypot((cells[n].i + 0.5) * 2, (cells[n].j + 0.5) * 2) <= 8));
  // A small one (4 m across) does not reach the street over it.
  assert.deepEqual(breach(skin, cells, { x: 0, y: -3, z: 0 }, 2, energyOf(2)), []);
  // A lining holds a weaker blow: what breaks under it is no more than unlined.
  const lined = breach(ceilingOf({ depth: 7, height: 5, lined: true }), cells, { x: 0, y: -3, z: 0 }, 8, energyOf(8));
  assert.ok(lined.length <= big.length);
  // From the street over it: a blast on the pavement breaks down into the mall.
  assert.ok(breach(skin, cells, { x: 0, y: 1, z: 0 }, 8, energyOf(8)).length > 0, "from above");
  // A deep lab's 80 m of rock, the deep layer's hard ceiling, the sky: nothing.
  assert.deepEqual(breach(ceilingOf({ depth: 90, height: 10, lined: false }), cells, { x: 0, y: -85, z: 0 }, 16, energyOf(16)), []);
  assert.deepEqual(breach(ceilingOf({ depth: 180, height: 60, lined: true, layer: "deep" }), cells, { x: 0, y: -125, z: 0 }, 16, energyOf(16)), []);
});

test("a hole in the skin (§8.4): no ground there, a drop from its rim to the hall's floor, back up only for a climber; the sky over the hall under it", () => {
  const mall = hallsOf(firstLandscape("d", "commercial")).find((hall) => hall.kind === "mall")!;
  assert.ok(mall, "the commercial district has a mall");
  const world = createWorld(source([mall]));
  ensure(world, mall.boxes[0].x, mall.boxes[0].z, 120, 0);
  const box = mall.boxes[0], i = Math.floor(box.x / 2), j = Math.floor(box.z / 2), floor = world.under.get(cellKey(i, j))!.find((entry) => entry.hall === 0)!;
  assert.ok(floor, "a mall cell under the box's middle");
  const before = worldGraph(world, standingOf(world)), streetNode = nodeId(world, i, j, 0);
  const open = before.type[streetNode];
  assert.equal(ceilingAt(world, i, j, floor.k).kind, "skin");
  // Break a 3 by 3 hole over the mall's middle (where no building stands).
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (!world.lotAt.has(cellKey(i + di, j + dj))) world.underDamage.breaches.set(cellKey(i + di, j + dj), 0);
  const after = worldGraph(world, standingOf(world)), bottom = nodeId(world, i, j, floor.k);
  assert.ok(open === 1, "the street was open ground there");
  assert.equal(after.type[streetNode], 0, "the hole is no ground");
  assert.deepEqual(ceilingAt(world, i, j, floor.k), { kind: "sky", at: Infinity, cover: 0, bond: Infinity, hall: 0, open: true });
  // The rim's drops land on the floor under the hole; their way back up is a wall.
  const { graph } = after, drops: number[] = [], ups: number[] = [];
  for (let from = 0; from < graph.nodes; from++) for (let e = graph.offsets[from]; e < graph.offsets[from + 1]; e++) {
    const to = graph.to[e];
    if (after.type[from] === 1 && graph.y[to] < -1 && graph.kind[e] === EDGE.fall) drops.push(to);
    if (after.type[to] === 1 && graph.y[from] < -1 && [EDGE.wallLow, EDGE.wallMid, EDGE.wallHigh].includes(graph.kind[e] as 6 | 7 | 8)) ups.push(from);
  }
  assert.ok(drops.length >= 4 && ups.length === drops.length, `${drops.length} drops, ${ups.length} climbs`);
  // In the hole's own window (no stairs of the mall's in it), who walks the floor under it gets no way up; one who climbs does.
  const near = windowOf(after.graph, { x0: (i - 2) * 2, x1: (i + 3) * 2, z0: (j - 2) * 2, z1: (j + 3) * 2 }), from = near.local[bottom];
  const up = (factors: number[]) => { const seen = reachableIn(near.graph, from, factors); return Array.from(near.ids).some((id, n) => seen[n] && after.type[id] === 1); };
  assert.ok(from >= 0, "the floor under the hole is in its window");
  assert.equal(up([1, 1, 1, 1, 1, 1, Infinity, Infinity, Infinity]), false, "a walker stays below");
  assert.equal(up([1, 1, 1, 1, 1, 1, 1.5, Infinity, Infinity]), true, "a climber comes up at the rim");
});

test("the ceiling over a cell: the sky outdoors, the floor above inside a building, the deep layer's hard ceiling over its floor", () => {
  const deep: Hall = { id: "deep", kind: "deep", depth: 180, height: 60, boxes: [{ x: 0, z: 0, w: 80, d: 80, angle: 0 }], bores: [], pillars: 0, lined: true, up: [], street: true, virtual: true, layer: "deep" };
  const world = createWorld(source([deep]));
  ensure(world, 0, 0, 80, 0);
  const built = worldGraph(world, standingOf(world)), street = nodeNear(world, built, 0, 40, 0)!, { i, j } = { i: world.cells[street * 3], j: world.cells[street * 3 + 1] };
  assert.equal(ceilingAt(world, i, j, 0).kind, "sky");
  const [index] = [...world.lotAt.values()], lot = world.lots[index];
  if (lot.floors >= 2) { const at = [...world.lotAt].find(([, n]) => n === index)![0], li = Math.floor(at / 65536) - 32768, lj = (at % 65536) - 32768; assert.deepEqual(ceilingAt(world, li, lj, 0), { kind: "slab", at: 3, cover: 0, bond: Infinity }); }
  const floor = world.under.get(cellKey(0, 0))?.find((entry) => entry.hall === 0);
  assert.ok(floor);
  const hard = ceilingAt(world, 0, 0, floor!.k);
  assert.equal(hard.kind, "hard");
  assert.ok(hard.at >= -120, "at least its room of 60 m");
});

test("a building of another level stands at its own level in the blast's reckoning (structure.ts y0): the deep floor's 180 m down, not on the street", async () => {
  const { structureOf, unitAt } = await import("../apps/playground/src/data/structure.js");
  const { generateSkeleton } = await import("../apps/playground/src/data/skeleton.js");
  const skeleton = generateSkeleton("house", 7);
  const street = structureOf({ i0: 0, j0: 0, skeleton }), deep = structureOf({ i0: 0, j0: 0, k0: -60, skeleton });
  assert.equal(street.y0, undefined);
  assert.equal(unitAt(deep, 0).y - unitAt(street, 0).y, -180);
});
