/**
 * The opened folder as a workspace of novels (docs/v3/design.html#workspace; the user, 2026-11-10: "the same open folder vscode
 * has. It scans through every epub or text file in the opened folder, and when we use agent clis to arrange them, they are
 * separated into universes and sorted out, and expandable into Chapters and smaller parts just like how vscode manage
 * repos").
 *
 * Nothing in the folder is moved or changed: the arrangement is a small state file, `.novel/workspace.json`, as a
 * repository's state is its `.git`. A file is known by its content (a hash), so a renamed or moved book keeps its place in
 * its universe. A book's text is the file's own (a text file), the EPUB's spine walked in reading order, or, when a
 * reading made from another extraction of it is linked, that reading's stored source (its sentence ids cite that text).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { walkEpub } from "../reading/album/epub.js";
import { splitChapters } from "../reading/text/blocks.js";
import { NovelError } from "../ground/errors.js";
import { storedSource } from "../ground/workspace/source.js";

/** A name that fits nothing (or several things) in the folder. */
export const noName = (message: string) => new NovelError(message, { aspect: "not_found", code: "FOLDER_NAME_NOT_FOUND" });
export const noReading = (path: string, what: string) => new NovelError(`${path} has no reading linked, so it has no ${what} yet.`, { aspect: "path", code: "FOLDER_NO_READING" });

export const STATE_DIR = ".novel", STATE_FILE = "workspace.json";
const KINDS: Record<string, "epub" | "text"> = { ".epub": "epub", ".txt": "text", ".md": "text" };
const SKIP = new Set(["node_modules", "dist", "build"]);
/** Files larger than this are listed but not read (a text file of 64 MB is not a novel). */
const LARGEST = 64 * 1024 * 1024;
/** How many places of a reading's text are looked for in a file before the two are linked. */
const SAMPLES = 24;

export interface FolderChapter { title: string | null; start: number; end: number }
export interface FolderFile {
  id: string;
  path: string;
  kind: "epub" | "text";
  size: number;
  mtimeMs: number;
  sha256: string;
  title: string;
  chars: number;
  textSha256: string;
  chapters: FolderChapter[];
  /** Other paths in the folder holding the same bytes. */
  copies?: string[];
  /** Why it could not be read as a book. */
  unread?: string;
  /** The file is gone from the folder (kept while a universe still holds it). */
  missing?: boolean;
}
export interface ReadingLink { novel: string; data: string; sourceSha256: string; sameText: boolean }
export interface FolderBook {
  file: string; title?: string; reading?: ReadingLink;
  /** The series the book belongs to inside its universe (different series can share a world); its order is the universe's. */
  series?: string;
}
export interface FolderUniverse { id: string; name: string; why?: string; books: FolderBook[] }
export interface FolderState {
  version: 1; files: FolderFile[]; universes: FolderUniverse[];
  /** The kinds a scan picks up by itself (a folder the console opens: EPUBs only); none set: EPUBs and text files. */
  found?: ("epub" | "text")[];
  /** Text files brought in one by one (the console's Import), picked up whatever `found` says. */
  imported?: string[];
}

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const statePath = (folder: string) => join(folder, STATE_DIR, STATE_FILE);
const slash = (path: string) => path.split(sep).join("/");

export async function loadState(folder: string): Promise<FolderState> {
  const raw = await readFile(statePath(folder), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (raw === null) return { version: 1, files: [], universes: [] };
  const state = JSON.parse(raw) as FolderState;
  if (state.version !== 1 || !Array.isArray(state.files) || !Array.isArray(state.universes)) throw new Error(`${statePath(folder)} is not a workspace state this version reads.`);
  return state;
}

async function saveState(folder: string, state: FolderState): Promise<void> {
  await mkdir(join(folder, STATE_DIR), { recursive: true });
  const target = statePath(folder), draft = `${target}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify(state, null, 1)}\n`, "utf8");
  await rename(draft, target);
}

