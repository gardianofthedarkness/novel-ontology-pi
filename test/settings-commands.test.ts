// `novel settings` (milestones M8b): show, explain, set, unset and diff on a scratch library; a value checked before it is
// written, written to its layer and logged; --before takes the book's before snapshot; diff against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsDiff, settingsExplain, settingsSet, settingsShow, settingsUnset } from "../src/cli/commands/extract/settingsCommands.js";
import { forgetLayers } from "../src/v2/settings.js";

function library() {
  const root = mkdtempSync(join(tmpdir(), "settings-cli-")), novel = join(root, "vol-1", "novel");
  mkdirSync(join(root, "universe"), { recursive: true }); mkdirSync(join(novel, "stage"), { recursive: true }); mkdirSync(join(root, "vol-1", "reading"), { recursive: true });
  writeFileSync(join(root, "universe", "terrain.json"), "{}\n"); writeFileSync(join(novel, "stage", "terrain.json"), "{}\n");
  forgetLayers();
  return { root, novel };
}

test("show lists every key with where it came from; a prefix narrows it", async () => {
  const { novel } = library();
  const all = await settingsShow(novel);
  assert.ok(all.count >= 60 && all.changed === 0);
  const fill = await settingsShow(novel, { prefix: "fill" });
  assert.deepEqual(fill.settings.map((row) => row.key).sort(), ["fill.buildingArea", "fill.ops", "fill.props", "fill.streets"]);
  assert.equal(fill.settings[0].from, "default");
});

test("explain says what a key means, its layers and when a change takes effect; an unknown key names near ones", () => {
  const earshot = settingsExplain("talk.earshot") as { unit: string; layers: string[]; takesEffect: string };
  assert.equal(earshot.unit, "m"); assert.deepEqual(earshot.layers, ["universe"]); assert.match(earshot.takesEffect, /next run/);
  assert.match((settingsExplain("highway.knobs") as { takesEffect: string }).takesEffect, /transport\.mjs/);
  assert.equal((settingsExplain("grid.cell") as { set: string }).set, "not settable");
  assert.throws(() => settingsExplain("fill.arterial"), /Near: .*fill\.streets/);
});

test("set writes the book's layer by default, a place's part with --place, the universe's for a universe-only key; refuses what it must", async () => {
  const { root, novel } = library();
  const set = await settingsSet(novel, "fill.streets", '{"arterial":22}', { why: "wider arterials" });
  assert.equal(set.layer, "book"); assert.equal((set.now!.value as Record<string, number>).arterial, 22); assert.equal((set.now!.value as Record<string, number>).local, 8);
  await settingsSet(novel, "fill.streets", '{"arterial":26}', { place: "loc_1", why: "the centre" });
  const placed = await settingsShow(novel, { prefix: "fill.streets", place: "loc_1" });
  assert.equal((placed.settings[0].value as Record<string, number>).arterial, 26);
  const earshot = await settingsSet(novel, "talk.earshot", "30", { why: "a quieter city" });
  assert.equal(earshot.layer, "universe");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "universe", "settings.json"), "utf8")).values, { "talk.earshot": 30 });
  await assert.rejects(settingsSet(novel, "talk.earshot", "300", { why: "x" }), /outside 5–100/);
  await assert.rejects(settingsSet(novel, "talk.earshot", "30", { place: "loc_1", why: "x" }), /may not be set for one place/);
  await assert.rejects(settingsSet(novel, "grid.cell", "3", { why: "x" }), /not settable/);
  await assert.rejects(settingsSet(novel, "fill.streets", '{"avenue":3}', { why: "x" }), /not a part/);
  await assert.rejects(settingsSet(novel, "fill.streets", '{"arterial":20}', {}), /--why/);
  const book = JSON.parse(readFileSync(join(novel, "stage", "settings.json"), "utf8"));
  assert.equal(book.log.length, 2); assert.equal(book.log[1].place, "loc_1");
});

test("a table's part merges over its file; unset falls back; diff shows the overrides, and against a before snapshot", async () => {
  const { novel } = library();
  const first = await settingsSet(novel, "fill.streets", '{"local":9}', { why: "lanes", before: true });
  assert.match(String(first.snapshot), /^vol-1\/\d{4}-before$/);
  await settingsSet(novel, "terrain.landscapes", '{"types":{"residential":{"cap":60}}}', { isTable: true, why: "taller flats" });
  await settingsSet(novel, "roads.waits", '{"signal":20}', { why: "slow lights" });
  const diff = await settingsDiff(novel);
  assert.deepEqual((diff.overrides ?? []).map((row) => row.key).sort(), ["fill.streets", "roads.waits", "terrain.landscapes"]);
  const since = await settingsDiff(novel, { from: String(first.snapshot) });
  assert.deepEqual([...(since.added ?? []).map((row) => row.key)].sort(), ["roads.waits", "terrain.landscapes"]);
  const gone = await settingsUnset(novel, "roads.waits", { why: "back" });
  assert.equal(gone.found, true);
  assert.equal((await settingsShow(novel, { prefix: "roads.waits" })).settings[0].changed, false);
});
