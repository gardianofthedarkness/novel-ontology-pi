// Interaction sheets (milestones M15): a part's defaults by kind, by a kit part's words, by its size; the book's
// overrides by kind and by reference; what the models.interact setting refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInteract, interactOf } from "../src/v2/models/interact.js";
import { problemsOf } from "../src/v2/settings.js";

test("defaults by kind: an aircraft crashes hard from the air, a knife blocks nothing, a bus seats forty, a kit bus is a bus by its name", () => {
  const plane = interactOf({ ref: "own:vtol", kind: "an aircraft", size: [12, 3, 10] }, {});
  assert.deepEqual([plane.layer, plane.solid, plane.crash, plane.breaks, plane.seats], ["air", true, { degree: 4, radius: 30 }, "wreck", 200]);
  const knife = interactOf({ ref: "kit:cw_wpn_knife", kind: "a small weapon", category: "wpn", size: [0.3, 0.04, 0.02] }, {});
  assert.deepEqual([knife.solid, knife.crash.degree, knife.breaks], [false, 0, "none"]);
  assert.equal(interactOf({ ref: "kit:dd_veh_bus", name: "dd_veh_bus", category: "veh", size: [11, 3, 3] }, {}).seats, 40, "a kit vehicle by the words of its name");
  assert.equal(interactOf({ ref: "kit:cw_veh_heli_wreck", name: "cw_veh_heli_wreck", category: "veh" }, {}).wreck, "kit:cw_veh_heli_wreck");
});

test("a big static thing breaks as structure and its fall has a radius; a small prop does not", () => {
  const turbine = interactOf({ ref: "own:turbine", kind: "a robot or a machine", size: [8, 38, 27] }, {});
  assert.deepEqual([turbine.breaks, turbine.crash.degree >= 1, turbine.crash.radius >= 12], ["structure", true, true]);
  const bench = interactOf({ ref: "kit:cw_prop_bench", name: "cw_prop_bench", category: "prop", size: [1.8, 0.5, 0.6] }, {});
  assert.deepEqual([bench.solid, bench.breaks, bench.crash.radius], [true, "none", 0]);
  const tallTree = interactOf({ ref: "kit:x_nature_tree", name: "x_nature_tree", category: "nature", size: [6, 22, 6] }, {});
  assert.equal(tallTree.breaks, "structure", "anything 10 m or taller carries structure");
});

test("overrides: a kind's for every part of it, a reference's over that; the setting is checked", () => {
  const over = { "a car": { crash: { degree: 2 } }, "own:tank": { solid: true, crash: { degree: 3, radius: 9 }, breaks: "structure" as const } };
  assert.equal(interactOf({ ref: "own:sedan", kind: "a car" }, over).crash.degree, 2); assert.equal(interactOf({ ref: "own:sedan", kind: "a car" }, over).crash.radius, 4, "the rest stays the kind's");
  assert.deepEqual(interactOf({ ref: "own:tank", kind: "a car" }, over).crash, { degree: 3, radius: 9 });
  assert.deepEqual(checkInteract({ "an aircraft": { crash: { degree: 4, radius: 40 } } }), []);
  assert.match(checkInteract({ "a car": { crash: { degree: 5 } } }).join(" "), /degree must be 0 to 4/);
  assert.match(checkInteract({ "a car": { layer: "space" } }).join(" "), /layer must be/);
  assert.match(checkInteract({ "a car": { wreck: "notaref" } }).join(" "), /part reference/);
  assert.match(checkInteract([]).join(" "), /must be an object/);
  assert.deepEqual(problemsOf("models.interact", { "a bus": { seats: 60 } }), []);
  assert.ok(problemsOf("models.interact", { "a bus": { seats: -1 } }).length > 0);
});
