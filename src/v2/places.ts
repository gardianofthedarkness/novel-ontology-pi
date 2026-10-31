import type { DecisionQuestion } from "../ground/connectors/jev.js";
import { mentions, type Chart } from "./em.js";
import type { PlaceLink, Slot } from "./roles.js";
import type { Decide } from "./typing.js";

/**
 * The place tree from the reading (the user's call, 2026-10-31: the place tree first, from the new extraction, for EM and
 * EM²). Only named places are places of the chart (EM); every description of a place was settled where it stands by EM²
 * (a named place of the scene, or an unnamed place of the scene, a slot), with the named place that holds it. Each named
 * place's parent, by what says it, surest first:
 * 1. its name holds another's ("学园都市第七学区" holds "学园都市": the shorter is the larger);
 * 2. the text names the larger right before it ("学园都市第七学区的公寓", "东京西部的学园都市，第七学区车站前的繁华街");
 * 3. EM² said so where a description of it stood (the named place it is in);
 * 4. for a named place none of these places, Jev, once for all of them: which named place it is in, or none, with the
 *    sentences that name it.
 * A parent that would close a loop is not taken. An unnamed place (a slot) is in what EM² said holds it.
 */
export interface PlaceParent { id: string; parent: string | null; by: "name" | "stated" | "em2" | "jev" | "none"; confidence: number; votes?: Record<string, number> }
export interface PlaceTree { places: PlaceParent[]; slots: { id: string; kind: string; scene: string; label: string; in: string | null }[] }

const WEIGHT = { name: 3, stated: 2, em2: 1 } as const;
/** Between two named places in a sentence: nothing, 的/之/里/中/内, or a comma: the first holds the second. */
const JOIN = /^(?:的|之|里的|内的|中的|里|内|中|，|、|\s)?$/;

export async function placeTree(decide: Decide, input: { chart: Chart; sentences: { id: string; text: string }[]; placeLinks: PlaceLink[]; slots: Slot[]; text: (sentence: string) => string }): Promise<PlaceTree> {
  const { chart } = input;
  const places = [...chart.entities.values()].filter((entity) => entity.category === "place");
  const ids = new Set(places.map((place) => place.id));
  const votes = new Map<string, Map<string, { score: number; by: PlaceParent["by"] }>>();
  const vote = (child: string, parent: string, by: keyof typeof WEIGHT, weight: number = WEIGHT[by]) => {
    if (child === parent || !ids.has(child) || !ids.has(parent)) return;
    const of = votes.get(child) ?? new Map(), now = of.get(parent) ?? { score: 0, by };
    now.score += weight; if (WEIGHT[by] > WEIGHT[now.by as keyof typeof WEIGHT]) now.by = by;
    of.set(parent, now); votes.set(child, of);
  };
  // 1. Names inside names.
  for (const outer of places) for (const inner of places) if (outer !== inner && inner.names.some((a) => outer.names.some((b) => b.length >= 2 && a !== b && a.includes(b)))) vote(inner.id, outer.id, "name");
  // 2. Named one right after the other.
  const names = places.flatMap((place) => place.names.map((name): [string, string] => [name, place.id])).sort((a, b) => b[0].length - a[0].length);
  for (const sentence of input.sentences) {
    const hits = mentions(sentence.text, names);
    for (let k = 1; k < hits.length; k++) if (hits[k - 1].id !== hits[k].id && JOIN.test(sentence.text.slice(hits[k - 1].at + hits[k - 1].name.length, hits[k].at))) vote(hits[k].id, hits[k - 1].id, "stated");
  }
  // 3. EM²'s.
  for (const link of input.placeLinks) vote(link.child, link.parent, "em2", link.confidence);

  // The surest parent of each, never closing a loop.
  const parentOf = new Map<string, PlaceParent>();
  const loops = (child: string, parent: string) => { for (let at: string | null = parent; at; at = parentOf.get(at)?.parent ?? null) if (at === child) return true; return false; };
  const ranked = [...votes].map(([child, of]) => [child, [...of].sort((a, b) => b[1].score - a[1].score)] as const).sort((a, b) => b[1][0][1].score - a[1][0][1].score);
  for (const [child, options] of ranked) {
    const best = options.find(([parent]) => !loops(child, parent));
    if (best) parentOf.set(child, { id: child, parent: best[0], by: best[1].by, confidence: Number(Math.min(1, best[1].score / 3).toFixed(3)), votes: Object.fromEntries(options.map(([parent, entry]) => [parent, Number(entry.score.toFixed(2))])) });
  }

  // 4. Jev, once, for the named places nothing placed.
  const left = places.filter((place) => !parentOf.has(place.id));
  if (left.length && places.length > 1) {
    const label = (id: string) => chart.entities.get(id)?.proper[0] ?? chart.entities.get(id)?.names[0] ?? id;
    const naming = (place: (typeof places)[number]) => input.sentences.filter((sentence) => place.names.some((name) => sentence.text.includes(name))).slice(0, 3).map((sentence) => sentence.text.length > 140 ? `${sentence.text.slice(0, 139)}…` : sentence.text);
    const keys = left.map((place, k) => [`q${k + 1}`, place] as const);
    const state = {
      task: "Named places of a novel. For each place asked about, say which of the named places it lies in (a district in its city, a street in its district, a room in its building), or none: it lies in none of them, or the text does not say.",
      places: Object.fromEntries(places.map((place) => [place.id, { name: label(place.id), is: place.type, ...(parentOf.get(place.id)?.parent ? { in: label(parentOf.get(place.id)!.parent!) } : {}) }])),
      asked: Object.fromEntries(keys.map(([key, place]) => [key, { place: place.id, text: naming(place) }])),
    };
    const questions: DecisionQuestion[] = keys.map(([key, place]) => ({ key: `tree:${key}`, primitive: "choice", instructions: `Which named place is asked.${key} (${label(place.id)}) in?`, options: [...places.filter((other) => other !== place).map((other) => other.id), "none"], optionHints: { ...Object.fromEntries(places.filter((other) => other !== place).map((other) => [other.id, `${label(other.id)} (${other.type})`])), none: "none of them, or the text does not say" } }));
    const replies = await decide(state, questions);
    for (const [key, place] of keys) {
      const reply = replies.find((entry) => entry.key === `tree:${key}`), value = String(reply?.value ?? "none"), confidence = Number(reply?.distribution?.[value] ?? reply?.confidence ?? 0);
      const parent = ids.has(value) && confidence >= 0.5 && !loops(place.id, value) ? value : null;
      parentOf.set(place.id, { id: place.id, parent, by: parent ? "jev" : "none", confidence: Number(confidence.toFixed(3)) });
    }
  }
  for (const place of places) if (!parentOf.has(place.id)) parentOf.set(place.id, { id: place.id, parent: null, by: "none", confidence: 0 });
  return {
    places: places.map((place) => parentOf.get(place.id)!),
    slots: input.slots.filter((slot) => ["place", "building", "room"].includes(slot.kind)).map((slot) => ({ id: slot.id, kind: slot.kind, scene: slot.scene, label: slot.label, in: slot.in ?? null })),
  };
}
