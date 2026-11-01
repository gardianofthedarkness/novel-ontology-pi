/**
 * The spawning configurations (docs/v2/borrow-and-spawn.md §2.1, §5; the user's design, 2026-11-01): what an area of each
 * type spawns one level down. Read across the levels they make a tree: a city's kind gives districts of each kind and how
 * many, a district's kind streets, a street's kind buildings by density and use. The files in config/spawning/ are the
 * defaults; a configuration is resolved through a resolver, so a universe's own files, a place's own and a function or a
 * review of the place can be layered over them later (§5) without changing the engine.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The levels borrowing and spawning run through, largest first, and the level each spawns. */
export type Level = "city" | "district" | "street" | "building";
export const LEVELS: Level[] = ["city", "district", "street", "building"];
export const CHILD: Record<Level, Level | null> = { city: "district", district: "street", street: "building", building: null };

/** How many of a kind: a number, or a range [least, most] picked once for each parent by a seed. */
export type Count = number | [number, number];
/** A street's buildings: how many a hectare, and the share of each use; `takes`, the ground's own it is (see streetTakes). */
export interface Density { density: number; uses: Record<string, number>; takes?: Takes }
/**
 * A street that is the ground's own, not an area laid out apart (street.json `takes`; the user, 2026-11-01): an avenue takes
 * a road of the city at least `road` m wide, a crossing the meeting of two roads each at least `crossing` m wide. It builds
 * no form of its own; its buildings are the city's lots already round it.
 */
export interface Takes { road?: number; crossing?: number }
/** How a parent's children lie (§8.2): each kind's ring (a share of the parent's radius from its centre), and kinds near or apart. */
export interface Topology { ring: Record<string, [number, number]>; pairs: [string, string, "near" | "apart"][]; open?: string }
/** A parent kind's entry: what it spawns, and how its children lie; an older entry is its counts alone. */
export type Spawning = Record<string, Count> | ({ spawns: Record<string, Count> } & Partial<Topology>);
export interface SpawningFiles {
  city: Record<string, Spawning>;
  district: Record<string, Spawning>;
  street: Record<string, Density>;
}

const DEFAULTS = fileURLToPath(new URL("../../../../config/spawning/", import.meta.url));

/** The default configurations (config/spawning/), or another folder's of the same shape. */
export function loadSpawning(folder = DEFAULTS): SpawningFiles {
  const read = (name: string) => JSON.parse(readFileSync(`${folder.replace(/\/?$/, "/")}${name}.json`, "utf8")).types;
  return { city: read("city"), district: read("district"), street: read("street") };
}

/** The kind a parent of a level is born as before Jev is asked (its configuration's `default`; the user's call, 2026-11-01). */
export function defaultKindOf(level: "city" | "district", folder = DEFAULTS): string | null {
  return JSON.parse(readFileSync(`${folder.replace(/\/?$/, "/")}${level}.json`, "utf8")).default ?? null;
}

/** The district kinds a street kind may stand in (district.json `only`), for the kinds that cannot be anywhere; others may stand in any. */
export function streetsOnly(folder = DEFAULTS): Record<string, string[]> {
  return JSON.parse(readFileSync(`${folder.replace(/\/?$/, "/")}district.json`, "utf8")).only ?? {};
}

/**
 * Every type's minimum, a hard gate (heights.json; the user, 2026-11-01): each building type's least floors, each area
 * kind's least median (metres) by level; and how near the heights of unnamed buildings sharing a lot must be (`share`).
 */
export interface HeightChart { share: number; buildings: Record<string, number>; areas: Record<string, Record<string, number>> }
export const loadHeights = (folder = DEFAULTS): HeightChart => JSON.parse(readFileSync(`${folder.replace(/\/?$/, "/")}heights.json`, "utf8"));
/** Whether two buildings' heights may share a lot: both above the street or both under it, within a factor of `share`. */
export const heightsShare = (a: number, b: number, share: number): boolean => (a < 0) === (b < 0) && Math.max(Math.abs(a), Math.abs(b)) <= share * Math.min(Math.abs(a), Math.abs(b));

/** What a street kind takes of its ground (street.json `takes`), or null for one laid out as an area of its own. */
export const streetTakes = (kind: string, files: SpawningFiles = loadSpawning()): Takes | null => files.street[kind]?.takes ?? null;

/** The area a configuration is asked for: its id and label (a place's own layer finds it by them), its level and its kind. */
export interface Parent { id: string; label: string; level: Level; kind: string }
/** A configuration resolved for one parent, and the layer it came from (kept with its slots, so a world is made again the same way). */
export interface Resolved { spawns: Record<string, Count>; layer: string; topology?: Topology }
export type Resolver = (parent: Parent) => Resolved | null;

/** The defaults' layer: a city's or a district's kind gives its children's counts; a kind with no entry spawns nothing. */
export function defaultResolver(files: SpawningFiles = loadSpawning()): Resolver {
  return (parent) => {
    if (parent.level !== "city" && parent.level !== "district") return null;
    const entry = files[parent.level][parent.kind] ?? {};
    if (!("spawns" in entry)) return { spawns: entry as Record<string, Count>, layer: "defaults" };
    const { spawns, ring, pairs, open } = entry as { spawns: Record<string, Count> } & Partial<Topology>;
    return { spawns, layer: "defaults", ...(ring ? { topology: { ring, pairs: pairs ?? [], ...(open ? { open } : {}) } } : {}) };
    return null;
  };
}

/** A seeded number in [0, 1): the same seed gives the same number every run. */
export function seeded(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // Mixed, so seeds that differ in one character land far apart.
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** A count picked: a number as it is, a range by the seed (each whole number in it as likely). */
export function pickCount(count: Count, seed: string): number {
  if (typeof count === "number") return count;
  const [least, most] = count;
  return least + Math.floor(seeded(seed) * (most - least + 1));
}

/**
 * What a parent spawns, by kind, with the layer it came from: each count picked once by a seed of the parent's id and the
 * kind, so the same parent always spawns the same.
 */
export function spawnsOf(parent: Parent, resolver: Resolver): { counts: Record<string, number>; layer: string } {
  const resolved = resolver(parent);
  if (!resolved) return { counts: {}, layer: "none" };
  const counts = Object.fromEntries(Object.entries(resolved.spawns).map(([kind, count]) => [kind, pickCount(count, `${parent.id}|${kind}`)]).filter(([, n]) => (n as number) > 0));
  return { counts, layer: resolved.layer };
}

/**
 * A street's buildings by use (§6): its kind's density over its area, shared out by the uses' shares (largest remainders,
 * so the counts add up to the whole). A kind with no uses spawns none here (a park's pavilions are its landscape's own).
 */
export function buildingsOf(kind: string, areaM2: number, files: SpawningFiles = loadSpawning()): Record<string, number> {
  const entry = files.street[kind];
  if (!entry || !Object.keys(entry.uses).length) return {};
  const whole = Math.round((entry.density * areaM2) / 10000), total = Object.values(entry.uses).reduce((sum, share) => sum + share, 0);
  const exact = Object.entries(entry.uses).map(([use, share]) => [use, (whole * share) / total] as const);
  const counts = Object.fromEntries(exact.map(([use, n]) => [use, Math.floor(n)]));
  let left = whole - Object.values(counts).reduce((sum, n) => sum + n, 0);
  for (const [use] of [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1) || a[0].localeCompare(b[0]))) { if (left <= 0) break; counts[use]++; left--; }
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}
