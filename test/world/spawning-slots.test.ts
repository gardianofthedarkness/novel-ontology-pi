import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingsOf, defaultResolver, loadSpawning, pickCount, seeded, spawnsOf } from "../../src/world/terrain/config.js";
import { admissible, chooseSlots, countsIn, spawnChildren, type LevelProblem, type Mention, type Point, type Slot } from "../../src/world/terrain/slots.js";

// Borrowing and spawning by type (docs/v3/design.html#borrow-and-spawn), on plain data: one city, its districts' slots, books of mentions.
const files = loadSpawning(), resolver = defaultResolver(files);
const city = { id: "c1", label: "a metropolis", level: "city" as const, kind: "metropolis" };
const within = (place: string, holder: string) => place === holder || (holder === "c1" && place.startsWith("c1"));
const hashAt = (seed: string): Point => [Math.round((seeded(`${seed}|x`) - 0.5) * 2000), Math.round((seeded(`${seed}|z`) - 0.5) * 2000)];
const problem = (book: string, slots: Slot[], mentions: Mention[], extra: Partial<LevelProblem> = {}): LevelProblem => ({
  book, level: "district", slots, mentions, fixed: [], within, ties: () => 0,
  place: (mention, parent) => ({ parent: parent ?? "c1", at: hashAt(`${book}|${mention.id}|${parent ?? "spawn"}`) }), ...extra,
});
const named = (id: string, kind: string, scene = `s-${id}`): Mention => ({ id, label: id, named: true, kind, holder: "c1", scene });
const unnamed = (id: string, kind: string, scene: string): Mention => ({ id, label: id, named: false, kind, holder: "c1", scene });

test("configurations: counts picked once by a seed, a metropolis's districts, a street's buildings adding up", () => {
  assert.equal(pickCount(3, "x"), 3);
  const picks = Array.from({ length: 50 }, (_, n) => pickCount([1, 3], `p${n}`));
  assert.ok(picks.every((n) => n >= 1 && n <= 3) && new Set(picks).size === 3, "a range gives each of its numbers");
  assert.equal(pickCount([1, 3], "same"), pickCount([1, 3], "same"), "the same seed, the same count");
  assert.deepEqual(spawnsOf(city, resolver), { counts: { cbd: 2, dwelling: 3, industrial: 1 }, layer: "defaults" });
  const shops = buildingsOf("shopping", 10000, files);
  assert.equal(Object.values(shops).reduce((sum, n) => sum + n, 0), Math.round(files.street.shopping.density), "a hectare of shopping street: its density in all");
  assert.deepEqual(buildingsOf("park", 10000, files), {}, "a park's pavilions are its landscape's own");
});

test("a named place takes a slot of its own and keeps it for good; another name never gets it", () => {
  const slots = spawnChildren(city, resolver, "b1");
  assert.equal(slots.length, 6);
  const one = chooseSlots(problem("b1", slots, [named("A", "dwelling")]));
  const mine = one.assignment.A;
  assert.equal(one.slots.find((slot) => slot.id === mine)?.owner, "A");
  const two = chooseSlots(problem("b2", one.slots, [named("B", "dwelling"), named("A", "dwelling")]));
  assert.equal(two.assignment.A, mine, "A returns to its slot in a later book");
  assert.notEqual(two.assignment.B, mine, "B never takes A's");
  assert.equal(two.spawned.length, 0, "a free dwelling slot was left for B");
});

test("unnamed mentions share across scenes, never within one; a name spawns only when its kind's slots are all named", () => {
  const slots = spawnChildren(city, resolver, "b1");
  const result = chooseSlots(problem("b1", slots, [unnamed("u1", "industrial", "s1"), unnamed("u2", "industrial", "s2"), unnamed("u3", "industrial", "s2")]));
  assert.equal(result.assignment.u1, result.assignment.u2, "the one industrial slot, shared across scenes");
  assert.notEqual(result.assignment.u3, result.assignment.u2, "two in one scene are two places");
  assert.equal(result.spawned.length, 1);
  const names = chooseSlots(problem("b1", spawnChildren(city, resolver, "b1"), ["P", "Q", "R"].map((id) => named(id, "cbd"))));
  assert.equal(names.spawned.length, 1, "two CBD slots, three CBD names: one spawned");
  assert.equal(countsIn(names.slots, "c1").cbd, 3);
});

