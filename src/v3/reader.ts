/**
 * The reader (docs/v3/design.html#reader; the user, 2026-11-10: "I really like how our read result html and the read button
 * highlights different characters and types of the sentences and all notes etc and how the full epub is loaded. Can you
 * make that the same for processed files?"). A processed book read as published: its EPUB a document at a time, each
 * sentence the reading cites coloured by its kind, the names, descriptions and times marked where they stand with whom or
 * what they mean, the speaker before a spoken line, and under any sentence every record the reading made of it. What
 * World · Live's Read panel and the reading's inspection page showed, served from the opened folder. Read-only.
 */
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { mentions } from "../v2/extraction/em.js";
import type { Reference } from "./book.js";
import { epubDocument, epubItems, type EpubDocument } from "./epub.js";
import type { NovelWorkspace, OpenBook } from "./workspace.js";

/** [at, length, type, ref]: type person|place|thing|concept|time|desc; ref the entity (a description: whom it means). */
export type Mark = [number, number, string, string | null];
export interface ReaderBook {
  id: string; title: string; path: string;
  /** "reading": the reading's records are marked; "plain": the text only. */
  mode: "reading" | "plain";
  /** Spine documents of the book's EPUB (0: shown as text). */
  epub: number;
  /** [id, text, starts a paragraph (1/0)]. */
  sentences: [string, string, number][];
  kinds: Record<string, string>;
  marks: Record<string, Mark[]>;
  /** entity → [label, category, unnamed 1/0]. */
  names: Record<string, [string, string, number]>;
  /** sentence → [speaker, confidence, settled 1/0, the words the role went through]. */
  speakers: Record<string, [string, number, number, string]>;
  problems: Record<string, string[]>;
  chapters: { title: string; first: string | null }[];
  scenes: { id: string; index: number; first: string | null }[];
  /** The people with a picture of their face in the reading's album (readerPortrait gives it). */
  portraits: string[];
  /** sentence → how many notes the director's page has on it. */
  notes: Record<string, number>;
}

const MARK_TYPE: Record<string, string> = { char: "person", loc: "place", item: "thing", concept: "concept", vehicle: "thing", weapon: "thing" };
const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

interface EmResult { text: string; outcome?: string; entity?: string | null; type?: string; category?: string; key?: string }
interface FullReading {
  kinds?: Record<string, { kind: string; confidence?: number; turn?: number; top?: [string, number][] }>;
  chart: { entities: { id: string; category: string; type?: string; proper?: string[]; names?: string[] }[] };
  em?: { batch: string; results: EmResult[] }[];
  references?: { text: string; type?: string; scene?: string; sentences: string[]; entity?: string | null; answer?: string; confidence?: number }[];
  time?: { words?: { sentence: string; start: number; end: number; text: string; gloss?: string; role?: string; confidence?: number }[] };
  cards?: { id: string; kind: string; home?: string; first: string; last: string; sentences?: string[]; inside?: string[]; people?: { id: string; how: string[] }[] }[];
  roles?: Record<string, { kind?: string; who?: { id: string | null; answer?: string; confidence?: number; via?: string }; to?: { id: string | null; answer?: string; confidence?: number; via?: string } }>;
  facts?: { id: string; sentences: string[]; about?: string[]; time?: string; story?: number }[];
  slots?: unknown;
}
const id = (value: string) => value.slice(0, value.indexOf("_") > 0 ? value.indexOf("_") : value.length);

async function rows(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
}

