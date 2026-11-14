// The figures (design §8.6): a person's rigged figure kept beside the universe's cast and assigned the way the album's
// portraits are: (a) by a name that is one person's, (b) following EM's merges, (c) the rest as the reviewer's tasks;
// and the figure as a part of the model warehouse (figure:<id>), assigned through the person:<id> slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "figures-"));
process.env.NOVEL_MODEL_PACKS = join(root, "packs"); process.env.NOVEL_WAREHOUSE = join(root, "packs", "warehouse.json");
delete process.env.NOVEL_CAUSAL_BINDINGS;
mkdirSync(join(root, "packs"), { recursive: true });
const F = await import("../../src/characters/figures.js");
const WH = await import("../../src/world/models/warehouse.js");
const { warehouseUse } = await import("../../src/cli/commands/extract/warehouseCommands.js");
type CastFile = import("../../src/universe/identity/cast.js").CastFile;
type FigureRecord = import("../../src/characters/figures.js").FigureRecord;

const person = (id: string, name: string, forms: string[] = [], books = ["book"]) => ({ id, name, forms: [name, ...forms].map((text, k) => ({ text, kind: (k ? "alias" : "canonical") as "alias" | "canonical" })), members: books.map((sourceId, k) => ({ sourceId, entityId: `${id}_${k}` })) });
const figure = (id: string, name: string, forms: string[] = [], personId: string | null = null): FigureRecord => ({ id, name, forms, personId, boundBy: personId ? "assigned" : null, file: `${id}/figure.vrm`, pipeline: "v0.6", outfits: ["summer"], size: [0.5, 1.6, 0.3], triangles: 16000, references: [], made: "2026-11-14" });
const cast = (persons: ReturnType<typeof person>[], merges: CastFile["merges"] = []): CastFile => ({ version: 1, universeId: "book", nextId: persons.length + 1, persons, merges, distinct: [] });

/** A one-triangle GLB that says it is a VRM 1.0 (the store checks the extension, the warehouse measures the mesh). */
function vrm(height = 1.6): Buffer {
  const v = [-0.2, 0, 0, 0.2, 0, 0, 0, height, 0.1], i = [0, 1, 2, 0];
  const positions = Buffer.from(Float32Array.from(v).buffer), indices = Buffer.from(Uint16Array.from(i).buffer), bin = Buffer.concat([positions, indices]);
  const json = JSON.stringify({ asset: { version: "2.0" }, extensionsUsed: ["VRMC_vrm"], extensions: { VRMC_vrm: { specVersion: "1.0", humanoid: { humanBones: { hips: { node: 0 } } } } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: 6 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.2, 0, 0], max: [0.2, height, 0.1] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }] });
  const jsonBytes = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " ")), binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binPadded.length, 8);
  const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(jsonBytes.length, 0); jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(binPadded.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, jsonBytes, binHead, binPadded]);
}

test("(a) a figure whose name is one person's is that person; a form two people share says nothing", () => {
  const persons = [person("p_000001", "御坂美琴", ["御坂", "Misaka Mikoto"]), person("p_000002", "御坂妹妹", ["御坂"]), person("p_000003", "上条当麻", ["上条"])];
  const figures = [figure("misaka-mikoto", "Misaka Mikoto"), figure("misaka", "御坂"), figure("touma", "上条", ["上條當麻"])];
  assert.equal(F.bindFiguresByName(persons, figures), 2);
  assert.equal(figures[0].personId, "p_000001"); assert.equal(figures[0].boundBy, "name");
  assert.equal(figures[1].personId, null, "御坂 is two people: never assigned by name");
  assert.equal(figures[2].personId, "p_000003");
  // An assigned figure is never re-bound by name.
  const kept = [figure("kept", "上条当麻", [], "p_000001")];
  assert.equal(F.bindFiguresByName(persons, kept), 0); assert.equal(kept[0].personId, "p_000001");
});

test("(b) a figure follows EM's merges to the survivor, through a chain; a figure whose person left is unassigned", () => {
  const merges = [{ keep: "p_000002", drop: "p_000001", method: "jev" as const, confidence: 0.95, reason: "", at: "" }, { keep: "p_000003", drop: "p_000002", method: "review" as const, confidence: 1, reason: "", at: "" }, { keep: "p_000003", drop: "book::c_9", method: "full-name" as const, confidence: 1, reason: "", at: "" }];
  const figures = [figure("a", "A", [], "p_000001"), figure("b", "B", [], "p_000009"), figure("c", "C", [], "p_000003")];
  assert.deepEqual(F.followFigureMerges(cast([person("p_000003", "C")], merges), figures), { moved: 1, released: 1 });
  assert.equal(figures[0].personId, "p_000003"); assert.equal(figures[0].boundBy, "assigned", "a hand assignment stays a hand assignment");
  assert.equal(figures[1].personId, null); assert.match(figures[1].note ?? "", /left the cast/);
  assert.equal(figures[2].personId, "p_000003");
});

