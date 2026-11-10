import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createZip } from "../src/digger/intake/album/zip.js";
import { linkReading, putBook, scanFolder, universeAdd } from "../src/v3/folder.js";
import { readerBook, readerDocument, readerLine, readerPortrait } from "../src/v3/reader.js";
import { NovelServer } from "../src/v3/server.js";
import { NovelWorkspace } from "../src/v3/workspace.js";
import { shelf } from "./v3-fixture.js";

async function arranged() {
  const made = await shelf();
  await scanFolder(made.folder);
  await universeAdd(made.folder, "The Lighthouse");
  await putBook(made.folder, "keeper-1.txt", "the-lighthouse");
  await linkReading(made.folder, "keeper-1.txt", made.one.novel);
  return made;
}
const idOf = (lines: { id: string; text: string }[], part: string) => lines.find((line) => line.text.includes(part))!.id;

test("the reader shows a processed book with its kinds, marks, speakers, faces and notes", async () => {
  const { folder, one } = await arranged(), ws = new NovelWorkspace(folder);
  const book = await readerBook(ws, "keeper-1.txt");
  assert.equal(book.mode, "reading"); assert.equal(book.epub, 0);
  assert.equal(book.sentences.length, one.lines.length);
  assert.equal(book.sentences[0][2], 1, "the first sentence starts a paragraph");
  const rope = idOf(one.lines, "Bring the rope"), storm = idOf(one.lines, "The storm arrived"), boat = idOf(one.lines, "There is a boat"), late = idOf(one.lines, "You are late");
  assert.equal(book.kinds[late], "spoken"); assert.equal(book.kinds[idOf(one.lines, "ran for the rope")], "action");
  // Names where they stand, a description with whom it means, a time.
  assert.deepEqual(book.marks[idOf(one.lines, "Mara climbed")][0], [0, 4, "person", "char_000001"]);
  assert.ok(book.marks[rope].some(([at, length, type, ref]) => type === "desc" && ref === "char_000003" && length === "the stranger".length && at > 0));
  assert.ok(book.marks[storm].some(([, , type, ref]) => type === "time" && ref === "ADVANCE · 00:00"));
  assert.ok(book.marks[idOf(one.lines, "from the gallery")].some(([, , type, ref]) => type === "place" && ref === "loc_000001"));
  // Who says a line, settled or a guess, and through which words.
  assert.deepEqual(book.speakers[late], ["char_000002", 0.9, 1, ""]);
  assert.deepEqual(book.speakers[rope], ["char_000003", 0.4, 1, "the stranger"]);
  assert.equal(book.names.char_000003[0], "Captain Reyes");
  assert.deepEqual(book.portraits, ["char_000002"]);
  assert.deepEqual(book.notes, { [boat]: 1 });
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ["Front matter", "Chapter 1 The Lamp", "Chapter 2 The Storm"]);
  assert.equal(book.chapters[1].first, idOf(one.lines, "Chapter 1 The Lamp"));
  assert.equal(book.scenes.length, 5);
  const face = await readerPortrait(ws, "keeper-1.txt", "char_000002");
  assert.match(face ?? "", /^data:image\/png;base64,/);
  assert.equal(await readerPortrait(ws, "keeper-1.txt", "char_000001"), null);
});

test("the notes on a sentence hold every record the reading made of it", async () => {
  const { folder, one } = await arranged(), ws = new NovelWorkspace(folder);
  const rope = await readerLine(ws, "keeper-1.txt", idOf(one.lines, "Bring the rope"));
  assert.equal(rope.chapter, "Chapter 2 The Storm"); assert.equal(rope.scene?.index, 4);
  assert.equal(rope.kind?.kind, "spoken"); assert.deepEqual(rope.kind?.top[0], ["spoken", 0.7]);
  assert.deepEqual(rope.role?.who, { id: "char_000003", label: "Captain Reyes", confidence: 0.4, settled: true, via: "the stranger" });
  assert.deepEqual(rope.descriptions, [{ text: "the stranger", type: "person", entity: "char_000003", label: "Captain Reyes", confidence: 0.4 }]);
  assert.deepEqual(rope.listed.map((entry) => [entry.text, entry.outcome]), [["the stranger", "description"]]);
  assert.deepEqual(rope.references.map((reference) => [reference.label, reference.how]), [["Captain Reyes", ["speaks"]]]);
  assert.deepEqual(rope.cards.map((card) => card.kind), ["spoken"]);
  const storm = await readerLine(ws, "keeper-1.txt", idOf(one.lines, "The storm arrived"));
  assert.deepEqual(storm.times, [{ text: "midnight", gloss: "00:00", role: "ADVANCE", confidence: 0.8 }]);
  const boat = await readerLine(ws, "keeper-1.txt", idOf(one.lines, "There is a boat"));
  assert.deepEqual(boat.notes.map((note) => note.text), ["Is this the same boat as the captain's?"]);
  const second = await readerLine(ws, "keeper-1.txt", one.lines[1].id);
  assert.deepEqual(second.facts.map((fact) => fact.id), ["fact_000001"]);
  await assert.rejects(readerLine(ws, "keeper-1.txt", "b9999_s9999"), /no sentence/);
});