async function listFiles(folder: string, found: ("epub" | "text")[] = ["epub", "text"], imported: string[] = []): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  const take = new Set(imported);
  const list: { path: string; size: number; mtimeMs: number }[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) await walk(full); continue; }
      if (!entry.isFile() || !(extname(entry.name).toLowerCase() in KINDS)) continue;
      const path = slash(relative(folder, full));
      if (!found.includes(KINDS[extname(entry.name).toLowerCase()]) && !take.has(path)) continue;
      const info = await stat(full);
      list.push({ path, size: info.size, mtimeMs: Math.round(info.mtimeMs) });
    }
  };
  await walk(folder);
  return list;
}

const chaptersOf = (text: string): FolderChapter[] => splitChapters(text).map((chapter) => ({ title: chapter.title, start: chapter.startOffset, end: chapter.endOffset }));

/** A file's text as a book: the file itself, or an EPUB's spine in reading order. */
export function readBook(bytes: Buffer, kind: "epub" | "text", name: string): { title: string; text: string } {
  const stem = basename(name, extname(name));
  if (kind === "text") return { title: stem, text: bytes.toString("utf8").replace(/^﻿/, "") };
  const walk = walkEpub(bytes);
  return { title: walk.title?.trim() || stem, text: walk.text };
}

async function describe(folder: string, entry: { path: string; size: number; mtimeMs: number }): Promise<FolderFile> {
  const kind = KINDS[extname(entry.path).toLowerCase()], base = { path: entry.path, kind, size: entry.size, mtimeMs: entry.mtimeMs };
  const none = { title: basename(entry.path, extname(entry.path)), chars: 0, textSha256: "", chapters: [] as FolderChapter[] };
  if (entry.size > LARGEST) return { id: `f_${sha(entry.path).slice(0, 12)}`, sha256: "", ...base, ...none, unread: "larger than 64 MB" };
  const bytes = await readFile(join(folder, entry.path)), hash = sha(bytes), id = `f_${hash.slice(0, 12)}`;
  try {
    const book = readBook(bytes, kind, entry.path);
    if (!book.text.trim()) return { id, sha256: hash, ...base, ...none, title: book.title, unread: "no text" };
    return { id, sha256: hash, ...base, title: book.title, chars: book.text.length, textSha256: sha(book.text), chapters: chaptersOf(book.text) };
  } catch (error) {
    return { id, sha256: hash, ...base, ...none, unread: error instanceof Error ? error.message : String(error) };
  }
}

export interface ScanReport { folder: string; files: number; added: string[]; changed: string[]; moved: { from: string; to: string }[]; missing: string[]; gone: string[]; unread: { path: string; why: string }[]; unsorted: number; universes: number }

/**
 * Every EPUB and text file under the folder, set against what the state knew: new files, files whose bytes changed (a book
 * in a universe follows its path), files that moved (the same bytes at another path), files that are gone (kept as missing
 * while a universe holds them, dropped otherwise). A file whose size and time are unchanged is not read again.
 */
