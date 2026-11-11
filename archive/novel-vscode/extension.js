// The Novel Workbench: the opened folder as a workspace of novels (docs/v3/design.html#workspace). A thin shell over the novel
// language server: it starts the server, shows its tree in the explorer, hands the editor's questions (outline, hover,
// definition, references, problems) to it, and opens a processed book in the reader. No dependency: the client side of the protocol is the few lines below.
const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { fork, spawn } = require("node:child_process");

class Client {
  constructor(serverPath, folder, nodePath, log) {
    this.log = log; this.next = 1; this.waiting = new Map(); this.pending = Buffer.alloc(0); this.closed = false;
    this.child = nodePath ? spawn(nodePath, [serverPath, folder], { stdio: ["pipe", "pipe", "pipe"] }) : fork(serverPath, [folder], { silent: true });
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => log.appendLine(String(chunk).trimEnd()));
    this.child.on("exit", (code) => { this.closed = true; log.appendLine(`The language server stopped (${code}).`); for (const entry of this.waiting.values()) entry.reject(new Error("The novel language server stopped.")); this.waiting.clear(); });
    this.child.on("error", (error) => log.appendLine(`The language server could not start: ${error.message}`));
  }
  read(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const head = this.pending.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.pending.subarray(0, head).toString("ascii"))?.[1]);
      if (this.pending.length < head + 4 + length) return;
      const message = JSON.parse(this.pending.subarray(head + 4, head + 4 + length).toString("utf8"));
      this.pending = this.pending.subarray(head + 4 + length);
      const entry = message.id !== undefined && message.id !== null ? this.waiting.get(message.id) : null;
      if (!entry) continue;
      this.waiting.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
  }
  send(message) { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8"); this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body])); }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("The novel language server is not running."));
    const id = this.next++;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  notify(method, params = {}) { if (!this.closed) this.send({ method, params }); }
  stop() { if (this.closed) return; this.request("shutdown").then(() => this.notify("exit"), () => {}); setTimeout(() => { if (!this.closed) this.child.kill(); }, 1500); }
}

const toRange = (range) => new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
const toLocation = (location) => new vscode.Location(vscode.Uri.parse(location.uri), toRange(location.range));
const at = (document, position) => ({ textDocument: { uri: document.uri.toString() }, position: { line: position.line, character: position.character } });
// The server's kinds are the protocol's (1-based); the editor's are 0-based.
const symbolKind = (kind) => kind - 1;

