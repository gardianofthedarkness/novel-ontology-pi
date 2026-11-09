/**
 * A universe's library, its fixed paths, and its snapshots (the user, 2026-11-05: "keep a snapshot per book per universe,
 * and rerunning a previous volume returns to the snapshot before that volume to recover clean status ... a fixed ontology
 * path system that manage snapshots and understandable data path"; "do it the v1 style, and every run result snapshot
 * should be something easily transferable to another user of this cli to step up their universe").
 *
 * v1's way (src/ground/connectors/bundle.ts, library.ts): plain files are the source of truth, the graph (graph.lbug) is
 * rebuilt from them, and a checkpoint is a record named by content. Here the same: a snapshot is a readable record of what
 * every tracked file held (by sha256) and which runs it holds; each content is stored once under snapshots/objects. A run's
 * own files (its world log, ledger, smoothing, records, page) are written once under the run's id and never change, so a
 * snapshot names them and never copies them. Nothing is deleted: a restore first snapshots what it replaces (a guard).
 *
 *   <library>/                              one universe
 *     universe/                             what its books share: pools.json, terrain.json, maps/, abilities.json, props.json
 *     vol-<n>/novel/                        a book's workspace
 *       source/                             its text: never snapshotted or exported (each user brings their own, checked
 *                                           by ontology/source.json's sha256)
 *       ontology/*.jsonl                    the canon, an append log; graph.lbug is rebuilt from it
 *       stage/world|director|simulation|terrain
 *     vol-<n>/reading/                      the book's v2 reading and pre-film notes (data.json, in-use.json, rides.json ...)
 *     snapshots/
 *       index.json                          every snapshot, oldest first
 *       objects/<ab>/<sha256>               each tracked content, once
 *       <book>/<seq>-<kind>[-<run>].json    one snapshot (kind: before | after | guard | manual | imported)
 *
 * A book's latest `before` is where a rerun of it starts (the director restores it); an `after` is the state a run left,
 * which `exportSnapshot` packs, with its `before`, into a bundle another user imports to start their universe there.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile, constants } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const posix = (path: string): string => path.split(sep).join("/");

/** The largest tracked file: a tracked file is state (records, notes, maps), never a page or a picture. */
export const MAX_TRACKED_BYTES = 64 * 1024 * 1024;
export const BUNDLE_FORMAT = "novel-universe-bundle";

// ---------------------------------------------------------------------------------------------------------------------
// Paths

/** Every path of a library, by name. Steps take their paths from here, never by joining folder names themselves. */
export function libraryPaths(root: string) {
  const dir = resolve(root), universe = join(dir, "universe"), snapshots = join(dir, "snapshots");
  const book = (id: string) => {
    const bookDir = join(dir, id), novel = join(bookDir, "novel"), stage = join(novel, "stage"), world = join(stage, "world");
    const director = join(stage, "director"), simulation = join(stage, "simulation"), reading = join(bookDir, "reading");
    return {
      id, dir: bookDir, novel, source: join(novel, "source"), sourceIdentity: join(novel, "ontology", "source.json"),
      ontology: join(novel, "ontology"), graph: join(novel, "ontology", "graph.lbug"),
      reading: { dir: reading, data: join(reading, "data.json") },
      stage, terrain: join(stage, "terrain.json"),
      world: {
        dir: world, script: join(world, "script.json"), strands: join(world, "strands.json"), spawn: join(world, "spawn.json"),
        pins: join(world, "pins.json"), speakers: join(world, "speakers.json"), canon: join(world, "canon.jsonl"), pool: join(world, "pool.jsonl"),
        log: (run: string) => join(world, "log", `${run}.jsonl`), ledger: (run: string) => join(world, "ledger", `${run}.jsonl`),
        smoothed: (run: string) => join(world, "smoothed", `${run}.json`), restrand: (run: string) => join(world, "restrand", `${run}.json`),
      },
      director: { dir: director, record: join(director, "run.json"), runs: (run: string) => join(director, "runs", run), cache: join(director, "cache") },
      simulation: { dir: simulation, index: join(simulation, "index.json"), page: (run: string) => join(simulation, "runs", "director", `${run}.page.json`) },
    };
  };
  return {
    root: dir,
    universe: { dir: universe, pools: join(universe, "pools.json"), terrain: join(universe, "terrain.json"), maps: join(universe, "maps"), abilities: join(universe, "abilities.json"), props: join(universe, "props.json") },
    snapshots: { dir: snapshots, index: join(snapshots, "index.json"), objects: join(snapshots, "objects"), object: (hash: string) => join(snapshots, "objects", hash.slice(0, 2), hash), lock: join(snapshots, ".lock") },
    book,
  };
}