/** Where each name, description and time stands in each sentence (as experiments/v2/marks.mjs found them). */
export function sentenceMarks(reading: FullReading, sentences: [string, string][]): Record<string, Mark[]> {
  const results = (reading.em ?? []).flatMap((batch) => batch.results ?? []);
  const lexicon: [string, string][] = [
    ...reading.chart.entities.flatMap((entity) => (entity.proper ?? []).map((name): [string, string] => [name, entity.id])),
    ...[...new Set(results.filter((entry) => entry.outcome === "description").map((entry) => entry.text))].map((name): [string, string] => [name, `desc:${name}`]),
  ].filter(([name]) => name.length > 0).sort((a, b) => b[0].length - a[0].length);
  const meant = new Map<string, string>();
  for (const reference of reading.references ?? []) for (const sentence of reference.sentences) meant.set(`${sentence}\u0000${reference.text}`, reference.entity ?? "");
  const wordsOf = new Map<string, NonNullable<NonNullable<FullReading["time"]>["words"]>>();
  for (const word of reading.time?.words ?? []) (wordsOf.get(word.sentence) ?? wordsOf.set(word.sentence, []).get(word.sentence)!).push(word);
  const marks: Record<string, Mark[]> = {};
  for (const [sentence, text] of sentences) {
    const found: Mark[] = [];
    for (const hit of mentions(text, lexicon)) {
      if (hit.id.startsWith("desc:")) found.push([hit.at, hit.name.length, "desc", meant.get(`${sentence}\u0000${hit.name}`) || null]);
      else { const type = MARK_TYPE[id(hit.id)]; if (type) found.push([hit.at, hit.name.length, type, hit.id]); }
    }
    for (const word of wordsOf.get(sentence) ?? []) {
      if (found.some(([at, length]) => word.start < at + length && at < word.end)) continue;
      found.push([word.start, word.end - word.start, "time", [word.role, word.gloss].filter(Boolean).join(" · ") || null]);
    }
    if (found.length) marks[sentence] = found.sort((a, b) => a[0] - b[0]);
  }
  return marks;
}

const epubPath = (ws: NovelWorkspace, open: OpenBook) => (extname(open.book.path).toLowerCase() === ".epub" ? (isAbsolute(open.book.path) ? open.book.path : join(ws.folder, open.book.path)) : null);

/** The book as the reader shows it. */
export async function readerBook(ws: NovelWorkspace, name: string): Promise<ReaderBook> {
  const open = await ws.book(name), index = open.index, reading = open.reading as FullReading | null, text = open.book.text;
  const epub = epubPath(ws, open), items = epub ? await epubItems(epub).catch(() => 0) : 0;
  const base = { id: open.book.id, title: open.book.title, path: open.book.path, epub: items };
  if (!index || !reading) {
    // No reading: the text in its paragraphs, a sentence a paragraph.
    const sentences: [string, string, number][] = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line, n) => [`p${n}`, line, 1]);
    const chapters = open.book.chapters.map((chapter, n) => ({ title: chapter.title ?? (n === 0 ? "Front matter" : `Section ${n + 1}`), first: null }));
    return { ...base, mode: "plain", sentences, kinds: {}, marks: {}, names: {}, speakers: {}, problems: {}, chapters, scenes: [], portraits: [], notes: {} };
  }
  const sentences: [string, string, number][] = index.lines.map((line, n) => [line.id, line.text, n === 0 || text.slice(index.lines[n - 1].end, line.start).includes("\n") ? 1 : 0]);
  const kinds = Object.fromEntries(Object.entries(reading.kinds ?? {}).map(([sentence, entry]) => [sentence, entry.kind]));
  const names: ReaderBook["names"] = Object.fromEntries(index.symbols.map((symbol) => [symbol.id, [symbol.label, symbol.category, symbol.unnamed ? 1 : 0]]));
  const speakers: ReaderBook["speakers"] = Object.fromEntries(index.speakers.map((entry) => [entry.sentence, [entry.entity, entry.confidence, entry.settled ? 1 : 0, entry.via ?? ""]]));
  const problems: ReaderBook["problems"] = {};
  for (const problem of index.problems) { const line = index.lineAt(problem.start); if (line) (problems[line.id] ??= []).push(problem.message); }
  const firstFrom = (start: number) => index.lines.find((line) => line.start >= start)?.id ?? null;
  const chapters = open.book.chapters.map((chapter, n) => ({ title: chapter.title ?? (n === 0 ? "Front matter" : `Section ${n + 1}`), first: firstFrom(chapter.start) }));
  const scenes = index.scenes.filter((scene) => scene.lines > 0).map((scene) => ({ id: scene.id, index: scene.index, first: index.lineAt(scene.start)?.id ?? null }));
  const novel = open.book.reading!.novel, portraits = [...(await portraitFiles(novel, (entity) => Boolean(names[entity]))).keys()];
  const notes: Record<string, number> = {};
  for (const note of await rows(join(novel, "stage", "director", "notes.jsonl"))) if (typeof note.sentence === "string") notes[note.sentence] = (notes[note.sentence] ?? 0) + 1;
  return { ...base, mode: "reading", sentences, kinds, marks: sentenceMarks(reading, sentences.map(([sentence, line]) => [sentence, line])), names, speakers, problems, chapters, scenes, portraits, notes };
}

