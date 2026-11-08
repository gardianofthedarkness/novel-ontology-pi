import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, EDGE, solveWalk, temperatureBound, UP, DOWN } from "../apps/playground/src/data/pathIntegral.js";

// Street (0) beside a wall up to a roof (1) that is the target; the wall is the only way.
const graph = buildGraph([[0, 0, 0], [2, 0, 24]], [{ from: 0, to: 1, dir: UP, cost: 26, kind: EDGE.wallMid }, { from: 1, to: 0, dir: DOWN, cost: 14, kind: EDGE.wallMid }]);
const T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 });

test("a building's wall is no way for someone whose way of moving does not name it", () => {
  const field = solveWalk(graph, [1], { T, kappa: 1, lambda: 8, factors: [1, 1, 1, 1, 4, 1] });
  assert.equal(field.weight[0], 0);
});

test("a climber's way of moving opens the walls it names", () => {
  const field = solveWalk(graph, [1], { T, kappa: 1, lambda: 8, factors: [1, 1, 1, 1, 4, 1, 1.5, 1.5, Infinity] });
  assert.ok(field.weight[0] > 0);
});
