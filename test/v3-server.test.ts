import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { linkReading, putBook, scanFolder, universeAdd } from "../src/v3/folder.js";
import { NovelServer } from "../src/v3/server.js";
import { NovelWorkspace } from "../src/v3/workspace.js";
import { KEEPER, shelf } from "./v3-fixture.js";

type Json = Record<string, unknown>;
interface Location { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }

async function arranged() {
  const made = await shelf();
  await scanFolder(made.folder);
  await universeAdd(made.folder, "The Lighthouse");
  await putBook(made.folder, "keeper-1.txt", "the-lighthouse"); await putBook(made.folder, "keeper-2.txt", "the-lighthouse");
  await linkReading(made.folder, "keeper-1.txt", made.one.novel); await linkReading(made.folder, "keeper-2.txt", made.two.novel);
  return made;
}
const positionOf = (text: string, part: string, within = 0) => { const offset = text.indexOf(part) + within, before = text.slice(0, offset).split("\n"); return { line: before.length - 1, character: before[before.length - 1].length }; };
const sliceOf = (text: string, range: Location["range"]) => { const lines = text.split("\n"); return range.start.line === range.end.line ? lines[range.start.line].slice(range.start.character, range.end.character) : lines[range.start.line].slice(range.start.character); };

test("the commands answer who someone is and every line that refers to them, with how and how sure", async () => {
  const { folder } = await arranged(), workspace = new NovelWorkspace(folder);
  const cast = await workspace.cast("keeper-1.txt") as { symbols: { id: string; label: string; references: number }[] };
  assert.deepEqual(cast.symbols.map((symbol) => symbol.label), ["Mara", "Tobin", "Captain Reyes", "gallery"]);
  const who = await workspace.who("keeper-1.txt", "Mara") as { id: string; references: number; how: Record<string, number>; first: { chapter: number; text: string }; otherBooks: { book: string; id: string; references: number }[]; record: string };
  assert.equal(who.id, "char_000001"); assert.equal(who.references, 5);
  assert.deepEqual(who.how, { named: 4, speaks: 1, acts: 1 });
  assert.equal(who.first.chapter, 2); assert.match(who.first.text, /^Mara climbed/);
  assert.deepEqual(who.otherBooks, [{ book: "downloads/keeper-2.txt", title: "keeper-2", id: "char_000009", references: 2 }]);
  assert.match(who.record, /# Mara/); assert.match(who.record, /keeper-2: 2 lines/);
  const said = await workspace.refs("keeper-1.txt", "Mara", { how: "speaks" }) as { total: number; books: { shown: { via?: string; confidence?: number; text: string; chapter: number }[] }[] };
  assert.equal(said.total, 1);
  assert.deepEqual([said.books[0].shown[0].via, said.books[0].shown[0].confidence, said.books[0].shown[0].chapter], ["she", 0.8, 2]);
  assert.match(said.books[0].shown[0].text, /oil was late/);
  const through = await workspace.refs("keeper-1.txt", "Mara", { via: true, limit: 1 }) as { total: number; books: { more: number; shown: { chapterTitle: string; line: string }[] }[] };
  assert.equal(through.total, 1); assert.equal(through.books[0].more, 0); assert.equal(through.books[0].shown[0].chapterTitle, "Chapter 1 The Lamp");
  const paged = await workspace.refs("keeper-1.txt", "Mara", { limit: 2 }) as { books: { more: number; shown: unknown[] }[] };
  assert.deepEqual([paged.books[0].shown.length, paged.books[0].more], [2, 3]);
  const listed = await workspace.chapters("keeper-1.txt", "chapters") as { chapters: { chapter: number; label: string; inside?: number }[] };
  assert.deepEqual(listed.chapters.map((chapter) => [chapter.chapter, chapter.label, chapter.inside]), [[1, "Front matter", 1], [2, "Chapter 1 The Lamp", 2], [3, "Chapter 2 The Storm", 2]]);
  const everywhere = await workspace.refs("keeper-1.txt", "char_000001", { universe: true }) as { total: number; books: { book: string }[] };
  assert.equal(everywhere.total, 7); assert.equal(everywhere.books.length, 2);
  const guesses = await workspace.refs("keeper-2.txt", "the boy", { guesses: true }) as { total: number; books: { shown: { guess?: boolean }[] }[] };
  assert.equal(guesses.total, 1); assert.equal(guesses.books[0].shown[0].guess, true);
  await assert.rejects(workspace.who("keeper-1.txt", "Nobody"), /is called "Nobody"/);
  await assert.rejects(workspace.who("small.epub", "Mara"), /no reading linked/);
  const line = await workspace.lineOf("keeper-1.txt", said.books[0].shown[0] ? (said.books[0].shown[0] as unknown as { line: string }).line : "") as { saidBy: { label: string }; text: { here?: boolean; text: string }[] };
  assert.equal(line.saidBy.label, "Mara"); assert.equal(line.text.filter((entry) => entry.here).length, 1);
});

test("a credit its scene does not back is a problem at its line", async () => {
  const { folder } = await arranged(), workspace = new NovelWorkspace(folder);
  const found = await workspace.problems("keeper-1.txt") as { total: number; problems: { code: string; message: string; text: string; scene: number; entity: string }[] };
  assert.equal(found.total, 1);
  assert.equal(found.problems[0].code, "credit-not-backed"); assert.equal(found.problems[0].entity, "char_000003");
  assert.match(found.problems[0].message, /Captain Reyes is reached through "the stranger" here, but scene 5 never names them/);
  assert.match(found.problems[0].text, /Bring the rope/);
});

test("the server answers an editor: tree, outline, hover, definition, references, symbols, hints, problems", async () => {
  const { folder } = await arranged(), server = new NovelServer();
  const started = await server.handle("initialize", { rootUri: pathToFileURL(folder).href, capabilities: {} }) as { capabilities: Json };
  assert.equal(started.capabilities.referencesProvider, true);
  const tree = await server.handle("novel/tree") as { universes: { id: string; books: { path: string; uri: string; symbols: number; problems: number }[] }[]; unsorted: { path: string; uri: string }[] };
  assert.deepEqual(tree.universes[0].books.map((book) => [book.path, book.symbols, book.problems]), [["keeper-1.txt", 4, 1], ["downloads/keeper-2.txt", 2, 0]]);
  const uri = tree.universes[0].books[0].uri, textDocument = { uri };
  assert.equal(uri, pathToFileURL(join(folder, "keeper-1.txt")).href);
  assert.match(tree.unsorted[0].uri, /^novel:\/book\/f_[0-9a-f]{12}\/A%20Small%20Book\.txt$/);
  assert.match((await server.handle("novel/document", { uri: tree.unsorted[0].uri }) as { text: string }).text, /It rained all day/);

  const outline = await server.handle("textDocument/documentSymbol", { textDocument }) as { name: string; children: { name: string; children: { name: string; detail?: string }[] }[] }[];
  assert.deepEqual(outline.map((chapter) => [chapter.name, chapter.children.map((scene) => scene.name)]), [["Front matter", ["Scene 1"]], ["Chapter 1 The Lamp", ["Scene 2", "Scene 3"]], ["Chapter 2 The Storm", ["Scene 4", "Scene 5"]]]);
  assert.deepEqual(outline[1].children[0].children.map((card) => [card.name, card.detail]), [["spoken", "Tobin"], ["spoken", "Mara"]]);
  const plain = await server.handle("novel/book", { id: "small.epub" }) as { reading: boolean; chapters: { label: string }[] };
  assert.equal(plain.reading, false); assert.deepEqual(plain.chapters.map((chapter) => chapter.label), ["Chapter 1 Rain", "Chapter 2 Sun"]);

  const onTobin = positionOf(KEEPER, "said Tobin", 6);
  const hover = await server.handle("textDocument/hover", { textDocument, position: onTobin }) as { contents: { value: string }; range: Location["range"] };
  assert.match(hover.contents.value, /\*\*Tobin\*\* · person/); assert.match(hover.contents.value, /here: named, speaks/);
  assert.equal(sliceOf(KEEPER, hover.range), "Tobin");
  // A line with no name under the cursor answers with whoever says it, and how the reading got there.
  const onShe = await server.handle("textDocument/hover", { textDocument, position: positionOf(KEEPER, "The oil was late", 4) }) as { contents: { value: string } };
  assert.match(onShe.contents.value, /\*\*Mara\*\*/); assert.match(onShe.contents.value, /through “she”/); assert.match(onShe.contents.value, /confidence 0\.80/);

  const definition = await server.handle("textDocument/definition", { textDocument, position: onTobin }) as Location;
  assert.match(definition.uri, /^novel:\/entity\/f_[0-9a-f]{12}\/char_000002\/Tobin\.md$/);
  assert.match((await server.handle("novel/document", { uri: definition.uri }) as { text: string }).text, /^# Tobin\n\nperson · char_000002/);
  const first = await server.handle("textDocument/declaration", { textDocument, position: positionOf(KEEPER, "Tobin said", 1) }) as Location;
  assert.deepEqual(first.range.start, positionOf(KEEPER, "Tobin from the gallery"));

  const references = await server.handle("textDocument/references", { textDocument, position: positionOf(KEEPER, "Mara climbed", 1), context: { includeDeclaration: true } }) as Location[];
  assert.equal(references.length, 7);
  assert.equal(references.filter((location) => location.uri === uri).length, 5);
  assert.deepEqual(references.filter((location) => location.uri === uri).map((location) => sliceOf(KEEPER, location.range)).slice(0, 2), ["Mara", "she"]);
  const fromRecord = await server.handle("textDocument/references", { textDocument: { uri: definition.uri }, position: { line: 0, character: 0 } }) as Location[];
  assert.equal(fromRecord.length, 3);

  const symbols = await server.handle("workspace/symbol", { query: "Mar" }) as { name: string; containerName: string }[];
  assert.deepEqual(symbols.map((symbol) => [symbol.name, symbol.containerName]), [["Mara", "keeper-1"], ["Mara", "keeper-2"]]);
  const hints = await server.handle("textDocument/inlayHint", { textDocument }) as { label: string; position: { line: number } }[];
  assert.deepEqual(hints.map((hint) => hint.label), ["Tobin:", "Mara:", "Tobin:", "Captain Reyes:"]);
  const two = tree.universes[0].books[1].uri;
  assert.deepEqual((await server.handle("textDocument/inlayHint", { textDocument: { uri: two } }) as { label: string }[]).map((hint) => hint.label), ["the boy?:"]);
  const problems = await server.handle("novel/problems", { uri }) as { code: string; severity: number; range: Location["range"] }[];
  assert.equal(problems.length, 1); assert.equal(problems[0].severity, 2); assert.equal(sliceOf(KEEPER, problems[0].range), "the stranger");
  const folds = await server.handle("textDocument/foldingRange", { textDocument }) as { startLine: number; endLine: number }[];
  assert.ok(folds.length >= 4);
  await assert.rejects(server.handle("textDocument/rename", {}), /Method not found/);
});

test("the server speaks the protocol over stdio, and sees what a command changed under it", async () => {
  const { folder } = await arranged();
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "..", "src", "v3", "server.js")], { stdio: ["pipe", "pipe", "inherit"] });
  let pending = Buffer.alloc(0);
  const waiting = new Map<number, (message: Json) => void>(), notes: Json[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const head = pending.indexOf("\r\n\r\n"); if (head < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(pending.subarray(0, head).toString())![1]); if (pending.length < head + 4 + length) return;
      const message = JSON.parse(pending.subarray(head + 4, head + 4 + length).toString("utf8")) as Json; pending = pending.subarray(head + 4 + length);
      if (typeof message.id === "number") waiting.get(message.id)?.(message); else notes.push(message);
    }
  });
  let next = 1;
  const send = (message: Json) => { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message })); child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body); };
  const request = (method: string, params: Json = {}) => new Promise<Json>((resolve) => { const id = next++; waiting.set(id, resolve); send({ id, method, params }); });
  try {
    const started = await request("initialize", { workspaceFolders: [{ uri: pathToFileURL(folder).href, name: "shelf" }], capabilities: {} });
    assert.equal((started.result as { serverInfo: { name: string } }).serverInfo.name, "novel-language-server");
    const uri = pathToFileURL(join(folder, "keeper-1.txt")).href;
    send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "plaintext", version: 1, text: KEEPER } } });
    const hover = await request("textDocument/hover", { textDocument: { uri }, position: positionOf(KEEPER, "Captain Reyes waved", 2) });
    assert.match((hover.result as { contents: { value: string } }).contents.value, /Captain Reyes/);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].method, "textDocument/publishDiagnostics"); assert.equal(((notes[0].params as { diagnostics: unknown[] }).diagnostics).length, 1);
    assert.equal(((await request("novel/tree")).result as { unsorted: unknown[] }).unsorted.length, 1);
    // An agent's command in a terminal: the EPUB into a universe of its own.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await universeAdd(folder, "Weather"); await putBook(folder, "small.epub", "weather");
    const tree = (await request("novel/tree")).result as { universes: { id: string }[]; unsorted: unknown[] };
    assert.deepEqual(tree.universes.map((universe) => universe.id), ["the-lighthouse", "weather"]); assert.equal(tree.unsorted.length, 0);
    const unknown = await request("textDocument/rename", {});
    assert.equal((unknown.error as { code: number }).code, -32601);
    await request("shutdown");
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    send({ method: "exit" });
    assert.equal(await exited, 0);
  } finally { child.kill(); }
});

test("the offset between two lines belongs to the second", async () => {
  const { folder } = await arranged(), workspace = new NovelWorkspace(folder), open = await workspace.book("keeper-1.txt"), index = open.index!;
  for (let at = 1; at < index.lines.length; at++) {
    const line = index.lines[at];
    assert.equal(index.lineAt(line.start)?.id, line.id);
    assert.equal(index.lineAt(line.end - 1)?.id, line.id);
  }
  const last = index.lines[index.lines.length - 1];
  assert.equal(index.lineAt(last.end)?.id, last.id);
  assert.equal(index.lineAt(KEEPER.length + 5), undefined);
});
