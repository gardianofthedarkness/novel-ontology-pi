/**
 * The universal world generator schema's resolver (config/world.schema.json; docs/v3/design.html#models-and-settings §4;
 * milestones M8a; the user, 2026-11-09: "dig out the hard rules and make them into our universal world generator
 * schema"). Every number and rule the generator, the laws, the smoother, crowds and the director used to keep in code
 * is a key of the schema with its default; a value resolves through layers:
 *
 *   defaults (the schema)  <  universe (<universe>/settings.json)  <  book (<novel>/stage/settings.json)  <  place
 *
 * A layer file: { "values": { key: value }, "tables": { name: partial table }, "places": { "<place id>": { "values",
 * "tables" } } }. An object value merges key by key over the one below; a number, a string or an array replaces it.
 * A key a layer may not set (the schema's `layers`), an unknown key, or a value of the wrong shape or out of its range
 * is refused when the layer is read. Pure reads: nothing here writes.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOps } from "./world/fillOps.js";
import { checkPartMap } from "./models/partRefs.js";
import { checkInteract } from "./models/interact.js";

export type Layer = "universe" | "book" | "place";
export interface Entry { default: unknown; unit: string; meaning: string; used: string[]; layers: Layer[]; kind: "hard" | "knob" | "physics" | "structure" | "presentation"; range?: [number, number]; wired?: boolean }
export interface TableEntry { file: string; meaning: string; used: string[]; layers: Layer[] }
export interface Schema { about: string; version: number; layers: string[]; keys: Record<string, Entry>; tables: Record<string, TableEntry> }
/** Where to read layers from: a universe folder, a book's novel folder (its stage/settings.json), a place id in either. */
export interface Scope { universe?: string | null; book?: string | null; place?: string | null }
interface LayerFile { values?: Record<string, unknown>; tables?: Record<string, unknown>; places?: Record<string, { values?: Record<string, unknown>; tables?: Record<string, unknown> }> }

/** The repository's root (dist/src/v2/settings.js or src/v2/settings.ts: the folder holding config/). */
const ROOT = (() => { let at = dirname(fileURLToPath(import.meta.url)); while (!existsSync(join(at, "config", "world.schema.json")) && dirname(at) !== at) at = dirname(at); return at; })();
export const SCHEMA_FILE = join(ROOT, "config", "world.schema.json");

/** "Infinity" in JSON is Infinity in the world. */
const revive = (_key: string, value: unknown) => (value === "Infinity" ? Infinity : value);
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"), revive);

let cached: Schema | null = null;
export function schema(): Schema { return (cached ??= readJson(SCHEMA_FILE) as Schema); }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Merge an override over a value: objects key by key, anything else replaced. */
export function merge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value);
  return out;
}

/** What is wrong with a value for a key (an empty list when it is fine): its shape against the default's, its range. */
export function problemsOf(key: string, value: unknown, layer?: Layer): string[] {
  const entry = schema().keys[key];
  if (!entry) return [`no setting ${key}`];
  const out: string[] = [];
  if (layer && !entry.layers.includes(layer)) out.push(`${key} may not be set by a ${layer} (only: ${entry.layers.join(", ") || "nowhere: it is the grid itself or a measured constant"})`);
  const walk = (path: string, base: unknown, given: unknown) => {
    if (isObject(base)) {
      if (!isObject(given)) { out.push(`${path} must be an object`); return; }
      for (const [name, sub] of Object.entries(given)) { if (!(name in base)) out.push(`${path}.${name} is not a part of ${key}`); else walk(`${path}.${name}`, base[name], sub); }
      return;
    }
    if (Array.isArray(base)) { if (!Array.isArray(given)) out.push(`${path} must be a list`); return; }
    if (typeof base === "number") { if (typeof given !== "number" || Number.isNaN(given)) out.push(`${path} must be a number`); return; }
    if (typeof base !== typeof given) out.push(`${path} must be a ${typeof base}`);
  };
  if (key === "fill.ops") return [...out, ...checkOps(value)];
  // The warehouse's slot maps (kind -> part; milestones M10i): their keys are kinds, not parts of the default.
  if (key === "fill.props" || key === "models.vehicles" || key === "models.parts") return [...out, ...checkPartMap(key, value)];
  if (key === "models.interact") return [...out, ...checkInteract(value)];
  walk(key, entry.default, value);
  if (entry.range && typeof value === "number" && (value < entry.range[0] || value > entry.range[1])) out.push(`${key} = ${value} is outside ${entry.range[0]}–${entry.range[1]} ${entry.unit}`);
  return out;
}

const layerCache = new Map<string, LayerFile | null>();
function layerFile(file: string): LayerFile | null {
  if (!layerCache.has(file)) layerCache.set(file, existsSync(file) ? (readJson(file) as LayerFile) : null);
  return layerCache.get(file) ?? null;
}
/** Forget the layer files read (after a write, or in tests). */
export function forgetLayers() { layerCache.clear(); }

/** The universe folder of a book's novel folder (<library>/vol-<n>/novel → <library>/universe), when there is one. */
export function universeFor(book: string | null | undefined): string | null {
  if (!book) return null;
  const library = resolve(book, "..", ".."), universe = join(library, "universe");
  return existsSync(universe) ? universe : null;
}

