import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE, buildGraph, directionOf, sampleWalk, solveWalk, temperatureBound } from "../apps/playground/src/data/pathIntegral.js";
import { composeGroup } from "../apps/playground/src/data/placeGroup.js";
import { certify } from "../apps/playground/src/data/buildingPlan.js";
import { stream } from "../apps/playground/src/data/placeGroup.js";

// A small loop with a target: walks may circle the square any number of times before entering Y.
//   0 — 1
//   |   |
//   3 — 2 → 4 (Y)
const positions: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 1, 0]];
const link = (from: number, to: number) => ({ from, to, dir: directionOf(positions[to][0] - positions[from][0], positions[to][1] - positions[from][1]), cost: Math.hypot(positions[to][0] - positions[from][0], positions[to][1] - positions[from][1]), kind: EDGE.walk });
const graph = buildGraph(positions, [link(0, 1), link(1, 0), link(1, 2), link(2, 1), link(2, 3), link(3, 2), link(3, 0), link(0, 3), link(2, 4)]);

/** Exact first-hit walk weights by enumeration (walks up to `depth` steps), keyed by the walk. */
function enumerate(start: number, heading: number, T: number, kappa: number, depth: number) {
  const weights = new Map<string, number>();
  const turn = (a: number, b: number) => { const u = [[1, 0], [-1, 0], [0, 1], [0, -1]][a], v = [[1, 0], [-1, 0], [0, 1], [0, -1]][b]; return kappa * (1 - (u[0] * v[0] + u[1] * v[1])); };
  const walk = (node: number, direction: number, path: number[], action: number) => {
    if (node === 4) { weights.set(path.join(","), Math.exp(-action / T)); return; }
    if (path.length > depth) return;
    for (let e = graph.offsets[node]; e < graph.offsets[node + 1]; e++) walk(graph.to[e], graph.dir[e], [...path, graph.to[e]], action + graph.cost[e] + turn(direction, graph.dir[e]));
  };
  walk(start, heading, [start], 0);
  return weights;
}

test("the h-transform draws walks with exactly their path-integral weights, persistence included", () => {
  const T = 0.6, kappa = 0.8, heading = directionOf(0, 1);
  const field = solveWalk(graph, [4], { T, kappa, lambda: 8 });
  assert.ok(field.converged);
  const exact = enumerate(0, heading, T, kappa, 14), total = [...exact.values()].reduce((sum, value) => sum + value, 0);
  const rng = stream("test"), counts = new Map<string, number>(), draws = 40000;
  for (let k = 0; k < draws; k++) { const path = sampleWalk(graph, field, 0, heading, rng)!.join(","); counts.set(path, (counts.get(path) ?? 0) + 1); }
  // The four shortest walks carry most of the mass; each is drawn at its exact share.
  for (const [path, weight] of [...exact].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    const expected = weight / total, observed = (counts.get(path) ?? 0) / draws;
    assert.ok(Math.abs(observed - expected) < 4 * Math.sqrt(expected * (1 - expected) / draws) + 1e-3, `${path}: ${observed.toFixed(4)} vs ${expected.toFixed(4)}`);
  }
  // Heading down, the walk through 3 (no turn) beats the one through 1 (a turn).
  assert.ok((exact.get("0,3,2,4") ?? 0) > (exact.get("0,1,2,4") ?? 0));
});

test("the temperature bound reproduces the research figure for 8 ground directions", () => {
  // With climbs this costly, up and down add almost nothing: the research's figure for 8 ground directions, T < 0.5626.
  const bound = temperatureBound({ step: 1, kappa: 0, lambda: 8, floorHeight: 3 });
  assert.ok(Math.abs(bound - 0.562562) < 2e-4, String(bound));
  assert.ok(temperatureBound({ step: 0.5, kappa: 1, lambda: 8, floorHeight: 3 }) > temperatureBound({ step: 0.5, kappa: 0, lambda: 8, floorHeight: 3 }), "turning costs allow a warmer walk");
});

test("a district keeps every room reachable from the avenue, clutter included, and reaches the roofs by its stairs", () => {
  const group = composeGroup({ id: "loc_7", kind: "district", seed: 3, members: [{ id: "h", label: "医院", spec: "hospital" }, { id: "s", label: "地铁站", spec: "station" }] });
  assert.ok(group.clutter.cells > 100 && group.clutter.attempts >= 1);
  const plan = { version: 1, archetype: "corridor" as const, seed: 3, attempt: 0, footprint: { x: 0, z: 0, width: group.width, depth: group.depth }, site: { x: 0, z: 0, width: group.width, depth: group.depth }, street: group.streets.avenue, floors: [{ level: 0, elevation: 0, rooms: group.rooms, portals: group.portals, cores: [] }] };
  assert.ok(certify(plan, group.nav, { floors: 1, minDoor: 0.8 }).ok);
  assert.deepEqual(group.lots.filter((lot) => lot.label).map((lot) => [lot.label, lot.spec]).sort(), [["医院", "hospital"], ["地铁站", "station"]]);
  const T = 0.6 * temperatureBound({ step: 0.5, kappa: 1, lambda: 8, floorHeight: 3 });
  const field = solveWalk(group.graph, group.spots.rooftop, { T, kappa: 1, lambda: 8 });
  const path = sampleWalk(group.graph, field, group.spots.avenue[0], directionOf(0, -1), stream("roof"))!;
  assert.ok(path && group.graph.y[path.at(-1)!] > 0, "someone on the avenue reaches a roof");
  assert.ok(path.some((node, index) => index > 0 && group.graph.y[node] > group.graph.y[path[index - 1]] && group.nav.regions[group.nav.region[path[index - 1]]]?.includes("stair")), "by a stair core");
});