/** The album's portraits bound to a known person: entity → its file (under the reading's assets/). */
async function portraitFiles(novel: string, known: (entity: string) => boolean): Promise<Map<string, { file: string; type: string }>> {
  const found = new Map<string, { file: string; type: string }>();
  for (const row of await rows(join(novel, "ontology", "portraits.jsonl"))) {
    const entity = row.entityId, file = row.portrait, type = typeof file === "string" ? IMAGE_TYPES[extname(file).toLowerCase()] : undefined;
    if (typeof entity !== "string" || typeof file !== "string" || !type || found.has(entity) || !known(entity) || !file.startsWith("assets/") || file.includes("..")) continue;
    found.set(entity, { file: join(novel, file), type });
  }
  return found;
}

/** A person's portrait as a data URI, or null. */
export async function readerPortrait(ws: NovelWorkspace, name: string, entity: string): Promise<string | null> {
  const open = await ws.book(name);
  if (!open.index || !open.book.reading) return null;
  const found = (await portraitFiles(open.book.reading.novel, (id) => Boolean(open.index!.symbol(id)))).get(entity);
  const bytes = found ? await readFile(found.file).catch(() => null) : null;
  return found && bytes && bytes.length < 4 * 1024 * 1024 ? `data:${found.type};base64,${bytes.toString("base64")}` : null;
}

/** A spine document of the book's EPUB, or null (no EPUB, or past its end). */
export async function readerDocument(ws: NovelWorkspace, name: string, item: number): Promise<EpubDocument | null> {
  const open = await ws.book(name), epub = epubPath(ws, open);
  return epub ? epubDocument(epub, item) : null;
}

interface Who { id: string | null; label: string; confidence: number | null; settled: boolean; via: string | null }
export interface ReaderLine {
  id: string; text: string; chapter: string; scene: { id: string; index: number; type: string } | null;
  kind: { kind: string; confidence: number | null; turn: number | null; top: [string, number][] } | null;
  role: { kind: string; who: Who | null; to: Who | null } | null;
  /** The people, places, things and concepts the line refers to, and how. */
  references: { entity: string; label: string; category: string; unnamed: boolean; how: string[]; settled: boolean; confidence: number | null; via: string | null }[];
  /** Descriptions of someone, and whom the reading took each to mean. */
  descriptions: { text: string; type: string | null; entity: string | null; label: string | null; confidence: number | null }[];
  times: { text: string; gloss: string | null; role: string | null; confidence: number | null }[];
  /** EM's verdict on each string listed from the line. */
  listed: { text: string; outcome: string | null; type: string | null; entity: string | null; label: string | null }[];
  cards: { id: string; kind: string; home: string | null; lines: number; people: { label: string; how: string[] }[] }[];
  facts: { id: string; about: string[]; time: string | null }[];
  problems: string[];
  notes: { at: string | null; card: string | null; text: string }[];
}

