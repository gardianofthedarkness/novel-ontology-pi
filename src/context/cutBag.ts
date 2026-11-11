/**
 * The cut bag (the user, 2026-11-04: "This is what context engine should now do. It decides which pre film casts notes are
 * provided to which runtime casts"). In a studio each cut travels desk to desk in its bag: the storyboard page, the
 * settei, the layout, the timesheet, the notes; each desk takes out what its job needs. Here the pre-film casts' notes
 * (the reading and terrain stage: the script supervisor, the screenwriter, the storyboard artist, blocking, the action
 * director, dialogue coverage, background action) are put in one bag, each note with who wrote it, what kind it is, the
 * line it rests on, who it is about, stated or implied and how sure. The routing table says which runtime cast (the
 * layout artist, the photographer, the key animator, the animation director, the episode director) is given which
 * notes, about whom, from how far; `route` ranks them for one task (sure, stated before implied, nearest the lines
 * being made, about the one asked of first), and `notesSource` makes them a source of the engine, so a Jev request
 * carries them under `notes` and its manifest records every note kept and every note cut.
 * Physics is no cast and is given no notes: it executes what the casts decide and pushes back through the laws.
 */
import type { Item, Source } from "./engine.js";

export type PreFilmCast = "script supervisor" | "screenwriter" | "storyboard artist" | "cinematographer" | "blocking" | "action director" | "dialogue coverage" | "background action";
export type RuntimeTask = "layout" | "frame" | "keys" | "layout check" | "key check" | "rush check";
export type NoteKind = "summary" | "state" | "fact" | "move" | "item" | "talk" | "background" | "journey" | "reach" | "exchange" | "formation" | "channel" | "crowd" | "heading" | "shot";
export interface Note { id: string; cast: PreFilmCast; kind: NoteKind; unit: string; sentence: string | null; who: string[]; basis: "stated" | "implied" | null; sure: number; text: string; /** The cast's own entry, for a rule that tests it (a fact on a spot). */ raw?: unknown }

/** Who does each runtime task (the crew's names). */
export const RUNTIME_CAST: Record<RuntimeTask, string> = { layout: "layout artist", frame: "photographer", keys: "key animator", "layout check": "episode director", "key check": "animation director", "rush check": "episode director" };

/**
 * One line of the routing table: from which pre-film cast, which kinds; where the note's line may stand (`card`: in the
 * lines being made; `cut`: in the cut's lines; `before`: in the unit up to the lines' end; `unit`: anywhere in the unit);
 * about whom (`subject`: the one asked of first, the mover; `cast`: anyone the cut holds; `anyone`); the least sureness;
 * how many.
 */
export interface Route { from: PreFilmCast; kinds: NoteKind[]; where: "card" | "cut" | "before" | "unit"; about: "subject" | "cast" | "anyone"; sure?: number; quota: number }

