/**
 * Spawning positions (docs/v2/spawning.md; the user's design, 2026-11-01): where each person and each thing of a scene
 * stands when the scene begins, people and things in one pass, by rule. Plain data and arithmetic: the world comes in as
 * `target` (what a scene's place is, as built), the strands as `entries` (who comes into each scene from where).
 *
 * - A person carries on from their own last scene at the same place, close in time (the same day, the same or the next
 *   part of it); else starts fresh. A flashback hands nothing on.
 * - A thing someone holds is at its holder's side; else it stays where it was left, however long ago, until someone picks
 *   it up; a thing seen for the first time starts fresh.
 * - A fresh start: inside a composite building's part, on its floor; in a building, on the floor its scene's spatial words
 *   say (the roof, under the street, a numbered floor, the street in front), else a random floor (the user: "start at a
 *   random floor in a random room"; Jev's choice over the place's spots is the next step); on a street or in an area, on
 *   its ground. People who come in from the same scene start together, a few metres apart; the first event's actors start
 *   within speaking distance of the first of them.
 */
import { numberOf } from "../context/measures.js";
import type { ScriptScene } from "../extraction/script.js";
import { seeded } from "../terrain/config.js";
import { closeInTime } from "../rules/time.js";
import { setting } from "../settings.js";

/** A footprint: its centre, its width and depth, its turn (world metres). */
export type Box = [number, number, number, number, number];
/** What a scene's place is as built: a composite building's part (one floor), a building (its floors), or an area's ground. */
export interface Target { place: string; kind: "part" | "building" | "area"; box: Box; bottom: number; floors: number }
/** Who comes into a scene from where (the strands' per-fork timeline). */
export interface Entry { person: string; from: string | null; samePlace: boolean }
export type By = "carried" | "stays" | "holder" | "spatial" | "group" | "speaking" | "default" | "ground" | "part";
/** A start position: who, the place and floor, the point (x, z) and its height, how it was decided, the scene it came from. */
export interface Start { who: string; kind: "person" | "thing"; scene: string; place: string | null; floor: number | null; at: [number, number]; y: number; by: By; from: string | null }

const FLOOR = setting<number>("grid.floor");
export { closeInTime };

/** A floor of a building by a spatial word: the roof its top, under the street −1, a numbered floor its number, the street 0 (in front). */
export function floorByWords(words: { text: string; level: string | null }[], floors: number): { floor: number; outside: boolean } | null {
  for (const { text, level } of words) {
    if (level === "roof" || level === "sky") return { floor: floors, outside: true };
    if (level === "underground") { const n = text.match(/地下\s*([0-9０-９一二两三四五六七八九十]+)\s*[层楼]/); return { floor: -(n ? numberOf(n[1]) ?? 1 : 1), outside: false }; }
    if (level === "street") return { floor: 0, outside: true };
    if (level === "inside") { const n = text.match(/([0-9０-９一二两三四五六七八九十百]+)\s*[楼层]/); const floor = n ? numberOf(n[1]) : null; if (floor && floor >= 1) return { floor: Math.min(floor, floors), outside: false }; }
  }
  return null;
}

/** A point of a footprint, the same each time for the same seed; `margin` inside its edge. */
export function pointIn(box: Box, seed: string, margin = 1): [number, number] {
  const [x, z, w, d, angle] = box, s = (seeded(`${seed}|s`) - 0.5) * Math.max(0, w - 2 * margin), t = (seeded(`${seed}|t`) - 0.5) * Math.max(0, d - 2 * margin), ux = Math.cos(angle), uz = Math.sin(angle);
  return [round(x + s * ux - t * uz), round(z + s * uz + t * ux)];
}
/** A point `near` another, between `least` and `most` metres away. */
export const near = (at: [number, number], seed: string, least: number, most: number): [number, number] => { const a = seeded(`${seed}|a`) * Math.PI * 2, r = least + seeded(`${seed}|r`) * (most - least); return [round(at[0] + Math.cos(a) * r), round(at[1] + Math.sin(a) * r)]; };
const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Every scene's start positions, in reading order. `target(scene, place)`: what a scene's place is as built (null: it is
 * not built, nobody there is placed); `entries`: who comes into each scene from where.
 */