test("(c) each unassigned figure is a task with the people it may be, likest names first, the assigned left out", () => {
  const persons = [person("p_000001", "白井黑子", ["黑子"]), person("p_000002", "御坂美琴", ["御坂"], ["vol-1", "vol-2"]), person("p_000003", "御坂妹妹", ["御坂"]), person("p_000004", "初春饰利")];
  const tasks = F.figureTasks(persons, [figure("misaka", "御坂"), figure("kuroko", "黑子", [], "p_000001")]);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].figure, "misaka");
  assert.deepEqual(tasks[0].candidates.slice(0, 2).map((candidate) => candidate.personId), ["p_000002", "p_000003"], "both 御坂, the one in more books first");
  assert.ok(!tasks[0].candidates.some((candidate) => candidate.personId === "p_000001"), "a person with a figure is not offered");
});

test("a figure put in the store is measured, assigned by EM's name rule, listed by the warehouse and reassigned through a person slot", async () => {
  const book = join(root, "book"); mkdirSync(join(book, "cast"), { recursive: true });
  writeFileSync(join(book, "cast", "book.json"), JSON.stringify(cast([person("p_000001", "御坂美琴", ["Misaka Mikoto"]), person("p_000002", "白井黑子")])));
  const file = join(root, "Misaka.vrm"); writeFileSync(file, vrm(1.58));
  const added = await F.addFigure(book, file, { name: "Misaka Mikoto", forms: ["御坂美琴"], outfits: ["summer", "winter"], pipeline: "v0.6", why: "test" });
  assert.equal(added.figure.personId, "p_000001"); assert.equal(added.figure.boundBy, "name"); assert.equal(added.figure.size[1], 1.58);
  assert.equal(added.part, "figure:misaka-mikoto");
  assert.equal(readFileSync(join(book, "figures", "book", "misaka-mikoto", "figure.vrm")).length, vrm(1.58).length);
  await assert.rejects(F.addFigure(book, file, { name: "Misaka Mikoto", why: "again" }), /already in the store/);
  const plain = join(root, "plain.glb"); writeFileSync(plain, vrm().toString("latin1").replace('"extensionsUsed":["VRMC_vrm"]', '"extensionsUsed":["KHR_none"]'), "latin1");
  await assert.rejects(F.addFigure(book, plain, { name: "x", id: "x", why: "no humanoid" }), /without a VRM humanoid/);

  const sources = await WH.listSources({ novelDir: book });
  assert.equal(sources.sources.find((source) => source.name === "figure")?.parts, 1);
  const found = await WH.findParts("Misaka", { novelDir: book });
  assert.equal(found.parts[0].ref, "figure:misaka-mikoto");
  assert.equal((await WH.meshOfPart("figure:misaka-mikoto", { novelDir: book }))?.size[1], 1.58);

  const used = await warehouseUse(book, "figure:misaka-mikoto", "person:p_000002", { why: "test: reassigned by hand" });
  assert.equal((used as { person: { id: string } }).person.id, "p_000002");
  await assert.rejects(WH.usePart(book, "figure:misaka-mikoto", "person:p_000002", { why: "a setting" }), /takes a figure/);
  await assert.rejects(warehouseUse(book, "kit:none", "person:p_000002", { why: "not a figure" }), /takes a figure/);
  const listed = await F.listFigures(book);
  assert.equal(listed.figures[0].person?.name, "白井黑子"); assert.equal(listed.figures[0].boundBy, "assigned"); assert.equal(listed.withFigure, 1);
  await assert.rejects(warehouseUse(book, "figure:misaka-mikoto", "person:p_404", { why: "no one" }), /No person p_404/);
  assert.equal((await F.figureOfPerson(book, "p_000002"))?.id, "misaka-mikoto");

  // Unassigned, it is the reviewer's task until EM's next settle finds its name is one person's (unassigned is only pending).
  await F.assignFigure(book, "misaka-mikoto", null, { why: "test" });
  assert.equal((await F.figureTasksOf(book)).length, 1);
  const settled = await F.settleFigures({ root: book, universeId: "book" }, JSON.parse(readFileSync(join(book, "cast", "book.json"), "utf8")));
  assert.equal(settled.bound, 1); assert.equal(settled.tasks, 0);
  assert.match(readFileSync(join(book, "figures", "book", "log.jsonl"), "utf8"), /"event":"assigned"/);
});
