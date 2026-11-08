import { createHash } from "node:crypto";
import type { DecisionModel } from "../../ground/connectors/jev.js";

/**
 * Stage faculty — scale: how big a place is, on the ladder region › city ›
 * district › street › building › room (or none), one Jev choice per place
 * from its name, its path in the place tree and the places inside it. The
 * stage builds a place by its scale: a building or a room is a site, a street
 * a street, anything larger a district of buildings.
 *
 * Jev, not a package: on 66 places of the toaru vols 1–4 snapshot, Jev was
 * right on 64; the name's generic part (通名) on 44 to 54, silent on bare
 * proper names; the books' embedding model on 43; a Chinese NER only told
 * areas from sites (docs/stage-simulation-design.md). Without Jev, the
 * generic part stands where it says something, and the place is asked again
 * once Jev is available.
 *
 * A view input: no review packet, never canon. Answers are kept per place and
 * reused while its name, path and children stay the same.
 */
export const SCALES = ["region", "city", "district", "street", "building", "room"] as const;
export type PlaceScale = (typeof SCALES)[number] | "none";
/** The options as Jev reads them (the wording the test above was run with). */
export const SCALE_HINTS: Record<PlaceScale, string> = {
  region: "region: a country, state, province, island group or wide natural area, bigger than a city",
  city: "city: a city or metropolis",
  district: "district: a part of a city: a ward, school district, downtown, neighbourhood, or a side of one",
  street: "street: a street, road, alley, tunnel, square, or the open space in front of something",
  building: "building: one building or site: a shop, station, school, hospital, airport, port, office tower, house, ship",
  room: "room: a room or space inside a building: an office, a ward, a lab, a cell, backstage",
  none: "none: not a place (furniture, a thing, an event), or none of these",
};

/** A place as the faculty reads it: its name, other names, its path in the place tree (ids, root first) and the places inside it (ids). */
export interface ScalePlace { id: string; label: string; aliases?: string[]; path: string[]; contains?: string[] }
export interface ScalePick {
  label: string;
  scale: PlaceScale;
  /** jev: the choice; name: the generic part of the name (no Jev); none: neither said anything. */
  by: "jev" | "name" | "none";
  /** What this pick read (name, path, children): it is reused while that stays the same. */
  inputs: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export interface ScaleReport { version: 1; inputs: string; model: string | null; askedAt: string; usage: { calls: number; reused: number }; places: Record<string, ScalePick> }

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
export const scaleInputs = (place: ScalePlace) => hash([place.label, place.aliases ?? [], place.path, place.contains ?? []]);
/** What the faculty reads, for the checklist: current while every place's inputs are. */
export const scaleFingerprint = (places: ScalePlace[]) => hash(places.map((place) => [place.id, scaleInputs(place)]).sort());

/** The generic part of a Chinese place name (通名), from a plain textbook list: the scale its end names, or null. */
const GENERIC: [PlaceScale, string[]][] = [
  ["room", ["室", "房", "厅", "间"]],
  ["building", ["楼", "厦", "馆", "店", "站", "院", "宫", "中心", "学校", "中学", "大学", "公寓", "宿舍", "住宅", "机场", "港", "寺", "堂"]],
  ["street", ["街", "路", "道", "巷", "广场", "桥", "隧道"]],
  ["district", ["区", "町", "镇", "村"]],
  ["city", ["市", "城", "都"]],
  ["region", ["国", "省", "州", "岛", "县", "洲"]],
];
export function scaleOfName(label: string): PlaceScale | null {
  // Latin words and brackets after the Chinese name (中心（Secret Residence）, 小馆Diner) do not count as its end.
  const core = label.replace(/[（(][^）)]*[）)]\s*$/, "").replace(/[A-Za-z_&\s]+$/, "");
  let best: { scale: PlaceScale; length: number } | null = null;
  for (const [scale, words] of GENERIC) for (const word of words) if (core.endsWith(word) && (!best || word.length > best.length)) best = { scale, length: word.length };
  return best?.scale ?? null;
}

/** One place: Jev's choice, or without Jev the generic part of its name. */
export async function pickScale(place: ScalePlace, options: { decisions?: DecisionModel; names?: Record<string, string> } = {}): Promise<{ pick: ScalePick; calls: number }> {
  const base = { label: place.label, inputs: scaleInputs(place) };
  if (!options.decisions) { const named = scaleOfName(place.label); return { pick: { ...base, scale: named ?? "none", by: named ? "name" : "none" }, calls: 0 }; }
  const name = (id: string) => options.names?.[id] ?? id, path = place.path.map(name), contains = (place.contains ?? []).slice(0, 8).map(name);
  const state = [`A place named in a novel: ${place.label}${place.aliases?.length ? ` (also called ${place.aliases.join("、")})` : ""}.`,
    path.length > 1 ? `Its place in the novel's place tree, outermost first: ${path.join(" › ")}.` : "The novel names no place it is inside.",
    contains.length ? `Places the novel puts inside it: ${contains.join("、")}.` : ""].filter(Boolean).join("\n");
  const [answer] = await options.decisions.decide(state, [{ key: "scale", primitive: "choice", instructions: `What scale of place is ${place.label}?`, options: Object.keys(SCALE_HINTS), optionHints: SCALE_HINTS }]);
  const value = String(answer?.value ?? ""), scale = (value in SCALE_HINTS ? value : "none") as PlaceScale;
  const probabilities = answer?.distribution ? Object.fromEntries(Object.entries(answer.distribution).map(([option, p]) => [option, Math.round(p * 1000) / 1000])) : undefined;
  return { pick: { ...base, scale, by: "jev", ...(answer?.confidence !== undefined ? { confidence: answer.confidence } : {}), ...(probabilities ? { probabilities } : {}) }, calls: 1 };
}

/** Every place, reusing earlier picks whose inputs have not changed (a pick made without Jev is asked again once Jev is there); a few places at a time. */
export async function pickScales(places: ScalePlace[], options: { decisions?: DecisionModel; names?: Record<string, string>; previous?: ScaleReport | null; concurrency?: number } = {}): Promise<ScaleReport> {
  const picks: Record<string, ScalePick> = {};
  let calls = 0, reused = 0, next = 0;
  const worker = async () => {
    while (next < places.length) {
      const place = places[next++], earlier = options.previous?.places[place.id];
      if (earlier && earlier.inputs === scaleInputs(place) && (earlier.by === "jev" || !options.decisions)) { picks[place.id] = earlier; reused++; continue; }
      const result = await pickScale(place, options);
      picks[place.id] = result.pick;
      calls += result.calls;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, places.length)) }, worker));
  return { version: 1, inputs: scaleFingerprint(places), model: options.decisions?.modelId ?? null, askedAt: new Date().toISOString(), usage: { calls, reused }, places: Object.fromEntries(places.map((place) => [place.id, picks[place.id]])) };
}

/** How the stage builds a place of this scale: a site (one building), a street, or a district of buildings; null when the scale says nothing. */
export const stageKindOf = (scale: PlaceScale | null | undefined): "site" | "street" | "district" | null =>
  scale === "building" || scale === "room" ? "site" : scale === "street" ? "street" : scale === "district" || scale === "city" || scale === "region" ? "district" : null;
