/**
 * The novel language server (docs/v3/design.html#workspace): the opened folder's books answered as an editor asks about source.
 * It speaks the Language Server Protocol over stdio (JSON-RPC with Content-Length frames, written here: no dependency),
 * so any editor's client can use it, and a few requests of its own for the explorer (`novel/tree`, `novel/book`,
 * `novel/document`, `novel/scan`, `novel/cast`, and the reader's `novel/read`, `novel/readDocument`, `novel/readLine`, `novel/readPortrait`, `novel/record`,
 * `novel/locate`, `novel/sentenceAt`).
 *
 * Documents: a text file that is a book as it stands is served at its own file URI; an EPUB, or a book shown as a linked
 * reading's stored source, is a virtual document `novel:/book/<file id>/<title>.txt`; an entity's record (its definition)
 * is `novel:/entity/<file id>/<entity id>/<label>.md`. Read-only.
 */
import { copyWorld, findWorlds } from "./worlds.js";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordOf, type OutlineNode, type Span } from "../library/book.js";
import { folderTree, importFiles, scanFolder } from "../library/folder.js";
import { basicStep, readBasic, seriesSuggestions } from "../library/basic.js";
import { putBook, universeAdd } from "../library/folder.js";
import { readerBook, readerDocument, readerLine, readerPortrait } from "./reader.js";
import { keyStatus, readingStatus, setKey, startReading, stopReading } from "./reading.js";
import { worldView } from "./world.js";
import { NovelWorkspace, type OpenBook } from "../library/workspace.js";

type Json = Record<string, unknown>;
interface Position { line: number; character: number }
interface Range { start: Position; end: Position }

const SCHEME = "novel";
const safe = (name: string) => encodeURIComponent(name.replace(/[\/\\:]/g, " ").trim() || "book");
export const bookUri = (folder: string, open: OpenBook): string => (open.book.from === "file" ? pathToFileURL(join(folder, open.book.path)).href : `${SCHEME}:/book/${open.book.id}/${safe(open.book.title)}.txt`);
export const entityUri = (open: OpenBook, entity: string, label: string): string => `${SCHEME}:/entity/${open.book.id}/${encodeURIComponent(entity)}/${safe(label)}.md`;

/** Symbol kinds of the protocol, by what a novel's symbol is. */
const KIND = { chapter: 3, scene: 24, part: 24, card: 12, person: 5, place: 2, thing: 13, concept: 11 } as const;
const kindOf = (category: string): number => (KIND as Record<string, number>)[category] ?? 13;

export class NovelServer {
  workspace: NovelWorkspace | null = null;
  constructor(folder?: string) { if (folder) this.workspace = new NovelWorkspace(folder); }
  private get ws(): NovelWorkspace { if (!this.workspace) throw new Error("No folder is open."); return this.workspace; }

  /** The book a document is, and for a record the entity it describes. */
  async resolve(uri: string): Promise<{ open: OpenBook; entity: string | null } | null> {
    if (uri.startsWith(`${SCHEME}:`)) {
      const [, kind, id, entity] = decodeURI(uri.slice(SCHEME.length + 1)).split("/");
      if (kind !== "book" && kind !== "entity") return null;
      const open = await this.ws.book(id).catch(() => null);
      return open ? { open, entity: kind === "entity" ? decodeURIComponent(entity ?? "") : null } : null;
    }
    if (!uri.startsWith("file:")) return null;
    const path = fileURLToPath(uri), folder = this.ws.folder;
    if (!path.startsWith(`${folder}/`)) return null;
    const open = await this.ws.book(path.slice(folder.length + 1)).catch(() => null);
    return open && open.book.from === "file" ? { open, entity: null } : null;
  }
  private range(open: OpenBook, span: Span): Range { return { start: open.lines.position(span.start), end: open.lines.position(span.end) }; }
  private location(open: OpenBook, span: Span): Json { return { uri: bookUri(this.ws.folder, open), range: this.range(open, span) }; }
  private async here(params: Json): Promise<{ open: OpenBook; offset: number } | null> {
    const found = await this.resolve((params.textDocument as { uri: string }).uri);
    if (!found || found.entity !== null) return null;
    return { open: found.open, offset: found.open.lines.offset(params.position as Position) };
  }