export function spawnScenes(scenes: ScriptScene[], entries: Map<string, Entry[]>, target: (scene: string, place: string) => Target | null): Map<string, Start[]> {
  const out = new Map<string, Start[]>(), last = new Map<string, Start>(), at = new Map(scenes.map((scene) => [scene.id, scene.at?.node ?? null]));
  for (const scene of scenes) {
    const past = scene.clock === null, here = scene.place ? target(scene.id, scene.place) : null, starts: Start[] = [], into = new Map((entries.get(scene.id) ?? []).map((entry) => [entry.person, entry]));
    const base = (who: string, kind: Start["kind"]) => ({ who, kind, scene: scene.id, place: scene.place });
    // A fresh start on this scene's place: its floor and point (`seed` makes it the same each time).
    const fresh = (who: string, kind: Start["kind"], from: string | null): Start | null => {
      if (!here) return null;
      const seed = `${scene.id}|${who}`, words = (scene.spatial ?? []).filter((mention) => !mention.who.length || mention.who.includes(who));
      if (here.kind === "part") return { ...base(who, kind), floor: Math.round(here.bottom / FLOOR) + 1, at: pointIn(here.box, seed), y: here.bottom, by: "part", from };
      if (here.kind === "area") return { ...base(who, kind), floor: 0, at: pointIn(here.box, seed), y: 0, by: "ground", from };
      const said = floorByWords(words, here.floors);
      if (said?.floor === 0) { const [x, z, w, d, angle] = here.box; return { ...base(who, kind), floor: 0, at: pointIn([x - Math.sin(angle) * (d / 2 + 4), z + Math.cos(angle) * (d / 2 + 4), w, 4, angle], seed), y: 0, by: "spatial", from }; }
      const floor = said ? said.floor : 1 + Math.floor(seeded(`${seed}|floor`) * Math.max(1, here.floors));
      const y = floor === here.floors && said?.outside ? floor * FLOOR : floor < 0 ? floor * 6 : here.bottom + (floor - 1) * FLOOR;
      return { ...base(who, kind), floor, at: pointIn(here.box, seed), y, by: said ? "spatial" : "default", from };
    };
    // People: carried on from their own last scene at this place, close in time; else fresh, together with whoever comes from the same scene.
    const groups = new Map<string, Start>();
    for (const who of scene.present) {
      const entry = into.get(who), was = last.get(who);
      if (!past && entry?.from && entry.samePlace && was && was.scene === entry.from && closeInTime(at.get(entry.from), scene.at?.node)) { starts.push({ ...was, scene: scene.id, by: "carried", from: entry.from }); continue; }
      const from = entry?.from ?? null, lead = from && !entry?.samePlace ? groups.get(from) : null;
      const start = lead ? { ...lead, who, at: near(lead.at, `${scene.id}|${who}`, 1, 2.5), by: "group" as By, from } : fresh(who, "person", from);
      if (!start) continue;
      if (from && !lead && !entry?.samePlace) groups.set(from, start);
      starts.push(start);
    }
    // The first event's actors, fresh here, within speaking distance of the first of them.
    const actors = (scene.timeline[0]?.actors ?? []).filter((who) => scene.present.includes(who)), first = starts.find((start) => start.who === actors[0]);
    if (first) for (const start of starts) if (start !== first && actors.includes(start.who) && start.by !== "carried" && start.floor === first.floor) Object.assign(start, { at: near(first.at, `${scene.id}|${start.who}|speak`, 2, 5), y: first.y, by: "speaking" as By });
    // Things: at their holder's side; else where they were left; else fresh.
    for (const thing of scene.things ?? []) {
      const holder = thing.holder ? starts.find((start) => start.who === thing.holder) : null, was = last.get(thing.id);
      const start: Start | null = holder ? { ...holder, who: thing.id, kind: "thing", at: near(holder.at, `${scene.id}|${thing.id}`, 0.3, 0.8), by: "holder", from: holder.who }
        : was ? { ...was, scene: scene.id, by: "stays", from: was.scene } : fresh(thing.id, "thing", null);
      if (start) starts.push(start);
    }
    out.set(scene.id, starts);
    // A flashback hands nothing on.
    if (!past) for (const start of starts) last.set(start.who, start);
  }
  return out;
}
