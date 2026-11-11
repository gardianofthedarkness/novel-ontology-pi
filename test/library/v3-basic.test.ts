import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicLayer, basicStep, numberOf, overlap, readBasic, seriesOf, seriesSuggestions } from "../../src/library/basic.js";
import { importFiles, loadState, scanFolder } from "../../src/library/folder.js";
import { NovelServer } from "../../src/server/server.js";
import { tinyEpub } from "../v3-fixture.js";

test("a title's series and volume, in the forms titles use", () => {
  assert.equal(numberOf("12"), 12); assert.equal(numberOf("\u5341\u4e8c"), 12); assert.equal(numberOf("\u4e5d"), 9); assert.equal(numberOf("\u4e8c\u5341"), 20); assert.equal(numberOf("x"), null);
  assert.deepEqual(seriesOf("The Harbour Lights Vol. 3"), { series: "The Harbour Lights", key: "theharbourlights", volume: 3 });
  assert.equal(seriesOf("Harbour Lights (2)").volume, 2);
  assert.equal(seriesOf("Harbour Lights 7").volume, 7);
  assert.equal(seriesOf("\u6e2f\u706f\u7b2c\u516d\u5377").volume, 6);
  assert.equal(seriesOf("\u6e2f\u706f\u7b2c\u516d\u5377").series, "\u6e2f\u706f");
  assert.equal(seriesOf("Harbour Lights").volume, null);
  assert.ok(overlap("harbourlights", "theharbourlights") === 1);
  assert.ok(overlap("harbourlights", "mountainroad") < 0.3);
});

test("the basic layer of a book: its title, chapters, lines, dialogue and names by pattern, no model asked", () => {
  const text = ["Chapter 1 The Pier", "", "\u300c\u6765\u4e86\u3002\u300d\u6797\u5c0f\u59d0\u8bf4\u3002\u6797\u5c0f\u59d0\u70b9\u5934\u3002\u6797\u5c0f\u59d0\u8d70\u4e86\u3002", "", "Chapter 2 The Boat", "", "\u5f20\u4e09\u8bf4\u9053\uff1a\u300c\u597d\u3002\u300d\u5f20\u4e09\u8bf4\u9053\uff1a\u300c\u8d70\u3002\u300d\u5f20\u4e09\u8bf4\u9053\uff1a\u300c\u505c\u3002\u300d"].join("\n");
  const layer = basicLayer(Buffer.from(text), { id: "f_x", kind: "text", path: "Harbour Lights 2.txt" });
  assert.equal(layer.volume, 2); assert.equal(layer.series, "Harbour Lights");
  assert.ok(layer.lines >= 8); assert.ok(layer.spoken >= 4 && layer.spoken < layer.lines);
  assert.deepEqual(layer.names.map((name) => [name.name, name.how]).sort(), [["\u5f20\u4e09", "speech"], ["\u6797", "honorific"]].filter(([name]) => name.length > 1).sort());
  const epub = basicLayer(tinyEpub("Harbour Lights Vol. 4"), { id: "f_y", kind: "epub", path: "h.epub" });
  assert.equal(epub.title, "Harbour Lights Vol. 4"); assert.equal(epub.volume, 4); assert.ok(epub.lines >= 4);
});

test("a folder the console opens: EPUBs found by themselves, text files imported, each book's basic layer, series offered", async () => {
  const root = await mkdtemp(join(tmpdir(), "novel-basic-")), folder = join(root, "Documents");
  await mkdir(join(folder, "Novels"), { recursive: true }); await mkdir(join(folder, "work"), { recursive: true });
  for (const n of [3, 1, 2]) await writeFile(join(folder, "Novels", `h${n}.epub`), tinyEpub(`Harbour Lights Vol. ${n}`));
  await writeFile(join(folder, "Novels", "copy-of-h1.epub"), tinyEpub("Harbour Lights Vol. 1"));
  await writeFile(join(folder, "Novels", "other.epub"), tinyEpub("A Mountain Road"));
  await writeFile(join(folder, "work", "notes.txt"), "Meeting notes, not a book.");
  await writeFile(join(folder, "Novels", "story.txt"), "Chapter 1 Rain\n\nIt rained all day. Nobody came.\n");
  const scan = await scanFolder(folder, { found: ["epub"] });
  assert.equal(scan.files, 4, "EPUBs only, the copy counted once"); assert.ok(!scan.added.some((path) => path.endsWith(".txt")));
  assert.deepEqual((await loadState(folder)).found, ["epub"]);
  const imported = await importFiles(folder, ["Novels/story.txt"]);
  assert.equal(imported.files, 5); assert.ok(imported.added.includes("Novels/story.txt"));
  await assert.rejects(importFiles(folder, ["../elsewhere.txt"]), /not inside/);
  let step; do { step = await basicStep(folder, 2); } while (step.left > 0);
  assert.equal(step.total, 5);
  const state = await loadState(folder);
  for (const file of state.files) assert.ok(await readBasic(folder, file.id), `${file.path} has its basic layer`);
  const series = await seriesSuggestions(folder);
  assert.equal(series.length, 1); assert.equal(series[0].name, "Harbour Lights"); assert.deepEqual(series[0].books.map((book) => book.volume), [1, 2, 3]);
  const server = new NovelServer(folder);
  const arranged = await server.handle("novel/arrange", { name: series[0].name, files: series[0].books.map((book) => book.file) }) as { books: number };
  assert.equal(arranged.books, 3);
  const tree = await server.handle("novel/tree", {}) as { universes: { name: string; books: { basic: { volume: number; lines: number } }[] }[] };
  assert.deepEqual(tree.universes[0].books.map((book) => book.basic.volume), [1, 2, 3]);
  assert.deepEqual(await seriesSuggestions(folder), [], "an arranged series is no longer offered");
});
