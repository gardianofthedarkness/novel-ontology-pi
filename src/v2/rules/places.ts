/**
 * The place rules (docs/v2/world-model.md §2.1, §4, §5): the tree's graded law, the place recommender's evidence weights,
 * and what place EM takes by rule rather than asking Jev. Code only: a rule never calls a model, and nothing here is
 * particular to a language (that is language.ts).
 */

/** The scale of places, smallest first; a place's scale is its type. */
export const PLACE_SCALES = ["room", "building", "street", "district", "city", "region"] as const;
export const SCALES: readonly string[] = PLACE_SCALES;
export const rankOf = (scale: string | null | undefined) => (scale ? SCALES.indexOf(scale) : -1);
/** The graded law: a place holds only a larger one (a region may hold a region, a building a building); an unknown scale may. */
export const mayHold = (outer: string | null | undefined, inner: string | null | undefined) =>
  rankOf(outer) < 0 || rankOf(inner) < 0 || rankOf(outer) > rankOf(inner) || (outer === inner && (inner === "region" || inner === "building"));

/** How much each kind of evidence for a parent weighs each time it is seen, and how many times count. */
export const EVIDENCE_WEIGHTS = { name: [3, 1], stated: [2, 3], sentence: [0.5, 4], setting: [0.5, 4], adjacent: [0.25, 4], fact: [1, 3] } as const;
/** The next scale up adds NEXT_SCALE; weak evidence (talk, nearness, facts) counts half FAR_LEVELS levels up or more. */
export const NEXT_SCALE = 0.3, FAR_LEVELS = 3;
/** Jev's answers below ACCEPT are no answer; the same answer HABIT times, and no other, is taken by rule from then on. */
export const ACCEPT = 0.5, HABIT = 2;

interface Scored { id: string; score: number; evidence: { kind: string }[] }
/** A parent is taken by rule when the best candidate has the text's own word (its name, or stated), scores 2, and leads the second twice over. */
export function sureParent<C extends Scored>(candidates: C[]): { candidate: C; by: "name" | "stated" } | null {
  const [top, second] = candidates;
  if (!top || !top.evidence.some((entry) => entry.kind === "name" || entry.kind === "stated") || top.score < 2 || (second && top.score < 2 * second.score)) return null;
  return { candidate: top, by: top.evidence.some((entry) => entry.kind === "name") ? "name" : "stated" };
}

/** Where an unnamed place stands: the deepest place on the address larger than it (a region may stand in a region). */
export function holderIn(path: string[], own: string | null, scaleOf: (id: string) => string | null): string | null {
  return [...path].reverse().find((id) => rankOf(own) < 0 || rankOf(scaleOf(id)) < 0 || rankOf(scaleOf(id)) > rankOf(own) || (own === "region" && scaleOf(id) === "region")) ?? null;
}

/** An unnamed place of this scene or the one before called by the same words is that place. */
export const sameWords = <S extends { names: string[] }>(text: string, places: S[]) => places.find((place) => place.names.includes(text));

export type SettingBy = "environment" | "action" | "named" | "carried" | "raised" | "none";
/** What a setting may know of the scene beyond its tiers (each optional; without them the setting is chosen as before). */
export interface SettingSense {
  /** A place's scale (a building and a room are where someone is only when the scene puts them there). */
  scale?: (id: string) => string | null;
  /** The scene calls the place by its kind (酒吧 for 飞镖酒吧: a description its name holds). */
  called?: (id: string) => boolean;
  /** The nearest place above it the size of a street or larger (where the scene is when it is only talked of). */
  above?: (id: string) => string | null;
  /** The scene the last setting came from is close in time (false: a carried building or room is left for the place above it). */
  close?: boolean;
}
/**
 * A scene's setting by tiers: the deepest named place its environment cards name; else the one its action cards name most;
 * else the one it names most (but talk of a place that holds the last setting keeps that one: carried). Then, for action
 * and named, the deepest place under it the scene sets in its environment or names twice. A scene that names none goes on
 * where the last one was, unless it is in the past or does not go on from it. `branched`: other places the environment
 * names off the chosen one's address (two branches of the tree: Jev's to say).
 *
 * A place is the setting only where the scene puts someone there (the user, 2026-11-01: mentioned is not there; 纽约 and
 * 第六学区 are talked of, nothing happens there): with `called`, only the places its environment or action cards name, or
 * that it calls by their kind (酒吧 for 飞镖酒吧), are its setting or deepen it; one only talked of never is (常盘台中学 named
 * for her uniform, the scene out on a street). A building or room carried on from the last scene stays only when that
 * scene is close in time; else the place above it (`raised`).
 */
