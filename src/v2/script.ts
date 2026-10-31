import { actionEvents, cardPeople } from "./canon.js";
import type { FlowResult } from "./flow.js";
import { isPresent, LANGUAGE, SCALES } from "./rules/index.js";
import { levelOf } from "./spatial.js";

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
 * - context: its environment cards, which open each of its questions;
 * - spatial: who or what its spatial words (on the ground, underground, on the roof) say is where, and at what level.
 * places: every named place with its parent in the place tree and its scale as far as the reading says it (a building or a
 * room by its type, else by its name, else one step above the largest place it holds: 日本 holding 东京都 is a region), and
 * every unnamed place found (a place, a building or a room of a scene: a big unnamed place as a street) with what holds it.
 * Since place EM (src/v2/placeEm.ts, docs/v2/world-model.md §5) the settings and the unnamed places are its: an unnamed
 * place the text puts in a place is `held: "stated"`; one place EM put in its scene's setting is `held: "setting"`, which
 * the engine shows as sampled, blinking, until the text or Jev says where it is. A reading from before place EM: the tiers
 * below, and EM²'s place slots (`held: "em2"`, or `"scene"` for a guess).
 */
/**
 * near: a named building or room the tree puts nowhere: the named area its scenes are set in most (where it is sampled
 * first); nears: every named area its scenes are set in (its possible pools, pools.ts). pool: a sampling pool's area
 * (docs/v2/world-engine-v2.md §2.0.11); pools: the pools a thing could be in, when picked among them; elsewhere: a pool
 * member from another book of the universe, standing as a marker.
 */
export interface ScriptPlace { label: string; scale: string | null; parent: string | null; unnamed?: boolean; held?: "stated" | "setting" | "em2" | "scene"; scene?: string; near?: string; nears?: string[]; pool?: string; pools?: string[]; elsewhere?: string }
export interface ScriptScene {
  id: string; chapter: number; place: string | null; placeBy: "environment" | "action" | "named" | "unnamed" | "carried" | "jev" | "none";
  clock: number[] | null; present: string[]; stayed: string[]; firstSeen: string[];
  timeline: { type: "event"; id: string; actors: string[] }[]; context?: string;
  /** Who or what its spatial words say is where (src/v2/spatial.ts): evidence for Jev at run time. */
  spatial?: { text: string; sentence: string; level: string | null; who: string[] }[];
}
export interface ReadingScript { version: 2; from: "v2-reading"; places: Record<string, ScriptPlace>; scenes: ScriptScene[] }

