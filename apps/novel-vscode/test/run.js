// Runs inside the editor's extension host (see launch.mjs): the extension on a real folder, asked through the editor's own
// provider commands, set against what the language server says directly. Writes what it saw to NOVEL_TEST_OUT.
const vscode = require("vscode");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const until = async (probe, what, most = 15000) => { for (const start = Date.now(); ;) { const value = await probe(); if (value) return value; if (Date.now() - start > most) throw new Error(`Timed out waiting for ${what}.`); await new Promise((resolve) => setTimeout(resolve, 150)); } };

async function check() {
  const seen = { steps: [] }, step = (name, detail) => seen.steps.push({ name, ...detail });
  const extension = vscode.extensions.all.find((entry) => entry.packageJSON.name === "novel-workbench");
  assert.ok(extension, "the extension is installed");
  const api = await extension.activate();
  assert.ok(api.client, "the language server started");

  // The explorer's tree: universes, their books in order, the unsorted files.
  const roots = await until(async () => { const found = await api.books.getChildren(); return found.length ? found : null; }, "the tree");
  const universes = roots.filter((node) => node.type === "universe"), unsorted = roots.find((node) => node.type === "unsorted");
  step("tree", { universes: universes.map((node) => ({ id: node.id, books: node.books.length })), unsorted: unsorted ? unsorted.files.length : 0 });
  const bookNodes = (await Promise.all(roots.map((node) => api.books.getChildren(node)))).flat();
  assert.ok(bookNodes.length > 0, "the folder has books");
  for (const node of bookNodes) assert.ok(api.books.getTreeItem(node).label, "every book has a label");
  // A book with no reading offers the play button (its reading); the keys' state is answered without values.
  const unread = bookNodes.filter((node) => api.books.getTreeItem(node).contextValue === "book-unread");
  const keys = await api.client.request("novel/keys");
  assert.ok("jev" in keys && "work" in keys && Object.values(keys).every((value) => value === null || typeof value === "string" && value.length < 20), "only where each key is from");
  const commands = await vscode.commands.getCommands(true);
  for (const name of ["novel.enterKeys", "novel.runReading", "novel.stopReading", "novel.read"]) assert.ok(commands.includes(name), `${name} is registered`);
  step("reading buttons", { unread: unread.length, withReading: bookNodes.filter((node) => api.books.getTreeItem(node).contextValue === "book").length });

  // Every book opens into chapters; one with a reading opens further into scenes and cards.
  const read = bookNodes.find((node) => node.book.reading) || null, any = read || bookNodes[0];
  const chapters = await api.books.getChildren(any);
  assert.ok(chapters.length > 0, "a book has chapters");
  const deep = chapters.find((node) => node.part.children.length);
  step("book", { reading: Boolean(read), chapters: chapters.length, firstParts: deep ? deep.part.children.length : 0, kinds: deep ? [...new Set(deep.part.children.map((part) => part.kind))] : [] });

  // The book as a document, at a chapter.
  const target = deep || chapters[0];
  await vscode.commands.executeCommand("novel.open", target.uri, target.part.range);
  const editor = vscode.window.activeTextEditor, document = editor.document;
  assert.equal(document.uri.toString(), vscode.Uri.parse(target.uri).toString());
  assert.ok(document.getText().length > 0, "the document has the book's text");
  assert.equal(editor.selection.active.line, target.part.range.start.line);
  step("document", { scheme: document.uri.scheme, lines: document.lineCount, chars: document.getText().length });

  const outline = await until(() => vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri), "the outline");
  assert.equal(outline.length, chapters.length);
  step("outline", { chapters: outline.length, scenes: outline.reduce((sum, chapter) => sum + chapter.children.length, 0) });
  if (!read) return seen;

  // A symbol: its record, its hover, every line that refers to it.
  const cast = await api.client.request("novel/cast", { id: any.book.id, category: "person", limit: 5 });
  const symbol = cast.symbols[0];
  const direct = await api.client.request("textDocument/references", { textDocument: { uri: symbol.uri }, position: { line: 0, character: 0 } });
  const own = direct.filter((location) => vscode.Uri.parse(location.uri).toString() === document.uri.toString());
  const named = own.find((location) => { const range = new vscode.Range(location.range.start.line, location.range.start.character, location.range.end.line, location.range.end.character); return symbol.names.includes(document.getText(range)); });
  assert.ok(named, "the most cited person is named somewhere in the text");
  const position = new vscode.Position(named.range.start.line, named.range.start.character);
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, position);
  const hoverText = hovers.flatMap((hover) => hover.contents).map((content) => (typeof content === "string" ? content : content.value)).join("\n");
  assert.ok(hoverText.includes(symbol.label), "the hover names the person under the cursor");
  const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, position);
  assert.equal(definitions.length, 1); assert.equal(definitions[0].uri.scheme, "novel"); assert.ok(definitions[0].uri.path.startsWith("/entity/"));
  const record = await vscode.workspace.openTextDocument(definitions[0].uri);
  assert.ok(record.getText().startsWith(`# ${symbol.label}`), "the definition is the person's record");
  const references = await vscode.commands.executeCommand("vscode.executeReferenceProvider", document.uri, position);
  assert.equal(references.length, direct.length);
  const found = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", symbol.label);
  assert.ok(found.some((entry) => entry.name === symbol.label), "the person is found by name across the folder");
  step("symbol", { references: references.length, inThisBook: own.length, otherBooks: new Set(direct.map((location) => location.uri)).size - 1, recordLines: record.lineCount, hoverChars: hoverText.length });

  const hints = await vscode.commands.executeCommand("vscode.executeInlayHintProvider", document.uri, new vscode.Range(0, 0, document.lineCount, 0));
  const expected = await api.client.request("novel/problems", { uri: document.uri.toString() });
  const problems = await until(() => { const now = vscode.languages.getDiagnostics(document.uri).filter((entry) => entry.source === "novel"); return now.length === expected.length ? now : null; }, "the problems");
  step("hints and problems", { speakerHints: hints.length, problems: problems.length });

  // The cast view follows the open book.
  await api.cast.show(any.book.id);
  const groups = await api.cast.getChildren();
  assert.ok(groups.length > 0 && groups[0].symbols.length > 0, "the cast view lists the book's people");
  step("cast view", { groups: groups.map((group) => `${group.label} ${group.symbols.length}`) });

  // The reader: the book as published, its sentences coloured and marked, the notes on a spoken line.
  const view = await api.client.request("novel/read", { id: any.book.id });
  const spoken = Object.keys(view.speakers).find((id) => view.marks[id] && view.kinds[id] === "spoken") || Object.keys(view.speakers)[0];
  const panel = await api.read({ type: "book", book: any.book });
  assert.ok(panel, "the reader opened");
  // The first page (an EPUB may open on its cover and plates, with no sentence yet), then a spoken line, then the end.
  const shown = await until(() => api.readers.last.get(`${any.book.id}:shown`), "the reader's first page", 30000).catch((error) => { throw new Error(`${error.message}: ${JSON.stringify([...api.readers.last.entries()])}`); });
  panel.webview.postMessage({ type: "reveal", sentence: spoken });
  const notes = await until(() => { const last = api.readers.last.get(`${any.book.id}:notes`); return last && last.sentence === spoken ? last : null; }, "the notes on a spoken line", 90000);
  assert.ok(notes.sections.includes("Who says it"), "the notes say who says the line");
  const after = api.readers.last.get(`${any.book.id}:shown`);
  assert.ok(after.found > 0 && after.marks > 0 && after.kinds > 0, "sentences are found, coloured and marked");
  const last = view.sentences[view.sentences.length - 1][0];
  panel.webview.postMessage({ type: "reveal", sentence: last });
  const end = await until(() => { const now = api.readers.last.get(`${any.book.id}:notes`); return now && now.sentence === last ? api.readers.last.get(`${any.book.id}:shown`) : null; }, "the end of the book", 120000);
  const counts = (state) => ({ found: state.found, documents: state.item, kinds: state.kinds, marks: state.marks, speakers: state.speakers, problems: state.problems, pictures: state.pictures });
  step("reader", { mode: view.mode, epub: view.epub, sentences: view.sentences.length, firstPage: counts(shown), toTheLine: counts(after), toTheEnd: counts(end), notes: { kind: notes.kind, sections: notes.sections, chips: notes.chips } });
  // From a chapter in the tree, and again from the cursor in the book's text.
  const later = chapters[chapters.length - 1];
  await vscode.commands.executeCommand("novel.read", later);
  step("reader from a chapter", { chapter: later.part.label });
  panel.dispose();
  return seen;
}