class BooksTree {
  constructor(client) { this.client = client; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; this.tree = null; }
  refresh() { this.tree = null; this.changed.fire(undefined); }
  async load() { return (this.tree ??= await this.client.request("novel/tree").catch(() => ({ universes: [], unsorted: [] }))); }
  getTreeItem(node) {
    if (node.type === "universe") { const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded); item.description = `${node.books.length} ${node.books.length === 1 ? "book" : "books"}`; item.iconPath = new vscode.ThemeIcon("globe"); item.tooltip = node.why || node.name; item.contextValue = "universe"; return item; }
    if (node.type === "unsorted") { const item = new vscode.TreeItem("Unsorted", vscode.TreeItemCollapsibleState.Expanded); item.description = `${node.files.length}`; item.iconPath = new vscode.ThemeIcon("inbox"); item.tooltip = "Files no universe holds yet. An agent arranges them with: novel folder put <folder> <file> <universe>"; return item; }
    if (node.type === "book") {
      const book = node.book, item = new vscode.TreeItem(book.title, book.missing || book.unread ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
      const job = book.job, reading = job?.state === "running";
      item.description = book.missing ? "missing" : book.unread ? "not readable" : reading ? `reading\u2026 ${job.now ?? ""}` : [book.reading ? `${book.symbols} entries` : job?.state === "failed" ? "reading failed" : job?.state === "stopped" ? "reading stopped" : "no reading", book.problems ? `${book.problems} ${book.problems === 1 ? "problem" : "problems"}` : ""].filter(Boolean).join(" \u00b7 ");
      item.iconPath = new vscode.ThemeIcon(book.missing ? "warning" : reading ? "sync~spin" : book.reading ? "book" : "file-text"); item.tooltip = `${book.path}\n${book.chars.toLocaleString()} characters, ${book.chapters} chapters`; item.contextValue = book.missing || book.unread ? "book-gone" : reading ? "book-reading" : book.reading ? "book" : "book-unread";
      if (job?.error && !reading) item.tooltip += `\nThe last reading ${job.state}: ${job.error}`;
      if (book.uri) item.command = { command: "novel.open", title: "Open", arguments: [book.uri] };
      return item;
    }
    const part = node.part, item = new vscode.TreeItem(part.label, part.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.description = part.detail || ""; item.iconPath = new vscode.ThemeIcon(part.kind === "chapter" ? "symbol-namespace" : part.kind === "card" ? "symbol-method" : "symbol-event");
    item.command = { command: "novel.open", title: "Open", arguments: [node.uri, part.range] }; item.contextValue = part.kind;
    return item;
  }
  getParent(node) { return node.parent; }
  async getChildren(node) {
    if (!node) { const tree = await this.load(); return [...tree.universes.map((universe) => ({ type: "universe", ...universe })), ...(tree.unsorted.length ? [{ type: "unsorted", files: tree.unsorted }] : [])]; }
    if (node.type === "universe") return node.books.map((book, index) => ({ type: "book", book, order: index + 1, parent: node }));
    if (node.type === "unsorted") return node.files.map((book) => ({ type: "book", book, parent: node }));
    if (node.type === "book") { const detail = await this.client.request("novel/book", { id: node.book.id }).catch(() => ({ chapters: [] })); return detail.chapters.map((part) => ({ type: "part", part, uri: detail.uri, parent: node })); }
    return node.part.children.map((part) => ({ type: "part", part, uri: node.uri, parent: node }));
  }
}

class CastTree {
  constructor(client) { this.client = client; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; this.book = null; }
  show(book) { if (book === this.book) return; this.book = book; this.changed.fire(undefined); }
  refresh() { this.changed.fire(undefined); }
  getTreeItem(node) {
    if (node.type === "group") { const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState[node.label === "People" ? "Expanded" : "Collapsed"]); item.description = `${node.symbols.length}`; return item; }
    const symbol = node.symbol, item = new vscode.TreeItem(symbol.label, vscode.TreeItemCollapsibleState.None);
    item.description = `${symbol.references} lines${symbol.unnamed ? " · unnamed" : ""}`; item.tooltip = symbol.names.join(", "); item.contextValue = "symbol";
    item.iconPath = new vscode.ThemeIcon({ person: "person", place: "location", thing: "package", concept: "lightbulb" }[symbol.category] || "symbol-misc");
    item.command = { command: "novel.showRecord", title: "Show Record", arguments: [symbol.uri] };
    return item;
  }
  async getChildren(node) {
    if (node) return node.type === "group" ? node.symbols.map((symbol) => ({ type: "symbol", symbol })) : [];
    if (!this.book) return [];
    const cast = await this.client.request("novel/cast", { id: this.book, limit: 400 }).catch(() => ({ symbols: [] }));
    const groups = [["People", (s) => s.category === "person" && !s.unnamed], ["Places", (s) => s.category === "place"], ["Things", (s) => s.category === "thing"], ["Concepts", (s) => s.category === "concept"], ["Unnamed people and crowds", (s) => s.unnamed]];
    return groups.map(([label, fits]) => ({ type: "group", label, symbols: cast.symbols.filter(fits) })).filter((group) => group.symbols.length);
  }
}

