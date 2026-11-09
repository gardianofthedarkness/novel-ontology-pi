/**
 * Story strands in v2 (the user's call, 2026-11-01: "v1 has strands already proven to work to some extent, we can build it
 * directly"): v1's strands (apps/playground/src/data/storyStrands.ts, about 0.85 of scene pairs against hand-read gold)
 * on the v2 reading's world script, with no model call. Each person's scenes are a strand, nobody in two places at once;
 * one scene comes before another only with evidence (a shared person, a flashback, stated times that differ within one
 * top-level place); scenes with none are parallel, and strands merge where their people meet. Then v1's per-fork timeline
 * (src/digger/stage/environment.ts): who comes into each scene from where, at the same place or from elsewhere, which is
 * what spawning reads (a person carries their position from their own last scene at the same place, else arrives).
 *
 * From the script: who is present (`present`), where (`place`, its parents in `places`; `placeBy: "carried"` a place
 * carried from the scene before), its chapter, a flashback (`clock: null`), and its node on the time tree (`at`: its day
 * and part of the day, and whether the scene states it or inherits it). v1 compares only a scene's own stated times.
 */
import { storyStrands, type StoryStrands } from "../../../apps/playground/src/data/storyStrands.js";
import type { StoryPlace, StoryScene, StoryTime, TimePlaceProjection } from "../../../apps/playground/src/data/timePlace.js";
import { forkTimeline, type Fork, type ForkTimeline, type Handoff } from "../../digger/stage/environment.js";
import { PLACE_SCALES, rankOf } from "../rules/places.js";
import type { ReadingScript, ScriptPlace, ScriptScene } from "./script.js";

/** A clock time as v1's part of the day (its slots: late night to night). */
export function partOfClock(hour: number): string {
  return hour < 5 ? "late-night" : hour < 7 ? "dawn" : hour < 11 ? "morning" : hour < 14 ? "noon" : hour < 17 ? "afternoon" : hour < 20 ? "evening" : "night";
}
/** A time tree node's day and part of the day (`t:y1:12-24:late-night`, `t:y1:12-24:15:00`); null in the past or with no day. */
export function nodeTime(node: string | null | undefined): { month: number; day: number; part: string | null } | null {
  const match = node?.match(/^t:y\d+:(\d{1,2})-(\d{1,2})(?::(.+))?$/);
  if (!match) return null;
  const rest = match[3] ?? null, clock = rest?.match(/^(\d{1,2}):(\d{2})$/);
  return { month: Number(match[1]), day: Number(match[2]), part: clock ? partOfClock(Number(clock[1])) : rest };
}

/** The script as v1's time-and-place projection: its scenes, a time for each scene that has a day, its places with their paths. */
export function scriptProjection(script: ReadingScript): TimePlaceProjection {
  const times: StoryTime[] = [], scenes: StoryScene[] = [];
  script.scenes.forEach((scene, index) => {
    const at = nodeTime(scene.at?.node);
    if (at && scene.clock) times.push({ id: `time:${scene.id}`, label: scene.at!.node, gloss: "", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: null, toldFromId: null, date: { month: at.month, day: at.day, derived: false }, partOfDay: at.part, chapterIndex: scene.chapter, storyIndex: index, narrativeIndex: index, anchorSceneId: scene.id, sceneIds: [scene.id] });
    scenes.push({ id: scene.id, index, chapterIndex: scene.chapter, label: scene.id, times: at && scene.clock ? [{ id: `time:${scene.id}`, via: scene.at!.stated ? "anchor" : "inherited" }] : [], flashback: scene.clock === null, placeIds: scene.place ? [scene.place] : [], placeCarried: scene.placeBy === "carried", characterIds: scene.present });
  });
  const pathOf = (id: string): string[] => { const path: string[] = []; for (let at: string | null = id, n = 0; at && n < 16; at = script.places[at]?.parent ?? null, n++) path.unshift(at); return path; };
  const places: StoryPlace[] = Object.entries(script.places).map(([id, place]) => {
    const here = script.scenes.filter((scene) => scene.place === id);
    return { id, label: place.label, sceneIds: here.map((scene) => scene.id), statedScenes: here.filter((scene) => scene.placeBy !== "carried").length, characterIds: [...new Set(here.flatMap((scene) => scene.present))], parentId: place.parent, path: pathOf(id), depth: pathOf(id).length - 1 };
  });
  const counts = new Map<string, number>();
  for (const scene of script.scenes) for (const id of scene.present) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { available: true, times, scenes, places, characters: [...counts].map(([id, n]) => ({ id, label: id, scenes: n })), names: Object.fromEntries(Object.entries(script.places).map(([id, place]) => [id, place.label])) };
}