export const ROUTES: Record<RuntimeTask, Route[]> = {
  // Where the cast stands at the cut's start: what is said or implied of where each is, how each starts and ends the
  // unit, the formations they stand in, the heading's place, the crowd round them.
  layout: [
    { from: "script supervisor", kinds: ["fact"], where: "before", about: "cast", sure: 0.5, quota: 12 },
    { from: "script supervisor", kinds: ["state"], where: "unit", about: "cast", quota: 8 },
    { from: "dialogue coverage", kinds: ["formation"], where: "cut", about: "cast", quota: 4 },
    { from: "screenwriter", kinds: ["heading"], where: "unit", about: "anyone", quota: 1 },
    { from: "background action", kinds: ["crowd"], where: "before", about: "anyone", quota: 2 },
  ],
  // The window: the storyboard's shot, the heading, who fights or talks to whom in the cut (both kept in frame), how far
  // a move goes.
  frame: [
    { from: "storyboard artist", kinds: ["shot"], where: "cut", about: "anyone", quota: 1 },
    { from: "screenwriter", kinds: ["heading"], where: "unit", about: "anyone", quota: 1 },
    { from: "action director", kinds: ["exchange"], where: "cut", about: "cast", quota: 6 },
    { from: "dialogue coverage", kinds: ["channel", "formation"], where: "cut", about: "cast", quota: 6 },
    { from: "cinematographer", kinds: ["reach"], where: "unit", about: "anyone", quota: 1 },
  ],
  // The key animator, for one mover in one card: their moves, what is said or implied of where they are, what they
  // carry, their journeys, the blows they give or take, the formations they stand in, the unit's summary.
  keys: [
    { from: "script supervisor", kinds: ["move"], where: "card", about: "subject", quota: 6 },
    { from: "script supervisor", kinds: ["fact"], where: "before", about: "subject", sure: 0.5, quota: 6 },
    { from: "script supervisor", kinds: ["item"], where: "before", about: "subject", quota: 4 },
    { from: "blocking", kinds: ["journey"], where: "card", about: "subject", quota: 3 },
    { from: "action director", kinds: ["exchange"], where: "card", about: "subject", quota: 4 },
    { from: "dialogue coverage", kinds: ["formation"], where: "card", about: "subject", quota: 3 },
    { from: "script supervisor", kinds: ["summary"], where: "unit", about: "anyone", quota: 1 },
  ],
  // The checks: the episode director holds the layout to where the text puts the cast (stated or implied and sure);
  // the animation director holds the keys to where the text puts the movers and how they talk.
  "layout check": [
    { from: "script supervisor", kinds: ["fact"], where: "before", about: "cast", sure: 0.5, quota: 24 },
  ],
  "key check": [
    { from: "script supervisor", kinds: ["fact"], where: "card", about: "cast", sure: 0.5, quota: 12 },
    { from: "dialogue coverage", kinds: ["channel"], where: "card", about: "cast", quota: 12 },
  ],
  "rush check": [
    { from: "script supervisor", kinds: ["fact", "item"], where: "card", about: "cast", quota: 24 },
  ],
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const clip = (value: unknown, size = 160) => { const text = String(value ?? ""); return text.length > size ? `${text.slice(0, size - 1)}…` : text; };
const sureOf = (value: unknown, fallback = 0.6) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback);
const people = (...values: unknown[]) => values.flat().filter((value): value is string => typeof value === "string" && value.length > 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Every pre-film cast's notes for one unit, as the reading step left them (prefilm.json's unit, by cast id: `scriptSupervisor`,
 * `cinematographer`, `blocking`, `actionDirector`, `dialogueCoverage`, `backgroundAction`), with the screenwriter's heading and the storyboard's cuts of the unit.
 */