test("unnamed shares and damage are their book's: cleared for the next book", () => {
  const sceneIndex = (scene: string) => Number(scene.replace(/\D/g, ""));
  const slots = spawnChildren(city, resolver, "b1");
  const one = chooseSlots(problem("b1", slots, [unnamed("u1", "industrial", "s1")], { sceneIndex }));
  const industrial = one.slots.find((slot) => slot.kind === "industrial")!;
  industrial.damaged.push({ book: "b1", scene: "s1" });
  const later = unnamed("u2", "industrial", "s5");
  assert.equal(admissible(industrial, later, { book: "b1", within, sceneIndex }), false, "damaged earlier in its book: not shared");
  assert.equal(admissible(industrial, later, { book: "b2", within, sceneIndex }), true, "the next book: whole and free again");
  const two = chooseSlots(problem("b2", one.slots, [unnamed("u9", "industrial", "s1")], { sceneIndex }));
  assert.equal(two.assignment.u9, industrial.id);
  assert.deepEqual(two.slots.find((slot) => slot.id === industrial.id)!.sharers.filter((share) => share.book === "b2").map((share) => share.mention), ["u9"]);
});

test("the bound: twenty books of unnamed mentions grow nothing; only new names beyond the configuration do", () => {
  let slots = spawnChildren(city, resolver, "b1");
  const kinds = ["cbd", "dwelling", "industrial", "harbour"], totals: number[] = [];
  const ties = (a: string, b: string) => (seeded(`${[a, b].sort().join("|")}`) < 0.2 ? 1 + Math.floor(seeded(`t${a}${b}`) * 3) : 0);
  for (let k = 1; k <= 20; k++) {
    const book = `b${k}`;
    const names = k <= 4 ? [named(`n${k}a`, "cbd"), named(`n${k}b`, "dwelling"), named(`n${k}c`, "dwelling")] : k % 5 === 0 ? [named("n1b", "dwelling")] : [];
    const mentions = [...names, ...Array.from({ length: 12 }, (_, i) => unnamed(`${book}u${i}`, kinds[i % 4], `${book}s${i}`))];
    slots = chooseSlots(problem(book, slots, mentions, { ties })).slots;
    const counts = countsIn(slots, "c1");
    assert.ok(counts.cbd <= Math.max(2, Math.min(k, 4)) && counts.dwelling <= Math.max(3, 2 * Math.min(k, 4)) && counts.industrial <= 1 && counts.harbour <= 1, `book ${k}: ${JSON.stringify(counts)}`);
    totals.push(slots.length);
  }
  assert.deepEqual(totals.slice(4), Array(16).fill(totals[3]), `no growth after the names stop: ${totals.join(" ")}`);
  assert.equal(totals[3], 4 + 8 + 1 + 1);
});

test("the moves undo what narrative order got wrong: the more tied name gets the nearer slot", () => {
  const at = (id: string, p: Point): Slot => ({ id, parent: "c1", level: "district", kind: "dwelling", at: p, owner: null, sharers: [], damaged: [], layer: "defaults", book: "b0" });
  const ties = (a: string, b: string) => ([a, b].includes("X") ? ([a, b].includes("A") ? 1 : [a, b].includes("B") ? 10 : 0) : 0);
  const result = chooseSlots(problem("b1", [at("near", [900, 0]), at("far", [-1000, 0])], [named("A", "dwelling"), named("B", "dwelling")], { ties, fixed: [{ id: "X", at: [1000, 0] }] }));
  assert.equal(result.assignment.B, "near"); assert.equal(result.assignment.A, "far");
  assert.ok(result.energy.final < result.energy.greedy, `${result.energy.greedy} → ${result.energy.final}`);
  // Two names exchange only where both may stand (`allow`: a building's lot keeps heights near, heights.json `share`).
  const kept = chooseSlots(problem("b1", [at("near", [900, 0]), at("far", [-1000, 0])], [named("A", "dwelling"), named("B", "dwelling")], { ties, fixed: [{ id: "X", at: [1000, 0] }], allow: (slot, m) => !(m.id === "B" && slot.id === "near") }));
  assert.deepEqual([kept.assignment.A, kept.assignment.B], ["near", "far"]);
});

test("the same book and slots give the same choice", () => {
  const mentions = [named("A", "cbd"), unnamed("u1", "dwelling", "s1"), unnamed("u2", "dwelling", "s1"), named("B", "dwelling")];
  const ties = (a: string, b: string) => (seeded([a, b].sort().join()) < 0.5 ? 2 : 0);
  const run = () => chooseSlots(problem("b1", spawnChildren(city, resolver, "b1"), mentions, { ties })).assignment;
  assert.deepEqual(run(), run());
});