/** The script's strands (v1's, on the script) and its per-fork timeline: each scene's fork, and who comes in from where. */
export function scriptStrands(script: ReadingScript): { strands: StoryStrands; timeline: ForkTimeline } {
  const projection = scriptProjection(script), strands = storyStrands(projection);
  const timeline = forkTimeline(script.scenes.map((scene, index) => ({ id: scene.id, index, placeId: scene.place, flashback: scene.clock === null, cast: scene.present, events: scene.timeline.map((event) => ({ id: event.id, actors: event.actors })) })), strands);
  return { strands, timeline };
}

/**
 * Strands as groups in envelopes (docs/v2/strands.md; milestones M17a; the user, 2026-11-09: "a timeline performed by a
 * group of people in a limited, enveloping area ... If the time is the same by mentioning the two groups united, the
 * strands reunify into one. Today our strands simply diverge"). A strand is a group, the area that envelops it, and the
 * stretch of story time it plays; one builder for the book's strands file and the director's segments.
 *
 * The envelope of a place is the first place at or above the envelope scale (`strands.envelope`, a district by default)
 * on the way up from it; a place that never reaches that scale has none known. Two envelopes are **apart** only on
 * evidence: both known, neither inside the other, and either side by side under a place they share or two top places of
 * one scale that is a city's or larger. A scene placed coarsely (the whole city) is never evidence of leaving, and
 * neither is a sampling pool (a place the text left "somewhere in" an area: it is that area, no finer). Where the engine
 * built such a place is known to the terrain registry: `builtTree` reads it, and `tree` takes it.
 */
export interface StrandFork extends Fork {
  envelope: string | null; unites: string[]; open: boolean; into?: string; past?: boolean;
  /** The strands its people left when it began (a split: its world layer starts as a copy of theirs); none for a strand of people first seen. */
  splitFrom: string[];
  /** The scene where it closed into `into` (the union: from there its world layer is merged into that strand's). */
  intoAt?: string;
}
export interface StrandCheck { kind: "split" | "union" | "apart" | "conflict"; sceneId: string; status: string; count?: number; otherId?: string; characterId?: string }
export interface GroupStrands {
  /** The envelope scale the strands were built at. */
  scale: string;
  /** The scenes in story order. */
  order: string[];
  /** A scene's place in story order, its strand's number, and the scene before it on its strand (what `forkTimeline` reads). */
  layer: Map<string, number>; lane: Map<string, number>; continues: Map<string, string | null>;
  forkOf: Map<string, string>; envelopeOf: Map<string, string | null>; handoffs: Map<string, Handoff[]>;
  forks: StrandFork[]; checks: StrandCheck[];
}
export interface GroupOptions {
  /** The envelope scale (a place scale); a district when not given. */
  envelope?: string;
  /** Places the built world knows better than the script (a parent the text never states, a slot's own parent and scale). */
  tree?: Record<string, { parent?: string | null; scale?: string | null }>;
}

