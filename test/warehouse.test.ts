// The model warehouse (milestones M10g–i) and settings profiles (M8d): a scratch SCAD kit and a one-file glTF folder
// registered and catalogued, parts found by words and size, a part connected to a slot through the schema, the licence
// gate, and a profile saved from one library and applied to another. The SCAD parts are skipped where OpenSCAD is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "warehouse-"));
process.env.NOVEL_MODEL_PACKS = join(root, "packs"); process.env.NOVEL_WAREHOUSE = join(root, "packs", "warehouse.json");
mkdirSync(join(root, "packs"), { recursive: true });
const WH = await import("../src/v2/models/warehouse.js");
const { checkPartMap, idOfRef, splitRef } = await import("../src/v2/models/partRefs.js");
const { settingsDiff, settingsProfileApply, settingsProfileList, settingsProfileSave } = await import("../src/cli/commands/extract/settingsCommands.js");
const { forgetLayers, problemsOf } = await import("../src/v2/settings.js");
const HAS_OPENSCAD = spawnSync(process.env.OPENSCAD ?? "openscad", ["--version"]).status === 0;

function library(name: string) {
  const lib = join(root, name), novel = join(lib, "vol-1", "novel");
  mkdirSync(join(lib, "universe"), { recursive: true }); mkdirSync(join(novel, "stage"), { recursive: true }); mkdirSync(join(lib, "vol-1", "reading"), { recursive: true });
  writeFileSync(join(lib, "universe", "terrain.json"), "{}\n"); writeFileSync(join(novel, "stage", "terrain.json"), "{}\n");
  forgetLayers();
  return { lib, novel };
}

/** A one-cube GLB (eight vertices, twelve triangles, a red material), as a modelling tool would save it. */
function cubeGlb(): Buffer {
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, -0.5, 0.5, 1, -0.5, 0.5, 1, 0.5, -0.5, 1, 0.5];
  const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const positions = Buffer.from(Float32Array.from(v).buffer), indices = Buffer.from(Uint16Array.from(i).buffer), bin = Buffer.concat([positions, indices]);
  const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" }] });
  const jsonBytes = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " ")), binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binPadded.length, 8);
  const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(jsonBytes.length, 0); jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(binPadded.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, jsonBytes, binHead, binPadded]);
}

test("part references: the slot maps hold only kinds and references; a reference splits and gets a stable page id", () => {
  assert.deepEqual(checkPartMap("fill.props", { tree: "kit:cw_nature_pine", bench: null }), []);
  assert.match(checkPartMap("fill.props", { "Lamp Post!": "kit:x" }).join(" "), /not a kind here/);
  assert.deepEqual(checkPartMap("fill.props", { "wind-turbine": "kit:hc_prop_wind_turbine" }), [], "a kind of one's own");
  assert.match(checkPartMap("models.vehicles", { "a bus": "bus" }).join(" "), /part reference/);
  assert.deepEqual(checkPartMap("models.parts", { "a small weapon": "my-kit:knife_01" }), []);
  assert.deepEqual(problemsOf("fill.props", { tree: "kit:cw_nature_pine" }), []);
  assert.deepEqual(splitRef("my-kit:knife_01"), { source: "my-kit", part: "knife_01" }); assert.equal(splitRef("knife"), null);
  assert.equal(idOfRef("kit:cw_nature_pine"), idOfRef("kit:cw_nature_pine")); assert.match(idOfRef("kit:cw_nature_pine"), /^w[0-9a-f]{8}$/);
});

