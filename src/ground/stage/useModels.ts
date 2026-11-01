/**
 * Which model of the 3D library draws each building (docs/v2/model-kit.md). One table for the whole world, in
 * config/models.json: each use's models with the floors each can stand for (`fill`, and `named` for a building the story
 * names), the use of a fill building kind, of an engine role, and the models of an older world (only on ancient ground).
 * The library is apps/playground/src/data/architectureModels.json (Kenney's, KayKit's and Quaternius's CC0 kits, baked by
 * apps/playground/tools/*-models.mjs). The reference page docs/v2/street-compatibility.html is made from it
 * (experiments/v2/compat-page.mjs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface UseModels { own: string[]; standIn: string[]; named?: string[]; note?: string }
/** A model and the floors it can stand for ([least, most]). */
export type Floors = Record<string, [number, number]>;
export interface ModelTable { uses: Record<string, { fill: Floors; named?: Floors }>; kinds: Record<string, string>; roles: Record<string, string>; ancient: Record<string, string[]> }
const DEFAULT = fileURLToPath(new URL("../../../../config/models.json", import.meta.url));
/** The model table (config/models.json, or a file of one's own). */
export const loadModels = (file = DEFAULT): ModelTable => JSON.parse(readFileSync(file, "utf8"));
export const MODELS = loadModels();
/** Shapes built in ArchitectureHolograms.tsx from the library, not models of it (the playground's place holograms). */
export const BUILT_SHAPES: Record<string, string> = { hospital: "office-k with a red cross on its roof", church: "a nave, a pitched roof, a bell tower with a spire, an apse", station: "a platform under a barrel vault on columns, a clock tower at one end" };
/** Each use's models as the reference page lists them: its own (fill and named); no stand-ins now; a use with none is a gap. */
export const USE_MODELS: Record<string, UseModels> = Object.fromEntries(Object.entries(MODELS.uses).map(([use, entry]) => [use, { own: Object.keys(entry.fill), standIn: [], named: Object.keys(entry.named ?? {}), ...(Object.keys(entry.fill).length ? {} : { note: "no model: a plain block" }) }]));

/** A free model found on the web that could fill a gap: not in the library (each needs the user's go-ahead to download). */
export interface Candidate { name: string; licence: string; url: string; has: string }
const METRO: Candidate = { name: "Metro, by elbolilloduro (itch.io)", licence: "CC0, by its listing (to be checked before use)", url: "https://elbolilloduro.itch.io/metro", has: "a subway platform, a tiled corridor, ticket machines, turnstiles (.fbx, .dae, .glb)" };
/**
 * Which models stand for each kind of underground hall (underground.ts; the terrain view dresses passages, tunnels, malls
 * and shelters in theirs, strand-demo.html UNDER_MODELS). Found on the web (2026-10-31): one CC0 subway kit; no free car
 * park, storm-water or basement model.
 */
export const UNDERGROUND_MODELS: Record<string, UseModels & { candidates?: Candidate[] }> = {
  tunnel: { own: ["kk-tunnel", "kk-tunnel-bend"], standIn: [] },
  station: { own: [], standIn: ["kk-tunnel"], candidates: [METRO] },
  corridor: { own: ["kk-tunnel", "kk-tunnel-bend"], standIn: [], candidates: [METRO] },
  mall: { own: [], standIn: ["kk-mall"], note: "an underground shopping street: under a road, or under a station's plaza" },
  parking: { own: [], standIn: [], note: "no free model found: drawn as its volume" },
  utility: { own: [], standIn: ["kk-tunnel"] },
  tank: { own: [], standIn: [], note: "drawn as its volume" },
  channel: { own: [], standIn: [], note: "drawn as its volume" },
  shelter: { own: [], standIn: ["kk-military"], note: "often a car park in peace" },
  basement: { own: [], standIn: [], note: "a building's floors below the street: drawn as its volume" },
  lab: { own: ["kk-lab"], standIn: [] },
  military: { own: ["kk-military"], standIn: [] },
  quantum: { own: ["kk-quantum"], standIn: [] },
};

/** The fill's building kinds as uses (a CBD's skyscrapers and towers are offices, a terrace's houses homes). */
export const KIND_USE: Record<string, string> = MODELS.kinds;
/** A building's use: its own (a street's buildings), else its kind's. */
export const useOf = (building: { kind: string; use?: string }) => building.use ?? KIND_USE[building.kind] ?? null;
const hash = (seed: string) => [...seed].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);
/** Of some models, the ones whose height over width is nearest the building's own, one of them by a seed. */
function nearest(models: string[], building: { w: number; d: number; floors: number }, seed: string, sizes: Record<string, number[]>): string {
  const ratio = (building.floors * 3) / Math.max(1, building.w, building.d), fit = (model: string) => Math.abs(Math.log(sizes[model][1] / Math.max(sizes[model][0], sizes[model][2]) / ratio));
  const best = Math.min(...models.map(fit)), near = models.filter((model) => fit(model) <= best + 0.4).sort();
  return near[hash(seed) % near.length];
}
/** Of a table's models (in the library), those whose floors hold the building's (else the nearest), the nearest by proportions; null for none. */
function byFloors(table: Floors | undefined, building: { w: number; d: number; floors: number }, seed: string, sizes: Record<string, number[]>, holding = false): string | null {
  const models = Object.entries(table ?? {}).filter(([model]) => sizes[model]);
  if (!models.length) return null;
  const off = ([, [least, most]]: [string, [number, number]]) => Math.max(0, least - building.floors, building.floors - most), closest = Math.min(...models.map(off));
  if (holding && closest > 0) return null;
  return nearest(models.filter((model) => off(model) === closest).map(([model]) => model), building, seed, sizes);
}
/**
 * The model a building is drawn as (docs/v2/model-kit.md): on ancient ground, its kind's model of an older world; else,
 * of its use's models, those whose floors hold its own (a named building's own models first, when one holds it), the
 * nearest by proportions, one of them by a seed; null when its use has none (a plain block). `sizes`: each library
 * model's size (architectureModels.json).
 */
export function modelFor(building: { kind: string; use?: string; w: number; d: number; floors: number; era?: string; named?: boolean }, seed: string, sizes: Record<string, number[]>, table: ModelTable = MODELS): string | null {
  if (building.era === "ancient") {
    const old = (table.ancient[building.kind] ?? table.ancient["*"] ?? []).filter((model) => sizes[model]);
    return old.length ? old[hash(seed) % old.length] : null;
  }
  const use = building.use ?? table.kinds[building.kind] ?? null, entry = use ? table.uses[use] : null;
  if (!entry) return null;
  return (building.named ? byFloors(entry.named, building, seed, sizes, true) : null) ?? byFloors(entry.fill, building, seed, sizes);
}
/**
 * The model of an engine lot or shell with no building model of its own (docs/v2/model-kit.md): its role's use, or, for a
 * named building, what it was matched as (a school, a skyscraper); an office when neither has a use.
 */
export function roleModel(lot: { role: string; w: number; d: number; floors: number; era?: string; named?: string }, seed: string, sizes: Record<string, number[]>, table: ModelTable = MODELS): string | null {
  const use = (lot.named && table.roles[lot.named]) || table.roles[lot.role] || "office";
  return modelFor({ kind: "", use, w: lot.w, d: lot.d, floors: lot.floors, era: lot.era, named: !!lot.named }, seed, sizes, table) ?? modelFor({ kind: "", use: "office", w: lot.w, d: lot.d, floors: lot.floors }, seed, sizes, table);
}