export type LibraryPaths = ReturnType<typeof libraryPaths>;
export const BOOK = /^vol-[A-Za-z0-9_-]+$/;

/** The library and book a path lies in: a library root, a book folder or a book's novel folder. Null outside a library. */
export function libraryOf(path: string): { root: string; book: string | null } | null {
  let at = resolve(path);
  for (let up = 0; up < 4; up++) {
    if (isLibrary(at)) {
      const first = posix(relative(at, resolve(path))).split("/")[0];
      return { root: at, book: BOOK.test(first) ? first : null };
    }
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return null;
}

/** A library holds the shared universe, or snapshots, or a book's workspace (vol-<n>/novel). */
function isLibrary(dir: string): boolean {
  if (existsSync(join(dir, "universe")) || existsSync(join(dir, "snapshots", "index.json"))) return true;
  try { return readdirSync(dir).some(name => BOOK.test(name) && existsSync(join(dir, name, "novel"))); } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------------------------
// What a snapshot tracks

export type Kind = "state" | "run" | "derived" | "source";

/** A run's own files: written once under its id, named by a snapshot, never copied into one. */
const RUN_FILES: RegExp[] = [
  /^vol-[^/]+\/novel\/stage\/world\/(?:log|ledger|smoothed|restrand)\/([^/]+?)\.jsonl?$/,
  /^vol-[^/]+\/novel\/stage\/director\/runs\/([^/]+)\//,
  /^vol-[^/]+\/novel\/stage\/simulation\/runs\/director\/([^/]+?)\.page\.json$/,
];
/** What is rebuilt or only shown: the graph, caches of model answers, pictures, the page as last exported, the live view. */
const DERIVED: RegExp[] = [
  /\/ontology\/graph\.lbug/, /\/\.graph-build-/, /(^|\/)cache(?:-[^/]*)?\//, /^vol-[^/]+\/novel\/stage\/director\/(?:shots|page)\//,
  /^vol-[^/]+\/novel\/stage\/simulation\/live(?:\/|\.json$)/, /(^|\/)\.DS_Store$/, /\.tmp$/, /(^|\/)\.lock(\/|$)/,
];

/**
 * The book's album (src/v2/album.ts; v1's album and portraits): its pictures and portraits are the published book's, as its
 * text is, and its records are made from them, never by a run; so is the reading's copy of it (reading/album, and
 * reading/front.json: the book's front and back matter, its own words). Kept with the book as its text is: never snapshotted,
 * restored, or exported (another user makes them from their own EPUB: novel album import, novel album assign).
 */
const ALBUM = /^vol-[^/]+\/(?:novel\/(?:assets\/|ontology\/(?:illustrations\.jsonl|album\.json|portraits\.jsonl|portrait-tasks\.jsonl|intro-groups\.json)$)|reading\/(?:album\/|front\.json$|pictures-text\.json$))/;

/** How a library-relative path is kept: tracked state, a run's own file, derived (never kept), or the book's text. */
export function classify(rel: string): { kind: Kind; run?: string } {
  // The universe's face store (experiments/v2/stills.mjs): faces cut from the books' pictures, the books' art.
  if (/^vol-[^/]+\/novel\/source\//.test(rel) || ALBUM.test(rel) || /^universe\/faces\//.test(rel)) return { kind: "source" };
  if (DERIVED.some(rule => rule.test(rel))) return { kind: "derived" };
  for (const rule of RUN_FILES) { const found = rel.match(rule); if (found) return { kind: "run", run: found[1] }; }
  return { kind: "state" };
}

/** The roots a snapshot looks under: the shared universe, each book's workspace and reading. */
async function trackedRoots(paths: LibraryPaths): Promise<string[]> {
  const books = (await readdir(paths.root).catch(() => [] as string[])).filter(name => BOOK.test(name)).sort();
  return [paths.universe.dir, ...books.flatMap(id => [paths.book(id).novel, paths.book(id).reading.dir])];
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

export interface Scan {
  /** Tracked files: library-relative path → content hash, size and mode. */
  files: Record<string, { sha: string; bytes: number; mode: number }>;
  /** Each run's own files (library-relative), by run id. */
  runs: Record<string, string[]>;
}

/** Every tracked file's hash and every run's files, as the library stands. `store` also puts each content in objects/. */
export async function scan(root: string, { store = false }: { store?: boolean } = {}): Promise<Scan> {
  const paths = libraryPaths(root), files: Scan["files"] = {}, runs: Scan["runs"] = {};
  for (const top of await trackedRoots(paths)) {
    for await (const path of walk(top)) {
      const rel = posix(relative(paths.root, path)), { kind, run: id } = classify(rel);
      if (kind === "run" && id) { (runs[id] ??= []).push(rel); continue; }
      if (kind !== "state") continue;
      const info = await lstat(path);
      if (info.size > MAX_TRACKED_BYTES) throw new Error(`${rel} is ${info.size} bytes: too large to be tracked state (classify it as a run's file or derived).`);
      const bytes = await readFile(path), hash = sha(bytes);
      files[rel] = { sha: hash, bytes: bytes.length, mode: info.mode & 0o777 };
      if (store) await putObject(paths, hash, bytes);
    }
  }
  return { files, runs };
}

async function putObject(paths: LibraryPaths, hash: string, bytes: Buffer): Promise<void> {
  const target = paths.snapshots.object(hash);
  if (existsSync(target)) return;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

async function getObject(paths: LibraryPaths, hash: string): Promise<Buffer> {
  const bytes = await readFile(paths.snapshots.object(hash));
  if (sha(bytes) !== hash) throw new Error(`snapshot object ${hash} is damaged`);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------------------------
// The state a snapshot reads off its files (for people: which runs it holds)

export interface BookState { accepted: string | null; runs: string[]; canon: string[]; source: string | null }

async function jsonOf<T>(path: string): Promise<T | null> { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return null; } }

/** Each book's accepted run, the runs it lists, the runs whose canon is applied (canon.jsonl, undone ones taken out), its text's hash. */
export async function bookStates(root: string): Promise<Record<string, BookState>> {
  const paths = libraryPaths(root), out: Record<string, BookState> = {};
  for (const id of (await readdir(paths.root).catch(() => [] as string[])).filter(name => BOOK.test(name)).sort()) {
    const book = paths.book(id);
    if (!existsSync(book.novel)) continue;
    const index = await jsonOf<{ strands?: { director?: { runs?: { id: string }[]; accepted?: string } } }>(book.simulation.index);
    const log = (await readFile(book.world.canon, "utf8").catch(() => "")).split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const undone = new Set(log.filter(entry => entry.undo).map(entry => entry.undo));
    const canon = [...new Set(log.filter(entry => entry.run && !entry.undo && !undone.has(`${entry.run}|${entry.file}|${entry.id}|${entry.at}`)).map(entry => String(entry.run)))];
    const source = await jsonOf<{ sha256?: string }>(book.sourceIdentity);
    out[id] = { accepted: index?.strands?.director?.accepted ?? null, runs: (index?.strands?.director?.runs ?? []).map(entry => entry.id), canon, source: source?.sha256 ?? null };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshots

export type SnapshotKind = "before" | "after" | "guard" | "manual" | "imported";

export interface Snapshot {
  version: 1;
  id: string;
  book: string | null;
  kind: SnapshotKind;
  run: string | null;
  parent: string | null;
  why: string;
  at: string;
  /** What each book held: its accepted run, its runs, the runs whose canon is applied, its text's hash. */
  books: Record<string, BookState>;
  /** Every tracked file: library-relative path → content hash, size and mode. */
  files: Scan["files"];
  /** The run files on disk then, by run id (named, not copied: they never change). */
  runs: Scan["runs"];
  /** sha256 of `files` (the snapshot's content address). */
  digest: string;
  importedFrom?: { bundle: string; id: string; at: string };
}

export interface SnapshotIndex { version: 1; snapshots: { id: string; book: string | null; kind: SnapshotKind; run: string | null; parent: string | null; why: string; at: string; files: number; digest: string }[] }

const recordPath = (paths: LibraryPaths, id: string): string => join(paths.snapshots.dir, `${id}.json`);

export async function readIndex(root: string): Promise<SnapshotIndex> {
  return (await jsonOf<SnapshotIndex>(libraryPaths(root).snapshots.index)) ?? { version: 1, snapshots: [] };
}

export async function readSnapshot(root: string, id: string): Promise<Snapshot> {
  const paths = libraryPaths(root), found = await jsonOf<Snapshot>(recordPath(paths, id));
  if (!found) throw new Error(`no snapshot ${id} in ${paths.root}`);
  return found;
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 1) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
}

/** One writer at a time (a folder made atomically, as v1's library lock is). */
async function locked<Result>(root: string, operation: () => Promise<Result>): Promise<Result> {
  const paths = libraryPaths(root);
  await mkdir(paths.snapshots.dir, { recursive: true, mode: 0o700 });
  try { await mkdir(paths.snapshots.lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${paths.snapshots.lock} exists: another snapshot or restore is running (remove it only if none is).`); throw error; }
  try { return await operation(); } finally { await rmdir(paths.snapshots.lock).catch(() => {}); }
}

async function writeSnapshot(root: string, fields: Omit<Snapshot, "version" | "id" | "digest" | "at"> & { at?: string }): Promise<Snapshot> {
  const paths = libraryPaths(root), index = await readIndex(root);
  const seq = String(index.snapshots.length + 1).padStart(4, "0");
  const id = `${fields.book ?? "library"}/${seq}-${fields.kind}${fields.run ? `-${fields.run}` : ""}`;
  const snapshot: Snapshot = { version: 1, id, ...fields, at: fields.at ?? new Date().toISOString(), digest: digestOf(fields.files) };
  await atomicJson(recordPath(paths, id), snapshot);
  index.snapshots.push({ id, book: snapshot.book, kind: snapshot.kind, run: snapshot.run, parent: snapshot.parent, why: snapshot.why, at: snapshot.at, files: Object.keys(snapshot.files).length, digest: snapshot.digest });
  await atomicJson(paths.snapshots.index, index);
  return snapshot;
}

async function take(root: string, options: { book: string | null; kind: SnapshotKind; why: string; run?: string | null; parent?: string | null }): Promise<Snapshot> {
  const found = await scan(root, { store: true });
  return writeSnapshot(root, { book: options.book, kind: options.kind, run: options.run ?? null, parent: options.parent ?? null, why: options.why, books: await bookStates(root), files: found.files, runs: found.runs });
}

/** Snapshot the library as it stands now. */
export async function takeSnapshot(root: string, options: { book: string | null; kind: SnapshotKind; why: string; run?: string | null; parent?: string | null }): Promise<Snapshot> {
  if (options.book && !BOOK.test(options.book)) throw new Error(`a book is named vol-<n>, not ${options.book}`);
  return locked(root, () => take(root, options));
}

/** The newest snapshot matching, else null. */
export async function latestSnapshot(root: string, { book, kind, not }: { book?: string | null; kind?: SnapshotKind; not?: SnapshotKind[] } = {}): Promise<Snapshot | null> {
  const index = await readIndex(root);
  const entry = [...index.snapshots].reverse().find(item => (book === undefined || item.book === book) && (!kind || item.kind === kind) && !(not ?? []).includes(item.kind));
  return entry ? readSnapshot(root, entry.id) : null;
}

const digestOf = (files: Scan["files"]): string => sha(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));

/** The newest snapshot the library stands exactly at now (its tracked files the same), else null. */
export async function matchingSnapshot(root: string): Promise<string | null> {
  const digest = digestOf((await scan(root)).files), index = await readIndex(root);
  return [...index.snapshots].reverse().find(entry => entry.digest === digest)?.id ?? null;
}

export interface Change { path: string; change: "added" | "removed" | "changed" }

/** How the tracked files now differ from a snapshot. */
export async function changesSince(root: string, id: string): Promise<Change[]> {
  const then = (await readSnapshot(root, id)).files, now = (await scan(root)).files, out: Change[] = [];
  for (const [path, file] of Object.entries(now)) if (!then[path]) out.push({ path, change: "added" }); else if (then[path].sha !== file.sha) out.push({ path, change: "changed" });
  for (const path of Object.keys(then)) if (!now[path]) out.push({ path, change: "removed" });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Put the library back as a snapshot has it: each tracked file written from its object, each tracked file it did not
 * have taken away. What is replaced is snapshotted first (a guard), so a restore loses nothing. Run files, caches and
 * the books' text are left as they are; each changed book's graph is rebuilt from its ontology unless `graph` is false.
 */
export async function restoreSnapshot(root: string, id: string, { why = "", graph = true }: { why?: string; graph?: boolean } = {}): Promise<{ restored: string; guard: string | null; written: number; removed: number; graphs: Record<string, unknown> }> {
  const paths = libraryPaths(root), target = await readSnapshot(root, id);
  const outcome = await locked(root, async () => {
    const now = await scan(root);
    const differs = Object.keys(now.files).some(path => target.files[path]?.sha !== now.files[path].sha) || Object.keys(target.files).some(path => !now.files[path]);
    const guard = differs ? await take(root, { book: target.book, kind: "guard", why: `before restoring ${id}${why ? `: ${why}` : ""}` }) : null;
    let written = 0, removed = 0;
    const touched = new Set<string>();
    for (const [path, file] of Object.entries(target.files)) {
      if (now.files[path]?.sha === file.sha) continue;
      const full = join(paths.root, path), bytes = await getObject(paths, file.sha);
      await mkdir(dirname(full), { recursive: true, mode: 0o700 });
      const temporary = `${full}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx", mode: file.mode || 0o600 });
      await rename(temporary, full);
      written++; touched.add(path.split("/")[0]);
    }
    for (const path of Object.keys(now.files)) if (!target.files[path]) { await unlink(join(paths.root, path)); removed++; touched.add(path.split("/")[0]); }
    return { guard: guard?.id ?? null, written, removed, touched };
  });
  const graphs: Record<string, unknown> = {};
  if (graph) for (const book of [...outcome.touched].filter(name => BOOK.test(name))) {
    const { ontology, graph: dbPath } = paths.book(book);
    if (!existsSync(join(ontology, "manifest.json"))) continue;
    try { const { buildGraphFromBundle } = await import("../connectors/ladybug.js"); graphs[book] = await buildGraphFromBundle(ontology, dbPath); }
    catch (error) { graphs[book] = { error: String((error as Error).message ?? error).slice(0, 300) }; }
  }
  return { restored: id, guard: outcome.guard, written: outcome.written, removed: outcome.removed, graphs };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bundles: a snapshot (with the one before its run) packed for another user of this CLI

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  exportedAt: string;
  library: string;
  /** The snapshots packed, oldest first (an `after` with the `before` its run started from). */
  snapshots: Snapshot[];
  /** Each run's files packed: library-relative path → hash and size. */
  runFiles: Record<string, { sha: string; bytes: number }>;
  /** What the importer must bring: each book's text, by the sha256 its ontology/source.json names. */
  sources: Record<string, string | null>;
  note: string;
}

/** The runs a snapshot holds: each book's accepted run and the runs whose canon is applied. */
function runsHeld(snapshot: Snapshot): Set<string> {
  return new Set(Object.values(snapshot.books).flatMap(book => [...(book.accepted ? [book.accepted] : []), ...book.canon]));
}

/**
 * Pack snapshot `id` into `out` (a folder; `.tgz` is packed with tar): its record and its parent `before`, every content
 * they name, and the files of the runs it holds (pages only with `pages`). Never the books' text, the caches, the
 * pictures or the host's files.
 */
export async function exportSnapshot(root: string, id: string, out: string, { pages = false }: { pages?: boolean } = {}): Promise<{ out: string; snapshots: string[]; objects: number; runFiles: number; bytes: number }> {
  const paths = libraryPaths(root), snapshot = await readSnapshot(root, id);
  const chain = [snapshot];
  for (let parent = snapshot.parent; parent; ) { const found = await readSnapshot(root, parent); chain.unshift(found); parent = found.kind === "before" ? null : found.parent; }
  // A .tgz is packed from a folder staged beside it (taken away once packed); the folder inside is <name>.universe.
  const tgz = /\.t(ar\.)?gz$/.test(out), staging = tgz ? join(dirname(resolve(out)), `.export-${randomUUID()}`) : null;
  const folder = staging ? join(staging, `${basename(resolve(out)).replace(/\.t(ar\.)?gz$/, "")}.universe`) : resolve(out);
  if (existsSync(folder) && (await readdir(folder)).length) throw new Error(`${folder} is not empty`);
  await mkdir(join(folder, "objects"), { recursive: true });
  const hashes = new Set(chain.flatMap(entry => Object.values(entry.files).map(file => file.sha)));
  let bytes = 0;
  for (const hash of hashes) { const target = join(folder, "objects", hash.slice(0, 2), hash); await mkdir(dirname(target), { recursive: true }); await copyFile(paths.snapshots.object(hash), target, constants.COPYFILE_FICLONE); bytes += (await stat(target)).size; }
  const runFiles: BundleManifest["runFiles"] = {};
  const held = runsHeld(snapshot);
  for (const [runId, files] of Object.entries(snapshot.runs)) {
    if (!held.has(runId)) continue;
    for (const rel of files) {
      if (!pages && rel.endsWith(".page.json")) continue;
      const source = join(paths.root, rel);
      if (!existsSync(source)) continue;
      const target = join(folder, "runs", rel);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target, constants.COPYFILE_FICLONE);
      const content = await readFile(target);
      runFiles[rel] = { sha: sha(content), bytes: content.length };
      bytes += content.length;
    }
  }
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT, version: 1, exportedAt: new Date().toISOString(), library: basename(paths.root), snapshots: chain, runFiles,
    sources: Object.fromEntries(Object.entries(snapshot.books).map(([book, state]) => [book, state.source])),
    note: "Import with: novel universe import <this bundle> <library-dir> [--source vol-<n>=<your copy of the book>]. The books' text and pictures are not included: bring your own copy (checked by sha256), and make each book's album from your EPUB (novel album import <library>/vol-<n>/novel <book.epub>, then novel album assign for its portraits).",
  };
  await writeFile(join(folder, "bundle.json"), JSON.stringify(manifest, null, 1) + "\n");
  if (staging) { try { await run("tar", ["-czf", resolve(out), "-C", staging, basename(folder)]); } finally { await rm(staging, { recursive: true, force: true }); } }
  return { out: tgz ? resolve(out) : folder, snapshots: chain.map(entry => entry.id), objects: hashes.size, runFiles: Object.keys(runFiles).length, bytes };
}

/**
 * Bring a bundle into a library (made if new): its contents checked against their hashes and stored, its snapshots
 * recorded (as `imported`, the `before` kept as a `before` so the book can be rerun), its run files put in place, and the
 * library restored to the bundle's last snapshot. Each `sources` file (book → path) is checked against the hash the book
 * names and copied in as its text.
 */
export async function importBundle(bundle: string, root: string, { sources = {} }: { sources?: Record<string, string> } = {}): Promise<{ library: string; snapshots: string[]; restored: unknown; sources: Record<string, string> }> {
  const paths = libraryPaths(root);
  await mkdir(paths.snapshots.dir, { recursive: true, mode: 0o700 });
  let folder = resolve(bundle);
  if (/\.t(ar\.)?gz$/.test(bundle)) {
    const unpack = join(paths.snapshots.dir, `.import-${randomUUID()}`);
    await mkdir(unpack);
    await run("tar", ["-xzf", resolve(bundle), "-C", unpack]);
    const [inner] = (await readdir(unpack)).filter(name => !name.startsWith("."));
    folder = join(unpack, inner);
  }
  const manifest = JSON.parse(await readFile(join(folder, "bundle.json"), "utf8")) as BundleManifest;
  if (manifest.format !== BUNDLE_FORMAT || manifest.version !== 1) throw new Error(`${bundle} is not a ${BUNDLE_FORMAT} (version 1)`);
  // Every path stays inside the library: a book's or the universe's, never ../ or absolute.
  const safe = (rel: string): string => { if (rel.startsWith("/") || rel.split("/").includes("..") || !(rel.startsWith("universe/") || /^vol-[A-Za-z0-9_-]+\//.test(rel))) throw new Error(`bundle path ${rel} is outside a library`); return rel; };
  for (const snapshot of manifest.snapshots) for (const [rel, file] of Object.entries(snapshot.files)) {
    safe(rel);
    if (classify(rel).kind !== "state") throw new Error(`bundle tracks ${rel}, which is not state`);
    if (!/^[a-f0-9]{64}$/.test(file.sha)) throw new Error(`bad hash for ${rel}`);
  }
  // Text first: the importer's copy must be the book the snapshots were made from.
  const placed: Record<string, string> = {};
  for (const [book, file] of Object.entries(sources)) {
    if (!BOOK.test(book)) throw new Error(`a book is named vol-<n>, not ${book}`);
    const bytes = await readFile(file), expected = manifest.sources[book];
    if (expected && sha(bytes) !== expected) throw new Error(`${file} is not the text ${book} was made from (sha256 ${sha(bytes).slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`);
    const target = join(paths.book(book).source, "source.txt");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
    placed[book] = target;
  }
  const ids: string[] = [];
  await locked(root, async () => {
    for (const hash of new Set(manifest.snapshots.flatMap(entry => Object.values(entry.files).map(file => file.sha)))) {
      const bytes = await readFile(join(folder, "objects", hash.slice(0, 2), hash));
      if (sha(bytes) !== hash) throw new Error(`bundle object ${hash} is damaged`);
      await putObject(paths, hash, bytes);
    }
    for (const [rel, file] of Object.entries(manifest.runFiles)) {
      safe(rel);
      if (classify(rel).kind !== "run") throw new Error(`bundle run file ${rel} is not a run's file`);
      const target = join(paths.root, rel), bytes = await readFile(join(folder, "runs", rel));
      if (sha(bytes) !== file.sha) throw new Error(`bundle run file ${rel} is damaged`);
      if (existsSync(target)) { if (sha(await readFile(target)) !== file.sha) throw new Error(`${rel} exists with other content`); continue; }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    let parent: string | null = null;
    for (const { version: _version, id: _id, digest: _digest, ...snapshot } of manifest.snapshots) {
      const written = await writeSnapshot(root, { ...snapshot, kind: snapshot.kind === "before" ? "before" : "imported", parent, why: `imported: ${snapshot.why}`, importedFrom: { bundle: basename(bundle), id: _id, at: snapshot.at } });
      ids.push(written.id); parent = written.id;
    }
  });
  if (folder !== resolve(bundle)) await rm(dirname(folder), { recursive: true, force: true });
  const restored = await restoreSnapshot(root, ids.at(-1)!, { why: `imported from ${basename(bundle)}` });
  return { library: paths.root, snapshots: ids, restored, sources: placed };
}