const SIZES = SCALES;
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
  // EM²'s place slots, in a reading from before place EM.
  const legacy = result.slots as unknown as { id: string; kind: string; scene: string; label: string; sentences: string[]; in?: string | null; scale?: string }[];

  // The tree's scale (EM's, checked against the tree: src/v2/places.ts); a reading from before it: by type and name.
  const treeScale = new Map((result.places?.places ?? []).filter((entry) => entry.scale).map((entry) => [entry.id, entry.scale!]));
  const places: Record<string, ScriptPlace> = Object.fromEntries([...result.chart.entities.values()].filter((place) => place.category === "place").map((place) => [place.id, {
    label: label(place.id), parent: parentOf.get(place.id) ?? null,
    scale: treeScale.get(place.id) ?? (SIZES.includes(place.type) ? place.type : LANGUAGE.scaleOfName(label(place.id))),
  }]));
  for (let pass = 0; pass < SIZES.length; pass++) for (const [id, place] of Object.entries(places)) {
    if (place.scale) continue;
    const largest = Math.max(-1, ...Object.values(places).filter((other) => other.parent === id && other.scale).map((other) => SIZES.indexOf(other.scale!)));
    if (largest >= 0) place.scale = SIZES[Math.min(largest + 1, SIZES.length - 1)];
  }
  // Place EM's unnamed places and settings, when the reading has them.
  const index = new Map(result.scenes.map((scene) => [scene.id, scene.index]));
  const settings = result.places?.settings ? new Map(result.places.settings.map((setting) => [setting.scene, setting])) : null;
  if (settings) for (const slot of result.places.slots) places[`unnamed:${slot.id}`] = { label: `${slot.label} (scene ${(index.get(slot.scene) ?? 0) + 1})`, scale: slot.kind === "place" ? slot.scale ?? "street" : slot.kind, parent: slot.in, unnamed: true, ...(slot.in ? { held: slot.held === "setting" ? "setting" as const : "stated" as const } : {}), scene: slot.scene };
  const placeOf = (id: string | null) => (id && places[`unnamed:${id}`] ? `unnamed:${id}` : id);
  const seen = new Set<string>();
  let previous: string | null = null, clock: number[] | null = null;
  const scenes = result.scenes.map((scene): ScriptScene => {
    const cards = cardsOf.get(scene.id) ?? [], time = when.get(scene.id), past = !!time?.flashback;
    const setting = settings?.get(scene.id);
    let place: string | null = null, by: ScriptScene["placeBy"] = "none";
    if (settings) { place = placeOf(setting?.place ?? null); by = setting?.by ?? "none"; }
    else {
    // The named places it names or describes: in its environment cards, in its action cards, anywhere (how often).
    const named = (kinds: string[] | null) => {
      const count = new Map<string, number>();
      for (const card of cards) if (!kinds || kinds.includes(card.kind)) for (const id of new Set([...card.entities.map((hit) => hit.id), ...card.people.map((person) => person.id)])) if (category(id) === "place") count.set(id, (count.get(id) ?? 0) + 1);
      return count;
    };
    const set = named(["environment"]), acted = named(["action"]), any = named(null);
    const most = (count: Map<string, number>) => [...count].sort((a, b) => b[1] - a[1] || depth(b[0]) - depth(a[0]))[0]?.[0] ?? null;
    place = [...set.keys()].sort((a, b) => depth(b) - depth(a) || (set.get(b) ?? 0) - (set.get(a) ?? 0))[0] ?? null;
    by = place ? "environment" : "none";
    if (!place && (place = most(acted))) by = "action";
    if (!place && (place = most(any))) by = "named";
    if (by === "named" && place && previous && !past && under(previous, place)) { place = previous; by = "carried"; }
    const deeper = place && by !== "carried" ? [...any].filter(([id, count]) => under(id, place!) && (set.has(id) || count >= 2)).sort((a, b) => depth(b[0]) - depth(a[0]))[0] : undefined;
    if (deeper) place = deeper[0];
    // An unnamed building or room the environment cards name, in the place (or under it), rooms first.
    const setting = new Set(cards.filter((card) => card.kind === "environment").flatMap((card) => card.sentences));
    const fits = (holder: string | null | undefined) => !holder || !place || holder === place || under(holder, place) || under(place, holder);
    const unnamed = legacy.filter((slot) => slot.scene === scene.id && (slot.kind === "room" || slot.kind === "building") && slot.sentences.some((id) => setting.has(id)) && fits(slot.in))
      .sort((a, b) => (a.kind === "room" ? 0 : 1) - (b.kind === "room" ? 0 : 1) || b.sentences.length - a.sentences.length)[0];
    if (unnamed) {
      const id = `unnamed:${unnamed.id}`, holder = unnamed.in && place && under(unnamed.in, place) ? unnamed.in : place ?? unnamed.in ?? null;
      places[id] = { label: `${unnamed.label} (scene ${scene.index + 1})`, scale: unnamed.kind, parent: holder, unnamed: true, held: unnamed.in ? "em2" : "scene", scene: scene.id };
      place = id; by = "unnamed";
    }
    if (!place && !past && previous && time?.continuation?.continues !== false) { place = previous; by = "carried"; }
    }
    if (!past && place) previous = place;
    // Its story-time span; a scene the tree gives no period keeps the one before.
    const indices = (time?.periods ?? []).map((id) => storyIndex.get(id)).filter((value): value is number => typeof value === "number");
    if (!past) clock = indices.length ? [Math.min(...indices), Math.max(...indices)] : clock ?? [0, 0];
    const present = [...new Set(cards.flatMap((card) => card.people.filter((person) => category(person.id) === "person" && isPresent(person)).map((person) => person.id)))];
    const firstSeen = past ? [] : present.filter((id) => !seen.has(id));
    if (!past) for (const id of present) seen.add(id);
    const environment = cards.filter((card) => card.kind === "environment").map((card) => card.sentences.map(text).join("")).join(" ");
    const spatial = (result.spatial ?? []).filter((mention) => mention.scene === scene.id).map(({ text: word, sentence, who }) => ({ text: word, sentence, level: levelOf(word), who }));
    return {
      id: scene.id, chapter: scene.chapter, place, placeBy: by, clock: past ? null : clock, present, stayed: [], firstSeen,
      timeline: cards.filter((card) => eventOf.has(card.id)).map((card) => ({ type: "event" as const, id: eventOf.get(card.id)!, actors: cardPeople(result, card).people })),
      ...(environment ? { context: `Environment: ${environment.length > CONTEXT ? `${environment.slice(0, CONTEXT - 1)}…` : environment}` } : {}),
      ...(spatial.length ? { spatial } : {}),
    };
  });
  // A named building or room the tree puts nowhere: near the named area its scenes (those whose cards name it) are set in
  // most. A district or a city the tree puts nowhere is not (being talked of somewhere is not being there).
  const AREA = new Set(["street", "district", "city", "region"]);
  const areaOf = (id: string | null) => { for (let at = id, n = 0; at && n < 16; at = places[at]?.parent ?? null, n++) if (!places[at]?.unnamed && AREA.has(places[at]?.scale ?? "")) return at; return null; };
  for (const [id, place] of Object.entries(places)) {
    if (place.unnamed || place.parent || AREA.has(place.scale ?? "")) continue;
    const count = new Map<string, number>();
    for (const scene of scenes) if ((cardsOf.get(scene.id) ?? []).some((card) => card.entities.some((hit) => hit.id === id) || card.people.some((person) => person.id === id))) { const area = areaOf(scene.place); if (area && area !== id) count.set(area, (count.get(area) ?? 0) + 1); }
    const ranked = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([area]) => area);
    if (ranked.length) { place.near = ranked[0]; place.nears = ranked; }
  }
  // An unnamed place nothing holds (its scene is set in a building the tree puts nowhere): near where its scene is.
  for (const place of Object.values(places)) {
    if (!place.unnamed || place.parent || !place.scene) continue;
    const at = scenes.find((scene) => scene.id === place.scene)?.place ?? null, near = areaOf(at) ?? (at ? places[at]?.near : undefined);
    if (near) place.near = near;
  }
  // A reading from before place EM: every other unnamed place EM² found, in what holds it, else in its scene's named place.
  const sceneAt = new Map(scenes.map((scene) => [scene.id, scene]));
  const namedOf = (id: string | null) => { for (let at = id, n = 0; at && n < 16; at = places[at]?.parent ?? null, n++) if (!places[at]?.unnamed) return at; return null; };
  if (!settings) for (const slot of legacy) {
    const id = `unnamed:${slot.id}`;
    if (places[id] || !["place", "building", "room"].includes(slot.kind)) continue;
    const holder = slot.in ?? namedOf(sceneAt.get(slot.scene)?.place ?? null);
    places[id] = { label: `${slot.label} (scene ${(index.get(slot.scene) ?? 0) + 1})`, scale: slot.kind === "place" ? slot.scale ?? "street" : slot.kind, parent: holder, unnamed: true, ...(holder ? { held: slot.in ? "em2" as const : "scene" as const } : {}), scene: slot.scene };
  }
  return { version: 2, from: "v2-reading", places, scenes };
}
