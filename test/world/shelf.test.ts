// The routine shelf (src/world/models/shelf.ts): a model put under its English name is recalled by that name and by every
// name a book gave it, a later book's name is kept beside it, a failing model is refused, and the warehouse finds it by its
// words. The OpenSCAD fixtures are skipped where OpenSCAD is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addName, meshOf, recall, shelfDir, shelve } from "../../src/world/models/shelf.js";
import { OPENSCAD } from "../../src/world/models/scad.js";

const HAS_OPENSCAD = spawnSync(OPENSCAD, ["--version"]).status === 0;
const BUCKET = "// plastic bucket\nmodule thing() { difference() { translate([0, 0, 0]) cylinder(h = 0.3, r1 = 0.13, r2 = 0.16, $fn = 16); translate([0, 0, 0.02]) cylinder(h = 0.3, r1 = 0.12, r2 = 0.15, $fn = 16); } }\nthing();";

test("a routine model is recalled by its English name and by a book's own name; a later book's name is kept", { skip: !HAS_OPENSCAD }, async () => {
  const dir = shelfDir(mkdtempSync(join(tmpdir(), "packs-")));
  const put = await shelve(dir, { english: "plastic bucket", kind: "a bag or a box", names: ["Eimer"], size: [0.3, 0.3, 0.3], code: BUCKET, by: "test" });
  assert.equal(put.ok, true, JSON.stringify(put)); assert.equal(put.name, "plastic_bucket");
  assert.equal(recall(dir, "Plastic Bucket")?.ref, "routine:plastic_bucket");
  assert.equal(recall(dir, "Eimer")?.ref, "routine:plastic_bucket");
  assert.equal(recall(dir, "seau"), null);
  await addName(dir, "plastic_bucket", "seau");
  assert.equal(recall(dir, "seau")?.ref, "routine:plastic_bucket");
  assert.ok(meshOf(dir, "plastic_bucket")?.t.length);
  assert.ok(existsSync(join(dir, "plastic_bucket.scad")));
  // Put again under the same name: kept, not replaced.
  assert.equal((await shelve(dir, { english: "plastic bucket", kind: "a bag or a box", code: BUCKET, by: "test" })).kept, "already on the shelf");
});

test("a model that breaks the contract is refused, and nothing is kept", { skip: !HAS_OPENSCAD }, async () => {
  const dir = shelfDir(mkdtempSync(join(tmpdir(), "packs-")));
  const put = await shelve(dir, { english: "kitchen knife", kind: "a small weapon", size: [0.3, 0.02, 0.03], code: "module thing() { translate([-15, 0, 0]) cube([30, 0.02, 0.03]); }\nthing();", by: "test" });
  assert.equal(put.ok, false); assert.ok(put.problems.some((problem) => /longest side/.test(problem)));
  assert.equal(recall(dir, "kitchen knife"), null);
});

test("the warehouse finds a shelf model by its words, as the built-in source routine", { skip: !HAS_OPENSCAD }, async () => {
  const packs = mkdtempSync(join(tmpdir(), "packs-"));
  process.env.NOVEL_MODEL_PACKS = packs;
  const { findParts } = await import(`../../src/world/models/warehouse.js?packs=${Date.now()}`);
  await shelve(shelfDir(packs), { english: "plastic bucket", kind: "a bag or a box", names: ["Eimer"], code: BUCKET, by: "test" });
  const found = await findParts("bucket", { source: "routine" });
  assert.equal(found.parts[0]?.ref, "routine:plastic_bucket");
  assert.equal((await findParts("Eimer", { source: "routine" })).parts[0]?.ref, "routine:plastic_bucket");
});

test("the sort: matched by number, a non-object left out of routine, a broken one named as the whole object", async () => {
  const { sortItems } = await import("../../src/world/models/shelf.js");
  const reply = { items: [
    { index: 2, object: true, routine: true, english: "Mobile Phone", state: "broken", kind: "a handheld thing", size: [0.15, 0.01, 0.07] },
    { index: 1, object: true, routine: true, english: "mobile phone", kind: "a handheld thing", size: [0.15, 0.01, 0.07] },
    { index: 3, object: false, routine: true, english: "blood", kind: "a substance", size: [0, 0, 0] },
    { index: 4, object: true, routine: false, english: "flame sword", kind: "a weapon", size: [1.2, 0.1, 0.05] },
  ] };
  const writer = { generateWithInfo: async () => ({ text: JSON.stringify(reply), usage: { promptTokens: 10, completionTokens: 20 } }) };
  const { sorted, usage } = await sortItems([{ name: "phone A" }, { name: "phone A, broken" }, { name: "stain" }, { name: "sword B" }], writer);
  assert.deepEqual(sorted.map((row) => [row.name, row.object, row.routine, row.english, row.state ?? null]), [
    ["phone A", true, true, "mobile phone", null],
    ["phone A, broken", true, true, "mobile phone", "broken"],
    ["stain", false, false, "blood", null],
    ["sword B", true, false, "flame sword", null],
  ]);
  assert.deepEqual(usage, { prompt: 10, completion: 20, requests: 1 });
});
