import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bookChapters, cutParts, folderTree, linkReading, loadState, putBook, scanFolder, takeBook, universeAdd, universeRemove } from "../src/v3/folder.js";
import { KEEPER, shelf } from "./v3-fixture.js";

type Tree = { universes: { id: string; name: string; books: { path: string; title: string; reading?: { sameText: boolean } }[] }[]; unsorted: { path: string; title: string; chapters: number; opening?: string; copies?: string[] }[] };

test("the scan finds every EPUB and text file under the folder and leaves them where they are", async () => {
  const { folder } = await shelf();
  const report = await scanFolder(folder);
  assert.deepEqual(report.added, ["downloads/keeper-2.txt", "downloads/small.epub", "keeper-1.txt"]);
  assert.equal(report.files, 3); assert.equal(report.unsorted, 3);
  const tree = await folderTree(folder, { opening: 30 }) as Tree;
  assert.equal(tree.universes.length, 0);
  const epub = tree.unsorted.find((file) => file.path === "downloads/small.epub")!;
  assert.equal(epub.title, "A Small Book"); assert.equal(epub.chapters, 2);
  assert.match(tree.unsorted.find((file) => file.path === "keeper-1.txt")!.opening!, /^The Lighthouse Keeper/);
  assert.equal(await readFile(join(folder, "keeper-1.txt"), "utf8"), KEEPER);
  // A second scan reads nothing again and reports nothing new.
  const again = await scanFolder(folder);
  assert.deepEqual([again.added, again.changed, again.moved, again.gone], [[], [], [], []]);
});

test("files are arranged into universes in an order, and taken out again", async () => {
  const { folder } = await shelf();
  await scanFolder(folder);
  assert.deepEqual(await universeAdd(folder, "The Lighthouse", { why: "same keeper, same coast" }), { universe: "the-lighthouse", name: "The Lighthouse", books: 0 });
  await putBook(folder, "keeper-2.txt", "the-lighthouse");
  const placed = await putBook(folder, "keeper-1.txt", "The Lighthouse", { at: 1, title: "Book One" }) as { order: { at: number; file: string; title: string }[] };
  assert.deepEqual(placed.order.map((entry) => entry.file), ["keeper-1.txt", "downloads/keeper-2.txt"]);
  assert.equal(placed.order[0].title, "Book One");
  let tree = await folderTree(folder) as Tree;
  assert.deepEqual(tree.unsorted.map((file) => file.path), ["downloads/small.epub"]);
  await universeAdd(folder, "Weather");
  await putBook(folder, "small.epub", "weather");
  await putBook(folder, "keeper-2.txt", "weather", { at: 1 });
  tree = await folderTree(folder) as Tree;
  assert.deepEqual(tree.universes.map((universe) => universe.books.map((book) => book.path)), [["keeper-1.txt"], ["downloads/keeper-2.txt", "downloads/small.epub"]]);
  await takeBook(folder, "keeper-2.txt");
  await universeRemove(folder, "weather");
  tree = await folderTree(folder) as Tree;
  assert.deepEqual(tree.unsorted.map((file) => file.path).sort(), ["downloads/keeper-2.txt", "downloads/small.epub"]);
  // A name with no Latin letters gets a numbered id.
  assert.equal((await universeAdd(folder, "\u7b2c\u4e00\u4e16\u754c") as { universe: string }).universe, "u1");
  assert.equal((await universeAdd(folder, "\u7b2c\u4e8c\u4e16\u754c") as { universe: string }).universe, "u2");
  await assert.rejects(putBook(folder, "nothing.txt", "the-lighthouse"), /No scanned file/);
  await assert.rejects(putBook(folder, "keeper-1.txt", "nowhere"), /No universe/);
  await assert.rejects(putBook(folder, "keeper-1.txt", "the-lighthouse", { at: 9 }), /--at must be/);
});