test("the built-in sources are listed; a licence outside the allowed set is refused without the user's OK", async () => {
  const listed = await WH.listSources();
  assert.ok(listed.sources.some((row) => row.name === "kit") && listed.sources.some((row) => row.name === "pack"));
  const folder = join(root, "gpl-kit"); mkdirSync(folder); writeFileSync(join(folder, "k.scad"), "module k_prop_box() cube(1);\n");
  await assert.rejects(WH.addSource("gplkit", folder, { licence: "GPL-3.0", why: "a test" }), /not in the allowed set/);
  await assert.rejects(WH.addSource("kit", folder, { licence: "MIT", why: "a test" }), /built-in/);
  await assert.rejects(WH.fetchSource("fetched", "https://example.org/kit.zip", { licence: "MIT", why: "a test", ok: "" }), /user's permission/);
});

test("a glTF folder is registered and catalogued: one part, its size and colour, found by its words and connected to a slot", async () => {
  const folder = join(root, "packs", "cubes", "props"); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, "red_cube.glb"), cubeGlb());
  const added = await WH.addSource("cubes", join(root, "packs", "cubes"), { licence: "CC0-1.0", why: "a scratch glTF pack", unit: "m" });
  assert.equal(added.kind, "gltf"); assert.equal(added.parts, 1); assert.equal(added.ok, 1); assert.deepEqual(added.categories, { props: 1 });
  const mesh = await WH.meshOfPart("cubes:red_cube");
  assert.ok(mesh); assert.deepEqual(mesh!.size, [1, 1, 1]); assert.equal(mesh!.t.length / 3, 12); assert.deepEqual(mesh!.c.slice(0, 3), [255, 0, 0]);
  const found = await WH.findParts("red cube", { source: "cubes" });
  assert.equal(found.parts[0]?.ref, "cubes:red_cube"); assert.deepEqual(found.parts[0].size, [1, 1, 1]);
  const { novel } = library("lib-a");
  const used = await WH.usePart(novel, "cubes:red_cube", "prop:bin", { why: "bins as red cubes" });
  assert.equal(used.layer, "book"); assert.equal(used.pageId, `scad:${idOfRef("cubes:red_cube")}`);
  const file = JSON.parse(readFileSync(join(novel, "stage", "settings.json"), "utf8"));
  assert.deepEqual(file.values["fill.props"], { bin: "cubes:red_cube" });
  await assert.rejects(WH.usePart(novel, "cubes:red_cube", "prop:Lamp Post!", { why: "x" }), /not a kind here/);
  await assert.rejects(WH.usePart(novel, "cubes:no_such", "prop:tree", { why: "x" }), /No part/);
  const shop = await WH.usePart(novel, "cubes:red_cube", "use:shop", { why: "shops as cubes", floors: [1, 3] });
  assert.equal(shop.set.table, true);
  const again = JSON.parse(readFileSync(join(novel, "stage", "settings.json"), "utf8"));
  assert.deepEqual(again.tables["models.uses"].uses.shop.fill["cubes:red_cube"], [1, 3]);
});

test("a SCAD kit is registered and catalogued: standing modules evaluated, their category from the name, a buried one not ok; a tree is found for \"tree\"", { skip: !HAS_OPENSCAD }, async () => {
  const folder = join(root, "packs", "tk"); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "kit_tk.scad"), ["module tk_nature_pine() { color([0.4, 0.3, 0.2]) cylinder(h = 2, r = 0.2); translate([0, 0, 2]) color([0.2, 0.5, 0.3]) cylinder(h = 4, r1 = 1.4, r2 = 0); }", "module tk_prop_bench(L = 1.8) { color([0.6, 0.4, 0.3]) translate([-L / 2, -0.3, 0.4]) cube([L, 0.6, 0.1]); for (x = [-L / 2 + 0.1, L / 2 - 0.2]) translate([x, -0.25, 0]) cube([0.1, 0.5, 0.4]); }", "module tk_bad_hole() { translate([0, 0, -2]) cube(1); }", "module tk_part_slab(L) { cube([L, L, 0.1]); }", ""].join("\n"));
  const added = await WH.addSource("tk", folder, { licence: "MIT", why: "a scratch SCAD kit" });
  assert.equal(added.kind, "scad"); assert.equal(added.parts, 3, "the module with a required parameter is no part");
  assert.deepEqual(added.categories, { nature: 1, prop: 1, bad: 1 });
  assert.equal(added.ok, 2); assert.match(added.failed.join(" "), /tk_bad_hole: below the ground/);
  const pine = await WH.partOf("tk:tk_nature_pine");
  assert.ok(pine?.ok); assert.ok(Math.abs(pine!.height - 6) < 0.05 && pine!.footprint[0] > 2.4 && pine!.footprint[0] <= 2.8, JSON.stringify(pine));
  const found = await WH.findParts("pine tree", { source: "tk" });
  assert.equal(found.parts[0]?.ref, "tk:tk_nature_pine", JSON.stringify(found.parts.slice(0, 3)));
  const everywhere = await WH.findParts("pine tree");
  assert.ok(everywhere.parts.some((part) => part.ref === "tk:tk_nature_pine") && everywhere.searched > 600, "the real kits are searched too");
  const bySize = await WH.findParts("bench", { size: 1.8, source: "tk" });
  assert.equal(bySize.parts[0]?.ref, "tk:tk_prop_bench");
  const mesh = await WH.meshOfPart("tk:tk_prop_bench");
  assert.ok(mesh && existsSync(join(folder, "meshes", "tk_prop_bench.mesh.json")));
  assert.ok(Math.abs(mesh!.size[1] - 0.5) < 0.02, "Y-up on the page: the bench's height is its y");
  const refreshed = await WH.refreshSource("tk"); assert.equal(refreshed.parts, 3);
});