// For pictures (launch.mjs --shots <dir>): the Novels view with a book opened out, a hover, the references of a person.
// Each pose writes <name>.ready and waits for the launcher's <name>.done.
async function pose(directory) {
  const path = require("node:path"), extension = vscode.extensions.all.find((entry) => entry.packageJSON.name === "novel-workbench"), api = await extension.activate();
  const held = async (name) => { await new Promise((resolve) => setTimeout(resolve, 1200)); fs.writeFileSync(path.join(directory, `${name}.ready`), ""); await until(() => fs.existsSync(path.join(directory, `${name}.done`)), `the picture ${name}`, 30000); };
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("workbench.view.extension.novel");
  const roots = await api.books.getChildren(), bookNodes = (await Promise.all(roots.map((node) => api.books.getChildren(node)))).flat();
  const book = bookNodes.find((node) => node.book.reading) || bookNodes[0], chapters = await api.books.getChildren(book);
  const chapter = chapters.find((node) => node.part.children.length > 2) || chapters[0], scenes = await api.books.getChildren(chapter);
  if (scenes[1]) await api.booksView.reveal(scenes[1], { expand: true, select: true, focus: false }); else await api.booksView.reveal(chapter, { expand: true });
  const target = scenes[1] || chapter;
  await vscode.commands.executeCommand("novel.open", target.uri, target.part.range);
  await held("1-tree");
  if (!book.book.reading) return;
  const editor = vscode.window.activeTextEditor, document = editor.document;
  const cast = await api.client.request("novel/cast", { id: book.book.id, category: "person", limit: 3 }), symbol = cast.symbols[0];
  const direct = await api.client.request("textDocument/references", { textDocument: { uri: symbol.uri }, position: { line: 0, character: 0 } });
  const here = direct.find((location) => vscode.Uri.parse(location.uri).toString() === document.uri.toString() && location.range.start.line > editor.selection.active.line + 3 && symbol.names.includes(document.getText(new vscode.Range(location.range.start.line, location.range.start.character, location.range.end.line, location.range.end.character))));
  if (!here) return;
  const position = new vscode.Position(here.range.start.line, here.range.start.character + 1);
  editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await vscode.commands.executeCommand("editor.action.showHover");
  await held("2-hover");
  await vscode.commands.executeCommand("editor.action.referenceSearch.trigger");
  await held("3-references");
  await vscode.commands.executeCommand("closeReferenceSearch");
  await vscode.commands.executeCommand("novel.showRecord", symbol.uri);
  await held("4-record");
  // The reader at a spoken line with a mark, its notes open.
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const view = await api.client.request("novel/read", { id: book.book.id });
  const pick = Object.keys(view.speakers).filter((id) => view.marks[id]?.some((mark) => mark[2] === "desc" && mark[3]) && view.kinds[id] === "spoken");
  const line = pick[Math.min(pick.length - 1, 3)] || Object.keys(view.speakers)[0];
  const panel = await api.read({ type: "book", book: book.book });
  await until(() => api.readers.last.get(`${book.book.id}:shown`), "the reader", 30000);
  panel.webview.postMessage({ type: "reveal", sentence: line });
  await until(() => api.readers.last.get(`${book.book.id}:notes`)?.sentence === line, "the notes", 150000);
  await held("5-reader");
  // The front of the book: its first pictures and headings.
  const first = view.chapters.find((chapter) => chapter.first)?.first;
  if (first) { panel.webview.postMessage({ type: "reveal", sentence: first }); await held("6-reader-start"); }
}

exports.run = async () => {
  const out = process.env.NOVEL_TEST_OUT;
  try { const seen = await check(); if (process.env.NOVEL_TEST_SHOTS) await pose(process.env.NOVEL_TEST_SHOTS).catch((error) => { seen.pose = String(error && error.message || error); }); if (out) fs.writeFileSync(out, JSON.stringify({ ok: true, ...seen }, null, 1)); }
  catch (error) { if (out) fs.writeFileSync(out, JSON.stringify({ ok: false, error: String(error && error.stack || error) }, null, 1)); throw error; }
};