/** Every record the reading made of one sentence. */
export async function readerLine(ws: NovelWorkspace, name: string, sentence: string): Promise<ReaderLine> {
  const open = await ws.book(name), index = open.index, reading = open.reading as FullReading | null;
  if (!index || !reading) throw new Error(`${open.book.path} has no reading linked.`);
  const line = index.line(sentence);
  if (!line) throw new Error(`${open.book.title} has no sentence ${sentence}.`);
  const label = (entity: string | null | undefined) => (entity ? index.symbol(entity)?.label ?? entity : null);
  const who = (side?: { id: string | null; answer?: string; confidence?: number; via?: string }): Who | null => {
    const entity = side?.id ?? side?.answer ?? null;
    if (!side || !entity || entity === "none") return null;
    return { id: index.symbol(entity) ? entity : null, label: label(entity) ?? entity, confidence: side.confidence ?? null, settled: side.id !== null, via: side.via ?? null };
  };
  const role = reading.roles?.[sentence], kind = reading.kinds?.[sentence], scene = line.scene >= 0 ? index.scenes.find((entry) => entry.index === line.scene) ?? null : null;
  const references = index.onLine(sentence).map((reference: Reference) => {
    const symbol = index.symbol(reference.entity)!;
    return { entity: reference.entity, label: symbol.label, category: symbol.category, unnamed: symbol.unnamed, how: reference.how, settled: reference.settled, confidence: reference.confidence ?? null, via: reference.via ?? null };
  });
  const descriptions = (reading.references ?? []).filter((reference) => reference.sentences.includes(sentence)).map((reference) => ({ text: reference.text, type: reference.type ?? null, entity: reference.entity ?? null, label: label(reference.entity), confidence: reference.confidence ?? null }));
  const times = (reading.time?.words ?? []).filter((word) => word.sentence === sentence).map((word) => ({ text: word.text, gloss: word.gloss ?? null, role: word.role ?? null, confidence: word.confidence ?? null }));
  // EM's batch for the line: the latest that starts at or before it.
  const order = new Map(index.lines.map((entry, n) => [entry.id, n])), here = order.get(sentence) ?? -1;
  let batch: { batch: string; results: EmResult[] } | null = null;
  for (const entry of [...(reading.em ?? [])].sort((a, b) => (order.get(a.batch) ?? -1) - (order.get(b.batch) ?? -1))) { if ((order.get(entry.batch) ?? -1) <= here) batch = entry; else break; }
  const listed = (batch?.results ?? []).filter((result) => result.text && line.text.includes(result.text)).map((result) => ({ text: result.text, outcome: result.outcome ?? null, type: result.type ?? result.category ?? null, entity: result.entity ?? null, label: label(result.entity) }));
  const cards = (reading.cards ?? []).filter((card) => (card.sentences ?? [card.first]).includes(sentence)).map((card) => ({
    id: card.id, kind: card.kind, home: card.home ?? null, lines: card.sentences?.length ?? 1,
    people: (card.people ?? []).map((person) => ({ label: label(person.id) ?? person.id, how: person.how })),
  }));
  const facts = (reading.facts ?? []).filter((fact) => fact.sentences.includes(sentence)).map((fact) => ({ id: fact.id, about: (fact.about ?? []).map((entity) => label(entity) ?? entity), time: fact.time ?? null }));
  const problems = index.problems.filter((problem) => index.lineAt(problem.start)?.id === sentence).map((problem) => problem.message);
  const notes = (await rows(join(open.book.reading!.novel, "stage", "director", "notes.jsonl"))).filter((note) => note.sentence === sentence)
    .map((note) => ({ at: typeof note.at === "string" ? note.at : null, card: typeof note.card === "string" ? note.card : null, text: String(note.text ?? "") }));
  const chapter = open.book.chapters[line.chapter];
  return {
    id: sentence, text: line.text, chapter: chapter?.title ?? (line.chapter === 0 ? "Front matter" : `Section ${line.chapter + 1}`),
    scene: scene ? { id: scene.id, index: scene.index, type: scene.type } : null,
    kind: kind ? { kind: kind.kind, confidence: kind.confidence ?? null, turn: kind.turn ?? null, top: kind.top ?? [] } : null,
    role: role ? { kind: role.kind ?? "", who: who(role.who), to: who(role.to) } : null,
    references, descriptions, times, listed, cards, facts, problems, notes,
  };
}
