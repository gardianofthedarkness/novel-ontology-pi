// The universal world generator schema (config/world.schema.json; milestones M8a): every key documented and in its range,
// every key the code reads is in the schema and every wired key is read, the tables load, and the layers resolve in order
// (defaults < universe < book < place), refusing what a layer may not set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { forgetLayers, problemsOf, resolveSetting, schema, SCHEMA_FILE, setting, table } from "../src/v2/settings.js";
import { LANDSCAPES } from "../src/v2/world/landscape.js";

const ROOT = dirname(dirname(SCHEMA_FILE));
const KINDS = new Set(["hard", "knob", "physics", "structure", "presentation"]), LAYERS = new Set(["universe", "book", "place"]);

test("every key is documented, its layers known and its default in its range", () => {
  const { keys, tables } = schema();
  assert.ok(Object.keys(keys).length >= 60, "the schema holds the generator's numbers");
  for (const [key, entry] of Object.entries(keys)) {
    assert.ok(entry.meaning.length > 10 && entry.unit && entry.used.length, `${key} is documented`);
    assert.ok(KINDS.has(entry.kind), `${key}'s kind`);
    assert.ok(entry.layers.every((layer) => LAYERS.has(layer)), `${key}'s layers`);
    if (entry.range) assert.ok(typeof entry.default === "number" && entry.default >= entry.range[0] && entry.default <= entry.range[1], `${key}'s default in range`);
    assert.deepEqual(problemsOf(key, entry.default), [], `${key}'s default is valid for itself`);
    for (const use of entry.used) assert.ok(existsSync(join(ROOT, use.split(" ")[0])), `${key} is used in ${use}`);
  }
  for (const [name, entry] of Object.entries(tables)) {
    assert.ok(existsSync(join(ROOT, entry.file)), `table ${name}'s file`);
    assert.ok(table(name), `table ${name} loads`);
  }
});

/** Every `setting("…")` and `table("…")` the code reads. */
function readsInCode(): { settings: Set<string>; tables: Set<string> } {
  const settings = new Set<string>(), tables = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (!["node_modules", "dist", "test"].includes(name)) walk(path); continue; }
      if (!/\.(ts|mjs)$/.test(name) || /\.test\./.test(name)) continue;
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/\bsetting(?:<[^()]*?>)?\(\s*["']([\w.]+)["']/g)) settings.add(m[1]);
      for (const m of text.matchAll(/\btable(?:<[^()]*?>)?\(\s*["']([\w.]+)["']/g)) tables.add(m[1]);
    }
  };
  walk(join(ROOT, "src")); walk(join(ROOT, "world-engine"));
  return { settings, tables };
}

test("the code reads only keys the schema has, and every wired key is read", () => {
  const { keys } = schema(), { settings } = readsInCode();
  for (const key of settings) assert.ok(keys[key], `the code reads ${key}, which the schema lacks`);
  const unread = Object.entries(keys).filter(([key, entry]) => entry.wired !== false && !settings.has(key)).map(([key]) => key);
  assert.deepEqual(unread, [], "every wired key is read by the code");
});

test("a landscape's building rule, as steps, picks the last step reached", () => {
  assert.equal(LANDSCAPES.skyscrapers.building(19.5), "tower");
  assert.equal(LANDSCAPES.skyscrapers.building(20), "skyscraper");
  assert.equal(LANDSCAPES.residential.building(3), "house");
  assert.equal(LANDSCAPES.residential.building(4), "apartment");
  assert.equal(Object.keys(LANDSCAPES).length, 19);
});

test("layers resolve defaults < universe < book < place, objects merging key by key", () => {
  const library = mkdtempSync(join(tmpdir(), "settings-")), universe = join(library, "universe"), book = join(library, "vol-1", "novel");
  mkdirSync(universe, { recursive: true }); mkdirSync(join(book, "stage"), { recursive: true });
  writeFileSync(join(universe, "settings.json"), JSON.stringify({ values: { "fill.streets": { arterial: 22 }, "talk.earshot": 30 } }));
  writeFileSync(join(book, "stage", "settings.json"), JSON.stringify({ values: { "fill.streets": { local: 9 } }, places: { loc_9: { values: { "fill.streets": { arterial: 26 } } } } }));
  forgetLayers();
  const base = setting<Record<string, number>>("fill.streets");
  assert.equal(setting<Record<string, number>>("fill.streets", { book }).arterial, 22, "the universe over the default");
  assert.equal(setting<Record<string, number>>("fill.streets", { book }).local, 9, "the book over the default");
  assert.equal(setting<Record<string, number>>("fill.streets", { book }).collector, base.collector, "untouched parts keep the default");
  assert.equal(setting<Record<string, number>>("fill.streets", { book, place: "loc_9" }).arterial, 26, "the place over both");
  assert.equal(setting<number>("talk.earshot", { book }), 30);
  assert.deepEqual(resolveSetting("fill.streets", { book, place: "loc_9" }).from.length, 4, "where each part came from");
});

test("a layer that sets what it may not, an unknown key, a wrong shape or a value out of range is refused", () => {
  const library = mkdtempSync(join(tmpdir(), "settings-")), universe = join(library, "universe"), book = join(library, "vol-1", "novel");
  mkdirSync(universe, { recursive: true }); mkdirSync(join(book, "stage"), { recursive: true });
  writeFileSync(join(book, "stage", "settings.json"), JSON.stringify({ values: { "talk.earshot": 40, "grid.cell": 3 } }));
  forgetLayers();
  assert.throws(() => setting("talk.earshot", { book }), /may not be set by a book/);
  assert.throws(() => setting("grid.cell", { book }), /may not be set/);
  assert.deepEqual(problemsOf("talk.earshot", 400), ["talk.earshot = 400 is outside 5–100 m"]);
  assert.match(problemsOf("fill.streets", { avenue: 3 })[0], /not a part of fill.streets/);
  assert.match(problemsOf("fill.streets", { arterial: "wide" })[0], /must be a number/);
  assert.deepEqual(problemsOf("no.such", 1), ["no setting no.such"]);
});

test("Infinity survives the schema", () => {
  assert.equal(setting<Record<string, number>>("laws.speed").teleport, Infinity);
  assert.equal(setting<{ to: number }[]>("underground.bands").at(-1)?.to, Infinity);
});
