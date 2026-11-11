import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { LANDSCAPES } from "../../src/world/built/landscape.js";
import { TERRAIN_KINDS } from "../../src/context/terrainModes.js";
import { LANGUAGE } from "../../src/world/rules/language.js";

// The spawning configurations (docs/v3/design.html#borrow-and-spawn §5), read from the repository's root (npm test): every kind a
// file names must be one Jev can answer at its level, and every building use one the language profile or the landscapes know.
const read = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), "config", "terrain", `${name}.json`), "utf8"));
const isCount = (count: unknown) => (Number.isInteger(count) && (count as number) >= 0) || (Array.isArray(count) && count.length === 2 && count.every((n) => Number.isInteger(n) && n >= 0) && count[0] <= count[1]);

for (const [name, parent, level] of [["city", "city", "district"], ["district", "district", "street"]] as const) {
  test(`spawning: ${name}.json spawns ${level} kinds for every ${parent} kind`, () => {
    const file = read(name);
    assert.equal(file.parent, parent); assert.equal(file.level, level);
    assert.deepEqual(Object.keys(file.types).sort(), Object.keys(TERRAIN_KINDS[parent]).sort(), `every ${parent} kind has its configuration`);
    if (file.default !== undefined) assert.ok(file.types[file.default], `the kind a ${parent} is born as is one of its kinds`);
    for (const [kind, parents] of Object.entries((file.only ?? {}) as Record<string, string[]>)) { assert.ok(TERRAIN_KINDS[level][kind], `${kind} is a ${level} kind`); for (const of of parents) assert.ok(TERRAIN_KINDS[parent][of], `${kind} may stand in ${of}, a ${parent} kind`); }
    for (const [type, entry] of Object.entries(file.types as Record<string, Record<string, unknown>>)) {
      const spawns = (entry.spawns ?? entry) as Record<string, unknown>;
      for (const [kind, count] of Object.entries(spawns)) {
        assert.ok(TERRAIN_KINDS[level][kind], `${type} spawns ${kind}, not a ${level} kind`);
        assert.ok(isCount(count), `${type}: ${kind} has a count or a range`);
      }
      // Its topology (docs/v3/design.html#borrow-and-spawn §8.2): a ring for each kind it spawns, within the radius; pairs of kinds it spawns.
      if (entry.ring) for (const kind of Object.keys(spawns)) { const ring = (entry.ring as Record<string, number[]>)[kind]; assert.ok(ring && ring[0] >= 0 && ring[0] < ring[1] && ring[1] <= 1, `${type}: ${kind} has a ring within the radius`); }
      if (entry.open) assert.ok(LANDSCAPES[entry.open as keyof typeof LANDSCAPES], `${type}: its open ground is a landscape`);
      for (const [a, b, how] of (entry.pairs ?? []) as [string, string, string][]) assert.ok(spawns[a] !== undefined && spawns[b] !== undefined && ["near", "apart"].includes(how), `${type}: the pair ${a}, ${b}, ${how}`);
    }
  });
}

test("spawning: street.json gives every street kind a density and uses the world knows", () => {
  const file = read("street");
  assert.equal(file.parent, "street"); assert.equal(file.level, "building");
  assert.deepEqual(Object.keys(file.types).sort(), Object.keys(TERRAIN_KINDS.street).sort(), "every street kind has its configuration");
  const known = new Set([...LANGUAGE.buildingUses.map(([, use]) => use), ...Object.values(LANDSCAPES).flatMap((landscape) => landscape.uses ?? [])]);
  for (const [type, { density, uses }] of Object.entries(file.types as Record<string, { density: number; uses: Record<string, number> }>)) {
    assert.ok(density > 0, `${type}: a density`);
    for (const [use, share] of Object.entries(uses)) { assert.ok(known.has(use as never), `${type}: ${use} is no use the world knows`); assert.ok(share > 0 && share <= 1, `${type}: ${use}'s share`); }
  }
});