export async function scanFolder(folder: string, options: { found?: ("epub" | "text")[] } = {}): Promise<ScanReport> {
  const root = resolve(folder), state = await loadState(root);
  // The first scan of a folder may say what it picks up by itself (the console: EPUBs only); later scans keep it.
  if (options.found && !state.found && !state.files.length) state.found = options.found;
  const listed = await listFiles(root, state.found, state.imported);
  const before = new Map(state.files.map((file) => [file.path, file])), held = new Set(state.universes.flatMap((universe) => universe.books.map((book) => book.file)));
  const report: ScanReport = { folder: root, files: 0, added: [], changed: [], moved: [], missing: [], gone: [], unread: [], unsorted: 0, universes: state.universes.length };
  const now: FolderFile[] = [], byId = new Map<string, FolderFile>(), replaced = new Map<string, string>();
  for (const entry of listed) {
    const known = before.get(entry.path);
    const file = known && !known.missing && known.size === entry.size && known.mtimeMs === entry.mtimeMs ? { ...known, copies: undefined } : await describe(root, entry);
    const first = byId.get(file.id);
    if (first) { (first.copies ??= []).push(file.path); continue; }
    byId.set(file.id, file); now.push(file);
    if (!known) report.added.push(file.path);
    else if (known.id !== file.id) { report.changed.push(file.path); replaced.set(known.id, file.id); }
  }
  const paths = new Set(listed.map((entry) => entry.path));
  for (const old of state.files) {
    if (paths.has(old.path)) continue;
    const moved = byId.get(old.id);
    if (moved) { if (!old.missing) report.moved.push({ from: old.path, to: moved.path }); report.added = report.added.filter((path) => path !== moved.path); continue; }
    if (held.has(old.id)) { now.push({ ...old, missing: true }); byId.set(old.id, now[now.length - 1]); report.missing.push(old.path); }
    else report.gone.push(old.path);
  }
  // A file whose bytes changed keeps its place when its old bytes are nowhere else in the folder.
  for (const universe of state.universes) for (const book of universe.books) {
    const next = replaced.get(book.file);
    if (next && !byId.has(book.file)) { book.file = next; if (book.reading) book.reading.sameText = byId.get(next)?.textSha256 === book.reading.sourceSha256; }
  }
  state.files = now;
  report.files = now.filter((file) => !file.missing).length;
  report.unread = now.filter((file) => file.unread).map((file) => ({ path: file.path, why: file.unread as string }));
  const placed = new Set(state.universes.flatMap((universe) => universe.books.map((book) => book.file)));
  report.unsorted = now.filter((file) => !file.missing && !file.unread && !placed.has(file.id)).length;
  await saveState(root, state);
  return report;
}

/** Text files brought into the folder's books one by one (a scan picks them up from then on). Paths inside the folder. */
export async function importFiles(folder: string, paths: string[]): Promise<ScanReport> {
  const root = resolve(folder), state = await loadState(root), wanted = new Set(state.imported ?? []);
  for (const path of paths) {
    const full = resolve(root, path), rel = slash(relative(root, full));
    if (rel.startsWith("..") || isAbsolute(rel)) throw new NovelError(`${path} is not inside ${root}.`, { aspect: "path", code: "FOLDER_CANNOT_READ" });
    if (KINDS[extname(rel).toLowerCase()] !== "text") throw new NovelError(`${path} is not a text file (.txt or .md).`, { aspect: "usage", code: "INVALID_ARGUMENT" });
    wanted.add(rel);
  }
  state.imported = [...wanted];
  await saveState(root, state);
  return scanFolder(root);
}

const slug = (name: string, taken: Set<string>): string => {
  // A name with no Latin letters or digits gets a numbered id.
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  let id = base || "u1";
  for (let n = 2; taken.has(id); n++) id = base ? `${base}-${n}` : `u${n}`;
  return id;
};

/** A file by its id, its path, or the end of its path when only one file ends so. */
export function findFile(state: FolderState, name: string): FolderFile {
  const wanted = slash(name), exact = state.files.find((file) => file.id === wanted || file.path === wanted || file.copies?.includes(wanted));
  if (exact) return exact;
  const ends = state.files.filter((file) => file.path.endsWith(`/${wanted}`) || basename(file.path) === wanted || (wanted.length >= 6 && file.id.startsWith(wanted)));
  if (ends.length === 1) return ends[0];
  throw noName(ends.length ? `"${name}" names ${ends.length} files (${ends.map((file) => file.path).join(", ")}); give the path or the id.` : `No scanned file is "${name}". Run the scan, or see the files with show.`);
}
const findUniverse = (state: FolderState, name: string): FolderUniverse => {
  const universe = state.universes.find((entry) => entry.id === name || entry.name === name);
  if (!universe) throw noName(`No universe is "${name}" (${state.universes.map((entry) => entry.id).join(", ") || "none yet"}). Make it first.`);
  return universe;
};
const bookOf = (state: FolderState, file: FolderFile): { universe: FolderUniverse; book: FolderBook; index: number } | null => {
  for (const universe of state.universes) { const index = universe.books.findIndex((book) => book.file === file.id); if (index >= 0) return { universe, book: universe.books[index], index }; }
  return null;
};