export function chooseSetting(input: { environment: [string, number][]; action: [string, number][]; any: [string, number][]; previous: string | null; past: boolean; continues: boolean; depth: (id: string) => number; under: (id: string, top: string) => boolean } & SettingSense): { place: string | null; by: SettingBy; branched: string[] } {
  const { depth, under, previous, past } = input, set = new Map(input.environment), acted = new Map(input.action), any = new Map(input.any);
  const most = (list: [string, number][]) => [...list].sort((a, b) => b[1] - a[1] || depth(b[0]) - depth(a[0]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const indoors = (id: string) => !!input.scale && ["building", "room"].includes(input.scale(id) ?? "");
  const there = (id: string) => !input.called || set.has(id) || acted.has(id) || input.called(id);
  const up = (id: string) => { let at: string | null = id; for (let n = 0; at && indoors(at) && n < 8; n++) at = input.above?.(at) ?? null; return at; };
  const close = input.close !== false;
  let place: string | null = null, by: SettingBy = "none", branched: string[] = [];
  if (set.size) {
    place = [...set.keys()].sort((a, b) => depth(b) - depth(a) || (set.get(b) ?? 0) - (set.get(a) ?? 0) || a.localeCompare(b))[0]; by = "environment";
    branched = [...set.keys()].filter((id) => id !== place && !under(place!, id));
  } else if ((place = most(input.action))) by = "action";
  else if ((place = most(input.any.filter(([id]) => there(id))))) {
    by = "named";
    if (previous && !past && under(previous, place) && (close || !indoors(previous))) { place = previous; by = "carried"; }
  }
  if (place && (by === "action" || by === "named")) { const deeper = [...any].filter(([id, count]) => under(id, place!) && (set.has(id) || count >= 2) && there(id)).sort((a, b) => depth(b[0]) - depth(a[0]))[0]; if (deeper) place = deeper[0]; }
  if (!place && !past && previous && input.continues) { if (close || !indoors(previous)) { place = previous; by = "carried"; } else { const raised = up(previous); place = raised ?? previous; by = raised ? "raised" : "carried"; } }
  return { place, by, branched };
}

/**
 * The setting more closely: an unnamed building or room the environment names, in the setting (rooms first, then the most
 * named); with none, a street it names when the setting is wider than a street (`wide`: a scene out of doors).
 */
export function deeperByUnnamed<S extends { id: string; kind: string; sentences: string[]; in: string | null; scale?: string }>(places: S[], environment: Set<string>, setting: string | null, onAddress: (holder: string) => boolean, wide = false): S | undefined {
  const held = (place: S) => place.sentences.some((id) => environment.has(id)) && (!setting || !place.in || place.in === setting || onAddress(place.in));
  return places.filter((place) => place.kind !== "place" && held(place))
    .sort((a, b) => (a.kind === "room" ? 0 : 1) - (b.kind === "room" ? 0 : 1) || b.sentences.length - a.sentences.length)[0]
    ?? (wide ? places.filter((place) => place.kind === "place" && place.scale === "street" && held(place)).sort((a, b) => b.sentences.length - a.sentences.length)[0] : undefined);
}

/** A place whose name holds another's name (two characters at least) holds it: 学园都市第七学区 is in 学园都市. */
export const nameHolds = (outer: readonly string[], inner: readonly string[]) => inner.some((a) => outer.some((b) => b.length >= 2 && a !== b && a.includes(b)));
