/**
 * Interaction sheets (milestones M15; docs/v2/models-and-settings.md §11; the user, 2026-11-09: large things "should be
 * also configured in the warehouse for interactability"). What a part does in the world besides being seen: whether it
 * blocks a walk where it stands, which layer it lives in, how many it seats, what its crash or explosion does to what it
 * hits when the text says it crashes (a degree as the digest's damage words, 0 to 4, and a radius), what it becomes when
 * broken (a wreck part, its structure cells, nothing). Defaults by kind and kit category, scaled to the part's size;
 * overrides by the `models.interact` setting (a part's reference or a kind as the key), layered universe < book.
 */
import { setting } from "../settings.js";

export interface Interact { solid: boolean; layer: "ground" | "air" | "water"; seats: number; crash: { degree: number; radius: number }; breaks: "wreck" | "structure" | "none"; wreck: string | null }
type Partial_ = { [K in keyof Interact]?: Interact[K] extends object ? Partial<Interact[K]> : Interact[K] };

/** The defaults a kind of thing brings (the vehicle kinds as mounts.mjs names them; the nomination's kinds; kit categories). */
export const BY_KIND: Record<string, Partial_> = {
  "a car": { solid: true, layer: "ground", seats: 5, crash: { degree: 1, radius: 4 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  "a van or a truck": { solid: true, layer: "ground", seats: 3, crash: { degree: 1, radius: 5 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  "a bus": { solid: true, layer: "ground", seats: 40, crash: { degree: 2, radius: 8 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  "a train or a carriage": { solid: true, layer: "ground", seats: 200, crash: { degree: 3, radius: 12 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  "a motorbike or a bicycle": { solid: false, layer: "ground", seats: 2, crash: { degree: 0, radius: 1 }, breaks: "wreck", wreck: null },
  "a boat": { solid: true, layer: "water", seats: 10, crash: { degree: 1, radius: 4 }, breaks: "wreck", wreck: null },
  "a helicopter": { solid: true, layer: "air", seats: 6, crash: { degree: 3, radius: 12 }, breaks: "wreck", wreck: "kit:cw_veh_heli_wreck" },
  "an aircraft": { solid: true, layer: "air", seats: 200, crash: { degree: 4, radius: 30 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  "a drone": { solid: false, layer: "air", seats: 0, crash: { degree: 0, radius: 1 }, breaks: "none", wreck: null },
  "a robot or a machine": { solid: true, layer: "ground", seats: 0, crash: { degree: 2, radius: 6 }, breaks: "structure", wreck: null },
  "a heavy weapon": { solid: true, layer: "ground", seats: 0, crash: { degree: 2, radius: 6 }, breaks: "structure", wreck: null },
  "a sign or a screen": { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "structure", wreck: null },
  furniture: { solid: true, layer: "ground", seats: 1, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  "a small weapon": { solid: false, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  "a handheld thing": { solid: false, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  "a bag or a box": { solid: false, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  "a building": { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "structure", wreck: null },
  // Kit categories (gkNextEngine's contract: the second segment of a module's name).
  veh: { solid: true, layer: "ground", seats: 4, crash: { degree: 1, radius: 4 }, breaks: "wreck", wreck: "kit:cw_veh_wreck" },
  bldg: { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "structure", wreck: null },
  nature: { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  prop: { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  furn: { solid: true, layer: "ground", seats: 1, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  wpn: { solid: false, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
  item: { solid: false, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null },
};
const PLAIN: Interact = { solid: true, layer: "ground", seats: 0, crash: { degree: 0, radius: 0 }, breaks: "none", wreck: null };
/** A vehicle kit part by the words of its name (a kit's bus is a bus whatever its category says). */
const VEH_WORDS: [RegExp, string][] = [[/airliner|plane|jet/, "an aircraft"], [/heli/, "a helicopter"], [/bus/, "a bus"], [/truck|lorry|tractor|harvester|tank|btr|hauler/, "a van or a truck"], [/boat|ship/, "a boat"], [/bike|cycle/, "a motorbike or a bicycle"], [/drone/, "a drone"], [/car|sedan|taxi|lada|uaz|pickup|van|gt3|safety/, "a car"]];

const merge = (base: Interact, over: Partial_ | undefined): Interact => (over ? { ...base, ...over, crash: { ...base.crash, ...(over.crash ?? {}) } } : base);

/** A part's sheet: its kind's (or category's) defaults, a big static thing breaking as structure, then the book's overrides by reference and by kind. */
export function interactOf(part: { ref?: string; name?: string; kind?: string | null; category?: string | null; size?: number[] | null }, overrides: Record<string, Partial_> = setting<Record<string, Partial_>>("models.interact")): Interact {
  const kind = part.kind ?? null, category = part.category ?? null;
  const byWords = category === "veh" || kind === "veh" ? VEH_WORDS.find(([pattern]) => pattern.test(String(part.name ?? "").toLowerCase()))?.[1] ?? null : null;
  let sheet = merge(merge(PLAIN, BY_KIND[category ?? ""]), BY_KIND[byWords ?? kind ?? ""]);
  const longest = Math.max(0, ...(part.size ?? []));
  // Anything 10 m or taller carries structure (the player's rule for big things): broken, it loses cells, not its whole
  // shape; and its fall reaches a third of its length, whatever its kind says.
  if (longest >= 10) sheet = { ...sheet, breaks: sheet.breaks === "none" ? "structure" : sheet.breaks, crash: { degree: Math.max(sheet.crash.degree, 1), radius: Math.max(sheet.crash.radius, Math.round(longest / 3)) } };
  sheet = merge(sheet, kind ? overrides[kind] : undefined);
  if (part.ref) sheet = merge(sheet, overrides[part.ref]);
  return sheet;
}

/** What is wrong with a `models.interact` value (keys are part references or kinds; each a partial sheet). */
export function checkInteract(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["models.interact must be an object: { \"<part or kind>\": { solid, layer, seats, crash: { degree, radius }, breaks, wreck } }"];
  const out: string[] = [];
  for (const [key, sheet] of Object.entries(value as Record<string, unknown>)) {
    if (typeof sheet !== "object" || sheet === null || Array.isArray(sheet)) { out.push(`models.interact.${key} must be an object`); continue; }
    const s = sheet as Record<string, unknown>;
    for (const name of Object.keys(s)) if (!["solid", "layer", "seats", "crash", "breaks", "wreck"].includes(name)) out.push(`models.interact.${key}.${name} is not a part of a sheet (solid, layer, seats, crash, breaks, wreck)`);
    if ("solid" in s && typeof s.solid !== "boolean") out.push(`models.interact.${key}.solid must be true or false`);
    if ("layer" in s && !["ground", "air", "water"].includes(String(s.layer))) out.push(`models.interact.${key}.layer must be ground, air or water`);
    if ("seats" in s && !(typeof s.seats === "number" && s.seats >= 0 && s.seats <= 1000)) out.push(`models.interact.${key}.seats must be 0 to 1000`);
    if ("breaks" in s && !["wreck", "structure", "none"].includes(String(s.breaks))) out.push(`models.interact.${key}.breaks must be wreck, structure or none`);
    if ("wreck" in s && s.wreck !== null && !(typeof s.wreck === "string" && /^[a-z][a-z0-9_-]*:[\p{L}\p{N}._-]+$/u.test(s.wreck))) out.push(`models.interact.${key}.wreck must be a part reference or null`);
    if ("crash" in s) { const c = s.crash as Record<string, unknown> | null; if (typeof c !== "object" || c === null) out.push(`models.interact.${key}.crash must be { degree, radius }`); else { if ("degree" in c && !(typeof c.degree === "number" && c.degree >= 0 && c.degree <= 4)) out.push(`models.interact.${key}.crash.degree must be 0 to 4 (the digest's damage degrees)`); if ("radius" in c && !(typeof c.radius === "number" && c.radius >= 0 && c.radius <= 200)) out.push(`models.interact.${key}.crash.radius must be 0 to 200 m`); } }
  }
  return out;
}