  async handle(method: string, params: Json = {}): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const folders = params.workspaceFolders as { uri: string }[] | null | undefined, root = (params.initializationOptions as { folder?: string } | undefined)?.folder ?? (folders?.[0]?.uri ? fileURLToPath(folders[0].uri) : typeof params.rootUri === "string" ? fileURLToPath(params.rootUri) : null);
        if (root) this.workspace = new NovelWorkspace(root);
        return { serverInfo: { name: "novel-language-server", version: "0.3.0" }, capabilities: { positionEncoding: "utf-16", textDocumentSync: { openClose: true, change: 0 }, documentSymbolProvider: true, definitionProvider: true, declarationProvider: true, referencesProvider: true, hoverProvider: true, workspaceSymbolProvider: true, foldingRangeProvider: true, inlayHintProvider: true } };
      }
      case "initialized": case "textDocument/didChange": case "textDocument/didClose": case "$/cancelRequest": case "$/setTrace": case "workspace/didChangeConfiguration": case "workspace/didChangeWatchedFiles": return null;
      case "shutdown": return null;
      case "novel/scan": return scanFolder(this.ws.folder, Array.isArray(params.found) ? { found: params.found as ("epub" | "text")[] } : {});
      // The basic layer (docs/v3/design.html#basic): a few books at a time, so the server answers between them; a book's own;
      // series among the books not arranged; a series made a universe, its books in volume order; text files imported.
      case "novel/basicStep": return basicStep(this.ws.folder, Number(params.most ?? 3));
      case "novel/basic": { const state = await this.ws.current(); const file = state.files.find((entry) => entry.id === params.id || entry.path === params.id); return file ? readBasic(this.ws.folder, file.id) : null; }
      case "novel/series": return seriesSuggestions(this.ws.folder);
      case "novel/worlds": return findWorlds(this.ws.folder);
      case "novel/copyWorld": return copyWorld(this.ws.folder, String(params.root ?? ""));
      case "novel/arrange": {
        const name = String(params.name ?? "").trim(), files = (params.files as string[] | undefined) ?? [];
        if (!name || !files.length) throw new Error("A universe needs a name and its books.");
        const state = await this.ws.current(), existing = state.universes.find((universe) => universe.name === name);
        const id = existing?.id ?? (await universeAdd(this.ws.folder, name, { why: "a series found by its titles (the basic layer)" }) as { universe: string }).universe;
        for (const file of files) await putBook(this.ws.folder, file, id);
        return { universe: id, books: files.length };
      }
      case "novel/import": return importFiles(this.ws.folder, (params.paths as string[] | undefined) ?? []);
      case "novel/tree": return this.tree();
      case "novel/book": return this.bookTree(String(params.id));
      case "novel/cast": return this.castOf(String(params.id), params as { query?: string; category?: string; limit?: number });
      case "novel/document": return this.document(String(params.uri));
      case "novel/problems": return this.diagnostics(String(params.uri));
      // The reader (docs/v3/design.html#reader): the book as published with the reading's marks, a document of its EPUB, every
      // record of one sentence; where a sentence stands in the book's document, and the sentence at a place in it.
      case "novel/read": return readerBook(this.ws, String(params.id));
      case "novel/readDocument": return readerDocument(this.ws, String(params.id), Number(params.item));
      case "novel/readLine": return readerLine(this.ws, String(params.id), String(params.sentence));
      // One-click readings (docs/v3/design.html#readings): the keys' state (never a value), a key kept, a book's reading started,
      // where it stands, stopped.
      case "novel/keys": return keyStatus();
      case "novel/setKey": return setKey(String(params.which), String(params.value ?? ""));
      case "novel/startReading": return startReading(this.ws.folder, String(params.id));
      case "novel/reading": return readingStatus(this.ws.folder, String(params.id));
      case "novel/stopReading": return stopReading(this.ws.folder, String(params.id));
      // For a console's panels: every line that refers to an entry (across the universe), a book's problems.
      case "novel/refs": return this.ws.refs(String(params.id), String(params.entity), { limit: Number(params.limit ?? 200), from: Number(params.from ?? 0), universe: params.universe !== false });
      case "novel/world": return worldView(this.ws, String(params.id));
      // Words in a book's lines, and the names of its people, places and things that hold them (the console's Search).
      case "novel/search": {
        const open = await this.ws.book(String(params.id)), index = open.index, needle = String(params.query ?? "").trim().toLowerCase(), limit = Math.min(500, Number(params.limit ?? 200));
        if (!needle || !index) return { query: needle, total: 0, lines: [], names: [] };
        const hits = index.lines.filter((line) => line.text.toLowerCase().includes(needle));
        const title = (chapter: number) => open.book.chapters[chapter]?.title ?? (chapter === 0 ? "Front matter" : `Section ${chapter + 1}`);
        const names = index.symbols.filter((symbol) => symbol.names.some((name) => name.toLowerCase().includes(needle))).map((symbol) => ({ id: symbol.id, label: symbol.label, category: symbol.category, unnamed: symbol.unnamed, references: index.references(symbol.id).length })).sort((a, b) => b.references - a.references).slice(0, 40);
        return { query: needle, total: hits.length, names, lines: hits.slice(0, limit).map((line) => ({ line: line.id, text: line.text, chapterTitle: title(line.chapter), scene: line.scene + 1 })) };
      }
      case "novel/bookProblems": return this.ws.problems(String(params.id), { limit: Number(params.limit ?? 500) });
      case "novel/record": {
        const open = await this.ws.book(String(params.id)), symbol = open.index?.symbol(String(params.entity));
        return symbol ? { uri: entityUri(open, symbol.id, symbol.label), label: symbol.label } : null;
      }
      case "novel/readPortrait": return readerPortrait(this.ws, String(params.id), String(params.entity));
      case "novel/locate": {
        const open = await this.ws.book(String(params.id)), line = open.index?.line(String(params.sentence));
        return line ? this.location(open, line) : null;
      }
      case "novel/sentenceAt": {
        const here = await this.here(params);
        const line = here?.open.index?.lineAt(here.offset) ?? (here ? here.open.index?.lines.find((entry) => entry.start >= here.offset) : undefined);
        return here ? { id: here.open.book.id, sentence: line?.id ?? null } : null;
      }
      case "textDocument/didOpen": return null;
      case "textDocument/documentSymbol": {
        const found = await this.resolve((params.textDocument as { uri: string }).uri);
        if (!found || found.entity !== null) return [];
        const shape = (node: OutlineNode): Json => { const range = this.range(found.open, node); return { name: node.label, ...(node.detail ? { detail: node.detail } : {}), kind: KIND[node.kind], range, selectionRange: { start: range.start, end: range.start }, children: node.children.map(shape) }; };
        return found.open.outline.map(shape);
      }
      case "textDocument/foldingRange": {
        const found = await this.resolve((params.textDocument as { uri: string }).uri);
        if (!found || found.entity !== null) return [];
        const out: Json[] = [], add = (node: OutlineNode) => { const range = this.range(found.open, node); if (range.end.line > range.start.line && node.kind !== "card") out.push({ startLine: range.start.line, endLine: range.end.line, kind: "region" }); node.children.forEach(add); };
        found.open.outline.forEach(add);
        return out;
      }
      case "textDocument/hover": {
        const at = await this.here(params), index = at?.open.index;
        if (!at || !index) return null;
        const references = index.at(at.offset);
        if (!references.length) return null;
        const parts = references.slice(0, 3).map((reference) => {
          const symbol = index.symbol(reference.entity)!, counts = index.counts(symbol.id), total = index.references(symbol.id).length;
          const sure = reference.confidence !== undefined ? ` · confidence ${reference.confidence.toFixed(2)}` : "";
          const here = reference.how.includes("text") ? "named here (the reading did not list this line)" : `here: ${reference.how.join(", ")}${reference.via ? ` (through “${reference.via}”)` : ""}${sure}${reference.settled ? "" : " · a guess the reading did not settle"}`;
          return [`**${symbol.label}** · ${symbol.unnamed ? "unnamed " : ""}${symbol.category}${symbol.type !== symbol.category ? ` (${symbol.type})` : ""}`, symbol.names.length > 1 ? `also ${symbol.names.slice(1, 5).join(", ")}` : "", here, `${total} lines in this book: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([how, count]) => `${how} ${count}`).join(", ")}`].filter(Boolean).join("  \n");
        });
        return { contents: { kind: "markdown", value: parts.join("\n\n---\n\n") }, range: this.range(at.open, references[0]) };
      }
      case "textDocument/definition": {
        const at = await this.here(params), reference = at?.open.index?.at(at.offset)[0];
        if (!at || !reference) return null;
        return { uri: entityUri(at.open, reference.entity, at.open.index!.symbol(reference.entity)!.label), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
      }
      case "textDocument/declaration": {
        const at = await this.here(params), index = at?.open.index, reference = index?.at(at!.offset)[0];
        if (!at || !index || !reference) return null;
        const symbol = index.symbol(reference.entity)!, first = index.references(symbol.id).find((entry) => entry.sentence === symbol.first) ?? index.references(symbol.id)[0];
        return first ? this.location(at.open, first) : null;
      }
      case "textDocument/references": {
        // From a line of the book, or from an entity's record.
        const found = await this.resolve((params.textDocument as { uri: string }).uri);
        if (!found?.open.index) return [];
        const entity = found.entity ?? found.open.index.at(found.open.lines.offset(params.position as Position))[0]?.entity, symbol = entity ? found.open.index.symbol(entity) : undefined;
        if (!symbol) return [];
        const out: Json[] = [];
        for (const other of await this.ws.readBooks(found.open.universe)) {
          const twin = other.book.id === found.open.book.id ? symbol : this.ws.twin(symbol, other);
          if (twin) for (const reference of other.index!.references(twin.id)) out.push(this.location(other, reference));
        }
        return out;
      }
      case "workspace/symbol": {
        const query = String(params.query ?? "").trim(), out: Json[] = [];
        for (const open of await this.ws.readBooks(null)) for (const symbol of open.index!.symbols) {
          if (query && !symbol.names.some((name) => name.includes(query)) && symbol.id !== query) continue;
          if (!query && symbol.unnamed) continue;
          out.push({ name: symbol.label, kind: kindOf(symbol.category), containerName: open.book.title, location: { uri: entityUri(open, symbol.id, symbol.label), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }, references: open.index!.references(symbol.id).length });
        }
        return out.sort((a, b) => (b.references as number) - (a.references as number)).slice(0, 200);
      }
      case "textDocument/inlayHint": {
        const found = await this.resolve((params.textDocument as { uri: string }).uri), index = found?.open.index;
        if (!found || !index || found.entity !== null) return [];
        const range = params.range as Range | undefined, from = range ? found.open.lines.offset(range.start) : 0, to = range ? found.open.lines.offset(range.end) : found.open.book.text.length;
        return index.speakers.filter((speaker) => speaker.start >= from && speaker.start <= to).map((speaker) => ({ position: found.open.lines.position(speaker.start), label: `${speaker.label}${speaker.settled ? "" : "?"}:`, kind: 1, paddingRight: true, tooltip: `${speaker.settled ? "Said by" : "Perhaps said by"} ${speaker.label} · confidence ${speaker.confidence.toFixed(2)}${speaker.via ? ` · through “${speaker.via}”` : ""}` }));
      }
      default: throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  async tree(): Promise<Json> {
    const tree = await folderTree(this.ws.folder) as { universes: { books: Json[] }[]; unsorted: Json[] };
    const state = await this.ws.current(), byId = new Map(state.files.map((file) => [file.id, file]));
    const dress = async (entry: Json) => {
      const open = entry.missing || entry.unread || !entry.reading ? null : await this.ws.book(String(entry.id)).catch(() => null), file = byId.get(String(entry.id));
      entry.uri = open ? bookUri(this.ws.folder, open) : file && !file.missing && !file.unread ? (file.kind === "epub" ? `${SCHEME}:/book/${file.id}/${safe(String(entry.title ?? file.title))}.txt` : pathToFileURL(join(this.ws.folder, file.path)).href) : null;
      entry.fileUri = file && !file.missing ? pathToFileURL(join(this.ws.folder, file.path)).href : null;
      entry.problems = open?.index?.problems.length ?? 0;
      const basic = await readBasic(this.ws.folder, String(entry.id)) as (Awaited<ReturnType<typeof readBasic>> & { failed?: string }) | null;
      entry.basic = basic ? (basic.failed ? { failed: basic.failed } : { author: basic.author, language: basic.language, series: basic.series, volume: basic.volume, chapters: basic.chapters, lines: basic.lines, spoken: basic.lines ? Math.round((basic.spoken / basic.lines) * 100) : 0, pictures: basic.pictures, names: basic.names.slice(0, 8).map((name) => name.name) }) : null;
      entry.symbols = open?.index?.symbols.filter((symbol) => !symbol.unnamed).length ?? 0;
      const job = entry.missing ? null : await readingStatus(this.ws.folder, String(entry.id)).catch(() => null);
      entry.job = job ? { state: job.state, now: job.now ?? null, steps: job.steps.length, estimate: job.estimate, error: job.error ?? null } : null;
    };
    for (const universe of tree.universes) for (const book of universe.books) await dress(book);
    for (const file of tree.unsorted) await dress(file);
    return tree as unknown as Json;
  }
  async bookTree(id: string): Promise<Json> {
    const open = await this.ws.book(id), shape = (node: OutlineNode): Json => ({ kind: node.kind, id: node.id, label: node.label, ...(node.detail ? { detail: node.detail } : {}), range: this.range(open, node), children: node.children.map(shape) });
    return { id: open.book.id, title: open.book.title, uri: bookUri(this.ws.folder, open), reading: Boolean(open.index), chapters: open.outline.map(shape) };
  }
  async castOf(id: string, options: { query?: string; category?: string; limit?: number }): Promise<Json> {
    const open = await this.ws.book(id), cast = await this.ws.cast(id, options) as { symbols: Json[] };
    for (const symbol of cast.symbols) symbol.uri = entityUri(open, String(symbol.id), String(symbol.label));
    return cast as unknown as Json;
  }
  async document(uri: string): Promise<Json> {
    const found = await this.resolve(uri);
    if (!found) throw new Error(`No book of this folder is ${uri}.`);
    if (found.entity === null) return { uri, languageId: "novel", text: found.open.book.text };
    if (!found.open.index) throw new Error(`${found.open.book.path} has no reading linked.`);
    const symbol = found.open.index.symbol(found.entity), others: { book: string; title: string; references: number }[] = [];
    if (symbol) for (const other of await this.ws.readBooks(found.open.universe)) { if (other.book.id === found.open.book.id) continue; const twin = this.ws.twin(symbol, other); if (twin) others.push({ book: other.book.path, title: other.book.title, references: other.index!.references(twin.id).length }); }
    return { uri, languageId: "markdown", text: recordOf(found.open.index, found.entity, others) };
  }
  async diagnostics(uri: string): Promise<Json[]> {
    const found = await this.resolve(uri);
    if (!found?.open.index || found.entity !== null) return [];
    return found.open.index.problems.map((problem) => ({ range: this.range(found.open, problem), severity: problem.severity === "warning" ? 2 : 3, code: problem.code, source: "novel", message: problem.message }));
  }
}

