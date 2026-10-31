/**
 * Which models of the 3D library can stand for each building use (docs/v2/world-engine-v2.md §2.0.15; the reference page
 * docs/v2/street-compatibility.html, made by experiments/v2/compat-page.mjs). The library is
 * apps/playground/src/data/architectureModels.json (Kenney's and KayKit's kits) with the shapes ArchitectureHolograms.tsx
 * builds from it (hospital, church, station). `own`: made for that use; `standIn`: a near model until one is made; a use
 * with neither is a gap, drawn as a plain block.
 */
export interface UseModels { own: string[]; standIn: string[]; note?: string }
const TOWERS = "abcdefghijklm".split("").map((letter) => `tower-${letter}`);
/** Shapes built in ArchitectureHolograms.tsx from the library, not models of it. */
export const BUILT_SHAPES: Record<string, string> = { hospital: "office-k with a red cross on its roof", church: "a nave, a pitched roof, a bell tower with a spire, an apse", station: "a platform under a barrel vault on columns, a clock tower at one end" };
export const USE_MODELS: Record<string, UseModels> = {
  convenience: { own: [], standIn: ["block-wide-a"], note: "a small shop front would do" },
  shop: { own: [], standIn: ["block-wide-a", "block-wide-b"] },
  cafe: { own: [], standIn: ["block-wide-a"] },
  restaurant: { own: [], standIn: ["block-wide-b"] },
  bar: { own: [], standIn: ["block-wide-a"] },
  arcade: { own: [], standIn: ["kk-mall"] },
  bank: { own: [], standIn: ["office-k", "office-c"] },
  mall: { own: ["kk-mall"], standIn: [] },
  department: { own: [], standIn: ["kk-mall"] },
  cinema: { own: [], standIn: ["kk-mall"] },
  office: { own: ["office-c", "office-k", ...TOWERS, "skyscraper-a", "skyscraper-b", "skyscraper-e"], standIn: ["block-wide-b"] },
  hotel: { own: [], standIn: ["tower-c", "tower-f", "office-h"] },
  apartment: { own: ["kk-apartment"], standIn: [] },
  dormitory: { own: ["kk-dormitory"], standIn: ["kk-apartment"] },
  house: { own: [], standIn: ["office-c"], note: "the hologram view draws a home as office-c" },
  school: { own: ["kk-school"], standIn: ["office-h"] },
  hospital: { own: ["hospital"], standIn: [] },
  clinic: { own: [], standIn: ["hospital"] },
  station: { own: ["station"], standIn: [], note: "a station's passages below the street are drawn as halls (kk-tunnel)" },
  government: { own: [], standIn: ["office-k", "office-h"] },
  church: { own: ["church"], standIn: [] },
  lab: { own: ["kk-lab", "kk-quantum"], standIn: [] },
  workshop: { own: [], standIn: ["kk-lab"] },
  warehouse: { own: [], standIn: [], note: "no model: a plain block" },
  parking: { own: [], standIn: [], note: "no model: a plain block" },
};

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
export const KIND_USE: Record<string, string> = { skyscraper: "office", tower: "office", office: "office", shop: "shop", mall: "mall", house: "house", townhouse: "house", cottage: "house", farmhouse: "house", apartment: "apartment", warehouse: "warehouse", station: "station" };
/** Kinds drawn as a model of their own whatever their use (an old town's keep and market hall, a fountain). */
const KIND_MODELS: Record<string, string[]> = { keep: ["keep"], fountain: ["fountain"], hall: ["market"] };
/** A building's use: its own (a street's buildings), else its kind's. */
export const useOf = (building: { kind: string; use?: string }) => building.use ?? KIND_USE[building.kind] ?? null;
/**
 * The model a building is drawn as in the terrain view (docs/v2/world-engine-v2.md §2.0.16): of its use's models (its own,
 * else its stand-ins), the ones whose height over width is nearest its own, one of them by a seed; null when its use has
 * none in the library (a plain block). `sizes`: each library model's size (architectureModels.json).
 */
export function modelFor(building: { kind: string; use?: string; w: number; d: number; floors: number }, seed: string, sizes: Record<string, number[]>): string | null {
  const use = useOf(building), entry = use ? USE_MODELS[use] : null, has = (model: string) => !!sizes[model];
  const own = (KIND_MODELS[building.kind] ?? entry?.own ?? []).filter(has), candidates = own.length ? own : (entry?.standIn ?? []).filter(has);
  if (!candidates.length) return null;
  const ratio = (building.floors * 3) / Math.max(1, building.w, building.d), fit = (model: string) => Math.abs(Math.log(sizes[model][1] / Math.max(sizes[model][0], sizes[model][2]) / ratio));
  const best = Math.min(...candidates.map(fit)), near = candidates.filter((model) => fit(model) <= best + 0.4).sort();
  const hash = [...seed].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);
  return near[hash % near.length];
}
