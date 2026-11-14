/**
 * The figures: each person's rigged 3D figure (a VRM made by engine/characters' pipeline, design §8.6), kept in the
 * user's library beside the universe's one character list and assigned to its people the way the album's portraits are
 * (src/reading/album/portraits.ts), on the universe cast of universal EM (src/universe/identity/cast.ts) instead of one
 * book's records, since one figure serves every volume:
 *   (a) by name: an unassigned figure whose name (or one of its forms) folds to exactly one person's name is that person;
 *       a form shared by several people ("御坂" for two sisters) says nothing and is skipped;
 *   (b) EM merges: when EM finds two people are one, the figure follows the survivor; a figure whose person left the cast
 *       is unassigned again (and (a) may bind it anew);
 *   (c) what (a) and (b) leave: each unassigned figure becomes a task for the main agent (System 2 reviewer), with the
 *       people it may be; the reviewer assigns (`novel figure assign`, or `novel warehouse use figure:<id> for
 *       person:<person>`), or leaves it unassigned. A wrong figure on a person is a visible error; an unassigned one is
 *       only pending.
 * EM settles the figures each time it saves the cast; a figure is never canon and never a gate proposal.
 *
 * Stored at `<library>/figures/<universe>/` (`<book>/figures/book/` for a standalone book), never in this repository:
 * the characters' figures are made from copyrighted pictures. `figures.jsonl` holds the records, `<id>/figure.vrm` the
 * files, `figure-tasks.jsonl` the reviewer's tasks and `log.jsonl` every assignment with its reason.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formKey } from "../ground/language/nameForms.js";
import { castScope, loadCast, type CastFile, type CastPerson, type CastScope } from "../universe/identity/cast.js";

/** One record of figures.jsonl. */
export interface FigureRecord {
  /** Its name in the warehouse (`figure:<id>`): lower-case letters, digits and -. */
  id: string;
  /** The person the figure was made for, as the maker named them. */
  name: string;
  /** Other names it answers to (another script, a full name in another order). */
  forms: string[];
  /** The cast person it is assigned to, or null while unassigned. */
  personId: string | null;
  /** How it was assigned: by name (a), followed through an EM merge (b), or by the reviewer or the user (c). */
  boundBy: "name" | "merge" | "assigned" | null;
  /** The VRM, relative to the store. */
  file: string;
  /** The figure pipeline's version that made it (engine/characters/VERSIONS.md). */
  pipeline: string;
  /** Its outfits, as the pipeline named them (the summer uniform, the winter one, ...). */
  outfits: string[];
  /** Its size in metres (width, height, depth), standing on y = 0. */
  size: [number, number, number];
  triangles: number;
  /** Where its pictures came from, in words (never the pictures). */
  references: string[];
  made: string;
  note?: string;
}

/** One reviewer task: an unassigned figure and the people it may be. */
export interface FigureTask {
  figure: string;
  name: string;
  forms: string[];
  candidates: { personId: string; name: string; forms: string[]; books: number }[];
  note: string;
}

export interface FigureStore { scope: CastScope; dir: string }

export const FIGURE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CANDIDATES = 12;

/** Where a book's universe keeps its figures. */
export const figureDir = (scope: Pick<CastScope, "root" | "universeId">) => join(scope.root, "figures", scope.universeId);
export async function figureStore(novelDir: string, env: NodeJS.ProcessEnv = process.env): Promise<FigureStore> {
  const scope = await castScope(resolve(novelDir), env);
  return { scope, dir: figureDir(scope) };
}