/** A new universe (a world several books share), or an existing one renamed. */
export async function universeAdd(folder: string, name: string, options: { why?: string; rename?: string } = {}): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root);
  if (!name.trim()) throw new Error("A universe needs a name.");
  if (options.rename) { const universe = findUniverse(state, name); universe.name = options.rename.trim(); if (options.why) universe.why = options.why; await saveState(root, state); return { universe: universe.id, name: universe.name }; }
  if (state.universes.some((entry) => entry.name === name.trim())) throw new Error(`A universe named "${name.trim()}" exists.`);
  const universe: FolderUniverse = { id: slug(name, new Set(state.universes.map((entry) => entry.id))), name: name.trim(), ...(options.why ? { why: options.why } : {}), books: [] };
  state.universes.push(universe);
  await saveState(root, state);
  return { universe: universe.id, name: universe.name, books: 0 };
}

/** A universe taken away; its books go back to the unsorted files. */
export async function universeRemove(folder: string, name: string): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), universe = findUniverse(state, name);
  state.universes = state.universes.filter((entry) => entry !== universe);
  await saveState(root, state);
  return { removed: universe.id, unsorted: universe.books.length };
}

/** A file put into a universe as a book, at a place in its order (1 is first; the end when not given). It leaves any universe it was in. */
export async function putBook(folder: string, name: string, universeName: string, options: { at?: number; title?: string; series?: string } = {}): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), file = findFile(state, name), universe = findUniverse(state, universeName);
  if (file.unread) throw new Error(`${file.path} could not be read as a book (${file.unread}).`);
  const was = bookOf(state, file), book: FolderBook = was?.book ?? { file: file.id };
  if (was) was.universe.books.splice(was.index, 1);
  if (options.title !== undefined) { if (options.title.trim()) book.title = options.title.trim(); else delete book.title; }
  if (options.series !== undefined) { if (options.series.trim()) book.series = options.series.trim(); else delete book.series; }
  const at = options.at === undefined ? universe.books.length : options.at - 1;
  if (!Number.isInteger(at) || at < 0 || at > universe.books.length) throw new Error(`--at must be from 1 to ${universe.books.length + 1} in ${universe.id}.`);
  universe.books.splice(at, 0, book);
  await saveState(root, state);
  return { universe: universe.id, order: universe.books.map((entry, index) => ({ at: index + 1, ...(entry.series ? { series: entry.series } : {}), file: state.files.find((known) => known.id === entry.file)?.path ?? entry.file, title: entry.title ?? state.files.find((known) => known.id === entry.file)?.title })) };
}

/** A book taken out of its universe, back to the unsorted files. */
export async function takeBook(folder: string, name: string): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), file = findFile(state, name), was = bookOf(state, file);
  if (!was) throw new Error(`${file.path} is in no universe.`);
  was.universe.books.splice(was.index, 1);
  await saveState(root, state);
  return { unsorted: file.path, from: was.universe.id };
}

/**
 * A reading that exists elsewhere (a v2 library's novel folder and its reading's data) linked to a book, read-only. When its
 * stored source is another extraction of the book than the file gives, the book is shown as that stored source, since the
 * reading's sentence ids cite it.
 */
