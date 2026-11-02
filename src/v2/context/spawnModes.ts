/**
 * Jev's spot question for spawning (docs/v2/spawning.md §4; the user, 2026-11-01): where in its scene's place each person or
 * thing the rules could not place is when the scene begins, a choice over the place's spots as built (its floors, its
 * roof, under the street, the street in front, the composite parts inside it), read from the scene's own text. One
 * request a scene, no picture.
 */
import type { Item, Mode, Source } from "./engine.js";

/** A spot of the place: its letter, what it is in words. */
export interface SpawnSpot { letter: string; said: string }
/** Who or what is asked about: its id, its name, a person or a thing. */
export interface SpawnSubject { id: string; name: string; kind: "person" | "thing" }
export interface SpawnFocus {
  scene: { id: string; label: string; when: string | null };
  place: { name: string; kind: string; floors: number | null };
  subjects: SpawnSubject[];
  spots: SpawnSpot[];
  /** The scene's text, in reading order, as chosen (spawnLines): what Jev reads it from. */
  lines: { id: string; text: string }[];
}

/**
 * The scene's lines Jev reads: those that name someone or something asked about, or say where (its spatial words), each
 * with the line either side; then its opening; in reading order, `most` at most, a break marked where lines are skipped.
 */
export function spawnLines(lines: { id: string; text: string }[], names: string[], spatial: string[], most = 24): { id: string; text: string }[] {
  const keep = new Set<number>(), hits = lines.flatMap((line, n) => (names.some((name) => name && line.text.includes(name)) || spatial.includes(line.id) ? [n] : []));
  for (const n of hits) for (const k of [n - 1, n, n + 1]) if (k >= 0 && k < lines.length && keep.size < most) keep.add(k);
  for (let n = 0; n < lines.length && keep.size < most && n < 4; n++) keep.add(n);
  return [...keep].sort((a, b) => a - b).map((n, i, all) => ({ id: lines[n].id, text: (i && n > all[i - 1] + 1 ? "……" : "") + lines[n].text }));
}

const fixed = (name: string, of: (focus: SpawnFocus) => Record<string, unknown>): Source<SpawnFocus, unknown> => ({ name, key: name, quota: 0, keep: true, collect: (focus) => Object.entries(of(focus)).map(([id, fields]): Item => ({ id, score: 1, fields })) });

export const spawnSpotMode: Mode<SpawnFocus, unknown> = {
  name: "spawn-spot",
  task: (focus) => `The scene ${focus.scene.label}${focus.scene.when ? ` (${focus.scene.when})` : ""} takes place in ${focus.place.name} (${focus.place.kind}${focus.place.floors ? `, ${focus.place.floors} floors` : ""}). Where is each of those asked about when the scene begins? Read it from the scene's text (scene); where it says nothing, what is likeliest for such a place.`,
  sources: [
    fixed("scene", (focus) => Object.fromEntries(focus.lines.map((line) => [line.id, line.text]))),
    fixed("who", (focus) => Object.fromEntries(focus.subjects.map((subject) => [subject.id, `${subject.name} (${subject.kind})`]))),
    fixed("spots", (focus) => Object.fromEntries(focus.spots.map((spot) => [spot.letter, spot.said]))),
  ],
  cutOrder: [],
  questions: (focus) => focus.subjects.map((subject) => ({ key: subject.id, primitive: "choice" as const, instructions: `Where is ${subject.name} when the scene begins?`, options: focus.spots.map((spot) => spot.letter), optionHints: Object.fromEntries(focus.spots.map((spot) => [spot.letter, `${spot.letter}: ${spot.said}`])) })),
  budget: 12000,
};