// The reader (docs/v3/design.html#reader): a processed book read as published, in a webview: its EPUB a document at a time, each
// sentence coloured by its kind, names, descriptions and times marked, the speaker before a spoken line, and the notes
// (every record of a tapped sentence). The page asks the language server through here; nothing else reaches it.
const READER_ASKS = new Set(["novel/read", "novel/readDocument", "novel/readLine", "novel/readPortrait"]);
class Readers {
  constructor(context, client, ask, actions, log) { this.log = log; this.context = context; this.client = client; this.ask = ask; this.actions = actions; this.panels = new Map(); this.last = new Map(); }
  html(webview, boot) {
    const nonce = require("node:crypto").randomBytes(16).toString("base64").replace(/[^A-Za-z0-9]/g, "");
    const csp = `default-src 'none'; img-src data: ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return fs.readFileSync(path.join(__dirname, "..", "reader", "reader.html"), "utf8").replace("__CSP__", csp).replace(/__NONCE__/g, nonce)
      .replace("/*BOOT*/null", JSON.stringify(boot).replace(/</g, "\\u003c"));
  }
  open(id, title, at) {
    const known = this.panels.get(id);
    if (known) { known.reveal(); if (at) known.webview.postMessage({ type: "reveal", sentence: at }); return known; }
    for (const key of [...this.last.keys()]) if (key.startsWith(`${id}:`)) this.last.delete(key);
    const panel = vscode.window.createWebviewPanel("novel.reader", `Read \u00b7 ${title}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    panel.iconPath = vscode.Uri.file(path.join(__dirname, "media", "book.svg"));
    panel.webview.html = this.html(panel.webview, { id, at: at || null });
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.id !== undefined && READER_ASKS.has(message.method)) {
        try { panel.webview.postMessage({ reply: message.id, result: await this.client.request(message.method, { ...message.params, id }) }); }
        catch (error) { panel.webview.postMessage({ reply: message.id, error: error.message }); }
        return;
      }
      if (message.type === "shown" || message.type === "notes" || message.type === "error" || message.type === "started") { this.last.set(`${id}:${message.type}`, message); if (message.type === "error") this.log?.appendLine(`reader: ${message.message}`); return; }
      if (message.type === "record" || message.type === "references") {
        const record = await this.ask("novel/record", { id, entity: message.entity });
        if (record) await (message.type === "record" ? this.actions.record(record.uri) : this.actions.references(record.uri));
        return;
      }
      if (message.type === "show") { const where = await this.ask("novel/locate", { id, sentence: message.sentence }); if (where) await this.actions.open(where.uri, where.range, vscode.ViewColumn.Beside); }
    }, undefined, this.context.subscriptions);
    panel.onDidDispose(() => this.panels.delete(id), undefined, this.context.subscriptions);
    this.panels.set(id, panel);
    return panel;
  }
}

/** The file id of the book a document is, from the tree (a virtual document carries it in its path). */
const bookIdOf = (uri, tree) => {
  if (uri.scheme === "novel") return uri.path.split("/")[2] || null;
  const text = uri.toString(), books = tree ? [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted] : [];
  return books.find((book) => book.uri === text)?.id ?? null;
};

