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
  station: { own: ["station"], standIn: ["kk-tunnel", "kk-tunnel-bend"], note: "the tunnels for a station below the street" },
  government: { own: [], standIn: ["office-k", "office-h"] },
  church: { own: ["church"], standIn: [] },
  lab: { own: ["kk-lab", "kk-quantum"], standIn: [] },
  workshop: { own: [], standIn: ["kk-lab"] },
  warehouse: { own: [], standIn: [], note: "no model: a plain block" },
  parking: { own: [], standIn: [], note: "no model: a plain block" },
};
