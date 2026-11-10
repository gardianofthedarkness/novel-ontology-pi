// The Novel Workbench: the opened folder as a workspace of novels (docs/v3/workspace.md). A thin shell over the novel
// language server: it starts the server, shows its tree in the explorer, and hands the editor's questions (outline, hover,
// definition, references, problems) to it. No dependency: the client side of the protocol is the few lines below.
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
      item.description = book.missing ? "missing" : book.unread ? "not readable" : [book.reading ? `${book.symbols} entries` : "no reading", book.problems ? `${book.problems} ${book.problems === 1 ? "problem" : "problems"}` : ""].filter(Boolean).join(" · ");
      item.iconPath = new vscode.ThemeIcon(book.missing ? "warning" : book.reading ? "book" : "file-text"); item.tooltip = `${book.path}\n${book.chars.toLocaleString()} characters, ${book.chapters} chapters`; item.contextValue = "book";
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
  const serverPath = settings.get("serverPath") || path.join(__dirname, "..", "..", "dist", "src", "v3", "server.js");
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

  const open = async (uri, range) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (range) { const where = toRange(range); editor.selection = new vscode.Selection(where.start, where.start); editor.revealRange(where, vscode.TextEditorRevealType.AtTop); }
  };

  context.subscriptions.push(
    log, problems, { dispose: () => client.stop() },
    booksView,
    vscode.window.registerTreeDataProvider("novel.cast", cast),
    vscode.workspace.registerTextDocumentContentProvider("novel", { onDidChange: text.event, provideTextDocumentContent: async (uri) => (await ask("novel/document", { uri: uri.toString() }))?.text ?? "" }),
    vscode.commands.registerCommand("novel.scan", async () => { const report = await scan(); if (report) vscode.window.setStatusBarMessage(`Novels: ${report.files} files, ${report.unsorted} unsorted`, 5000); return report; }),
    vscode.commands.registerCommand("novel.open", open),
    vscode.commands.registerCommand("novel.showRecord", async (uri) => { await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.parse(uri)).then(undefined, () => open(uri)); }),
    vscode.commands.registerCommand("novel.findReferences", async (node) => {
      const uri = vscode.Uri.parse(node.symbol.uri), found = await ask("textDocument/references", { textDocument: { uri: uri.toString() }, position: { line: 0, character: 0 }, context: { includeDeclaration: true } });
      if (found?.length) await vscode.commands.executeCommand("editor.action.showReferences", vscode.Uri.parse(found[0].uri), toRange(found[0].range).start, found.map(toLocation));
    }),
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
  return { client, books, booksView, cast, scan, refresh };
}

function deactivate() {}
module.exports = { activate, deactivate };