/** Envelopes over a place tree: a place's envelope, whether one place is inside another, whether two are known to be apart. */
export function envelopes(places: Record<string, Pick<ScriptPlace, "scale" | "parent" | "pool">>, options: GroupOptions = {}) {
  const scale = options.envelope ?? "district", need = rankOf(scale), city = rankOf("city");
  if (need < 0) throw new Error(`strands.envelope ${JSON.stringify(scale)} is not a place scale (${PLACE_SCALES.join(", ")})`);
  const parentOf = (id: string): string | null => { const own = options.tree?.[id]; return own && own.parent !== undefined ? own.parent : places[id]?.parent ?? null; };
  // A sampling pool is no area of its own: it has no scale here, so the area it samples is the envelope.
  const scaleOf = (id: string): string | null => options.tree?.[id]?.scale ?? (places[id]?.pool ? null : places[id]?.scale ?? null);
  /** The place and every place it stands in, itself first. */
  const pathOf = (id: string): string[] => { const path: string[] = []; for (let at: string | null = id; at && !path.includes(at) && path.length < 24; at = parentOf(at)) path.push(at); return path; };
  const envelopeOf = (place: string | null | undefined): string | null => (place ? pathOf(place).find((id) => rankOf(scaleOf(id)) >= need) ?? null : null);
  const within = (inner: string, outer: string) => pathOf(inner).includes(outer);
  const apart = (first: string | null, second: string | null): boolean => {
    if (!first || !second || first === second) return false;
    const a = pathOf(first), b = pathOf(second);
    if (a.includes(second) || b.includes(first)) return false;
    if (a.some((id) => b.includes(id))) return true;
    const top = rankOf(scaleOf(a.at(-1)!));
    return top >= city && top === rankOf(scaleOf(b.at(-1)!));
  };
  return { scale, envelopeOf, within, apart, pathOf };
}

/**
 * The script's strands by group and envelope. Scenes are walked in story order (the script's clock, then reading order;
 * a flashback is told where it is read and is a closed strand of its own, handing nothing on). For a scene, each strand
 * its people are on either plays it or is left by them:
 *
 *   - a strand whose envelope is not known to be apart from the scene's plays it;
 *   - one that is apart plays it too when its whole group is here (the strand moves), or when the rest of its group is
 *     not told elsewhere meanwhile (the next scene with any of them has someone from here, or is not apart from here);
 *   - otherwise the people here leave it (a **split**): the rest is told in its own envelope while they are in another.
 *
 * No strand plays it: a new strand, from the ones left (`splitFrom`). One: it goes on. Several: a **union**, the strand with the most
 * scenes keeps its id and the others close into it (`unites`, `into`, `intoAt`). A scene of people first seen is on the strand
 * being told unless its place is known to be apart (a new group in another area is a new strand). A scene with nobody in
 * it has no group to be a strand: it is on the strand being told, or on the open strand whose envelope it looks at, and
 * with the telling when it looks at nobody's.
 */