export async function linkReading(folder: string, name: string, novelDir: string | null, dataFile?: string, options: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), file = findFile(state, name), was = bookOf(state, file);
  if (!was) throw new Error(`${file.path} is in no universe; put it in one before linking a reading.`);
  if (novelDir === null) { delete was.book.reading; await saveState(root, state); return { file: file.path, reading: null }; }
  const novel = resolve(novelDir), bound = await storedSource(novel);
  if (!bound) throw new Error(`${novel} has no stored source (ontology/source.json).`);
  const data = resolve(dataFile ?? join(novel, "..", "reading", "data.json"));
  const reading = JSON.parse(await readFile(data, "utf8")) as { scenes?: unknown; cards?: unknown; chart?: { entities?: unknown } };
  if (!Array.isArray(reading.scenes) || !Array.isArray(reading.cards) || !Array.isArray(reading.chart?.entities)) throw new Error(`${data} is not a reading's data (scenes, cards, chart).`);
  const inside = (path: string) => { const rel = relative(root, path); return rel && !rel.startsWith("..") && !isAbsolute(rel) ? slash(rel) : path; };
  const sameText = bound.sha256 === file.textSha256;
  // Another extraction of the same book shares most of its words with the file; a reading of another book shares none.
  let shared: string | undefined;
  if (!sameText && !file.missing) {
    const stored = await readFile(join(novel, "source", bound.file), "utf8"), own = readBook(await readFile(join(root, file.path)), file.kind, file.path).text.replace(/\s+/g, "");
    const samples = Array.from({ length: SAMPLES }, (_, index) => stored.slice(Math.floor(((index + 0.5) * stored.length) / SAMPLES)).replace(/\s+/g, "").slice(0, 20)).filter((sample) => sample.length === 20);
    const hits = samples.filter((sample) => own.includes(sample)).length;
    shared = `${hits} of ${samples.length} samples of the reading's text are in the file`;
    if (hits * 2 < samples.length && !options.force) throw new NovelError(`${novel} reads another book than ${file.path}: ${shared}. Link it to the book it was read from (--force links it anyway).`, { aspect: "conflict", code: "FOLDER_READING_OF_ANOTHER_BOOK" });
  }
  was.book.reading = { novel: inside(novel), data: inside(data), sourceSha256: bound.sha256, sameText };
  await saveState(root, state);
  return { file: file.path, reading: was.book.reading, text: sameText ? "the file's own text" : "the reading's stored source (another extraction of this book)", ...(shared ? { shared } : {}), scenes: reading.scenes.length, cards: reading.cards.length, entities: (reading.chart?.entities as unknown[]).length };
}

export interface BookText { id: string; title: string; text: string; from: "file" | "epub" | "reading"; chapters: FolderChapter[]; path: string; reading: { novel: string; data: string } | null }

/** A book's text and chapters as the workspace shows it. */
export async function bookText(folder: string, state: FolderState, name: string): Promise<BookText> {
  const root = resolve(folder), file = findFile(state, name), placed = bookOf(state, file), link = placed?.book.reading ?? null;
  const title = placed?.book.title ?? file.title, at = (path: string) => (isAbsolute(path) ? path : join(root, path));
  const reading = link ? { novel: at(link.novel), data: at(link.data) } : null;
  if (link && !link.sameText) {
    const novel = at(link.novel), bound = await storedSource(novel);
    if (!bound) throw new Error(`${novel} has lost its stored source.`);
    const text = await readFile(join(novel, "source", bound.file), "utf8");
    return { id: file.id, title, text, from: "reading", chapters: chaptersOf(text), path: file.path, reading };
  }
  if (file.missing) throw new Error(`${file.path} is gone from the folder.`);
  if (file.unread) throw new Error(`${file.path} could not be read as a book (${file.unread}).`);
  const book = readBook(await readFile(join(root, file.path)), file.kind, file.path);
  return { id: file.id, title, text: book.text, from: file.kind === "epub" ? "epub" : "file", chapters: file.chapters, path: file.path, reading };
}

/**
 * A chapter's smaller parts where the text marks them: a line that is only a number, or only a row of marks, starts a new
 * part. A chapter with no such line is one part.
 */