export async function loadFigures(dir: string): Promise<FigureRecord[]> {
  const raw = await readFile(join(dir, "figures.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return ""; });
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as FigureRecord);
}
/** The records synchronously (the warehouse's catalogue readers are synchronous). */
export function readFiguresSync(dir: string): FigureRecord[] {
  if (!existsSync(join(dir, "figures.jsonl"))) return [];
  return readFileSync(join(dir, "figures.jsonl"), "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as FigureRecord);
}

async function atomic(dir: string, file: string, rows: unknown[]): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, file);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
  if (info?.isSymbolicLink()) throw new Error("Figure metadata must not be a symlink");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
export const saveFigures = (dir: string, figures: FigureRecord[]) => atomic(dir, "figures.jsonl", figures);
async function log(dir: string, entry: Record<string, unknown>) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await appendFile(join(dir, "log.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
}

/** A person's names as fold keys (descriptions are not names). */
const personKeys = (person: CastPerson) => new Set([person.name, ...person.forms.filter((form) => form.kind !== "description").map((form) => form.text)].filter(Boolean).map((text) => formKey(text)));

/**
 * (a) By name: each unassigned figure whose forms point to exactly one person (forms that several people share are
 * skipped) is that person. Returns the number newly assigned.
 */
export function bindFiguresByName(persons: CastPerson[], figures: FigureRecord[]): number {
  const owners = new Map<string, Set<string>>();
  for (const person of persons) for (const key of personKeys(person)) owners.set(key, (owners.get(key) ?? new Set()).add(person.id));
  let bound = 0;
  for (const figure of figures) {
    if (figure.personId !== null) continue;
    const pointed = new Set<string>();
    for (const form of [figure.name, ...figure.forms]) {
      const ids = owners.get(formKey(form));
      if (ids?.size === 1) pointed.add([...ids][0]);
    }
    if (pointed.size === 1) { figure.personId = [...pointed][0]; figure.boundBy = "name"; bound++; }
  }
  return bound;
}

/**
 * (b) EM merges: a figure on a person merged into another moves to the survivor (through chains of merges); a figure
 * whose person is gone from the cast is unassigned. Returns how many moved and how many were released.
 */
export function followFigureMerges(cast: Pick<CastFile, "persons" | "merges">, figures: FigureRecord[]): { moved: number; released: number } {
  const alive = new Set(cast.persons.map((person) => person.id));
  const next = new Map(cast.merges.filter((merge) => !merge.drop.includes("::") && !merge.keep.includes("::")).map((merge) => [merge.drop, merge.keep]));
  let moved = 0, released = 0;
  for (const figure of figures) {
    if (figure.personId === null || alive.has(figure.personId)) continue;
    let current = figure.personId;
    for (let step = 0; step < 64 && next.has(current) && !alive.has(current); step++) current = next.get(current)!;
    if (alive.has(current)) { figure.personId = current; figure.boundBy = figure.boundBy === "assigned" ? "assigned" : "merge"; moved++; }
    else { figure.personId = null; figure.boundBy = null; figure.note = "its person left the cast"; released++; }
  }
  return { moved, released };
}

/** How alike two names are, for ranking a task's candidates: shared characters (CJK) or words, by the shorter one. */
function likeness(a: string, b: string): number {
  const units = (text: string) => { const folded = formKey(text).toLowerCase(); return new Set(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(folded) ? [...folded.replace(/\s+/g, "")] : folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean)); };
  const x = units(a), y = units(b);
  if (!x.size || !y.size) return 0;
  let shared = 0; for (const unit of x) if (y.has(unit)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** (c) A task for each unassigned figure: the people it may be, likest names first, then those in the most books. */
export function figureTasks(persons: CastPerson[], figures: FigureRecord[]): FigureTask[] {
  const taken = new Set(figures.flatMap((figure) => (figure.personId ? [figure.personId] : [])));
  return figures.filter((figure) => figure.personId === null).map((figure) => {
    const scored = persons.filter((person) => !taken.has(person.id)).map((person) => {
      const names = [person.name, ...person.forms.filter((form) => form.kind !== "description").map((form) => form.text)];
      return { person, score: Math.max(0, ...[figure.name, ...figure.forms].flatMap((form) => names.map((name) => likeness(form, name)))), books: new Set(person.members.map((member) => member.sourceId)).size };
    });
    const candidates = scored.sort((a, b) => b.score - a.score || b.books - a.books || b.person.members.length - a.person.members.length).slice(0, CANDIDATES)
      .map(({ person, books }) => ({ personId: person.id, name: person.name, forms: person.forms.map((form) => form.text).slice(0, 8), books }));
    return { figure: figure.id, name: figure.name, forms: figure.forms, candidates, note: "Assign the figure to the person it was made for (novel figure assign <novel-dir> <figure> <person> --why ...), or leave it unassigned when none is; never guess." };
  });
}

export interface SettleResult { figures: number; assigned: number; bound: number; moved: number; released: number; tasks: number }

/** EM's step: follow the merges, bind by name, rewrite the reviewer's tasks. Writes only when there are figures. */
export async function settleFigures(scope: Pick<CastScope, "root" | "universeId">, cast: CastFile): Promise<SettleResult> {
  const dir = figureDir(scope), figures = await loadFigures(dir);
  if (!figures.length) return { figures: 0, assigned: 0, bound: 0, moved: 0, released: 0, tasks: 0 };
  const { moved, released } = followFigureMerges(cast, figures);
  const bound = bindFiguresByName(cast.persons, figures);
  if (moved || released || bound) {
    await saveFigures(dir, figures);
    await log(dir, { event: "settled", by: "em", bound, moved, released });
  }
  const tasks = figureTasks(cast.persons, figures);
  await atomic(dir, "figure-tasks.jsonl", tasks);
  return { figures: figures.length, assigned: figures.filter((figure) => figure.personId).length, bound, moved, released, tasks: tasks.length };
}

/** A figure's id from its name: ASCII letters and digits, else the given fallback. */
export const figureIdOf = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** A GLB file's JSON chunk, or an error. */
function glbJson(bytes: Buffer): Record<string, unknown> {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a binary glTF (a .vrm is one)");
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as Record<string, unknown>;
}

export interface AddFigureOptions { name: string; forms?: string[]; id?: string; outfits?: string[]; pipeline?: string; references?: string[]; person?: string; why: string; by?: string; env?: NodeJS.ProcessEnv }

/** Put a made figure (a VRM) in the universe's store, measured; then settle (a figure named for one person is assigned at once). */
export async function addFigure(novelDir: string, vrm: string, options: AddFigureOptions) {
  if (!options.why?.trim()) throw new Error("--why <text> is required: say what the figure is and how it was made.");
  if (!options.name?.trim()) throw new Error("--name <the person's name> is required.");
  const id = options.id ?? figureIdOf(options.name);
  if (!FIGURE_ID.test(id)) throw new Error(`A figure's id is lower-case letters, digits and - (give one with --id; "${options.name}" makes none).`);
  const bytes = await readFile(vrm);
  const gltf = glbJson(bytes), used = (gltf.extensionsUsed as string[] | undefined) ?? [];
  if (!used.includes("VRMC_vrm") && !used.includes("VRM")) throw new Error(`${vrm} is a glTF without a VRM humanoid (the figure pipeline exports VRM 1.0).`);
  const { scope, dir } = await figureStore(novelDir, options.env);
  const figures = await loadFigures(dir);
  if (figures.some((figure) => figure.id === id)) throw new Error(`A figure ${id} is already in the store (novel figure list ${novelDir}); give another --id.`);
  const { meshOfGltf } = await import("../world/models/warehouse.js");
  const mesh = meshOfGltf(vrm);
  await mkdir(join(dir, id), { recursive: true, mode: 0o700 });
  await copyFile(vrm, join(dir, id, "figure.vrm"));
  const cast = await loadCast(scope);
  if (options.person && !cast.persons.some((person) => person.id === options.person)) throw new Error(`No person ${options.person} in the universe's cast (novel em show).`);
  const record: FigureRecord = {
    id, name: options.name.trim(), forms: (options.forms ?? []).map((form) => form.trim()).filter(Boolean), personId: options.person ?? null, boundBy: options.person ? "assigned" : null,
    file: `${id}/figure.vrm`, pipeline: options.pipeline ?? "unknown", outfits: options.outfits ?? [], size: mesh.size, triangles: mesh.t.length / 3,
    references: options.references ?? [], made: new Date().toISOString().slice(0, 10),
  };
  figures.push(record);
  await saveFigures(dir, figures);
  await log(dir, { event: "added", figure: id, person: record.personId, why: options.why, by: options.by ?? process.env.NOVEL_AGENT ?? null });
  const settled = await settleFigures(scope, cast);
  const now = (await loadFigures(dir)).find((figure) => figure.id === id)!;
  return { figure: now, store: dir, settled, part: `figure:${id}`, next: now.personId ? `novel figure list ${novelDir}; novel warehouse show figure:${id} ${novelDir}` : `novel figure assign ${novelDir} ${id} <person> --why <text> (novel figure tasks ${novelDir} lists who it may be)` };
}

/** The reviewer's or the user's assignment (null: unassign). A manual assignment stands until it is changed again; merges still carry it. */
export async function assignFigure(novelDir: string, figureId: string, personId: string | null, options: { why: string; by?: string; env?: NodeJS.ProcessEnv }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required: say how you know who the figure is.");
  const { scope, dir } = await figureStore(novelDir, options.env);
  const figures = await loadFigures(dir), figure = figures.find((entry) => entry.id === figureId);
  if (!figure) throw new Error(`No figure ${figureId} (novel figure list ${novelDir}).`);
  const cast = await loadCast(scope);
  const person = personId === null ? null : cast.persons.find((entry) => entry.id === personId);
  if (personId !== null && !person) throw new Error(`No person ${personId} in the universe's cast (novel em show).`);
  const other = personId === null ? undefined : figures.find((entry) => entry.id !== figureId && entry.personId === personId);
  const before = figure.personId;
  figure.personId = personId; figure.boundBy = personId ? "assigned" : null; delete figure.note;
  if (personId === null) figure.note = "unassigned by hand";
  await saveFigures(dir, figures);
  await log(dir, { event: personId ? "assigned" : "unassigned", figure: figureId, person: personId, before, why: options.why, by: options.by ?? process.env.NOVEL_AGENT ?? null });
  await atomic(dir, "figure-tasks.jsonl", figureTasks(cast.persons, figures));
  return { figure: figureId, person: person ? { id: person.id, name: person.name } : null, before, ...(other ? { alsoOn: other.id, note: `${person!.name} has another figure too (${other.id}); the first in the list is drawn` } : {}) };
}

/** The store as a reviewer reads it: each figure with its person, the tasks, and how many people have none. */
export async function listFigures(novelDir: string, env: NodeJS.ProcessEnv = process.env) {
  const { scope, dir } = await figureStore(novelDir, env);
  const cast = await loadCast(scope), figures = await loadFigures(dir), byId = new Map(cast.persons.map((person) => [person.id, person]));
  const tasks = (await readFile(join(dir, "figure-tasks.jsonl"), "utf8").catch(() => "")).split("\n").filter((line) => line.trim()).length;
  return {
    universe: scope.universeId, store: dir,
    figures: figures.map((figure) => ({ id: figure.id, part: `figure:${figure.id}`, name: figure.name, person: figure.personId ? { id: figure.personId, name: byId.get(figure.personId)?.name ?? null } : null, boundBy: figure.boundBy, pipeline: figure.pipeline, outfits: figure.outfits, height: figure.size[1], triangles: figure.triangles, ...(figure.note ? { note: figure.note } : {}) })),
    people: cast.persons.length, withFigure: new Set(figures.flatMap((figure) => (figure.personId ? [figure.personId] : []))).size, tasks,
    next: tasks ? `novel figure tasks ${novelDir}` : figures.length ? `novel warehouse show figure:<id> ${novelDir}` : `novel figure add ${novelDir} <figure.vrm> --name <the person's name> --why <text>`,
  };
}

export async function figureTasksOf(novelDir: string, env: NodeJS.ProcessEnv = process.env): Promise<FigureTask[]> {
  const { dir } = await figureStore(novelDir, env);
  return (await readFile(join(dir, "figure-tasks.jsonl"), "utf8").catch(() => "")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as FigureTask);
}

/** The person's figure, for whoever draws people: the first figure assigned to them, with its file's full path. */
export async function figureOfPerson(novelDir: string, personId: string, env: NodeJS.ProcessEnv = process.env): Promise<(FigureRecord & { path: string }) | null> {
  const { dir } = await figureStore(novelDir, env);
  const figure = (await loadFigures(dir)).find((entry) => entry.personId === personId);
  return figure ? { ...figure, path: join(dir, figure.file) } : null;
}
