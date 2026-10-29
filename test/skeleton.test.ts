import { test } from "node:test";
import assert from "node:assert/strict";
import { CORRIDOR, MASS, STAIR, cellAt, cellIndex, furnish, generateSkeleton, reachable, robustness, skeletonStream, strike, type SkeletonKind } from "../apps/playground/src/data/skeleton.js";

test("a skeleton is the entrance's cluster and reaches every floor; stairs come in stacked pairs", () => {
  for (const kind of ["house", "school", "tower"] as SkeletonKind[]) for (let seed = 1; seed <= 20; seed++) {
    const s = generateSkeleton(kind, seed), seen = reachable(s, s.cells);
    const floors = new Set<number>();
    for (let cell = 0; cell < s.cells.length; cell++) if (s.cells[cell] !== MASS) { assert.ok(seen[cell], `${kind} ${seed}: an unreached corridor`); floors.add(cellAt(s, cell).k); }
    assert.equal(floors.size, s.floors, `${kind} ${seed}: every floor reached`);
    for (let cell = 0; cell < s.cells.length; cell++) if (s.cells[cell] === STAIR) {
      const { i, j, k } = cellAt(s, cell);
      assert.ok((k + 1 < s.floors && s.cells[cellIndex(s, i, j, k + 1)] === STAIR) || (k > 0 && s.cells[cellIndex(s, i, j, k - 1)] === STAIR), "a stair joins two floors");
    }
  }
});

test("rooms are boxes of mass, each opening onto circulation, none overlapping", () => {
  const s = generateSkeleton("school", 3), rooms = furnish(s, 1), owner = new Map<number, number>();
  assert.ok(rooms.length > 20);
  rooms.forEach((room, index) => {
    assert.ok(room.doors.length >= 1 && room.doors.every((door) => s.cells[door] === CORRIDOR || s.cells[door] === STAIR));
    for (let i = room.i0; i <= room.i1; i++) for (let j = room.j0; j <= room.j1; j++) { const cell = cellIndex(s, i, j, room.floor); assert.equal(s.cells[cell], MASS); assert.ok(!owner.has(cell)); owner.set(cell, index); }
  });
});

test("damage cuts off what it disconnects, and buildings fall apart as uniform damage grows", () => {
  const s = generateSkeleton("tower", 2), hit = strike(s, s.cells.map((value) => value ? 1 : 0), { x: 10, y: 1.5, z: 10, degree: 4 }, skeletonStream("hit"));
  assert.ok(hit.destroyed.length > 0);
  const seen = reachable(s, hit.standing);
  assert.ok(hit.cutOff.every((cell) => hit.standing[cell] && !seen[cell]));
  const curve = robustness(s, [0, 0.1, 0.3, 0.6], 40);
  assert.equal(curve[0].top, 1);
  assert.ok(curve[0].reached > curve[1].reached && curve[1].reached > curve[2].reached && curve[2].reached >= curve[3].reached);
});

test("a district of skeleton buildings: rooms on upper floors and roofs are walked to by stairs, and a hit takes them away", async () => {
  const { composePlace, placeGraph, hitLot, nodePosition } = await import("../apps/playground/src/data/skeletonPlace.js");
  const { solveWalk, sampleWalk, temperatureBound, directionOf } = await import("../apps/playground/src/data/pathIntegral.js");
  const place = composePlace({ id: "loc_7", kind: "district", seed: 5, members: [{ label: "医院", role: "hospital" }] });
  const standing: Uint8Array[] = place.lots.map((lot) => lot.skeleton.cells.map((value) => (value ? 1 : 0)));
  const { graph, spots } = placeGraph(place, standing);
  const T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3 });
  const upper = spots.west.filter((node) => nodePosition(place, node).k >= 2);
  assert.ok(upper.length > 0 && spots.rooftop.length > 0);
  const path = sampleWalk(graph, solveWalk(graph, upper, { T, kappa: 1, lambda: 8 }), spots.avenue[0], directionOf(0, -1), skeletonStream("up"))!;
  assert.ok(path && nodePosition(place, path.at(-1)!).k >= 2, "from the avenue up to a room two floors up");
  const lot = place.lots.findIndex((entry) => entry.floors >= 4), result = hitLot(place, lot, standing[lot], { x: (place.lots[lot].i0 + place.lots[lot].nx / 2) * 2, y: 0, z: (place.lots[lot].j0 + 6) * 2 }, 4, skeletonStream("blast"));
  assert.ok(result.destroyed.length > 0);
  standing[lot] = result.standing;
  const after = placeGraph(place, standing);
  assert.ok(after.graph.to.length < graph.to.length, "the walk sees less building");
});