export function groupStrands(script: ReadingScript, options: GroupOptions = {}): GroupStrands {
  const { scale, envelopeOf: envelopeAt, within, apart } = envelopes(script.places ?? {}, options);
  const index = new Map(script.scenes.map((scene, n) => [scene.id, n])), keyOf = new Map<string, number>();
  let key = -1e15;
  for (const scene of script.scenes) { if (scene.clock && typeof scene.clock[0] === "number") key = scene.clock[0]; keyOf.set(scene.id, key); }
  const ordered = [...script.scenes].sort((a, b) => keyOf.get(a.id)! - keyOf.get(b.id)! || index.get(a.id)! - index.get(b.id)!);
  interface Live { id: string; lane: number; scenes: string[]; people: string[]; group: Set<string>; envelope: string | null; from: string[]; to: string[]; unites: string[]; open: boolean; into?: string; intoAt?: string; splitFrom: string[]; past?: boolean; last: string | null; active: number; closed?: number }
  const strands = new Map<string, Live>(), onStrand = new Map<string, string>(), lastScene = new Map<string, ScriptScene>();
  const layer = new Map<string, number>(), lane = new Map<string, number>(), continues = new Map<string, string | null>(), forkOf = new Map<string, string>(), envelopeOf = new Map<string, string | null>(), handoffs = new Map<string, Handoff[]>(), checks: StrandCheck[] = [];
  const begin = (id: string, envelope: string | null): Live => { const strand: Live = { id, lane: strands.size, scenes: [], people: [], group: new Set(), envelope, from: [], to: [], unites: [], splitFrom: [], open: true, last: null, active: -1 }; strands.set(id, strand); return strand; };
  const strandOf = (person: string): Live | null => { let at = onStrand.has(person) ? strands.get(onStrand.get(person)!)! : null; while (at?.into) at = strands.get(at.into)!; return at; };
  const link = (from: Live, to: Live) => { if (from === to) return; if (!to.from.includes(from.id)) to.from.push(from.id); if (!from.to.includes(to.id)) from.to.push(to.id); };
  /** The next scene in story time (not a flashback) with any of these people. */
  const nextWith = (people: string[], after: number) => ordered.find((scene, rank) => rank > after && scene.clock !== null && (scene.present ?? []).some((person) => people.includes(person))) ?? null;
  let told: Live | null = null;
  ordered.forEach((scene, rank) => {
    const people = scene.present ?? [], here = envelopeAt(scene.place);
    layer.set(scene.id, rank); envelopeOf.set(scene.id, here);
    const place = (strand: Live) => { continues.set(scene.id, strand.last); forkOf.set(scene.id, strand.id); lane.set(scene.id, strand.lane); strand.scenes.push(scene.id); for (const person of people) if (!strand.people.includes(person)) strand.people.push(person); strand.last = scene.id; strand.active = rank; };
    if (scene.clock === null) {
      // The past, told here: its own closed strand; nobody comes into it from the present and nobody leaves it for the present.
      const past = begin(scene.id, here); past.past = true; past.open = false; past.closed = rank;
      handoffs.set(scene.id, people.map((person) => ({ person, from: null, samePlace: false })));
      place(past);
      return;
    }
    handoffs.set(scene.id, people.map((person) => { const from = lastScene.get(person); return { person, from: from?.id ?? null, samePlace: !!from && !!scene.place && from.place === scene.place }; }));
    for (const person of people) { const from = lastScene.get(person); if (from && scene.at?.stated && from.at?.stated && scene.at.node === from.at.node && apart(envelopeAt(from.place), here)) checks.push({ kind: "conflict", sceneId: scene.id, status: "one stated time in two envelopes", otherId: from.id, characterId: person }); }
    const sources = [...new Set(people.map(strandOf).filter((strand): strand is Live => !!strand))], together: Live[] = [], left: Live[] = [];
    for (const source of sources) {
      if (!apart(source.envelope, here)) { together.push(source); continue; }
      const mine = people.filter((person) => strandOf(person) === source), rest = [...source.group].filter((person) => !mine.includes(person) && strandOf(person) === source);
      const next = rest.length ? nextWith(rest, rank) : null;
      if (next && !(next.present ?? []).some((person) => mine.includes(person)) && apart(envelopeAt(next.place), here)) left.push(source); else together.push(source);
    }
    let strand: Live;
    if (!sources.length) {
      // Nobody here is on a strand yet: the strand being told, else the open one last told that this place is not apart
      // from; a scene of nobody apart from every open strand stays with the telling (no group, no strand of its own).
      const near = (other: Live) => other.open && !apart(other.envelope, here);
      const open = [...strands.values()].filter(near).sort((a, b) => b.active - a.active);
      strand = (told && near(told) ? told : open[0]) ?? (!people.length && told?.open ? told : begin(scene.id, here));
      if (!strand.scenes.length) strand.group = new Set(people);
    } else if (!together.length) {
      strand = begin(scene.id, here); strand.group = new Set(people); strand.splitFrom = left.map((source) => source.id);
    } else {
      strand = together.reduce((best, other) => (other.scenes.length > best.scenes.length || (other.scenes.length === best.scenes.length && other.lane < best.lane) ? other : best));
      for (const other of together) if (other !== strand) { other.open = false; other.into = strand.id; other.intoAt = scene.id; other.closed = rank; strand.unites.push(other.id); link(other, strand); checks.push({ kind: "union", sceneId: scene.id, status: "groups together", otherId: other.id }); }
      // The envelope follows the group: a finer place inside it, or the place it moved to; a coarser placement tells nothing new.
      if (here && !(strand.envelope && within(strand.envelope, here))) strand.envelope = here;
      strand.group = new Set(people);
    }
    for (const source of left) { link(source, strand); checks.push({ kind: "split", sceneId: scene.id, status: "envelopes differ", otherId: source.id }); }
    place(strand);
    for (const person of people) { onStrand.set(person, strand.id); lastScene.set(person, scene); }
    told = strand;
  });
  // A chapter that ends with more than one strand open: groups still apart (for the review; nothing reads it as an error).
  const chapters = new Map<number, { last: number; scene: string; strands: Set<Live> }>();
  ordered.forEach((scene, rank) => { const strand = strands.get(forkOf.get(scene.id)!)!; if (strand.past) return; const chapter = chapters.get(scene.chapter) ?? chapters.set(scene.chapter, { last: rank, scene: scene.id, strands: new Set() }).get(scene.chapter)!; chapter.last = rank; chapter.scene = scene.id; chapter.strands.add(strand); });
  for (const chapter of chapters.values()) { const count = [...chapter.strands].filter((strand) => strand.open || (strand.closed ?? -1) > chapter.last).length; if (count > 1) checks.push({ kind: "apart", sceneId: chapter.scene, status: "open at the chapter's end", count }); }
  const forks: StrandFork[] = [...strands.values()].map((strand) => ({ id: strand.id, scenes: strand.scenes, people: strand.people, from: strand.from, to: strand.to, envelope: strand.envelope, unites: strand.unites, open: strand.open, splitFrom: strand.splitFrom, ...(strand.into ? { into: strand.into, intoAt: strand.intoAt } : {}), ...(strand.past ? { past: true } : {}) }));
  return { scale, order: ordered.map((scene) => scene.id), layer, lane, continues, forkOf, envelopeOf, handoffs, forks, checks };
}