test("an EPUB is read as published: headings and pictures kept, nothing that runs or loads", async () => {
  const { folder } = await arranged();
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pictures</dc:title></metadata><manifest><item id="a" href="Text/a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="Text/b.xhtml" media-type="application/xhtml+xml"/><item id="p" href="Images/p.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`;
  await writeFile(join(folder, "pictures.epub"), createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/Images/p.png", data: Buffer.from("89504e470d0a1a0a", "hex") },
    { name: "OEBPS/Text/a.xhtml", data: `<html><head><style>p{}</style></head><body onload="x()"><h1 class="t" id="h">Chapter 1 Rain</h1><svg><image xlink:href="../Images/p.png"/></svg><p style="color:red">It rained. <a href="https://example.com">Away</a></p><script>alert(1)</script><img src="../Images/p.png" onerror="x()"/><img src="https://example.com/x.png"/></body></html>` },
    { name: "OEBPS/Text/b.xhtml", data: "<html><body><h1>Chapter 2 Sun</h1><p>The sun came back.</p></body></html>" },
  ]));
  await scanFolder(folder);
  const ws = new NovelWorkspace(folder), book = await readerBook(ws, "pictures.epub");
  assert.equal(book.mode, "plain"); assert.equal(book.epub, 2);
  const first = await readerDocument(ws, "pictures.epub", 0);
  assert.equal(first?.title, "Pictures"); assert.equal(first?.items, 2);
  const html = first!.html;
  assert.equal((html.match(/<img class="epub" alt="" src="data:image\/png;base64,/g) ?? []).length, 2, "the SVG wrapper and the picture, inlined");
  assert.match(html, /<h1>Chapter 1 Rain<\/h1>/); assert.match(html, /It rained\. Away/);
  for (const banned of [/<script/i, /onload|onerror/i, /style=/i, /href=/i, /example\.com/, /<style/i, /class="t"|id="h"/]) assert.doesNotMatch(html, banned);
  assert.match((await readerDocument(ws, "pictures.epub", 1))!.html, /The sun came back/);
  assert.equal(await readerDocument(ws, "pictures.epub", 2), null);
  assert.equal(await readerDocument(ws, "keeper-1.txt", 0), null, "a text file has no EPUB");
});

test("the server answers the reader and finds a sentence in the book's document and back", async () => {
  const { folder, one } = await arranged(), server = new NovelServer(folder);
  const book = await server.handle("novel/read", { id: "keeper-1.txt" }) as { id: string; sentences: unknown[] };
  assert.equal(book.sentences.length, one.lines.length);
  const rope = idOf(one.lines, "Bring the rope");
  const where = await server.handle("novel/locate", { id: book.id, sentence: rope }) as { uri: string; range: { start: { line: number; character: number } } };
  assert.match(where.uri, /keeper-1\.txt$/);
  const back = await server.handle("novel/sentenceAt", { textDocument: { uri: where.uri }, position: where.range.start }) as { id: string; sentence: string };
  assert.deepEqual(back, { id: book.id, sentence: rope });
  const record = await server.handle("novel/record", { id: book.id, entity: "char_000003" }) as { uri: string; label: string };
  assert.equal(record.label, "Captain Reyes"); assert.match(record.uri, /^novel:\/entity\//);
  assert.equal(await server.handle("novel/record", { id: book.id, entity: "char_999999" }), null);
  const line = await server.handle("novel/readLine", { id: book.id, sentence: rope }) as { role: { who: { label: string } } };
  assert.equal(line.role.who.label, "Captain Reyes");
});
