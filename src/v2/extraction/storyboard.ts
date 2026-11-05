/**
 * Sequence headings and the storyboard (the user, 2026-11-04: "rephrase and redefine ... into the industry standard";
 * docs/v2/directing/casts-jev-and-crew.md). The levels of an anime episode are episode › sequence › scene › cut: a
 * sequence is one span of the tiler's scene pass (where the place, the time or the viewpoint changes), a scene is one
 * unit of the kind pass, a cut is one camera setup.
 *
 * - Headings: each sequence asked of Jev as a screenplay's heading: interior or exterior, where (one of its places), the
 *   time of day. A scene of it whose place was only carried on from the scene before takes the heading's place.
 * - Storyboard (絵コンテ): each scene's cards asked of Jev in order: does the camera cut here, and the shot (size, angle,
 *   movement, seconds on screen). Cards up to the next cut are one cut; a cut's shot is its cards' answers summed.
 */
import type { DecisionAnswer, DecisionQuestion } from "../../ground/connectors/jev.js";
import { ask, type Asker } from "../context/engine.js";
import { headingMode, storyboardMode } from "../context/readingModes.js";
import type { PlaceResult } from "./placeEm.js";

export const SETTINGS: Record<string, string> = { interior: "indoors (INT.)", exterior: "outdoors (EXT.)", both: "indoors and outdoors, or moving between them", unclear: "the text does not say" };
export const DAYTIMES: Record<string, string> = { dawn: "first light", morning: "morning", midday: "around noon", afternoon: "afternoon", evening: "dusk, early evening", night: "night", "late night": "past midnight", unclear: "the text does not say" };
export const SHOT_SIZES: Record<string, string> = {
  "extreme close-up": "a detail: eyes, a hand, an object (ECU)", "close-up": "one face (CU)", "medium close-up": "head and shoulders (MCU)",
  "medium shot": "from the waist up; two people talking (MS)", "full shot": "whole bodies, head to feet (FS)", "wide shot": "the people small in their surroundings: a room, a street (WS)",
  "extreme wide shot": "the place itself: a district, the skyline, from far or high (EWS)",
};
export const SHOT_ANGLES: Record<string, string> = { "eye level": "level, at a person's height", "over the shoulder": "from behind one person toward another", high: "from above, looking down at a slant", low: "from low, looking up", overhead: "straight down", aerial: "from high over the place" };
export const SHOT_MOVES: Record<string, string> = { static: "the camera holds still", pan: "turns to follow or to show", tilt: "tilts up or down", track: "moves along with someone (dolly or track)", crane: "rises or descends", handheld: "shakes with the action", zoom: "pushes in or pulls out" };
export const SHOT_SECONDS: Record<string, number> = { "1–2 s": 1.5, "3–5 s": 4, "6–10 s": 8, "11–20 s": 15, "21–60 s": 40, "over a minute": 90 };

export interface Heading { setting: string | null; place: string | null; daytime: string | null; confidence: { setting: number; place: number; daytime: number }; offered: string[] }
export interface Cut { id: string; index: number; sequence: string | null; scene: string; cards: string[]; first: string; last: string; size: string; angle: string; move: string; seconds: number; confidence: number; distributions: { size: Record<string, number>; angle: Record<string, number>; move: Record<string, number> } }
/** One card's storyboard answers: whether it cuts (P), its shot's distributions, its seconds. */
export interface CardShot { card: string; scene: string; first: string; last: string; cut: number; size: Record<string, number>; angle: Record<string, number>; move: Record<string, number>; seconds: number; confidence: number }

const round = (value: number) => Math.round(value * 1000) / 1000;
const clip = (value: string, size: number) => (value.length > size ? `${value.slice(0, Math.round(size * 0.7))}…${value.slice(-Math.round(size * 0.3))}` : value);
const choice = (key: string, instructions: string, options: Record<string, string> | string[]): DecisionQuestion => Array.isArray(options)
  ? { key, primitive: "choice", instructions, options: [...options] }
  : { key, primitive: "choice", instructions, options: Object.keys(options), optionHints: { ...options } };
/** A reply's whole distribution over the options (its value alone when it gives none). */
export function distributionOf(reply: DecisionAnswer | undefined, options: string[]): Record<string, number> {
  const out = Object.fromEntries(options.map((option) => [option, Number(reply?.distribution?.[option] ?? 0)]));
  if (!Object.values(out).some((p) => p > 0) && reply && options.includes(String(reply.value))) out[String(reply.value)] = Number(reply.confidence ?? 1);
  return out;
}
const top = (distribution: Record<string, number>) => Object.entries(distribution).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

/**
 * The places a sequence's heading may name: the places its scenes are set in by what they say (not carried), the unnamed
 * places opened in them, the heading before, and the places those stand in (two levels up); at most `most`.
 */
