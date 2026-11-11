/**
 * The opened folder's books, loaded once and kept until the state or a reading changes: what the language server and the
 * `novel folder` commands both answer from (docs/v3/design.html#workspace).
 */
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { blockSizeOf, indexBook, linesOf, loadReading, plainOutline, recordOf, type BookIndex, type OutlineNode, type Reference, type Symbol_ } from "./book.js";
import { STATE_DIR, STATE_FILE, bookText, findFile, loadState, noName, noReading, type BookText, type FolderState } from "./folder.js";

export interface OpenBook { book: BookText; index: BookIndex | null; reading: unknown | null; outline: OutlineNode[]; lines: ReturnType<typeof linesOf>; universe: string | null }
const stamp = (path: string) => stat(path).then((info) => info.mtimeMs, () => 0);

export class NovelWorkspace {
  readonly folder: string;
  private state: FolderState | null = null;
  private stateStamp = -1;
  private readonly open = new Map<string, { stamp: number; value: OpenBook }>();
  constructor(folder: string) { this.folder = resolve(folder); }

  /** The state as it is on disk now (an agent's command in a terminal changes it under the server). */
  async current(): Promise<FolderState> {
    const now = await stamp(join(this.folder, STATE_DIR, STATE_FILE));
    if (!this.state || now !== this.stateStamp) { this.state = await loadState(this.folder); this.stateStamp = now; this.open.clear(); }
    return this.state;
  }
  universeOf(state: FolderState, id: string): string | null { return state.universes.find((universe) => universe.books.some((book) => book.file === id))?.id ?? null; }

  async book(name: string): Promise<OpenBook> {
    const state = await this.current(), file = findFile(state, name);
    const link = state.universes.flatMap((universe) => universe.books).find((book) => book.file === file.id)?.reading;
    const now = link ? await stamp(isAbsolute(link.data) ? link.data : join(this.folder, link.data)) : 0, kept = this.open.get(file.id);
    if (kept && kept.stamp === now) return kept.value;
    const book = await bookText(this.folder, state, file.id), reading = await loadReading(book);
    const index = reading ? indexBook(book, reading, await blockSizeOf(book)) : null;
    const value: OpenBook = { book, index, reading, outline: index?.outline ?? plainOutline(book), lines: linesOf(book.text), universe: this.universeOf(state, file.id) };
    this.open.set(file.id, { stamp: now, value });
    return value;
  }

  /** The books of a universe that have a reading, in the universe's order. */
  async readBooks(universe: string | null): Promise<OpenBook[]> {
    const state = await this.current(), books = state.universes.filter((entry) => universe === null || entry.id === universe).flatMap((entry) => entry.books).filter((book) => book.reading);
    const out: OpenBook[] = [];
    for (const book of books) { const open = await this.book(book.file).catch(() => null); if (open?.index) out.push(open); }
    return out;
  }

  /** A symbol by its id, or by a name (exact first, then the only one holding the words). */
  find(open: OpenBook, name: string): Symbol_ {
    if (!open.index) throw noReading(open.book.path, "cast");
    const symbols = open.index.symbols, exact = symbols.filter((symbol) => symbol.id === name || symbol.names.includes(name));
    const pick = (list: Symbol_[]) => [...list].sort((a, b) => open.index!.references(b.id).length - open.index!.references(a.id).length);
    if (exact.length) return pick(exact)[0];
    const holding = symbols.filter((symbol) => symbol.names.some((own) => own.includes(name)));
    if (holding.length === 1) return holding[0];
    throw noName(holding.length ? `"${name}" fits ${holding.length} entries (${pick(holding).slice(0, 8).map((symbol) => `${symbol.id} ${symbol.label}`).join("; ")}); give the id.` : `Nobody and nothing in ${open.book.title} is called "${name}".`);
  }

  /** The same person or thing in another book of the universe: an entry sharing a name. */
  twin(symbol: Symbol_, other: OpenBook): Symbol_ | null {
    if (symbol.unnamed || !other.index) return null;
    return other.index.symbols.find((entry) => !entry.unnamed && entry.category === symbol.category && (entry.names.includes(symbol.label) || symbol.names.includes(entry.label))) ?? null;
  }