async function activate(context) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return {};
  const settings = vscode.workspace.getConfiguration("novel"), log = vscode.window.createOutputChannel("Novel Workbench");
  const serverPath = settings.get("serverPath") || path.join(__dirname, "..", "..", "dist", "src", "server", "server.js");
  if (!fs.existsSync(serverPath)) { log.appendLine(`No language server at ${serverPath}. Build the repository (npm run build) or set novel.serverPath.`); vscode.window.showWarningMessage("Novel Workbench: the language server is not built. See the Novel Workbench output."); return {}; }
  const client = new Client(serverPath, folder, settings.get("nodePath") || "", log);
  await client.request("initialize", { processId: process.pid, rootUri: vscode.Uri.file(folder).toString(), capabilities: {}, initializationOptions: { folder } });
  client.notify("initialized");

  const books = new BooksTree(client), cast = new CastTree(client), problems = vscode.languages.createDiagnosticCollection("novel");
  const booksView = vscode.window.createTreeView("novel.books", { treeDataProvider: books, showCollapseAll: true });
  const text = new vscode.EventEmitter(), hints = new vscode.EventEmitter();
  const selector = [{ scheme: "novel" }, { scheme: "file", language: "plaintext" }, { scheme: "file", language: "markdown" }];
  const ask = (method, params) => client.request(method, params).catch((error) => { log.appendLine(`${method}: ${error.message}`); return null; });

  const diagnose = async (document) => {
    if (document.uri.scheme !== "novel" && document.uri.scheme !== "file") return;
    const found = await ask("novel/problems", { uri: document.uri.toString() });
    problems.set(document.uri, (found || []).map((entry) => { const diagnostic = new vscode.Diagnostic(toRange(entry.range), entry.message, entry.severity === 2 ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information); diagnostic.code = entry.code; diagnostic.source = entry.source; return diagnostic; }));
  };
  const follow = async (editor) => { if (editor) cast.show(bookIdOf(editor.document.uri, await books.load())); };
  const refresh = async () => {
    books.refresh(); cast.refresh(); hints.fire();
    for (const document of vscode.workspace.textDocuments) { if (document.uri.scheme === "novel") text.fire(document.uri); await diagnose(document); }
  };
  let scanning = null;
  const scan = () => (scanning ??= ask("novel/scan").finally(() => { scanning = null; }).then(async (report) => { await refresh(); return report; }));

  const open = async (uri, range, column) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const editor = await vscode.window.showTextDocument(document, { preview: true, ...(column ? { viewColumn: column } : {}) });
    if (range) { const where = toRange(range); editor.selection = new vscode.Selection(where.start, column ? where.end : where.start); editor.revealRange(where, column ? vscode.TextEditorRevealType.InCenter : vscode.TextEditorRevealType.AtTop); }
  };
  const record = async (uri) => { await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.parse(uri)).then(undefined, () => open(uri)); };
  const references = async (uri) => {
    const found = await ask("textDocument/references", { textDocument: { uri }, position: { line: 0, character: 0 }, context: { includeDeclaration: true } });
    if (found?.length) await vscode.commands.executeCommand("editor.action.showReferences", vscode.Uri.parse(found[0].uri), toRange(found[0].range).start, found.map(toLocation));
  };
  const readers = new Readers(context, client, ask, { open, record, references }, log);
  // Read: a book from the tree, a chapter or scene from where it starts, or the book in the editor from the cursor.
  const read = async (node) => {
    let id = null, title = "", from = null;
    if (node?.type === "book") { id = node.book.id; title = node.book.title; }
    else if (node?.type === "part") {
      let book = node.parent; while (book && book.type !== "book") book = book.parent;
      id = book?.book.id; title = book?.book.title ?? "";
      from = (await ask("novel/sentenceAt", { textDocument: { uri: node.uri }, position: node.part.range.start }))?.sentence ?? null;
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showInformationMessage("Pick a book in the Books view to read it."); return null; }
      const here = await ask("novel/sentenceAt", at(editor.document, editor.selection.active));
      if (!here) { vscode.window.showInformationMessage("This document is not a book of the folder."); return null; }
      id = here.id; from = here.sentence;
      const tree = await books.load(); title = [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted].find((book) => book.id === id)?.title ?? "";
    }
    return id ? readers.open(id, title, from) : null;
  };

  // The model keys, kept in the Mac's secure store by the language server (never shown again, never in settings).
  const keys = async () => (await ask("novel/keys")) || {};
  const enterKeys = async () => {
    const now = await keys();
    for (const [which, label] of [["jev", "Jev (TypeSafe)"], ["work", "the work model (DeepSeek)"]]) {
      const value = await vscode.window.showInputBox({ title: `API key for ${label}`, prompt: now[which] ? `A key is set (${now[which]}). Enter a new one to replace it, or leave this empty to keep it.` : "Enter the key. It is kept in this Mac's secure store, not in the editor's settings.", password: true, ignoreFocusOut: true });
      if (value === undefined) return keys();
      if (value.trim()) await client.request("novel/setKey", { which, value }).catch((error) => vscode.window.showErrorMessage(error.message));
    }
    const after = await keys();
    vscode.window.setStatusBarMessage(`Novel keys: Jev ${after.jev ? "set" : "missing"}, work model ${after.work ? "set" : "missing"}`, 6000);
    return after;
  };
  // One click: the book's reading runs on the Mac in a process of its own; this follows it until it ends.
  const following = new Set();
  const followReading = (id, title) => {
    if (following.has(id)) return;
    following.add(id);
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Reading ${title}`, cancellable: true }, async (progress, cancel) => {
      cancel.onCancellationRequested(() => ask("novel/stopReading", { id }));
      let seen = -1, last = null;
      for (;;) {
        last = await ask("novel/reading", { id });
        if (!last || last.state !== "running") break;
        if (last.steps.length !== seen) { progress.report({ message: `${last.now ?? "starting"} · ${last.steps.length} steps done · about $${last.estimate}`, increment: seen >= 0 && last.steps.length > seen ? 6 : 0 }); seen = last.steps.length; books.refresh(); }
        await new Promise((done) => setTimeout(done, 2000));
      }
      following.delete(id);
      await refresh();
      if (last?.state === "done") {
        const pick = await vscode.window.showInformationMessage(`${title} is read: ${last.steps.length} steps${last.paid ? `, ${last.paid.jev} Jev and ${last.paid.work} work-model requests asked` : ""}.`, "Read");
        if (pick === "Read") readers.open(id, title, null);
      } else if (last?.state === "failed") vscode.window.showErrorMessage(`The reading of ${title} failed: ${last.error ?? `see .novel/books/${id}/reading.log`}`);
      else if (last?.state === "stopped") vscode.window.showInformationMessage(`The reading of ${title} was stopped. Starting it again pays only for what it had not asked.`);
    });
  };
  const runReading = async (node) => {
    const book = node?.book;
    if (!book) { vscode.window.showInformationMessage("Pick a book in the Books view to read it."); return null; }
    let now = await keys();
    if (!now.jev || !now.work) {
      now = (await enterKeys()) || {};
      if (!now.jev || !now.work) { vscode.window.showWarningMessage("The reading needs both keys: Jev's and the work model's."); return null; }
    }
    const started = await client.request("novel/startReading", { id: book.id }).catch((error) => { vscode.window.showErrorMessage(error.message); return null; });
    if (started) { books.refresh(); followReading(book.id, book.title); }
    return started;
  };

  context.subscriptions.push(
    log, problems, { dispose: () => client.stop() },
    booksView,
    vscode.window.registerTreeDataProvider("novel.cast", cast),
    vscode.workspace.registerTextDocumentContentProvider("novel", { onDidChange: text.event, provideTextDocumentContent: async (uri) => (await ask("novel/document", { uri: uri.toString() }))?.text ?? "" }),
    vscode.commands.registerCommand("novel.scan", async () => { const report = await scan(); if (report) vscode.window.setStatusBarMessage(`Novels: ${report.files} files, ${report.unsorted} unsorted`, 5000); return report; }),
    vscode.commands.registerCommand("novel.open", open),
    vscode.commands.registerCommand("novel.showRecord", record),
    vscode.commands.registerCommand("novel.findReferences", (node) => references(node.symbol.uri)),
    vscode.commands.registerCommand("novel.read", read),
    vscode.commands.registerCommand("novel.enterKeys", enterKeys),
    vscode.commands.registerCommand("novel.runReading", runReading),
    vscode.commands.registerCommand("novel.stopReading", (node) => node?.book && ask("novel/stopReading", { id: node.book.id }).then(refresh)),
    vscode.commands.registerCommand("novel.openFile", (node) => node?.book?.fileUri && vscode.commands.executeCommand("revealInExplorer", vscode.Uri.parse(node.book.fileUri))),
    vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols: async (document) => {
      const shape = (node) => { const symbol = new vscode.DocumentSymbol(node.name, node.detail || "", symbolKind(node.kind), toRange(node.range), toRange(node.selectionRange)); symbol.children = (node.children || []).map(shape); return symbol; };
      return ((await ask("textDocument/documentSymbol", { textDocument: { uri: document.uri.toString() } })) || []).map(shape);
    } }),
    vscode.languages.registerFoldingRangeProvider(selector, { provideFoldingRanges: async (document) => ((await ask("textDocument/foldingRange", { textDocument: { uri: document.uri.toString() } })) || []).map((range) => new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region)) }),
    vscode.languages.registerHoverProvider(selector, { provideHover: async (document, position) => { const hover = await ask("textDocument/hover", at(document, position)); return hover ? new vscode.Hover(new vscode.MarkdownString(hover.contents.value), toRange(hover.range)) : null; } }),
    vscode.languages.registerDefinitionProvider(selector, { provideDefinition: async (document, position) => { const found = await ask("textDocument/definition", at(document, position)); return found ? toLocation(found) : null; } }),
    vscode.languages.registerDeclarationProvider(selector, { provideDeclaration: async (document, position) => { const found = await ask("textDocument/declaration", at(document, position)); return found ? toLocation(found) : null; } }),
    vscode.languages.registerReferenceProvider(selector, { provideReferences: async (document, position) => ((await ask("textDocument/references", { ...at(document, position), context: { includeDeclaration: true } })) || []).map(toLocation) }),
    vscode.languages.registerWorkspaceSymbolProvider({ provideWorkspaceSymbols: async (query) => ((await ask("workspace/symbol", { query })) || []).map((symbol) => new vscode.SymbolInformation(symbol.name, symbolKind(symbol.kind), symbol.containerName, toLocation(symbol.location))) }),
    vscode.languages.registerInlayHintsProvider(selector, { onDidChangeInlayHints: hints.event, provideInlayHints: async (document, range) => ((await ask("textDocument/inlayHint", { textDocument: { uri: document.uri.toString() }, range: { start: { line: range.start.line, character: range.start.character }, end: { line: range.end.line, character: range.end.character } } })) || []).map((hint) => { const made = new vscode.InlayHint(new vscode.Position(hint.position.line, hint.position.character), hint.label, vscode.InlayHintKind.Type); made.paddingRight = true; made.tooltip = hint.tooltip; return made; }) }),
    vscode.workspace.onDidOpenTextDocument(diagnose),
    vscode.workspace.onDidCloseTextDocument((document) => problems.delete(document.uri)),
    vscode.window.onDidChangeActiveTextEditor(follow),
  );

  // What changes under the editor: an agent's command rewrites the state; a book is added, moved or removed.
  const state = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, ".novel/workspace.json"));
  const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*.{epub,txt,md}"));
  let later = null;
  const soon = (run) => { clearTimeout(later); later = setTimeout(run, 400); };
  state.onDidChange(() => soon(refresh)); state.onDidCreate(() => soon(refresh)); state.onDidDelete(() => soon(refresh));
  files.onDidCreate(() => soon(scan)); files.onDidDelete(() => soon(scan)); files.onDidChange(() => soon(scan));
  context.subscriptions.push(state, files);

  if (settings.get("scanOnOpen")) {
    const known = fs.existsSync(path.join(folder, ".novel", "workspace.json")) || (await vscode.workspace.findFiles("**/*.epub", null, 1)).length > 0;
    if (known) await scan();
  }
  for (const document of vscode.workspace.textDocuments) await diagnose(document);
  await follow(vscode.window.activeTextEditor);
  // A reading already running (started from a terminal, or before the editor reconnected) is followed too.
  const tree = await books.load();
  for (const book of [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted]) if (book.job?.state === "running") followReading(book.id, book.title);
  return { client, books, booksView, cast, scan, refresh, read, readers, enterKeys, runReading };
}

function deactivate() {}
module.exports = { activate, deactivate };