export function headingPlaces(sequence: { scenes: string[] }, places: PlaceResult, before: string | null, most = 12): string[] {
  const parentOf = new Map(places.places.map((entry) => [entry.id, entry.parent]));
  const own = new Set(sequence.scenes), found: string[] = [], add = (id: string | null | undefined) => { if (id && !found.includes(id)) found.push(id); };
  for (const setting of places.settings) if (own.has(setting.scene) && setting.place && !["carried", "none"].includes(setting.by)) add(setting.place);
  for (const slot of places.slots) if (own.has(slot.scene)) add(slot.id);
  add(before);
  for (const id of [...found]) { let up = parentOf.get(id) ?? places.slots.find((slot) => slot.id === id)?.in ?? null; for (let k = 0; k < 2 && up; k++, up = parentOf.get(up) ?? null) add(up); }
  return found.slice(0, most);
}

/**
 * Each sequence's heading, asked of Jev a few at a time; a scene whose place was only carried on (by "carried" or none)
 * takes the heading's place when Jev is sure enough. Changes `places.settings` and `places.occupancy` in place; returns the
 * headings by sequence and how many scenes changed place.
 */
export async function readHeadings(decide: Asker, input: { sequences: { id: string; index: number; sentences: string[]; scenes: string[] }[]; places: PlaceResult; label: (id: string) => string; text: (id: string) => string; flashback: (scene: string) => boolean; per?: number; shown?: number; accept?: number }): Promise<{ headings: Map<string, Heading>; changed: number }> {
  const per = input.per ?? 6, shown = input.shown ?? 2400, accept = input.accept ?? 0.5, headings = new Map<string, Heading>();
  let before: string | null = null, changed = 0;
  const offeredOf = new Map<string, string[]>();
  // The places offered depend on the heading before, so batches go in reading order.
  for (let n = 0; n < input.sequences.length; n += per) {
    const batch = input.sequences.slice(n, n + per), items: [string, unknown][] = [], questions: DecisionQuestion[] = [];
    for (const sequence of batch) {
      const offered = headingPlaces(sequence, input.places, before), name = `sequence_${sequence.index + 1}`;
      offeredOf.set(sequence.id, offered);
      items.push([name, { text: clip(sequence.sentences.map(input.text).join(""), shown), places: offered.map((id) => input.label(id)) }]);
      questions.push(choice(`setting:${sequence.id}`, `Is sequences.${name} interior or exterior?`, SETTINGS));
      if (offered.length) questions.push(choice(`place:${sequence.id}`, `Where is sequences.${name}? One of its places, or none of these.`, { ...Object.fromEntries(offered.map((id) => [id, input.label(id)])), "none of these": "somewhere else, or the text does not say" }));
      questions.push(choice(`daytime:${sequence.id}`, `What time of day is sequences.${name}?`, DAYTIMES));
      // A sequence's own place is the next one's "before" only once asked; a batch's later sequences offer the last known.
    }
    const { replies } = await ask(decide, headingMode, { items, questions }, null);
    for (const sequence of batch) {
      const reply = (field: string) => replies.find((entry) => entry.key === `${field}:${sequence.id}`);
      const offered = offeredOf.get(sequence.id) ?? [], place = reply("place"), setting = reply("setting"), daytime = reply("daytime");
      const where = place && offered.includes(String(place.value)) && Number(place.confidence ?? 0) >= accept ? String(place.value) : null;
      headings.set(sequence.id, { setting: setting ? String(setting.value) : null, place: where, daytime: daytime ? String(daytime.value) : null, confidence: { setting: round(Number(setting?.confidence ?? 0)), place: round(Number(place?.confidence ?? 0)), daytime: round(Number(daytime?.confidence ?? 0)) }, offered });
      if (where) before = where;
      if (!where) continue;
      for (const setting of input.places.settings) if (sequence.scenes.includes(setting.scene) && ["carried", "none"].includes(setting.by) && !input.flashback(setting.scene) && setting.place !== where) {
        setting.place = where; setting.by = "sequence"; setting.confidence = round(Number(place?.confidence ?? 0)); changed++;
        for (const entry of input.places.occupancy) if (entry.scene === setting.scene && entry.by === "setting") entry.place = where;
      }
    }
  }
  return { headings, changed };
}

/** Cuts from the cards' answers, scene by scene in order: a cut starts at a scene's first card and where P(cut) ≥ ½. */
export function cutsOf(shots: CardShot[], sequenceOf: (scene: string) => string | null): Cut[] {
  const cuts: Cut[] = [];
  let open: CardShot[] = [];
  const close = () => {
    if (!open.length) return;
    const sum = (field: "size" | "angle" | "move") => { const out: Record<string, number> = {}; for (const shot of open) for (const [option, p] of Object.entries(shot[field])) out[option] = (out[option] ?? 0) + p / open.length; return Object.fromEntries(Object.entries(out).map(([option, p]) => [option, round(p)])); };
    const size = sum("size"), angle = sum("angle"), move = sum("move"), n = cuts.length;
    cuts.push({ id: `cut_${String(n + 1).padStart(6, "0")}`, index: n, sequence: sequenceOf(open[0].scene), scene: open[0].scene, cards: open.map((shot) => shot.card), first: open[0].first, last: open.at(-1)!.last,
      size: top(size)[0], angle: top(angle)[0], move: top(move)[0], seconds: round(open.reduce((total, shot) => total + shot.seconds, 0)), confidence: round(open.reduce((total, shot) => total + shot.confidence, 0) / open.length), distributions: { size, angle, move } });
    open = [];
  };
  shots.forEach((shot, k) => { if (!open.length || shot.scene !== shots[k - 1]?.scene || shot.cut >= 0.5) close(); open.push(shot); });
  close();
  return cuts;
}