const MARKS = "*\\-=#~\\u00b7\\u2014\\u2015\\u203b\\u25a0\\u25a1\\u25c6\\u25c7\\u25cb\\u25cf\\u2605\\u2606\\u30fb\\uff0a\\uff5e\\u00d7";
const BREAK = new RegExp(`^[ \\t\\u3000]*(?:[0-9\\uff10-\\uff19]{1,3}|[${MARKS}]{1,12}(?:[ \\t\\u3000]*[${MARKS}]{1,12})*)[ \\t\\u3000]*$`);
export function cutParts(text: string, start: number, end: number): { index: number; label: string | null; start: number; end: number }[] {
  const parts: { index: number; label: string | null; start: number; end: number }[] = [];
  let from = start, label: string | null = null, at = start;
  const close = (to: number) => { if (text.slice(from, to).trim()) parts.push({ index: parts.length, label, start: from, end: to }); };
  while (at < end) {
    const stop = text.indexOf("\n", at), lineEnd = stop < 0 || stop > end ? end : stop, line = text.slice(at, lineEnd);
    if (BREAK.test(line)) { close(at); from = at; label = line.trim(); }
    at = lineEnd + 1;
  }
  close(end);
  return parts.length > 1 ? parts : [];
}

const lineOf = (text: string, start: number, end: number, most = 40): string => { const line = text.slice(start, end).trim().split("\n")[0]?.trim() ?? ""; return line.length > most ? `${line.slice(0, most - 1)}…` : line; };

/**
 * The folder as a tree: universes in their order, their books in theirs, a book's chapters; then the files no universe
 * holds, and the ones that are gone. `opening` adds each file's first lines, for an agent sorting the folder.
 */
export async function folderTree(folder: string, options: { opening?: number } = {}): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), byId = new Map(state.files.map((file) => [file.id, file])), placed = new Set<string>();
  const opening = async (file: FolderFile): Promise<string | undefined> => {
    if (!options.opening || file.missing || file.unread) return undefined;
    const book = readBook(await readFile(join(root, file.path)), file.kind, file.path);
    return book.text.trim().slice(0, options.opening);
  };
  const shape = async (file: FolderFile, book?: FolderBook) => ({
    id: file.id, path: file.path, title: book?.title ?? file.title, kind: file.kind, chars: file.chars, chapters: file.chapters.length, ...(book?.series ? { series: book.series } : {}),
    ...(file.copies?.length ? { copies: file.copies } : {}), ...(file.missing ? { missing: true } : {}), ...(file.unread ? { unread: file.unread } : {}),
    ...(book?.reading ? { reading: { novel: book.reading.novel, sameText: book.reading.sameText } } : {}),
    ...(options.opening ? { chapterTitles: file.chapters.map((chapter) => chapter.title).filter(Boolean).slice(0, 12), opening: await opening(file) } : {}),
  });
  const universes = [];
  for (const universe of state.universes) {
    const books = [];
    for (const book of universe.books) { const file = byId.get(book.file); placed.add(book.file); if (file) books.push(await shape(file, book)); }
    universes.push({ id: universe.id, name: universe.name, ...(universe.why ? { why: universe.why } : {}), books });
  }
  const unsorted = [];
  for (const file of state.files) if (!placed.has(file.id) && !file.missing) unsorted.push(await shape(file));
  return { folder: root, scanned: state.files.length > 0 || state.universes.length > 0, universes, unsorted };
}

/** A book's chapters and each chapter's parts as the text marks them (a linked reading's scenes are the server's to add). */
export async function bookChapters(folder: string, name: string): Promise<Record<string, unknown>> {
  const root = resolve(folder), state = await loadState(root), book = await bookText(root, state, name);
  return { id: book.id, path: book.path, title: book.title, text: book.from, chars: book.text.length, reading: Boolean(book.reading),
    chapters: book.chapters.map((chapter, index) => ({ index, title: chapter.title, start: chapter.start, end: chapter.end, chars: chapter.end - chapter.start, first: lineOf(book.text, chapter.start, chapter.end),
      parts: cutParts(book.text, chapter.start, chapter.end).map((part) => ({ index: part.index, label: part.label, start: part.start, end: part.end, chars: part.end - part.start })) })) };
}