test("the slot tree: pools gone, their members in the pool's area; spare and shared slots are places; names and shares under their slots", async () => {
  const { withSlots, defaultTerrain } = await import("../../src/world/terrain/tree.js");
  const inputs = {
    placeTree: [
      { id: "c1", label: "City", parentId: null, path: ["c1"] },
      { id: "d1", label: "Seventh", parentId: "c1", path: ["c1", "d1"] },
      { id: "pool:c1", label: "City · pool", parentId: "c1", path: ["c1", "pool:c1"] },
      { id: "unnamed:a", label: "大道 (scene 3)", parentId: "pool:c1", path: ["c1", "pool:c1", "unnamed:a"] },
      { id: "unnamed:b", label: "大道 (scene 9)", parentId: "pool:c1", path: ["c1", "pool:c1", "unnamed:b"] },
    ],
    world: { places: { "pool:c1": { label: "City · pool", parent: "c1", pool: "c1" }, "unnamed:a": { label: "大道 (scene 3)", parent: "pool:c1" }, "unnamed:b": { label: "大道 (scene 9)", parent: "pool:c1" } } },
    names: { c1: "City", d1: "Seventh", "unnamed:a": "大道 (scene 3)", "unnamed:b": "大道 (scene 9)" } as Record<string, string>,
    scale: { places: { c1: { scale: "city" }, d1: { scale: "district" } } as Record<string, { scale: string }> },
  };
  const slot = (id: string, extra: object) => ({ id, parent: "c1", level: "district" as const, kind: "cbd", toward: [100, 0] as [number, number], owner: null, sharers: [], damaged: [], layer: "defaults", book: "b1", ...extra });
  withSlots(inputs, [
    slot("slot:c1:dwelling:1", { kind: "dwelling", owner: "d1", ownerBook: "b1" }),
    slot("slot:c1:cbd:1", { sharers: [{ book: "b1", mention: "unnamed:a", scene: "s3" }, { book: "b1", mention: "unnamed:b", scene: "s9" }] }),
    slot("slot:c1:cbd:2", {}),
    slot("slot:c1:industrial:1", { kind: "industrial", toward: null }),
  ], "b1");
  const byId = new Map(inputs.placeTree.map((place) => [place.id, place]));
  assert.ok(!byId.has("pool:c1") && !inputs.world.places["pool:c1"], "no pool");
  assert.equal(byId.get("slot:c1:cbd:1")?.label, "大道 · 2 scenes");
  assert.equal(byId.get("slot:c1:cbd:2")?.label, "cbd · spare");
  assert.ok(!byId.has("slot:c1:industrial:1"), "an unplaced slot is no place yet");
  assert.equal(byId.get("unnamed:a")?.parentId, "slot:c1:cbd:1"); assert.deepEqual(byId.get("unnamed:b")?.path, ["c1", "slot:c1:cbd:1", "unnamed:b"]);
  assert.equal(inputs.scale.places["slot:c1:cbd:2"].scale, "district");
  assert.equal(byId.get("d1")?.parentId, "c1");
  assert.deepEqual(defaultTerrain("district", "cbd"), { ground: "skyscrapers", median: 120, manifold: defaultTerrain("district", "cbd")?.manifold });
});

test("a bounded repair (the dynamic-grid research §3; the user, 2026-11-06: small repairs): only the movable mentions move; the rest keep their slots whatever a move would gain", () => {
  // Two unnamed industrial mentions far from the place they are tied to, two slots of their kind: one near it, one far.
  const slots: Slot[] = [
    { id: "near", parent: "c1", level: "district", kind: "industrial", at: [0, 0], owner: null, sharers: [], damaged: [], layer: "defaults", book: "b1" },
    { id: "far", parent: "c1", level: "district", kind: "industrial", at: [900, 0], owner: null, sharers: [], damaged: [], layer: "defaults", book: "b1" },
  ];
  const fixed = [{ id: "home", at: [10, 0] as Point }], ties = (a: string, b: string) => ([a, b].includes("home") ? 1 : 0);
  const mentions = [unnamed("u1", "industrial", "s1"), unnamed("u2", "industrial", "s2")], assigned = { u1: "far", u2: "far" };
  const whole = chooseSlots(problem("b1", slots, mentions, { fixed, ties, assigned }));
  assert.deepEqual(whole.assignment, { u1: "near", u2: "near" }, "settled whole, both move to the near slot");
  const bounded = chooseSlots(problem("b1", slots, mentions, { fixed, ties, assigned, movable: (id) => id === "u2" }));
  assert.deepEqual(bounded.assignment, { u1: "far", u2: "near" }, "bounded: only the movable one moves");
  assert.equal(bounded.moves, 1);
});