export function notesOfUnit(unit: string, prepared: any, extra: { heading?: any; cuts?: any[] } = {}): Note[] {
  const notes: Note[] = [], add = (note: Omit<Note, "id" | "unit">) => notes.push({ id: `${unit}:${notes.length + 1}`, unit, ...note });
  const g = prepared?.scriptSupervisor ?? null, digest = g?.digest ?? null;
  if (digest?.summary) add({ cast: "script supervisor", kind: "summary", sentence: null, who: [], basis: null, sure: 1, text: clip(`${digest.summary}${digest.where ? ` Where: ${digest.where}.` : ""}`, 300) });
  for (const person of digest?.people ?? []) add({ cast: "script supervisor", kind: "state", sentence: null, who: people(person.who), basis: null, sure: 1, text: clip(`${person.who}: ${person.doing ?? ""}; starts ${person.start ?? "?"}; ends ${person.end ?? "?"}${person.holding?.length ? `; holding ${person.holding.join(", ")}` : ""}`) });
  for (const fact of g?.facts ?? []) add({ cast: "script supervisor", kind: "fact", sentence: fact.sentence ?? null, who: people(fact.who), basis: fact.basis === "stated" ? "stated" : "implied", sure: sureOf(fact.sure), text: clip(`${fact.who} ${fact.kind}${fact.value ? `: ${fact.value}` : ""}`), raw: fact });
  for (const move of g?.moves ?? []) add({ cast: "script supervisor", kind: "move", sentence: move.sentence ?? null, who: people(move.who), basis: move.basis === "stated" ? "stated" : "implied", sure: sureOf(move.sure), text: clip(`${move.who} ${move.motion}${move.toward ? ` toward ${move.toward}` : ""}${move.away ? ` away from ${move.away}` : ""}${move.with ? ` with ${move.with}` : ""}${move.to ? `, to ${move.to}` : ""} (${move.how ?? "walk"})`) });
  for (const item of g?.items ?? []) add({ cast: "script supervisor", kind: "item", sentence: item.sentence ?? null, who: people(item.who, item.to), basis: null, sure: 0.8, text: clip(`${item.item} ${item.event}${item.who ? ` by ${item.who}` : ""}${item.to ? ` to ${item.to}` : ""}`) });
  for (const talk of g?.talk ?? []) add({ cast: "script supervisor", kind: "talk", sentence: talk.sentence ?? null, who: [], basis: null, sure: 0.7, text: `spoken ${talk.kind}` });
  for (const entry of g?.background ?? []) add({ cast: "script supervisor", kind: "background", sentence: entry.sentence ?? null, who: entry.who === "crowd" ? [] : people(entry.who), basis: null, sure: 0.6, text: clip(`${entry.who} ${entry.doing}`) });
  for (const scale of prepared?.cinematographer ?? []) add({ cast: "cinematographer", kind: "reach", sentence: scale.first ?? null, who: [], basis: null, sure: sureOf(scale.sure), text: clip(`a move reaches ${scale.reach?.times ?? 1} × ${scale.reach?.referent ?? "?"}; the frame takes in ${scale.frame?.referent ?? "?"}`) });
  for (const journey of prepared?.blocking ?? []) add({ cast: "blocking", kind: "journey", sentence: journey.sentence ?? null, who: people(journey.who), basis: null, sure: sureOf(journey.sure), text: clip(`${journey.who} ${journey.manner ?? "goes"} from ${journey.said?.from ?? journey.from ?? "?"} to ${journey.said?.to ?? journey.to ?? "?"}${journey.distance ? `, ${journey.distance.times ?? 1} × ${journey.distance.referent}` : ""}`) });
  for (const blow of prepared?.actionDirector ?? []) add({ cast: "action director", kind: "exchange", sentence: blow.sentence ?? null, who: people(blow.attacker, blow.target), basis: null, sure: sureOf(blow.sure), text: clip(`${blow.attacker} → ${blow.target}: ${blow.attack}, ${blow.range ?? ""}, ${blow.outcome ?? ""}${blow.condition ? `, ${blow.condition}` : ""}`) });
  for (const exchange of prepared?.dialogueCoverage?.exchanges ?? []) add({ cast: "dialogue coverage", kind: "channel", sentence: exchange.sentence ?? null, who: people(exchange.who, exchange.with ?? []), basis: null, sure: sureOf(exchange.sure), text: clip(`${exchange.who} to ${(exchange.with ?? []).join(", ")}: ${exchange.channel}`) });
  for (const formation of prepared?.dialogueCoverage?.formations ?? []) add({ cast: "dialogue coverage", kind: "formation", sentence: formation.sentence ?? null, who: people(formation.who ?? []), basis: null, sure: sureOf(formation.sure), text: clip(`${(formation.who ?? []).join(", ")}: ${formation.formation}`) });
  for (const crowd of prepared?.backgroundAction ?? []) add({ cast: "background action", kind: "crowd", sentence: crowd.sentence ?? null, who: people(crowd.focus), basis: null, sure: sureOf(crowd.sure), text: clip(`crowd ${crowd.size}, ${crowd.state}${crowd.focus ? ` round ${crowd.focus}` : ""}`) });
  const heading = extra.heading;
  if (heading) add({ cast: "screenwriter", kind: "heading", sentence: null, who: [], basis: null, sure: Math.min(...Object.values(heading.confidence ?? { all: 1 }).map((value) => sureOf(value, 1))), text: [heading.setting === "interior" ? "INT." : heading.setting === "exterior" ? "EXT." : "", heading.place ?? "", heading.daytime ? `— ${heading.daytime}` : ""].filter(Boolean).join(" ") });
  for (const cut of extra.cuts ?? []) add({ cast: "storyboard artist", kind: "shot", sentence: cut.first ?? null, who: [], basis: null, sure: sureOf(cut.confidence), text: `${cut.id}: ${cut.size}, ${cut.angle}, ${cut.move}, ${cut.seconds} s` });
  return notes;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** What one runtime task is being done on: the unit, the lines being made (the card's or the cut's), the cut's lines, the reading order of the unit's lines, the cut's cast, and the one asked of first. */
export interface RouteFocus { unit: string; lines: string[]; cut?: string[]; order: string[]; cast: string[]; subject?: string | null }

/** The notes the routing table gives `task` for this focus, ranked: sure, stated before implied, nearest the lines, about the subject. */
export function route(task: RuntimeTask, focus: RouteFocus, bag: Note[]): (Item & { note: Note })[] {
  const at = new Map(focus.order.map((id, n) => [id, n])), span = (ids: string[]) => { const ns = ids.map((id) => at.get(id)).filter((n): n is number => n !== undefined); return ns.length ? [Math.min(...ns), Math.max(...ns)] as const : null; };
  const lines = span(focus.lines), cut = span(focus.cut ?? focus.lines), cast = new Set(focus.cast);
  const out: (Item & { note: Note })[] = [];
  for (const routeLine of ROUTES[task]) {
    const found: (Item & { note: Note })[] = [];
    for (const note of bag) {
      if (note.unit !== focus.unit || note.cast !== routeLine.from || !routeLine.kinds.includes(note.kind) || note.sure < (routeLine.sure ?? 0)) continue;
      const n = note.sentence ? at.get(note.sentence) : undefined;
      if (routeLine.where !== "unit") {
        if (n === undefined) continue;
        const [lo, hi] = routeLine.where === "cut" ? cut ?? [-1, -1] : lines ?? [-1, -1];
        if (routeLine.where === "before" ? n > hi : n < lo || n > hi) continue;
      }
      if (routeLine.about === "subject" && !(focus.subject && note.who.includes(focus.subject))) continue;
      if (routeLine.about === "cast" && note.who.length && !note.who.some((who) => cast.has(who))) continue;
      const distance = n === undefined || !lines ? 0 : n < lines[0] ? lines[0] - n : n > lines[1] ? n - lines[1] : 0;
      const score = round(note.sure * (note.basis === "implied" ? 0.8 : 1) * (1 / (1 + distance / 10)) * (focus.subject && note.who.includes(focus.subject) ? 1 : 0.8));
      found.push({ id: note.id, score, fields: { by: note.cast, [note.kind]: note.text, ...(note.basis ? { basis: note.basis } : {}), sure: note.sure, ...(note.sentence ? { line: note.sentence } : {}) }, why: `${RUNTIME_CAST[task]} ← ${note.cast} (${note.kind})`, note });
    }
    out.push(...found.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, routeLine.quota));
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** The routed notes as a source of the engine: `stores.notes` is the bag, `routeOf(focus)` says what the task is done on. */
export function notesSource<F>(task: RuntimeTask, routeOf: (focus: F) => RouteFocus | null | undefined, quota = 24): Source<F, { notes?: Note[] } | null> {
  return { name: "notes", key: "notes", quota, collect: (focus, stores) => { const at = routeOf(focus); return at && stores?.notes?.length ? route(task, at, stores.notes).map(({ note: _note, ...item }) => item) : []; } };
}