test("a profile is the overrides in force, saved by name and applied to another library through the schema", async () => {
  const { novel } = library("lib-b");
  const { settingsSet } = await import("../src/cli/commands/extract/settingsCommands.js");
  await settingsSet(novel, "fill.streets", JSON.stringify({ cell: 150 }), { why: "tighter blocks" });
  await settingsSet(novel, "fill.props", JSON.stringify({ tree: "cubes:red_cube" }), { place: "loc_000001", why: "red trees in the city" });
  const saved = await settingsProfileSave(novel, "red-city", { why: "the test's look" });
  assert.equal(saved.overrides, 2); assert.deepEqual(saved.keys.sort(), ["fill.props", "fill.streets"]);
  assert.equal((await settingsProfileList(novel)).profiles[0].name, "red-city");
  const other = library("lib-c");
  const { copyFileSync } = await import("node:fs"); mkdirSync(join(other.lib, "universe", "profiles"), { recursive: true }); copyFileSync(saved.file, join(other.lib, "universe", "profiles", "red-city.json"));
  const applied = await settingsProfileApply(other.novel, "red-city", { why: "the same look here" });
  assert.equal(applied.overrides, 2); assert.deepEqual(applied.refused, []);
  const diff = await settingsDiff(other.novel);
  assert.deepEqual((diff as { overrides: { key: string; place: string | null }[] }).overrides.map((row) => `${row.key}@${row.place ?? "book"}`).sort(), ["fill.props@loc_000001", "fill.streets@book"]);
  await assert.rejects(settingsProfileApply(other.novel, "no-such", { why: "x" }), /No profile no-such/);
});

test("a model named at birth is recalled exactly by its label, for nothing: own:<slug>, own:<id>, and find", async () => {
  const { lib, novel } = library("lib-own");
  const store = join(lib, "universe", "models"); mkdirSync(store, { recursive: true });
  const mesh = { p: [0, 0, 0, 1, 0, 0, 0, 1, 0], t: [0, 1, 2], c: [200, 200, 200], size: [1, 1, 0] };
  writeFileSync(join(store, "m0000abcd.mesh.json"), JSON.stringify(mesh));
  writeFileSync(join(store, "m0000abcd.scad"), "// Advertising Van (loudspeaker truck) stylised, low-poly\nmodule thing() { cube(1); }\nthing();\n");
  writeFileSync(join(store, "catalog.json"), JSON.stringify({ version: 1, models: { m0000abcd: { id: "m0000abcd", label: "Advertising Van", kind: "a van or a truck", state: "ok", at: "2026-11-09T00:00:00Z", size: [5.9, 2.5, 2.5], triangles: 300 } }, names: { "Advertising Van": "m0000abcd" } }));
  const found = await WH.findParts("Advertising Van", { novelDir: novel });
  assert.equal(found.exact, true); assert.equal(found.parts[0].ref, "own:advertising_van"); assert.ok(found.parts[0].score >= 10);
  const byGloss = await WH.findParts("loudspeaker truck", { novelDir: novel });
  assert.equal(byGloss.parts[0]?.ref, "own:advertising_van", "the English gloss in the code's first comment line is searched too");
  const byWords = await WH.findParts("van", { novelDir: novel, kind: "a van or a truck" });
  assert.ok(byWords.parts.some((part) => part.ref === "own:advertising_van"), "its words find it among the kits' vans too");
  for (const ref of ["own:advertising_van", "own:m0000abcd", "own:Advertising_Van"]) { const part = await WH.partOf(ref, { novelDir: novel }); assert.equal(part?.id, "m0000abcd", ref); assert.deepEqual((await WH.meshOfPart(ref, { novelDir: novel }))?.size, [1, 1, 0], ref); }
  const used = await WH.usePart(novel, "own:advertising_van", "vehicle:a van or a truck", { why: "the book's own van for every van" });
  assert.equal(used.connected.part, "own:advertising_van");
});

test("a baked pack part decodes from its own bytes (a pooled Buffer once gave the whole pool): the sedan's size, bounds and indices hold", async () => {
  const mesh = await WH.meshOfPart("pack:car-sedan");
  assert.ok(mesh, "the baked vehicles are in the repository");
  const verts = mesh!.p.length / 3, [sx, sy, sz] = mesh!.size;
  assert.ok(verts > 8 && mesh!.t.length % 3 === 0 && Math.max(...mesh!.t) < verts, "every triangle points at a vertex");
  for (let i = 0; i < mesh!.p.length; i += 3) assert.ok(Math.abs(mesh!.p[i]) <= sx / 2 + 0.01 && mesh!.p[i + 1] >= -0.01 && mesh!.p[i + 1] <= sy + 0.01 && Math.abs(mesh!.p[i + 2]) <= sz / 2 + 0.01, `vertex ${i / 3} inside the model's box`);
  const found = await WH.findParts("sedan", { source: "pack" });
  assert.equal(found.parts[0]?.ref, "pack:car-sedan");
});