/** The server on a pair of streams: Content-Length frames in, frames out. */
export function serve(server: NovelServer, input: NodeJS.ReadableStream, output: NodeJS.WritableStream, done: (code: number) => void = () => {}): void {
  let pending = Buffer.alloc(0), stopping = false, queue: Promise<void> = Promise.resolve();
  const send = (message: Json) => { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8"); output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body])); };
  const take = async (message: { id?: number | string; method?: string; params?: Json }) => {
    if (!message.method) return;
    if (message.method === "exit") { done(stopping ? 0 : 1); return; }
    if (message.method === "shutdown") stopping = true;
    try {
      const result = await server.handle(message.method, message.params ?? {});
      if (message.id !== undefined) send({ id: message.id, result: result ?? null });
      if (message.method === "textDocument/didOpen") { const uri = (message.params?.textDocument as { uri: string }).uri; send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: await server.diagnostics(uri) } }); }
    } catch (error) {
      const failure = error as Error & { code?: number };
      if (message.id !== undefined) send({ id: message.id, error: { code: failure.code ?? -32603, message: failure.message } });
    }
  };
  input.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const head = pending.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(pending.subarray(0, head).toString("ascii"))?.[1] ?? NaN);
      if (!Number.isFinite(length)) { pending = pending.subarray(head + 4); continue; }
      if (pending.length < head + 4 + length) return;
      const body = pending.subarray(head + 4, head + 4 + length).toString("utf8");
      pending = pending.subarray(head + 4 + length);
      let message: { id?: number | string; method?: string; params?: Json };
      try { message = JSON.parse(body); } catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      queue = queue.then(() => take(message));
    }
  });
  input.on("end", () => done(stopping ? 0 : 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv.find((value, index) => index > 1 && !value.startsWith("--"));
  serve(new NovelServer(folder), process.stdin, process.stdout, (code) => process.exit(code));
}
