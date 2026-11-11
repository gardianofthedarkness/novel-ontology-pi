// Models as code (milestones M10a–c): fixtures that pass and fail each check of the contract, the floating-piece rule,
// and the nomination's ranking. The OpenSCAD fixtures are skipped where OpenSCAD is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, floatingPieces } from "../../src/world/models/contract.js";
import { evaluate, measure, readOff, solidOf } from "../../src/world/models/scad.js";
import { nominate } from "../../src/world/models/models.js";

const HAS_OPENSCAD = spawnSync(process.env.OPENSCAD ?? "openscad", ["--version"]).status === 0;
async function made(code: string, expected: { kind?: string; size?: number[] | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "model-")), scad = join(dir, "t.scad"), off = join(dir, "t.off");
  writeFileSync(scad, code);
  const run = evaluate(scad, off);
  assert.ok(run.ok, JSON.stringify(run));
  const mesh = readOff(off), m = measure(mesh), solid = await solidOf(mesh);
  return { m, solid, mesh, ...check(m, solid, expected) };
}

test("a box on the ground, about the reading's size, passes; its colours come through", { skip: !HAS_OPENSCAD }, async () => {
  const r = await made("module thing() { color([0.2, 0.4, 0.8]) translate([-2, -1, 0]) cube([4, 2, 1.5]); }\nthing();", { kind: "a car", size: [4.5, 1.5, 1.9] });
  assert.deepEqual(r.problems, []); assert.equal(r.solid.pieces, 1); assert.deepEqual(r.m.size, [4, 2, 1.5]);
  assert.deepEqual(r.mesh.colours[0], [51, 102, 204]);
});

test("blades under the ground fail (the wind turbine, 2026-11-09)", { skip: !HAS_OPENSCAD }, async () => {
  const r = await made("module thing() { cylinder(h = 60, r = 2); translate([0, 0, 60]) rotate([0, 90, 0]) translate([-1, -1, 0]) cube([2, 2, 1]); translate([1, -1, 60 - 90]) cube([0.5, 2, 90]); }\nthing();");
  assert.match(r.problems.join(" "), /lowest point is at z = -30/);
});

test("a rotor 1 m off its mast floats; 5 cm off, it is attached (a warning)", { skip: !HAS_OPENSCAD }, async () => {
  const far = await made("module thing() { translate([-5, -1, 0]) cube([10, 2, 3]); translate([-6, -0.1, 4]) cube([12, 0.2, 0.1]); }\nthing();");
  assert.match(far.problems.join(" "), /1 of its 2 pieces float/);
  const near = await made("module thing() { translate([-5, -1, 0]) cube([10, 2, 3]); translate([-6, -0.1, 3.05]) cube([12, 0.2, 0.1]); }\nthing();");
  assert.deepEqual(near.problems, []); assert.match(near.warnings.join(" "), /2 pieces, each within/);
});

test("a 30 m knife is refused against the reading's 0.3 m", { skip: !HAS_OPENSCAD }, async () => {
  const r = await made("module thing() { translate([-15, -0.02, 0]) cube([30, 0.04, 0.1]); }\nthing();", { kind: "a small weapon", size: [0.3, 0.04, 0.02] });
  assert.match(r.problems.join(" "), /longest side is 30 m, but the reading has it at about 0.3 m/);
});

test("broken code reports OpenSCAD's own error", { skip: !HAS_OPENSCAD }, () => {
  const dir = mkdtempSync(join(tmpdir(), "model-")), scad = join(dir, "t.scad");
  writeFileSync(scad, "module thing() { cube([1, 1, 1] }\nthing();");
  const run = evaluate(scad, join(dir, "t.off"));
  assert.equal(run.ok, false);
});

test("floating pieces: joined to the body through near pieces, else floating", () => {
  const box = (x: number): { min: [number, number, number]; max: [number, number, number] } => ({ min: [x, 0, 0], max: [x + 1, 1, 1] });
  assert.deepEqual(floatingPieces([{ min: [0, 0, 0], max: [10, 10, 10] }, box(10.1), box(11.2)], 0.15), []);
  assert.equal(floatingPieces([{ min: [0, 0, 0], max: [10, 10, 10] }, box(12)], 0.15).length, 1);
});

test("nominate: a big thing seen in scenes gets its own model, a small one a part, a non-thing nothing", () => {
  const sentences = new Map([["s1", { text: "The observation helicopter circled the tower, its rotor loud over the street." }], ["s2", { text: "The helicopter dipped." }], ["s3", { text: "She drew a knife." }], ["s4", { text: "The observation helicopter turned away from the building, two armoured men at its doors." }]]);
  const sceneOf = new Map([["s1", "a"], ["s2", "a"], ["s3", "b"], ["s4", "c"]]);
  const rows = nominate({ "observation helicopter": { kind: "a helicopter", size: [12, 3, 3] }, knife: { kind: "a small weapon" }, wall: { kind: "part of a building" } }, sentences, sceneOf, { ownScenes: 2, ownMentions: 3, top: 40 });
  assert.deepEqual(rows.map((row) => [row.label, row.decision]), [["observation helicopter", "own"], ["knife", "part"]]);
  assert.equal(rows[0].scenes, 2); assert.equal(rows[0].mentions, 2);
});
