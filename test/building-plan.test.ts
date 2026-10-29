import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL, PLAN_SPECS, certify, generateBuilding, navigate, stepsFrom, type BuildingPlan, type PlanSpec } from "../apps/playground/src/data/buildingPlan.js";

const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1);

test("every generated house and school floor passes its certificate: every room reached from the street, through public rooms only", () => {
  for (const [name, spec] of Object.entries(PLAN_SPECS) as [string, PlanSpec][]) {
    let firstTry = 0;
    for (const seed of SEEDS) {
      const { plan, certificate, attempts } = generateBuilding(spec, seed);
      assert.ok(certificate.ok, `${name} seed ${seed}: ${JSON.stringify(certificate.failures)}`);
      if (attempts === 1) firstTry++;
      const rooms = new Map(plan.floors[0].rooms.map((room) => [room.id, room]));
      for (const [id, via] of Object.entries(certificate.access)) {
        assert.equal(via!.at(-1), id);
        // Only public rooms are passed through on the way.
        assert.ok(via!.slice(1, -1).every((step) => rooms.get(step)!.transit), `${name} seed ${seed}: ${via!.join(" → ")}`);
      }
      assert.ok(plan.floors[0].cores.length >= 1, "the stair core is reserved");
      assert.ok(plan.floors[0].portals.every((portal) => portal.to - portal.from >= spec.minDoor), "doors are clear");
    }
    assert.ok(firstTry >= SEEDS.length * 0.9, `${name}: ${firstTry}/${SEEDS.length} pass on the first candidate`);
  }
});

test("a plan is a function of its seed, and seeds vary it", () => {
  const key = (plan: BuildingPlan) => JSON.stringify(plan.floors);
  assert.equal(key(generateBuilding(PLAN_SPECS.house, 7).plan), key(generateBuilding(PLAN_SPECS.house, 7).plan));
  assert.ok(new Set(SEEDS.slice(0, 50).map((seed) => key(generateBuilding(PLAN_SPECS.house, seed).plan))).size >= 45);
});

test("walls hold: rooms connect only through portals, and no diagonal step cuts a corner", () => {
  for (const seed of SEEDS.slice(0, 40)) for (const spec of Object.values(PLAN_SPECS) as PlanSpec[]) {
    const { plan, nav } = generateBuilding(spec, seed);
    const portalPairs = new Set(plan.floors[0].portals.map((portal) => [...portal.between].sort().join("|")));
    for (let cell = 0; cell < nav.cols * nav.rows; cell++) for (const next of stepsFrom(nav, cell)) {
      const [a, b] = [nav.regions[nav.region[cell]], nav.regions[nav.region[next]]];
      if (a !== b) assert.ok(portalPairs.has([a, b].sort().join("|")), `seed ${seed}: ${a} → ${b} without a portal`);
      const dx = (next % nav.cols) - (cell % nav.cols), dz = Math.floor(next / nav.cols) - Math.floor(cell / nav.cols);
      if (dx && dz) assert.ok(stepsFrom(nav, cell).includes(cell + dx) && stepsFrom(nav, cell).includes(cell + dz * nav.cols), "a diagonal needs both axial neighbours");
    }
  }
});

test("failures are diagnosed, not looped on: a core that cannot fit, a private room in the way, a door too narrow", () => {
  const huge = generateBuilding({ ...PLAN_SPECS.house, core: { width: 9, depth: 9 } }, 1, 5);
  assert.equal(huge.attempts, 5);
  assert.deepEqual(huge.certificate.failures.map((failure) => failure.code), ["core_does_not_fit"]);
  // Hand-made: the study is reached only through a bedroom, and the bedroom door is 0.5 m.
  const rect = (x: number, z: number, width: number, depth: number) => ({ x, z, width, depth });
  const plan: BuildingPlan = { version: 1, archetype: "hall", seed: 0, attempt: 0, footprint: rect(0, 0, 6, 4), site: rect(-2, -2, 10, 12), street: rect(-2, 6, 10, 4), floors: [{ level: 0, elevation: 0, cores: [],
    rooms: [{ id: "hall_1", use: "hall", rect: rect(0, 0, 2, 4), transit: true }, { id: "bedroom_1", use: "bedroom", rect: rect(2, 0, 2, 4), transit: false }, { id: "study_1", use: "office", rect: rect(4, 0, 2, 4), transit: false }],
    portals: [{ id: "entrance_1", kind: "entrance", between: ["outside", "hall_1"], axis: "x", at: 4, from: 0.5, to: 1.5 }, { id: "door_2", kind: "door", between: ["bedroom_1", "hall_1"], axis: "z", at: 2, from: 1, to: 1.5 },
      { id: "door_3", kind: "door", between: ["study_1", "bedroom_1"], axis: "z", at: 4, from: 1, to: 2 }] }] };
  const nav = navigate(plan), certificate = certify(plan, nav, { floors: 1, minDoor: 0.8 });
  assert.deepEqual(certificate.failures.map((failure) => `${failure.code}:${failure.room}`), ["no_clear_door:bedroom_1", "unreachable_target:study_1"]);
  assert.deepEqual(certificate.access.bedroom_1, ["outside", "hall_1", "bedroom_1"]);
  assert.equal(CELL, 0.5);
});