/** The layers that apply to a scope, lowest first, each with its name and file. */
export function layersOf(scope: Scope = {}): { layer: Layer; file: string; data: LayerFile; place?: string }[] {
  const out: { layer: Layer; file: string; data: LayerFile; place?: string }[] = [];
  const universe = scope.universe ?? universeFor(scope.book);
  const files: [Layer, string | null][] = [["universe", universe ? join(universe, "settings.json") : null], ["book", scope.book ? join(scope.book, "stage", "settings.json") : null]];
  for (const [layer, file] of files) { const data = file ? layerFile(file) : null; if (file && data) out.push({ layer, file, data }); }
  if (scope.place) for (const { file, data } of [...out]) { const own = data.places?.[scope.place]; if (own) out.push({ layer: "place", file, data: own, place: scope.place }); }
  return out;
}

/** A setting's value for a scope, and where it came from. Throws on a layer that sets it wrongly. */
export function resolveSetting(key: string, scope: Scope = {}): { value: unknown; from: string[] } {
  const entry = schema().keys[key];
  if (!entry) throw new Error(`no setting ${key} in ${SCHEMA_FILE}`);
  let value: unknown = entry.default; const from = ["defaults"];
  for (const { layer, file, data, place } of layersOf(scope)) {
    if (!data.values || !(key in data.values)) continue;
    const given = data.values[key], problems = problemsOf(key, given, layer);
    if (problems.length) throw new Error(`${file}${place ? ` (place ${place})` : ""}: ${problems.join("; ")}`);
    value = merge(value, given); from.push(place ? `place ${place} (${file})` : `${layer} (${file})`);
  }
  return { value, from };
}

/**
 * The book a process works on, so a module's own constants take the book's and its universe's layers (milestones M8c):
 * NOVEL_SETTINGS_BOOK (a novel folder, or "none"), else the first argument that is a novel folder (one holding stage/ or
 * ontology/: the director's, a rehearsal's, the transport step's, a novel command's). A place's own layer applies only
 * where the code passes the place (the fill, the expressway).
 */
let active: Scope | null = null;
function detectScope(): Scope {
  const env = process.env.NOVEL_SETTINGS_BOOK;
  if (env === "none") return {};
  if (env) return { book: resolve(env) };
  for (const arg of process.argv.slice(2)) {
    if (!arg || arg.startsWith("-")) continue;
    const path = resolve(arg);
    try { if (statSync(path).isDirectory() && (existsSync(join(path, "stage")) || existsSync(join(path, "ontology")))) return { book: path }; } catch { /* not a folder */ }
  }
  return {};
}
export function activeScope(): Scope { return (active ??= detectScope()); }
/** Work on another book from now on (a module's constants read before keep the scope they had). */
export function useScope(scope: Scope) { active = scope; announced.clear(); }
const announced = new Set<string>();
function withActive(scope: Scope): Scope {
  const base = activeScope();
  return { universe: scope.universe ?? (scope.book ? null : base.universe ?? null), book: scope.book ?? base.book ?? null, place: scope.place ?? null };
}

/** A setting's value: the defaults under the active book's layers, or a given scope's (a place's with `place`). */
export function setting<T = unknown>(key: string, scope: Scope = {}): T {
  const at = withActive(scope), layers = layersOf(at).filter(({ data }) => data.values && Object.keys(data.values).length);
  for (const { file } of layers) if (!announced.has(file)) { announced.add(file); console.error(`settings: overrides from ${file} (novel settings diff <novel-dir>)`); }
  return resolveSetting(key, at).value as T;
}

/** Every override in force for a scope (for a run's record): layer, place, key, value. */
export function overridesOf(scope: Scope = {}): { layer: Layer; place: string | null; key: string; value: unknown; table: boolean; file: string }[] {
  const at = withActive(scope), out: { layer: Layer; place: string | null; key: string; value: unknown; table: boolean; file: string }[] = [];
  const top: Scope = { ...at, place: null };
  for (const { layer, file, data } of layersOf(top)) {
    for (const [key, value] of Object.entries(data.values ?? {})) out.push({ layer, place: null, key, value, table: false, file });
    for (const [key, value] of Object.entries(data.tables ?? {})) out.push({ layer, place: null, key, value, table: true, file });
    for (const [place, own] of Object.entries(data.places ?? {})) {
      for (const [key, value] of Object.entries(own.values ?? {})) out.push({ layer: "place", place, key, value, table: false, file });
      for (const [key, value] of Object.entries(own.tables ?? {})) out.push({ layer: "place", place, key, value, table: true, file });
    }
  }
  return out;
}

const tableCache = new Map<string, unknown>();
/** A table (a whole configuration file) with its layers merged over it. */
export function table<T = unknown>(name: string, given: Scope = {}): T {
  const entry = schema().tables[name], scope = withActive(given);
  if (!entry) throw new Error(`no table ${name} in ${SCHEMA_FILE}`);
  if (!tableCache.has(name)) tableCache.set(name, readJson(join(ROOT, entry.file)));
  let value = tableCache.get(name);
  for (const { layer, file, data, place } of layersOf(scope)) {
    const given = data.tables?.[name];
    if (given === undefined) continue;
    if (!entry.layers.includes(layer)) throw new Error(`${file}${place ? ` (place ${place})` : ""}: table ${name} may not be set by a ${layer}`);
    value = merge(value, given);
  }
  return value as T;
}

/** Every setting's value for a scope, with where each came from (for `novel settings show`). */
export function settingsOf(scope: Scope = {}): Record<string, { value: unknown; from: string[] }> {
  return Object.fromEntries(Object.keys(schema().keys).map((key) => [key, resolveSetting(key, scope)]));
}