/** The storyboard: each scene's cards asked in order, `per` a request (the card before a batch shown for context). */
export async function readStoryboard(decide: Asker, input: { scenes: { id: string; sentences: string[] }[]; cards: { id: string; kind: string; first: string; last?: string; sentences: string[] }[]; headingOf: (scene: string) => { setting: string | null; where: string | null; daytime: string | null } | null; text: (id: string) => string; sequenceOf: (scene: string) => string | null; per?: number; shown?: number; parallel?: number }): Promise<Cut[]> {
  const per = input.per ?? 12, shown = input.shown ?? 500, parallel = input.parallel ?? 8;
  const sceneOf = new Map(input.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id] as [string, string])));
  const cardsOf = new Map<string, typeof input.cards>();
  for (const card of input.cards) { const scene = sceneOf.get(card.first); if (scene) cardsOf.set(scene, [...(cardsOf.get(scene) ?? []), card]); }
  const batches = input.scenes.flatMap((scene) => { const list = cardsOf.get(scene.id) ?? []; return Array.from({ length: Math.ceil(list.length / per) }, (_, k) => ({ scene: scene.id, list: list.slice(k * per, (k + 1) * per), before: k ? list[k * per - 1] : null, opens: k === 0 })); });
  const shots = new Map<string, CardShot>();
  let next = 0;
  const one = async (batch: (typeof batches)[number]) => {
    const keyOf = new Map(batch.list.map((card, k) => [card.id, `c${k + 1}`])), heading = input.headingOf(batch.scene);
    const words = (card: { sentences: string[] }) => clip(card.sentences.map(input.text).join(""), shown);
    const items: [string, unknown][] = [["heading", heading ?? {}], ...(batch.before ? [["before", { kind: batch.before.kind, text: words(batch.before) }] as [string, unknown]] : []), ...batch.list.map((card) => [keyOf.get(card.id)!, { kind: card.kind, text: words(card) }] as [string, unknown])];
    const questions = batch.list.flatMap((card, k) => {
      const key = keyOf.get(card.id)!;
      return [
        ...(batch.opens && k === 0 ? [] : [choice(`cut:${card.id}`, `Does the camera cut to a new shot at scene.${key}?`, { "new cut": "a new camera setup starts here", "same shot": "the shot before goes on" })]),
        choice(`size:${card.id}`, `What size is the shot at scene.${key}?`, SHOT_SIZES),
        choice(`angle:${card.id}`, `From what angle does the camera look at scene.${key}?`, SHOT_ANGLES),
        choice(`move:${card.id}`, `How does the camera move during scene.${key}?`, SHOT_MOVES),
        choice(`seconds:${card.id}`, `How long is scene.${key} on screen?`, Object.keys(SHOT_SECONDS)),
      ];
    });
    const { replies } = await ask(decide, storyboardMode, { items, questions }, null);
    for (const [k, card] of batch.list.entries()) {
      const reply = (field: string) => replies.find((entry) => entry.key === `${field}:${card.id}`);
      const cut = batch.opens && k === 0 ? 1 : distributionOf(reply("cut"), ["new cut", "same shot"])["new cut"];
      const seconds = distributionOf(reply("seconds"), Object.keys(SHOT_SECONDS)), mass = Object.values(seconds).reduce((total, p) => total + p, 0);
      const fields = ["size", "angle", "move"].map((field) => Number(reply(field)?.confidence ?? 0));
      shots.set(card.id, { card: card.id, scene: batch.scene, first: card.first, last: card.last ?? card.sentences.at(-1) ?? card.first, cut: round(cut),
        size: distributionOf(reply("size"), Object.keys(SHOT_SIZES)), angle: distributionOf(reply("angle"), Object.keys(SHOT_ANGLES)), move: distributionOf(reply("move"), Object.keys(SHOT_MOVES)),
        seconds: round(mass ? Object.entries(seconds).reduce((total, [option, p]) => total + SHOT_SECONDS[option] * p, 0) / mass : 4), confidence: round(fields.reduce((total, value) => total + value, 0) / fields.length) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, async () => { while (next < batches.length) await one(batches[next++]); }));
  const ordered = input.scenes.flatMap((scene) => (cardsOf.get(scene.id) ?? []).map((card) => shots.get(card.id)).filter((shot): shot is CardShot => !!shot));
  return cutsOf(ordered, input.sequenceOf);
}
