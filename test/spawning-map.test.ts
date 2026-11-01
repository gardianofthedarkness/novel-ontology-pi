import assert from "node:assert/strict";
import { test } from "node:test";
import { averageOverMedian } from "../src/ground/stage/landscape.js";
import { TERRAIN_KINDS } from "../src/v2/context/terrainModes.js";
import { defaultResolver, loadSpawning } from "../src/v2/spawning/config.js";
import { unify } from "../src/v2/spawning/heights.js";
import { energyOf, layOut, radiusOf, type Standing } from "../src/v2/spawning/topology.js";

// One city of manifolds (docs/v2/borrow-and-spawn.md §8): its districts laid out by its topology, its heights unified.
const metropolis = defaultResolver(loadSpawning())({ id: "c1", label: "a metropolis", level: "city", kind: "metropolis" })!;
const six = [["cbd", 2], ["dwelling", 3], ["industrial", 1]].flatMap(([kind, n]) => Array.from({ length: n as number }, (_, k) => ({ id: `${kind}${k + 1}`, kind: kind as string, r: 300 })));
const shareOf = (at: [number, number], R: number) => Math.hypot(at[0], at[1]) / R;

test("a metropolis's districts lie by its topology: the CBDs in the middle, industry out at the edge and away from them", () => {
  assert.ok(metropolis.topology, "the city configuration carries a topology");
  const { manifolds, terms, radius } = layOut([], six, metropolis.topology!, "c1");
  const R = radiusOf(manifolds), at = (id: string) => manifolds.find((m) => m.id === id)!.at;
  for (const id of ["cbd1", "cbd2"]) assert.ok(shareOf(at(id), R) <= 0.35, `${id} at ${shareOf(at(id), R).toFixed(2)} of the radius`);
  assert.ok(shareOf(at("industrial1"), R) >= 0.65, `industry at ${shareOf(at("industrial1"), R).toFixed(2)}`);
  assert.ok(Math.min(...["cbd1", "cbd2"].map((id) => Math.hypot(at(id)[0] - at("industrial1")[0], at(id)[1] - at("industrial1")[1]))) > 0.5 * R, "industry apart from the CBDs");
  assert.ok(terms.pressure < 1, `little left pressing: ${JSON.stringify(terms)}`);
  assert.equal(radius, Math.round(R));
  assert.deepEqual(layOut([], six, metropolis.topology!, "c1").manifolds, manifolds, "the same seed, the same city");
});

test("a new district presses on the standing ones, which give only a little", () => {
  const first = layOut([], six, metropolis.topology!, "c1").manifolds;
  const standing: Standing[] = first.map((m) => ({ ...m, give: 1 }));
  const { manifolds } = layOut(standing, [{ id: "cbd3", kind: "cbd", r: 300 }], metropolis.topology!, "c1");
  for (const m of first) {
    const now = manifolds.find((other) => other.id === m.id)!;
    assert.ok(Math.hypot(now.at[0] - m.at[0], now.at[1] - m.at[1]) <= 0.15 * m.r + 1, `${m.id} moved at most its give`);
  }
  const fixed = layOut(first.map((m) => ({ ...m, give: 0 })), [{ id: "cbd3", kind: "cbd", r: 300 }], metropolis.topology!, "c1").manifolds;
  for (const m of first) assert.deepEqual(fixed.find((other) => other.id === m.id)!.at, m.at, "with no give, nothing moves");
  assert.ok(energyOf(manifolds, metropolis.topology!).total >= 0);
});

test("heights: a lower part raises the rest; a higher one lowers only the highest unnamed, only so far; the parent takes the rest", () => {
  const part = (id: string, average: number, extra = {}) => ({ id, area: 100, average, range: [5, 200] as [number, number], ...extra });
  const lower = unify(20, [part("new", 10, { fixed: true }), part("a", 20), part("b", 20)]);
  assert.equal(lower.parent, 20); assert.equal(lower.averages.a, 25); assert.equal(lower.averages.b, 25);
  const higher = unify(20, [part("new", 80, { fixed: true }), part("tall", 40), part("low", 10), part("named", 60, { nominated: true })]);
  assert.equal(higher.averages.low, 10, "low ground is never lowered");
  assert.equal(higher.averages.named, 60, "a nominated building stands");
  assert.equal(higher.averages.tall, 34, "the highest unnamed lowered by its limit, 15%");
  assert.ok(higher.parent > 20, `the parent's average takes the rest: ${higher.parent}`);
  const born = unify(15, [part("open", 15, { born: true, range: [6, 60] }), part("cbd", 120, { born: true, range: [30, 250] })]);
  assert.equal(born.averages.cbd, 30, "what is born now goes as low as its range lets it");
  assert.equal(born.averages.open, 6);
  assert.equal(born.parent, 18, "and the city's average rises for what its range would not let go");
});

test("a manifold's average stands above its median by its own spread and fall", () => {
  const cbd = TERRAIN_KINDS.district.cbd.manifold!, dwelling = TERRAIN_KINDS.district.dwelling.manifold!;
  assert.ok(averageOverMedian(cbd) > 1 && averageOverMedian(dwelling) > 1);
  assert.ok(averageOverMedian(cbd) > averageOverMedian(dwelling), "a CBD's towers lift its average more");
});
