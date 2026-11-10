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
import { rankOf } from "../rules/places.js";
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
 * Strands by interaction (docs/v2/strands.md §0; milestones M17e; the user, 2026-11-09: "As long as the group splits on
 * different things and no longer interact with each other on semantic scale, they become two strands. When they reunited
 * the strands become one. Whether scale is building street what ever depends on the context"). A strand is a group, the
 * area its scenes are in (read from them, at whatever scale) and the stretch of story time it plays; one builder for the
 * book's strands file, the director's segments and a run re-stranded after smoothing.
 *
 * The rules (§0, §0.2–0.6), each scene walked in story order (the script's clock, then reading order):
 *   1. A scene's group is the people acting in it (acting, speaking or spoken to: `evidence`), and anyone an action of
 *      theirs is aimed at who is there (rule 12). People only held in view ride along: they neither split nor unite.
 *   2. A split: part of a strand's group acts here while the rest of that group next appears (acting or in view) where
 *      none of the people here is in view. No place scale enters (rules 2, 9, 10).
 *   3. A union: people of two strands acting here and linked by an interaction (one conversation, one action, one event,
 *      an action aimed at one of them). Strands acting here with no link act beside each other and stay apart. The strand
 *      begun first keeps its id (rule 8).
 *   4. A union is refused when both sides leave it at once: each side's next action is out of view of the other (a
 *      meeting the reading made up); the walk then runs again (rule 11, narrowed when built).
 *   5. Latency: a strand lands only if its group has a dialogue or an action in its next scene with anyone acting (its
 *      next segment); otherwise it folds into the strand it left, a new group into the one it joins, else into the one
 *      told before it. A strand of nobody folds into the first strand of someone (§0.2).
 *   6. A flashback is a closed strand of its own, handing nothing on.
 * Without beats (a script and nothing else), everyone acting in one scene is linked and every scene where someone acts
 * has a beat.
 */
export interface StrandFork extends Fork {
  /** The smallest place holding the strand's scenes (the context's scale), when they are placed. */
  envelope: string | null; unites: string[]; open: boolean; into?: string; past?: boolean;
  /** The strands its people left when it began (a split: its world layer starts as a copy of theirs); none for a strand of people first seen. */
  splitFrom: string[];
  /** The scene where it closed into `into` (the union: from there its world layer is merged into that strand's). */
  intoAt?: string;
}
export interface StrandCheck { kind: "split" | "union" | "apart" | "conflict" | "beside" | "refused" | "folded"; sceneId: string; status: string; count?: number; otherId?: string; characterId?: string }
export interface GroupStrands {
  /** "context": the scale of each strand is read from its scenes (`envelope`). */
  scale: string;
  /** The scenes in story order. */
  order: string[];
  /** A scene's place in story order, its strand's number, and the scene before it on its strand (what `forkTimeline` reads). */
  layer: Map<string, number>; lane: Map<string, number>; continues: Map<string, string | null>;
  forkOf: Map<string, string>; envelopeOf: Map<string, string | null>; handoffs: Map<string, Handoff[]>;
  forks: StrandFork[]; checks: StrandCheck[];
}
/** A scene's interactions: who took part together (`links`), its beats (each a dialogue or an action, with its people), and who an action was aimed at. */
export interface StrandBeats { links?: string[][]; beats?: string[][]; aimed?: string[] }
export interface GroupOptions {
  /** Places the built world knows better than the script (a parent the text never states, a slot's own parent and scale). */
  tree?: Record<string, { parent?: string | null; scale?: string | null }>;
  /** Per scene id (a run's sub-scene `x~2` reads scene x): from `strandBeats`. */
  beats?: Record<string, StrandBeats>;
}
type StrandScene = ScriptScene & { evidence?: string[] };

/** The place tree: a place's path up, whether one place is inside another, whether two are known to be apart, the smallest place holding several. */
export function placeTree(places: Record<string, Pick<ScriptPlace, "scale" | "parent" | "pool">>, options: Pick<GroupOptions, "tree"> = {}) {
  const city = rankOf("city");
  const parentOf = (id: string): string | null => { const own = options.tree?.[id]; return own && own.parent !== undefined ? own.parent : places[id]?.parent ?? null; };
  const scaleOf = (id: string): string | null => options.tree?.[id]?.scale ?? (places[id]?.pool ? null : places[id]?.scale ?? null);
  /** The place and every place it stands in, itself first. */
  const pathOf = (id: string): string[] => { const path: string[] = []; for (let at: string | null = id; at && !path.includes(at) && path.length < 24; at = parentOf(at)) path.push(at); return path; };
  const within = (inner: string, outer: string) => pathOf(inner).includes(outer);
  /** Apart only on evidence: neither inside the other, and side by side under a place they share, or two top places of one scale a city's or larger. */
  const apart = (first: string | null, second: string | null): boolean => {
    if (!first || !second || first === second) return false;
    const a = pathOf(first), b = pathOf(second);
    if (a.includes(second) || b.includes(first)) return false;
    if (a.some((id) => b.includes(id))) return true;
    const top = rankOf(scaleOf(a.at(-1)!));
    return top >= city && top === rankOf(scaleOf(b.at(-1)!));
  };
  /** The smallest place holding all of these (nulls ignored); null when they share none. */
  const holding = (ids: (string | null | undefined)[]): string | null => {
    const paths = ids.filter((id): id is string => !!id).map(pathOf);
    return paths.length ? paths[0].find((id) => paths.every((path) => path.includes(id))) ?? null : null;
  };
  return { pathOf, within, apart, holding, scaleOf };
}

/** A card as the beats read it: its kind, the cards inside it (a conversation's), its lines and its people's credit. */
export interface BeatCard { id: string; kind: string; first: string; sentences?: string[]; inside?: string[]; people?: { id: string; how: string[]; at?: string[] }[] }
const ACTING = new Set(["acts", "speaks", "addressed"]);
/** A place the reading credits with acting ("the city") takes part in no interaction. */
const aPlace = (id: string) => id.startsWith("loc_");
/**
 * A reading's interactions per scene, for `groupStrands`: `links` are the people acting together in one conversation
 * (a dialogue card), one action (in or out of a conversation) or one of the script's events, and an action's actor with
 * a person its line names who is in the scene (an action aimed at someone, rule 12); `beats` are the conversations and
 * the actions outside one, each with its people (the latency); `aimed` the people aimed at.
 */
export function strandBeats(cards: readonly BeatCard[], roles: Readonly<Record<string, { kind?: string; who?: { id: string | null } }>>, units: readonly { id: string; sentences: readonly string[] }[], script: { scenes: readonly StrandScene[] }): Record<string, StrandBeats> {
  const unitOf = new Map(units.flatMap((unit) => unit.sentences.map((id) => [id, unit.id] as const)));
  const sceneOf = new Map(script.scenes.map((scene) => [scene.id, scene]));
  const base = (id: string) => id.replace(/#\d+$/, "");
  const inside = new Set(cards.filter((card) => card.kind === "dialogue").flatMap((card) => (card.inside ?? []).map(base)));
  const out: Record<string, { links: string[][]; beats: string[][]; aimed: Set<string> }> = {};
  const at = (unit: string) => (out[unit] ??= { links: [], beats: [], aimed: new Set() });
  for (const card of cards) {
    const conversation = card.kind === "dialogue", action = card.kind === "action";
    if (!conversation && !action) continue;
    const byUnit = new Map<string, Set<string>>();
    for (const person of card.people ?? []) if (!aPlace(person.id) && person.how.some((how) => ACTING.has(how))) for (const id of person.at?.length ? person.at : [card.first]) { const unit = unitOf.get(id); if (unit) (byUnit.get(unit) ?? byUnit.set(unit, new Set()).get(unit)!).add(person.id); }
    for (const [unit, people] of byUnit) {
      if (people.size > 1) at(unit).links.push([...people]);
      if (conversation || !inside.has(base(card.id))) at(unit).beats.push([...people]);
    }
    if (!action) continue;
    for (const id of card.sentences ?? [card.first]) {
      const role = roles[id], actor = role?.kind === "action" ? role.who?.id : null, unit = unitOf.get(id), scene = unit ? sceneOf.get(unit) : undefined;
      if (!actor || !unit || !scene) continue;
      const here = new Set([...(scene.evidence ?? []), ...scene.present]);
      for (const person of card.people ?? []) if (person.id !== actor && !aPlace(person.id) && !aPlace(actor) && person.how.includes("named") && (person.at ?? []).includes(id) && here.has(person.id)) { at(unit).links.push([actor, person.id]); at(unit).aimed.add(person.id); }
    }
  }
  for (const scene of script.scenes) for (const event of scene.timeline ?? []) { const actors = (event.actors ?? []).filter((id) => !aPlace(id)); if (actors.length > 1) at(scene.id).links.push(actors); }
  return Object.fromEntries(Object.entries(out).map(([unit, entry]) => [unit, { links: entry.links, beats: entry.beats, aimed: [...entry.aimed] }]));
}

interface Live { id: string; born: number; scenes: string[]; people: Set<string>; group: Set<string>; open: boolean; unites: string[]; splitFrom: string[]; into?: string; intoAt?: string; past?: boolean }
interface WalkUnion { sceneId: string; other: string; keeper: string; who: string[]; with: string[] }
interface Walked { strands: Live[]; checks: StrandCheck[]; unions: WalkUnion[] }

/** The strands of a script by interaction (the rules above). */
export function groupStrands(script: ReadingScript, options: GroupOptions = {}): GroupStrands {
  const scenes = script.scenes as StrandScene[];
  const tree = placeTree(script.places ?? {}, options);
  const beatsOf = (id: string): StrandBeats | undefined => options.beats?.[id] ?? options.beats?.[id.split("~")[0]];
  const actingOf = (scene: StrandScene) => scene.evidence ?? scene.present ?? [];
  const seenIn = (scene: StrandScene) => new Set([...actingOf(scene), ...(scene.present ?? [])]);
  // Who takes part in a scene: its acting people and those an action of theirs is aimed at.
  const active = (scene: StrandScene) => { const aimed = beatsOf(scene.id)?.aimed ?? [], here = seenIn(scene); return [...new Set([...actingOf(scene), ...aimed.filter((person) => here.has(person))])]; };
  const linksOf = (scene: StrandScene) => (options.beats ? beatsOf(scene.id)?.links ?? [] : [actingOf(scene)]);
  const index = new Map(scenes.map((scene, n) => [scene.id, n])), keyOf = new Map<string, number>();
  let key = -1e15;
  for (const scene of scenes) { if (scene.clock && typeof scene.clock[0] === "number") key = scene.clock[0]; keyOf.set(scene.id, key); }
  const ordered = [...scenes].sort((a, b) => keyOf.get(a.id)! - keyOf.get(b.id)! || index.get(a.id)! - index.get(b.id)!);
  const rank = new Map(ordered.map((scene, n) => [scene.id, n])), sceneById = new Map(scenes.map((scene) => [scene.id, scene]));

  const walk = (noUnion: Set<string>): Walked => {
    const strands = new Map<string, Live>(), onStrand = new Map<string, string>(), checks: StrandCheck[] = [], unions: WalkUnion[] = [];
    const begin = (id: string): Live => { const strand: Live = { id, born: strands.size, scenes: [], people: new Set(), group: new Set(), open: true, unites: [], splitFrom: [] }; strands.set(id, strand); return strand; };
    const strandOf = (person: string): Live | null => { let at = onStrand.has(person) ? strands.get(onStrand.get(person)!)! : null; while (at?.into) at = strands.get(at.into)!; return at; };
    const nextWith = (people: string[], after: number) => ordered.find((scene, n) => n > after && scene.clock !== null && [...seenIn(scene)].some((person) => people.includes(person))) ?? null;
    let told: Live | null = null;
    ordered.forEach((scene, n) => {
      const acting = active(scene), present = new Set([...(scene.present ?? []), ...acting]);
      const place = (strand: Live) => { strand.scenes.push(scene.id); for (const person of acting) strand.people.add(person); };
      if (scene.clock === null) { const past = begin(scene.id); past.past = true; past.open = false; place(past); return; }
      const sideOf = new Map(acting.map((person) => [person, strandOf(person)]));
      const sources = [...new Set(acting.map(strandOf).filter((strand): strand is Live => !!strand))], together: Live[] = [], left: Live[] = [], beside: Live[] = [];
      for (const source of sources) {
        const rest = [...source.group].filter((person) => !present.has(person) && strandOf(person) === source);
        const next = rest.length ? nextWith(rest, n) : null;
        if (next && !acting.some((person) => seenIn(next).has(person))) left.push(source); else together.push(source);
      }
      let strand: Live;
      if (!sources.length) {
        // Nobody acting here is on a strand: someone in view who is (they are in the scene), else a new group, else (nobody acts) the telling.
        const viewed = [...present].map(strandOf).find((other): other is Live => !!other);
        strand = viewed ?? (acting.length || !told ? begin(scene.id) : told);
        if (!strand.scenes.length) strand.group = new Set(acting);
      } else if (!together.length) {
        strand = begin(scene.id); strand.splitFrom = left.map((source) => source.id);
      } else {
        let united = together;
        if (together.length > 1) {
          const root = new Map(together.map((other) => [other, other])), find = (other: Live): Live => (root.get(other) === other ? other : find(root.get(other)!));
          for (const link of noUnion.has(scene.id) ? [] : linksOf(scene)) {
            const hit = [...new Set(link.map((person) => sideOf.get(person)).filter((other): other is Live => !!other && together.includes(other)))];
            for (let i = 1; i < hit.length; i++) root.set(find(hit[i]), find(hit[0]));
          }
          const parts = new Map<Live, Live[]>();
          for (const other of together) (parts.get(find(other)) ?? parts.set(find(other), []).get(find(other))!).push(other);
          const weight = (part: Live[]) => acting.filter((person) => part.includes(sideOf.get(person)!)).length * 1e6 + Math.max(...part.map((other) => other.scenes.length));
          united = [...parts.values()].sort((a, b) => weight(b) - weight(a))[0];
          for (const other of together) if (!united.includes(other)) { beside.push(other); checks.push({ kind: "beside", sceneId: scene.id, status: "acting here with no interaction", otherId: other.id }); }
        }
        strand = united.reduce((best, other) => (other.born < best.born ? other : best));
        for (const other of united) if (other !== strand) {
          other.open = false; other.into = strand.id; other.intoAt = scene.id; strand.unites.push(other.id);
          unions.push({ sceneId: scene.id, other: other.id, keeper: strand.id, who: acting.filter((person) => sideOf.get(person) === other), with: acting.filter((person) => sideOf.get(person) !== other) });
        }
      }
      const mine = acting.filter((person) => !beside.includes(sideOf.get(person)!));
      if (acting.length) strand.group = new Set(mine);
      place(strand);
      for (const person of mine) onStrand.set(person, strand.id);
      told = strand;
    });
    return { strands: [...strands.values()], checks, unions };
  };

  // Rule 11: a union both sides leave at once (each side's next action out of view of the other) is refused, and the
  // walk runs again: a meeting the reading made up, not one the text tells.
  const noUnion = new Set<string>(), refused: StrandCheck[] = [];
  let walked = walk(noUnion);
  for (let round = 0; round < 100; round++) {
    // Both sides straight back apart: each side's next action is out of view of the other.
    const apartAfter = (union: WalkUnion, side: string[], other: string[]) => { const next = ordered.find((scene, n) => n > rank.get(union.sceneId)! && scene.clock !== null && side.some((person) => active(scene).includes(person))); return !!next && !other.some((person) => seenIn(next).has(person)); };
    const bad = walked.unions.filter((union) => !noUnion.has(union.sceneId)).find((union) => apartAfter(union, union.who, union.with) && apartAfter(union, union.with, union.who));
    if (!bad) break;
    noUnion.add(bad.sceneId); refused.push({ kind: "refused", sceneId: bad.sceneId, status: "both sides apart at their next action", otherId: bad.other });
    walked = walk(noUnion);
  }

  // Rule 5: the latency, folding after the walk. A strand's next segment is its next scene with anyone acting.
  const checks: StrandCheck[] = [...walked.checks, ...refused];
  const strands = new Map(walked.strands.map((strand) => [strand.id, { ...strand, scenes: [...strand.scenes], people: new Set(strand.people), splitFrom: [...strand.splitFrom], unites: [...strand.unites] }]));
  const hasBeat = (id: string) => { const scene = sceneById.get(id)!, people = new Set(actingOf(scene)); const beats = options.beats ? beatsOf(id)?.beats ?? [] : people.size ? [[...people]] : []; return beats.some((beat) => beat.some((person) => people.has(person))); };
  const lands = (strand: Live) => { const next = strand.scenes.slice(1).find((id) => actingOf(sceneById.get(id)!).length); return !!next && hasBeat(next); };
  const before = (strand: Live, all: Live[]) => { for (let n = rank.get(strand.scenes[0])! - 1; n >= 0; n--) { const other = all.find((entry) => entry !== strand && !entry.past && entry.people.size && entry.scenes.includes(ordered[n].id)); if (other) return other; } return null; };
  const fold = (strand: Live, target: Live, why: string) => {
    checks.push({ kind: "folded", sceneId: strand.scenes[0], status: why, otherId: target.id });
    target.scenes = [...target.scenes, ...strand.scenes].sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (const person of strand.people) target.people.add(person);
    if (rank.get(strand.scenes[0])! < rank.get(target.scenes[0])! || target.scenes[0] === strand.scenes[0]) target.splitFrom = [...new Set([...target.splitFrom, ...strand.splitFrom])].filter((id) => id !== target.id);
    target.unites = target.unites.filter((id) => id !== strand.id);
    strands.delete(strand.id);
    for (const other of strands.values()) {
      if (other.into === strand.id) other.into = target.id;
      other.splitFrom = [...new Set(other.splitFrom.map((id) => (id === strand.id ? target.id : id)))].filter((id) => id !== other.id);
      other.unites = [...new Set(other.unites.map((id) => (id === strand.id ? target.id : id)))].filter((id) => id !== other.id);
      if (other.into === other.id) { delete other.into; delete other.intoAt; other.open = true; }
    }
  };
  for (;;) {
    const all = [...strands.values()];
    const short = all.filter((strand) => !strand.past && strand.people.size && !lands(strand) && (strand.splitFrom.length || strand.into || before(strand, all)))
      .sort((a, b) => a.born - b.born);
    if (!short.length) break;
    const strand = short[0], target = strands.get(strand.splitFrom[0] ?? strand.into ?? "") ?? before(strand, all)!;
    fold(strand, target, "no dialogue or action in its next segment");
  }
  for (const strand of [...strands.values()]) if (!strand.past && !strand.people.size) {
    const first = [...strands.values()].filter((other) => !other.past && other.people.size).sort((a, b) => rank.get(a.scenes[0])! - rank.get(b.scenes[0])!)[0];
    if (first) fold(strand, first, "nobody acts in it");
  }

  // The answer in the shape every reader takes: per scene its strand, its place in story order, its lane, the scene it continues.
  const live = [...strands.values()].sort((a, b) => a.born - b.born);
  const forkOf = new Map<string, string>(), lane = new Map<string, number>(), continues = new Map<string, string | null>(), layer = new Map<string, number>(), envelopeOf = new Map<string, string | null>();
  const envelope = new Map(live.map((strand) => [strand.id, tree.holding(strand.scenes.map((id) => sceneById.get(id)!.place))]));
  live.forEach((strand, n) => { let last: string | null = null; for (const id of strand.scenes) { forkOf.set(id, strand.id); lane.set(id, n); continues.set(id, last); last = id; } });
  ordered.forEach((scene, n) => { layer.set(scene.id, n); envelopeOf.set(scene.id, envelope.get(forkOf.get(scene.id)!) ?? null); });
  // How each person comes into each scene (from the last scene they were in, in story time; nothing from the past).
  const handoffs = new Map<string, Handoff[]>(), lastScene = new Map<string, StrandScene>();
  for (const scene of ordered) {
    const people = scene.present ?? [];
    if (scene.clock === null) { handoffs.set(scene.id, people.map((person) => ({ person, from: null, samePlace: false }))); continue; }
    handoffs.set(scene.id, people.map((person) => { const from = lastScene.get(person); return { person, from: from?.id ?? null, samePlace: !!from && !!scene.place && from.place === scene.place }; }));
    for (const person of people) {
      const from = lastScene.get(person);
      if (from && scene.at?.stated && from.at?.stated && scene.at.node === from.at.node && tree.apart(from.place, scene.place)) checks.push({ kind: "conflict", sceneId: scene.id, status: "one stated time in two places apart", otherId: from.id, characterId: person });
    }
    for (const person of people) lastScene.set(person, scene);
  }
  // The splits and unions that landed (after the latency and the refusals).
  for (const strand of live) {
    for (const source of strand.splitFrom) checks.push({ kind: "split", sceneId: strand.scenes[0], status: "the rest is told out of view", otherId: source });
    if (strand.into) checks.push({ kind: "union", sceneId: strand.intoAt!, status: "groups interact", otherId: strand.id });
  }
  // A chapter that ends with more than one strand open: groups still apart (for the review; nothing reads it as an error).
  const chapters = new Map<number, { last: number; scene: string; strands: Set<string> }>();
  ordered.forEach((scene, n) => { const fork = forkOf.get(scene.id)!, strand = strands.get(fork)!; if (strand.past) return; const chapter = chapters.get(scene.chapter) ?? chapters.set(scene.chapter, { last: n, scene: scene.id, strands: new Set() }).get(scene.chapter)!; chapter.last = n; chapter.scene = scene.id; chapter.strands.add(fork); });
  for (const chapter of chapters.values()) { const count = [...chapter.strands].filter((id) => { const strand = strands.get(id)!; return strand.open || rank.get(strand.intoAt ?? "")! > chapter.last; }).length; if (count > 1) checks.push({ kind: "apart", sceneId: chapter.scene, status: "open at the chapter's end", count }); }
  const from = new Map<string, Set<string>>(), to = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { if (a === b) return; (to.get(a) ?? to.set(a, new Set()).get(a)!).add(b); (from.get(b) ?? from.set(b, new Set()).get(b)!).add(a); };
  for (const strand of live) { for (const source of strand.splitFrom) link(source, strand.id); if (strand.into) link(strand.id, strand.into); }
  const forks: StrandFork[] = live.map((strand) => ({ id: strand.id, scenes: strand.scenes, people: [...strand.people], from: [...(from.get(strand.id) ?? [])], to: [...(to.get(strand.id) ?? [])], envelope: envelope.get(strand.id) ?? null, unites: strand.unites, open: strand.open, splitFrom: strand.splitFrom, ...(strand.into ? { into: strand.into, intoAt: strand.intoAt } : {}), ...(strand.past ? { past: true } : {}) }));
  return { scale: "context", order: ordered.map((scene) => scene.id), layer, lane, continues, forkOf, envelopeOf, handoffs, forks, checks };
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