/** A slot of the terrain registry as the built tree reads it (universe/terrain.json, a book's stage/terrain.json). */
export interface BuiltSlot { id?: string; parent?: string | null; owner?: string | null; sharers?: { book?: string; mention?: string }[] }
/**
 * The built world's place tree, from the terrain registry's slots: a place that owns a slot, or borrows one (an unnamed
 * place of `book`: a mention's id is only its book's), stands under the nearest place above that slot. What `tree` takes:
 * where the engine built a place the text left under "somewhere in the city".
 */
export function builtTree(slots: Record<string, BuiltSlot> | null | undefined, book?: string | null): NonNullable<GroupOptions["tree"]> {
  const all = slots ?? {}, tree: NonNullable<GroupOptions["tree"]> = {};
  const placeAbove = (id: string | null | undefined): string | null => {
    let at = id ?? null;
    for (let guard = 0; at && at.startsWith("slot:") && guard < 12; guard++) { const slot: BuiltSlot | undefined = all[at]; if (!slot) return null; if (slot.owner) return slot.owner; at = slot.parent ?? null; }
    return at && !at.startsWith("slot:") ? at : null;
  };
  for (const slot of Object.values(all)) {
    const above = placeAbove(slot.parent), stands = slot.owner ?? above;
    if (slot.owner && above && above !== slot.owner) tree[slot.owner] = { parent: above };
    for (const sharer of slot.sharers ?? []) if (sharer.mention && stands && stands !== sharer.mention && (!book || !sharer.book || sharer.book === book)) tree[sharer.mention] = { parent: stands };
  }
  return tree;
}

/**
 * The strands file of a script (stage/world/strands.json, and the director's segments/strands.json): each scene's strand
 * (`fork`), its place in story order, the scene before it on its strand, its envelope and how each person comes into it;
 * each strand with its people, the strands they came from and went on to, its envelope, the strands it united and
 * whether it is open at the end.
 */
export function strandsDocument(script: ReadingScript, strands: GroupStrands, from: string) {
  return {
    version: 2, from, order: "story", envelope: strands.scale,
    scenes: script.scenes.map((scene) => ({ id: scene.id, ...("parent" in scene ? { parent: (scene as { parent?: string | null }).parent ?? null } : {}), fork: strands.forkOf.get(scene.id) ?? null, layer: strands.layer.get(scene.id) ?? null, lane: strands.lane.get(scene.id) ?? null, continues: strands.continues.get(scene.id) ?? null, envelope: strands.envelopeOf.get(scene.id) ?? null, entries: strands.handoffs.get(scene.id) ?? [] })),
    forks: strands.forks, checks: strands.checks,
  };
}