test("a book keeps its place when its file moves, follows its path when its text changes, and is kept as missing when it is gone", async () => {
  const { folder } = await shelf();
  await scanFolder(folder);
  await universeAdd(folder, "The Lighthouse");
  await putBook(folder, "keeper-1.txt", "the-lighthouse"); await putBook(folder, "keeper-2.txt", "the-lighthouse");
  await mkdir(join(folder, "sorted"));
  await rename(join(folder, "keeper-1.txt"), join(folder, "sorted", "one.txt"));
  let report = await scanFolder(folder);
  assert.deepEqual(report.moved, [{ from: "keeper-1.txt", to: "sorted/one.txt" }]); assert.deepEqual(report.added, []);
  let tree = await folderTree(folder) as Tree;
  assert.deepEqual(tree.universes[0].books.map((book) => book.path), ["sorted/one.txt", "downloads/keeper-2.txt"]);
  await writeFile(join(folder, "sorted", "one.txt"), `${KEEPER}\nChapter 3 After\n\nThe sea was calm.\n`, "utf8");
  report = await scanFolder(folder);
  assert.deepEqual(report.changed, ["sorted/one.txt"]);
  tree = await folderTree(folder) as Tree;
  assert.equal(tree.universes[0].books[0].path, "sorted/one.txt");
  await writeFile(join(folder, "copy.txt"), await readFile(join(folder, "downloads", "keeper-2.txt")));
  await rm(join(folder, "sorted", "one.txt"));
  report = await scanFolder(folder);
  assert.deepEqual(report.missing, ["sorted/one.txt"]);
  const state = await loadState(folder);
  assert.equal(state.files.find((file) => file.path === "sorted/one.txt")?.missing, true);
  assert.deepEqual(state.files.find((file) => file.path === "copy.txt")?.copies, ["downloads/keeper-2.txt"]);
});

test("a book opens into chapters and the parts its text marks", async () => {
  const { folder } = await shelf();
  await scanFolder(folder);
  const book = await bookChapters(folder, "keeper-1.txt") as { chapters: { title: string | null; parts: { label: string | null }[] }[] };
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), [null, "Chapter 1 The Lamp", "Chapter 2 The Storm"]);
  assert.deepEqual(book.chapters.map((chapter) => chapter.parts.map((part) => part.label)), [[], [null, "*"], [null, "1"]]);
  assert.deepEqual(cutParts("one\ntwo\n", 0, 8), []);
  assert.deepEqual(cutParts("a\n※※※\nb\n", 0, 8).map((part) => part.label), [null, "※※※"]);
  // A spoken line of marks only is no break.
  assert.deepEqual(cutParts("a\n\"...\"\nb\n", 0, 10), []);
});

test("a reading is linked to a book in a universe, by its own text or as another extraction", async () => {
  const { folder, one, two } = await shelf();
  await scanFolder(folder);
  await assert.rejects(linkReading(folder, "keeper-1.txt", one.novel), /in no universe/);
  await universeAdd(folder, "The Lighthouse");
  await putBook(folder, "keeper-1.txt", "the-lighthouse"); await putBook(folder, "small.epub", "the-lighthouse");
  const same = await linkReading(folder, "keeper-1.txt", one.novel) as { reading: { sameText: boolean }; scenes: number };
  assert.equal(same.reading.sameText, true); assert.equal(same.scenes, 5);
  // A reading of another book is refused: its line ids would point at the wrong lines.
  await assert.rejects(linkReading(folder, "small.epub", two.novel), /reads another book than downloads\/small\.epub: 0 of \d+ samples/);
  const other = await linkReading(folder, "small.epub", two.novel, undefined, { force: true }) as { reading: { sameText: boolean }; text: string };
  assert.equal(other.reading.sameText, false); assert.match(other.text, /stored source/);
  const book = await bookChapters(folder, "small.epub") as { text: string; chapters: { title: string | null }[] };
  assert.equal(book.text, "reading"); assert.equal(book.chapters[1].title, "Chapter 1 The Letter");
  await linkReading(folder, "small.epub", null);
  assert.equal((await bookChapters(folder, "small.epub") as { text: string }).text, "epub");
  await assert.rejects(linkReading(folder, "keeper-1.txt", join(folder, "downloads")), /no stored source/);
});
