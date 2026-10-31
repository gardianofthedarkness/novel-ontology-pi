import { scaleOfName } from "../digger/stage/scale.js";
import { actionEvents, cardPeople } from "./canon.js";
import type { FlowResult } from "./flow.js";

/**
 * The world script from the v2 reading (the user's call, 2026-10-31: replace the world-first loop's script and build on the
 * extraction we have). The stage and the engine read a world-first book's scenes through stage/world/script.json: each
 * scene's place, who is present, whether it is in the past, and its events in order. The v1 world loop decided these with
 * the main agent, batch by batch, before anything else could run; the reading has decided them already, so here they are
 * read off it, with no model call:
 * - place: where the scene is set, by the named places its cards name or describe: those its environment cards name come
 *   first (the deepest of them), then those its action cards name (the most named), then any (the most named; talk of a
 *   school or a country is not where a scene is, so a place found only so that holds the last scene's place keeps that
 *   one). Then the deepest place under it the scene sets in an environment card or names twice. An unnamed building or
 *   room an environment card names (an EM² slot) is more specific still, in the place that holds it (rooms are the
 *   smallest unit; a big unnamed place is left to the world engine, which places it live). A scene that names no place
 *   carries the place of the scene before it, unless it is in the past or the time tree says it does not go on from it;
 *   else it has none (and is not staged).
 * - present: who speaks, acts or is spoken to in its cards (someone only named or described is not there);
 * - clock: null for a scene in the past (the time tree's flashback), else its story-time span;
 * - firstSeen: who is present for the first time (in reading order, the past aside): where the engine's births are;
 * - timeline: its events (the action cards, with the canon's ids) in reading order;
 * - context: its environment cards, which open each of its questions.
 * places: every named place with its parent in the place tree and its scale as far as the reading says it (a building or a
 * room by its type, else by its name, else one step above the largest place it holds: 日本 holding 东京都 is a region), and
 * each unnamed place a scene is set in.
 */
export interface ScriptPlace { label: string; scale: string | null; parent: string | null; unnamed?: boolean }
export interface ScriptScene {
  id: string; chapter: number; place: string | null; placeBy: "environment" | "action" | "named" | "unnamed" | "carried" | "none";
  clock: number[] | null; present: string[]; stayed: string[]; firstSeen: string[];
  timeline: { type: "event"; id: string; actors: string[] }[]; context?: string;
}
export interface ReadingScript { version: 2; from: "v2-reading"; places: Record<string, ScriptPlace>; scenes: ScriptScene[] }

const PRESENT = new Set(["speaks", "acts", "addressed"]);
const SIZES = ["room", "building", "street", "district", "city", "region"];
const CONTEXT = 600;