  async cast(name: string, options: { query?: string; category?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
    const open = await this.book(name);
    if (!open.index) return { book: open.book.path, reading: false, symbols: [] };
    const index = open.index, wanted = options.query?.trim();
    const listed = index.symbols.filter((symbol) => (!options.category || symbol.category === options.category) && (!wanted || symbol.id === wanted || symbol.names.some((own) => own.includes(wanted))))
      .map((symbol) => ({ id: symbol.id, label: symbol.label, category: symbol.category, type: symbol.type, ...(symbol.unnamed ? { unnamed: true } : {}), names: symbol.names.slice(0, 6), references: index.references(symbol.id).length }))
      .sort((a, b) => b.references - a.references);
    return { book: open.book.path, title: open.book.title, reading: true, total: listed.length, symbols: listed.slice(0, options.limit ?? 40) };
  }

  /** A chapter's title as the outline shows it (chapters are numbered from 1 in the order of `chapters`). */
  chapterTitle(open: OpenBook, chapter: number): string { return open.outline[chapter]?.label ?? `Chapter ${chapter + 1}`; }
  describe(open: OpenBook, reference: Reference) {
    const index = open.index!, line = index.line(reference.sentence)!, position = open.lines.position(reference.start);
    return { line: reference.sentence, at: `${position.line + 1}:${position.character + 1}`, chapter: line.chapter + 1, chapterTitle: this.chapterTitle(open, line.chapter), scene: line.scene + 1, how: reference.how, ...(reference.confidence !== undefined ? { confidence: reference.confidence } : {}), ...(reference.via ? { via: reference.via } : {}), ...(reference.settled ? {} : { guess: true }), text: line.text };
  }

  async who(name: string, entity: string): Promise<Record<string, unknown>> {
    const open = await this.book(name), symbol = this.find(open, entity), index = open.index!;
    const others = [];
    for (const other of await this.readBooks(open.universe)) { if (other.book.id === open.book.id) continue; const twin = this.twin(symbol, other); if (twin) others.push({ book: other.book.path, title: other.book.title, id: twin.id, references: other.index!.references(twin.id).length }); }
    const references = index.references(symbol.id), first = symbol.first ? index.line(symbol.first) : undefined;
    return { book: open.book.path, id: symbol.id, label: symbol.label, category: symbol.category, type: symbol.type, names: symbol.names, ...(symbol.unnamed ? { unnamed: true } : {}),
      first: first ? { line: first.id, chapter: first.chapter + 1, chapterTitle: this.chapterTitle(open, first.chapter), scene: first.scene + 1, text: first.text } : null,
      ...(references[0] && references[0].sentence !== first?.id ? { firstReference: { line: references[0].sentence, how: references[0].how, note: "an earlier line refers to them before they are named" } } : {}),
      references: references.length, guesses: references.filter((reference) => !reference.settled).length, how: index.counts(symbol.id), otherBooks: others,
      record: recordOf(index, symbol.id, others.map((other) => ({ book: other.book, title: other.title, references: other.references }))) };
  }

  async refs(name: string, entity: string, options: { how?: string; chapter?: number; scene?: number; guesses?: boolean; via?: boolean; limit?: number; from?: number; universe?: boolean } = {}): Promise<Record<string, unknown>> {
    const open = await this.book(name), symbol = this.find(open, entity);
    const books = options.universe ? await this.readBooks(open.universe) : [open], out: Record<string, unknown>[] = [];
    let total = 0;
    for (const other of books) {
      const twin = other.book.id === open.book.id ? symbol : this.twin(symbol, other);
      if (!twin) continue;
      const fitting = other.index!.references(twin.id).filter((reference) => {
        const line = other.index!.line(reference.sentence)!;
        return (!options.how || reference.how.includes(options.how)) && (options.chapter === undefined || line.chapter + 1 === options.chapter) && (options.scene === undefined || line.scene + 1 === options.scene) && (!options.guesses || !reference.settled) && (!options.via || Boolean(reference.via));
      });
      total += fitting.length;
      const from = options.from ?? 0, limit = options.limit ?? 30;
      const shown = fitting.slice(from, from + limit);
      out.push({ book: other.book.path, title: other.book.title, id: twin.id, label: twin.label, references: fitting.length, from, more: Math.max(0, fitting.length - from - shown.length), shown: shown.map((reference) => this.describe(other, reference)) });
    }
    return { entity: symbol.id, label: symbol.label, total, books: out };
  }

  async problems(name: string, options: { limit?: number } = {}): Promise<Record<string, unknown>> {
    const open = await this.book(name);
    if (!open.index) return { book: open.book.path, reading: false, problems: [] };
    const index = open.index, list = index.problems;
    return { book: open.book.path, title: open.book.title, total: list.length, problems: list.slice(0, options.limit ?? 40).map((problem) => { const line = index.lineAt(problem.start), position = open.lines.position(problem.start); return { code: problem.code, at: `${position.line + 1}:${position.character + 1}`, line: line?.id, chapter: (line?.chapter ?? 0) + 1, chapterTitle: this.chapterTitle(open, line?.chapter ?? 0), scene: (line?.scene ?? 0) + 1, entity: problem.entity, message: problem.message, text: line?.text }; }) };
  }

  /** A line with the lines around it, and what the reading says of it: for checking an answer against the text. */
  async lineOf(name: string, id: string, around = 2): Promise<Record<string, unknown>> {
    const open = await this.book(name);
    if (!open.index) throw noReading(open.book.path, "line ids");
    const index = open.index, at = index.lines.findIndex((line) => line.id === id);
    if (at < 0) throw noName(`${open.book.path} has no line ${id}.`);
    const line = index.lines[at], speaker = index.speakers.find((entry) => entry.sentence === id);
    return { book: open.book.path, line: id, chapter: line.chapter + 1, chapterTitle: this.chapterTitle(open, line.chapter), scene: line.scene + 1,
      ...(speaker ? { saidBy: { id: speaker.entity, label: speaker.label, confidence: speaker.confidence, ...(speaker.via ? { via: speaker.via } : {}), ...(speaker.settled ? {} : { guess: true }) } } : {}),
      people: index.symbols.filter((symbol) => index.references(symbol.id).some((reference) => reference.sentence === id)).map((symbol) => ({ id: symbol.id, label: symbol.label, how: index.references(symbol.id).find((reference) => reference.sentence === id)!.how })),
      text: index.lines.slice(Math.max(0, at - around), at + around + 1).map((entry) => ({ line: entry.id, scene: entry.scene + 1, ...(entry.id === id ? { here: true } : {}), text: entry.text })) };
  }

  /** A book's chapters, each with its scenes (with a reading) or the parts the text marks. */
  async chapters(name: string, depth: "chapters" | "parts" | "cards" = "parts"): Promise<Record<string, unknown>> {
    const open = await this.book(name);
    const shape = (node: OutlineNode, level: number, order = 0): Record<string, unknown> => { const position = open.lines.position(node.start); return { kind: node.kind, ...(node.kind === "chapter" ? { chapter: order + 1 } : node.kind === "scene" ? { scene: Number(node.id.replace(/^scene_0*/, "")) } : {}), id: node.id, label: node.label, ...(node.detail ? { detail: node.detail } : {}), at: `${position.line + 1}:${position.character + 1}`, start: node.start, end: node.end, chars: node.end - node.start,
      ...((depth === "cards" || (depth === "parts" && level < 1)) && node.children.length ? { children: node.children.map((child) => shape(child, level + 1)) } : node.children.length ? { inside: node.children.length } : {}) }; };
    return { id: open.book.id, path: open.book.path, title: open.book.title, text: open.book.from, chars: open.book.text.length, reading: Boolean(open.index), chapters: open.outline.map((node, order) => shape(node, 0, order)) };
  }
}
