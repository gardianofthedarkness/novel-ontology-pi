import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { LANDSCAPES } from "../src/v2/world/landscape.js";
import { MODELS } from "../src/v2/world/useModels.js";

// The model table (config/models.json, docs/v2/model-kit.md) against the library and the buildings the world makes, read
// from the repository's root (npm test).
const read = (...path: string[]) => JSON.parse(readFileSync(resolve(process.cwd(), ...path), "utf8"));
const library = read("apps", "playground", "src", "data", "architectureModels.json"), street = read("config", "terrain", "street.json");

test("model kit: every model the table names is in the library, its floors a range", () => {
  for (const [use, entry] of Object.entries(MODELS.uses))
    for (const [model, [least, most]] of Object.entries({ ...entry.fill, ...(entry.named ?? {}) })) {
      assert.ok(library.models[model], `${use}: ${model} is not in the library`);
      assert.ok(Number.isInteger(least) && Number.isInteger(most) && least >= 1 && least <= most, `${use}: ${model}'s floors`);
    }
  for (const model of Object.values(MODELS.ancient).flat()) assert.ok(library.models[model], `${model} (an older world's) is not in the library`);
});

test("model kit: no modern use is drawn as a model of an older world", () => {
  const old = new Set(Object.values(MODELS.ancient).flat());
  for (const [use, entry] of Object.entries(MODELS.uses))
    for (const model of [...Object.keys(entry.fill), ...Object.keys(entry.named ?? {})]) assert.ok(!old.has(model), `${use} names ${model}, an older world's model`);
});

test("model kit: every use a street spawns and every building a modern landscape builds has an entry; every role a use with models", () => {
  const uses = new Set([...Object.values(street.types as Record<string, { uses: Record<string, number> }>).flatMap((type) => Object.keys(type.uses)), ...Object.values(LANDSCAPES).flatMap((landscape) => landscape.uses ?? [])]);
  for (const use of uses) assert.ok(MODELS.uses[use], `${use} has no entry`);
  for (const [name, landscape] of Object.entries(LANDSCAPES)) {
    if (landscape.era !== "modern") continue;
    for (const floors of [1, 3, 6, 12, 30]) { const kind = landscape.building(floors); assert.ok(MODELS.uses[MODELS.kinds[kind]], `${name}: a ${kind} has no use`); }
  }
  for (const [role, use] of Object.entries(MODELS.roles)) assert.ok(Object.keys(MODELS.uses[use]?.fill ?? {}).length, `role ${role}: ${use} has no models`);
});
