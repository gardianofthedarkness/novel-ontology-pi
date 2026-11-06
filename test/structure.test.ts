import { test } from "node:test";
import assert from "node:assert/strict";
import { CORRIDOR, STAIR } from "../apps/playground/src/data/skeleton.js";
import { UNIT, blast, intact, settle, structureOf, supported, unitAt } from "../apps/playground/src/data/structure.js";

// An invented block, 4 × 4 cells and 3 floors: corridors on every floor, a stair column at (1, 1).
function block(fill: (i: number, j: number, k: number) => number) {
  const nx = 4, nz = 4, floors = 3, cells = new Uint8Array(nx * nz * floors);
  for (let k = 0; k < floors; k++) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) cells[(k * nz + j) * nx + i] = fill(i, j, k);
  return structureOf({ i0: 0, j0: 0, skeleton: { nx, nz, floors, cells } });
}
const plain = () => block((i, j) => (i === 1 && j === 1 ? STAIR : CORRIDOR));

test("an intact building stands: every unit has a load path", () => {
  const structure = plain(), standing = intact(structure);
  assert.deepEqual([...supported(structure, standing)], [...standing]);
  assert.equal(structure.kind.filter((kind) => kind === UNIT.wall).length, 12 * 3, "a wall on every outer cell of every floor");
  assert.equal(structure.kind.filter((kind) => kind === UNIT.roof).length, 16, "a roof over the whole footprint");
});

test("a bigger blast breaks more at the same contact: its energy grows with its diameter", () => {
  const structure = plain(), centre = unitAt(structure, structure.kind.findIndex((kind, unit) => kind === UNIT.wall && structure.k[unit] === 1));
  const within = (broken: number[], r: number) => broken.filter((unit) => { const at = unitAt(structure, unit); return Math.hypot(at.x - centre.x, at.y - centre.y, at.z - centre.z) <= r; }).length;
  const small = blast(structure, intact(structure), { ...centre, r: 2 }, 1), large = blast(structure, intact(structure), { ...centre, r: 4 }, 1);
  assert.ok(large.energy === small.energy * 8, "twice the diameter, eight times the energy");
  assert.ok(within(large.broken, 2) > within(small.broken, 2), "inside the same 2 m, the bigger blast breaks more");
  assert.ok(blast(structure, intact(structure), { ...centre, r: 4 }, 0.3).broken.length < large.broken.length, "a weaker event breaks less");
});

test("a roof with nothing left under it comes down onto the floor below, and nothing is left floating", () => {
  const structure = plain(), standing = intact(structure);
  for (let unit = 0; unit < standing.length; unit++) if (structure.k[unit] === 2 && structure.kind[unit] !== UNIT.roof) standing[unit] = 0;
  const { standing: after, fallen } = settle(structure, standing);
  const roofs = fallen.filter(({ unit }) => structure.kind[unit] === UNIT.roof);
  assert.equal(roofs.length, 16, "the whole roof falls");
  for (const { from, to } of roofs) assert.ok(to < from && to >= 3 && to <= 6, "it lands on the floor below, not the ground");
  assert.deepEqual([...supported(structure, after)], [...after], "every unit left standing is held");
});

test("a stair falls when the stair under it breaks, unless a corridor beside it holds it", () => {
  // Stairs at (1, 1) on every floor; corridors only on the ground floor, so nothing holds the upper stairs sideways.
  const lone = block((i, j, k) => (i === 1 && j === 1 ? STAIR : k === 0 ? CORRIDOR : 0)), standing = intact(lone);
  standing[(0 * 4 + 1) * 4 + 1] = 0;
  const { fallen } = settle(lone, standing);
  assert.ok(fallen.some(({ unit }) => lone.kind[unit] === UNIT.stair && lone.k[unit] === 1), "the stair above falls");
  // With corridors on every floor, the corridor beside the upper stair holds it.
  const held = plain(), kept = intact(held);
  kept[(0 * 4 + 1) * 4 + 1] = 0;
  assert.ok(!settle(held, kept).fallen.some(({ unit }) => held.kind[unit] === UNIT.stair), "a corridor beside it holds it");
});