export function readingScript(result: FlowResult, text: (sentence: string) => string): ReadingScript {
  const entity = (id: string) => result.chart.entities.get(id), category = (id: string) => entity(id)?.category;
  const label = (id: string) => entity(id)?.proper[0] ?? entity(id)?.names[0] ?? id;
  const parentOf = new Map((result.places?.places ?? []).map((entry) => [entry.id, entry.parent]));
  const depth = (id: string) => { let n = 0; for (let at = parentOf.get(id), seen = new Set([id]); at && !seen.has(at); at = parentOf.get(at)) { seen.add(at); n++; } return n; };
  const under = (id: string, top: string) => { for (let at = parentOf.get(id), n = 0; at && n < 16; at = parentOf.get(at), n++) if (at === top) return true; return false; };
  const sceneOf = new Map(result.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id] as const)));
  const cardsOf = new Map<string, FlowResult["cards"]>();
  for (const card of result.cards) { const scene = sceneOf.get(card.first); if (scene) cardsOf.set(scene, [...(cardsOf.get(scene) ?? []), card]); }
  const eventOf = new Map(actionEvents(result).map(({ id, card }) => [card.id, id]));
  const when = new Map((result.time?.scenes ?? []).map((scene) => [scene.scene, scene]));
  const storyIndex = new Map((result.time?.periods ?? []).map((period) => [period.id, period.storyIndex]));

  const places: Record<string, ScriptPlace> = Object.fromEntries([...result.chart.entities.values()].filter((place) => place.category === "place").map((place) => [place.id, {
    label: label(place.id), parent: parentOf.get(place.id) ?? null,
    scale: place.type === "building" || place.type === "room" ? place.type : (() => { const scale = scaleOfName(label(place.id)); return scale && scale !== "none" ? scale : null; })(),
  }]));
  for (let pass = 0; pass < SIZES.length; pass++) for (const [id, place] of Object.entries(places)) {
    if (place.scale) continue;
    const largest = Math.max(-1, ...Object.values(places).filter((other) => other.parent === id && other.scale).map((other) => SIZES.indexOf(other.scale!)));
    if (largest >= 0) place.scale = SIZES[Math.min(largest + 1, SIZES.length - 1)];
  }
  const seen = new Set<string>();
  let previous: string | null = null, clock: number[] | null = null;
  const scenes = result.scenes.map((scene): ScriptScene => {
    const cards = cardsOf.get(scene.id) ?? [], time = when.get(scene.id), past = !!time?.flashback;
    // The named places it names or describes: in its environment cards, in its action cards, anywhere (how often).
    const named = (kinds: string[] | null) => {
      const count = new Map<string, number>();
      for (const card of cards) if (!kinds || kinds.includes(card.kind)) for (const id of new Set([...card.entities.map((hit) => hit.id), ...card.people.map((person) => person.id)])) if (category(id) === "place") count.set(id, (count.get(id) ?? 0) + 1);
      return count;
    };
    const set = named(["environment"]), acted = named(["action"]), any = named(null);
    const most = (count: Map<string, number>) => [...count].sort((a, b) => b[1] - a[1] || depth(b[0]) - depth(a[0]))[0]?.[0] ?? null;
    let place = [...set.keys()].sort((a, b) => depth(b) - depth(a) || (set.get(b) ?? 0) - (set.get(a) ?? 0))[0] ?? null;
    let by: ScriptScene["placeBy"] = place ? "environment" : "none";
    if (!place && (place = most(acted))) by = "action";
    if (!place && (place = most(any))) by = "named";
    if (by === "named" && place && previous && !past && under(previous, place)) { place = previous; by = "carried"; }
    const deeper = place && by !== "carried" ? [...any].filter(([id, count]) => under(id, place!) && (set.has(id) || count >= 2)).sort((a, b) => depth(b[0]) - depth(a[0]))[0] : undefined;
    if (deeper) place = deeper[0];
    // An unnamed building or room the environment cards name, in the place (or under it), rooms first.
    const setting = new Set(cards.filter((card) => card.kind === "environment").flatMap((card) => card.sentences));
    const fits = (holder: string | null | undefined) => !holder || !place || holder === place || under(holder, place) || under(place, holder);
    const unnamed = result.slots.filter((slot) => slot.scene === scene.id && (slot.kind === "room" || slot.kind === "building") && slot.sentences.some((id) => setting.has(id)) && fits(slot.in))
      .sort((a, b) => (a.kind === "room" ? 0 : 1) - (b.kind === "room" ? 0 : 1) || b.sentences.length - a.sentences.length)[0];
    if (unnamed) {
      const id = `unnamed:${unnamed.id}`, holder = unnamed.in && place && under(unnamed.in, place) ? unnamed.in : place ?? unnamed.in ?? null;
      places[id] = { label: `${unnamed.label} (scene ${scene.index + 1})`, scale: unnamed.kind, parent: holder, unnamed: true };
      place = id; by = "unnamed";
    }
    if (!place && !past && previous && time?.continuation?.continues !== false) { place = previous; by = "carried"; }
    if (!past && place) previous = place;
    // Its story-time span; a scene the tree gives no period keeps the one before.
    const indices = (time?.periods ?? []).map((id) => storyIndex.get(id)).filter((value): value is number => typeof value === "number");
    if (!past) clock = indices.length ? [Math.min(...indices), Math.max(...indices)] : clock ?? [0, 0];
    const present = [...new Set(cards.flatMap((card) => card.people.filter((person) => category(person.id) === "person" && person.how.some((how) => PRESENT.has(how))).map((person) => person.id)))];
    const firstSeen = past ? [] : present.filter((id) => !seen.has(id));
    if (!past) for (const id of present) seen.add(id);
    const environment = cards.filter((card) => card.kind === "environment").map((card) => card.sentences.map(text).join("")).join(" ");
    return {
      id: scene.id, chapter: scene.chapter, place, placeBy: by, clock: past ? null : clock, present, stayed: [], firstSeen,
      timeline: cards.filter((card) => eventOf.has(card.id)).map((card) => ({ type: "event" as const, id: eventOf.get(card.id)!, actors: cardPeople(result, card).people })),
      ...(environment ? { context: `Environment: ${environment.length > CONTEXT ? `${environment.slice(0, CONTEXT - 1)}…` : environment}` } : {}),
    };
  });
  return { version: 2, from: "v2-reading", places, scenes };
}
