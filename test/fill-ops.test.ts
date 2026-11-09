// Fill operators (src/v2/world/fillOps.ts; milestones M8c): checked before use; a line along a road both sides at its
// spacing; nothing in a building or on a carriageway; scatter at most n, the same each time for a seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, checkOps } from "../src/v2/world/fillOps.js";
import { problemsOf } from "../src/v2/settings.js";

const roads = [{ a: [0, 0] as [number, number], b: [300, 0] as [number, number], width: 18, level: "arterial" }, { a: [150, -150] as [number, number], b: [150, 150] as [number, number], width: 8, level: "local" }];
const buildings = [{ x: 60, z: 30, w: 30, d: 20, angle: 0 }];

test("operators are checked: kinds, numbers, unknown parts", () => {
  assert.deepEqual(checkOps([{ op: "line", what: "street-light", along: "arterial", every: 30 }]), []);
  assert.match(checkOps([{ op: "scatter", what: "Dragon!", n: 3 }]).join(" "), /what must be one of/);
  assert.deepEqual(checkOps([{ op: "scatter", what: "wind-turbine", on: "street", n: 3 }]), [], "a kind of one's own, drawn where fill.props connects a part");
  assert.match(checkOps([{ op: "line", what: "tree" }]).join(" "), /every is needed/);
  assert.match(checkOps([{ op: "ring", what: "bench", n: 4, r: 10, colour: "red" }]).join(" "), /colour is not a part/);
  assert.match(problemsOf("fill.ops", [{ op: "scatter", what: "tree", n: 0 }]).join(" "), /n must be a number from 1/);
});

test("a line puts its things both sides at its spacing, none in a building or on another road", () => {
  const { props, report } = applyOps([{ op: "line", what: "street-light", along: "arterial", every: 30 }], { roads, buildings });
  assert.ok(props.length >= 16 && props.length <= 20, `${props.length} lights`);
  assert.ok(props.every(([, x, z]) => Math.abs(Math.abs(z) - 10.5) < 0.2), "at the kerb, 10.5 m off the axis");
  assert.ok(!props.some(([, x, z]) => Math.abs(x - 60) <= 15.5 && Math.abs(z - 30) <= 10.5), "none in the building");
  assert.ok(!props.some(([, x]) => Math.abs(x - 150) < 4.3), "none on the crossing road");
  assert.equal(report[0].put, props.length);
});

test("scatter puts at most n, the same for the same seed, never on a road", () => {
  const ops = [{ op: "scatter", what: "tree", on: "open", n: 50, seed: 1 }];
  const one = applyOps(ops, { roads, buildings, centre: [150, 0], radius: 140, seed: "p" }), two = applyOps(ops, { roads, buildings, centre: [150, 0], radius: 140, seed: "p" });
  assert.ok(one.props.length <= 50 && one.props.length > 40);
  assert.deepEqual(one.props, two.props);
  assert.ok(one.props.every(([, , z]) => Math.abs(z) > 9.3), "off the arterial");
});
