import { createHash } from "node:crypto";
import type { DecisionAnswer, DecisionModel, DecisionQuestion } from "../../ground/connectors/jev.js";
import { ARCHITECTURE_LABEL, type ArchitectureKind } from "../../ground/stage/placeArchitecture.js";
import { DIRECTIONS, DIRECTION_HINT, MANNERS, centreSpot, navGrid, type Manner } from "../../ground/stage/holoNav.js";

/**
 * Stage faculty 2 — movement: who moves where inside a scene's building, and
 * how. Runs once the whole file is extracted (the full character list, so
 * each scene's cast comes from the cast-candidate scorer) and the building
 * of every place is picked (its nav grid is what Jev chooses spots from).
 *
 * Per scene: does its opening say where each person is, and where. Per event,
 * in reading order: who changes spot (a yes/no per person; someone the event
 * names moves on an even chance, anyone else only above 0.8), then for each
 * mover the spot they end at, how (walk, run, … teleport) and which way (up,
 * down, same level, out, in). Each event is asked with everyone's spot so
 * far, so the moves chain — but only spots that are known: an assumed start
 * (the building's centre) is never told to Jev, because it anchors the
 * answers there. Who goes together is asked too: at the opening, for each
 * pair of the cast, whether they arrive or stand together; per event, for
 * each mover and anyone else present, whether the two go together and end
 * up beside each other (one leading, carrying or dragging the other counts),
 * so the engine keeps companions side by side. The answers are raw; the prep
 * step checks each chain physically (holoNav solveChain). A view input: no review packet, never
 * canon. Answers are kept per scene and reused while its inputs stay the same.
 */
export interface MovementEvent { id: string; text: string; actors: string[] }
export interface MovementScene { id: string; placeId: string; placeLabel: string; kind: ArchitectureKind; opening: string; cast: string[]; events: MovementEvent[] }
export interface MoveAnswer { moves: number; to?: Record<string, number>; how?: Manner; direction?: Record<string, number> }
export interface SceneMovement {
  place: string; kind: ArchitectureKind; cast: string[];
  /** Event ids in reading order, and the people each names. */
  order: string[]; named: Record<string, string[]>;
  starts: Record<string, { stated: number; to: Record<string, number> }>;
  events: Record<string, Record<string, MoveAnswer>>;
  /** Who goes together: [a, b, chance] at the opening, and per event (a mover and someone else present). */
  startPairs?: [string, string, number][];
  pairs?: Record<string, [string, string, number][]>;
  /** What this scene's answers read: reused while it stays the same. */
  inputs: string;
  calls: number;
}
export interface MovementReport { version: 1; inputs: string; model: string | null; askedAt: string; complete: boolean; usage: { calls: number; reused: number; skipped: number }; names: Record<string, string>; scenes: Record<string, SceneMovement> }

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
/** Bump when the questions change (their wording, the thresholds, the manners or directions offered): every scene is asked again. */
export const MOVEMENT_QUESTIONS_VERSION = 1;
/** What Jev chooses from in a building of this kind: its spots (ids, names, hints) and the ways between them. An answer is a spot id of this grid, so it is reused only while the grid stays the same. */
export const navGridSignature = (kind: ArchitectureKind) => { const grid = navGrid(kind); return hash([grid.spots.map((spot) => [spot.id, spot.label, spot.hint]), grid.links]); };
export const sceneInputs = (scene: MovementScene, names: Record<string, string>) => hash([MOVEMENT_QUESTIONS_VERSION, navGridSignature(scene.kind), scene.placeId, scene.kind, scene.opening, scene.cast.map((id) => [id, names[id]]), scene.events.map((event) => [event.id, event.text, event.actors])]);
export const movementFingerprint = (scenes: MovementScene[], names: Record<string, string>) => hash(scenes.map((scene) => [scene.id, sceneInputs(scene, names)]));
/** Requests a scene usually costs: its starts, then per event who moves, and where and how for the few with movers. */
export const sceneCallEstimate = (scene: MovementScene) => 1 + scene.events.length * 1.4;
/** Requests a scene can cost at most: its starts (when it has a cast), then per event who moves and, when someone does, where and how. The budget reserves this. */
export const sceneCallLimit = (scene: MovementScene) => (scene.cast.length ? 1 : 0) + scene.events.length * 2;
/**
 * Who goes together was added after the other questions: a scene asked before keeps its answers (the questions above
 * are unchanged), and only its pairs are asked, at most its opening and one request per event.
 */
export const pairsCallLimit = (scene: MovementScene) => (scene.cast.length > 1 ? 1 : 0) + scene.events.length;
/** At most this many of a scene's cast are paired at its opening (the first named). */
const PAIRED_CAST = 6;

const MOVE_THRESHOLD = { named: 0.5, other: 0.8 };
const top = (distribution: Record<string, number> = {}) => Object.entries(distribution).sort((first, second) => second[1] - first[1])[0]?.[0];
const round = (value: number) => Math.round(value * 1000) / 1000;
const probabilities = (answer: DecisionAnswer | undefined): Record<string, number> => answer?.distribution ? Object.fromEntries(Object.entries(answer.distribution).map(([key, value]) => [key, round(value)])) : typeof answer?.value === "string" && answer.value ? { [answer.value]: 1 } : {};

/**
 * One scene's movement. With `earlier` (the same scene asked before pairs were asked), its starts and moves are kept
 * as they were and only who goes together is asked.
 */
export async function askSceneMovement(scene: MovementScene, decisions: DecisionModel, names: Record<string, string>, earlier?: SceneMovement): Promise<SceneMovement> {
  const grid = navGrid(scene.kind), centre = centreSpot(grid);
  // Destinations a reader would name; the stairwells are only the way between floors.
  const spots = grid.spots.filter((spot) => !spot.id.startsWith("stairs-"));
  const spotLabel = new Map(grid.spots.map((spot) => [spot.id, spot.label]));
  const name = (id: string) => names[id] ?? id;
  const where = `${scene.placeLabel} is a ${ARCHITECTURE_LABEL[scene.kind].toLowerCase()}. Its spots: ${spots.map((spot) => `${spot.label} (${spot.hint})`).join("; ")}.`;
  const spotChoice = (key: string, instructions: string): DecisionQuestion => ({ key, primitive: "choice", instructions: `${instructions} Answer with a spot id: ${spots.map((spot) => `${spot.id} = ${spot.label}`).join(", ")}.`, options: spots.map((spot) => spot.id) });
  const result: SceneMovement = { place: scene.placeId, kind: scene.kind, cast: scene.cast, order: scene.events.map((event) => event.id), named: Object.fromEntries(scene.events.map((event) => [event.id, event.actors])), starts: {}, events: {}, startPairs: [], pairs: {}, inputs: sceneInputs(scene, names), calls: earlier?.calls ?? 0 };
  const decide = async (state: string, questions: DecisionQuestion[]) => { if (!questions.length) return new Map<string, DecisionAnswer>(); result.calls++; return new Map((await decisions.decide(state, questions)).map((answer) => [answer.key, answer])); };
  const pairQuestion = (key: string, a: string, b: string, when: "opening" | "event"): DecisionQuestion => ({ key, primitive: "noul", instructions: when === "opening"
    ? `When this scene opens, are ${name(a)} and ${name(b)} together — arriving together, or already side by side?`
    : `In this event, do ${name(a)} and ${name(b)} go together — side by side, or one leading, carrying or dragging the other — and end up beside each other?` });

  const now = new Map<string, string>(), known = new Set<string>();
  if (scene.cast.length) {
    const paired = scene.cast.slice(0, PAIRED_CAST), startPairs = paired.flatMap((a, i) => paired.slice(i + 1).map((b) => [a, b] as const));
    const opening = await decide(`${where}\nScene: ${scene.opening}\nIt begins: ${scene.events.slice(0, 3).map((event) => event.text).join(" / ")}\nPeople in the scene: ${scene.cast.map(name).join(", ")}.`, [
      ...(earlier ? [] : scene.cast.flatMap((id, index): DecisionQuestion[] => [
        { key: `stated_${index}`, primitive: "noul", instructions: `Does the scene's opening say or clearly show where in ${scene.placeLabel} ${name(id)} is (which floor, room, door, or outside)? Only being "in the building" is not saying where.` },
        spotChoice(`start_${index}`, `Where is ${name(id)} when this scene opens? Use the first things the scene says they do or see.`),
      ])),
      ...startPairs.map(([a, b], index) => pairQuestion(`together_${index}`, a, b, "opening")),
    ]);
    result.startPairs = startPairs.map(([a, b], index) => [a, b, round(Number(opening.get(`together_${index}`)?.value ?? 0) || 0)]);
    scene.cast.forEach((id, index) => {
      const stated = earlier ? earlier.starts[id]?.stated ?? 0 : Number(opening.get(`stated_${index}`)?.value ?? 0), to = earlier ? earlier.starts[id]?.to ?? {} : probabilities(opening.get(`start_${index}`));
      result.starts[id] = { stated: round(stated), to };
      // Not said where: the centre of the building, until the chain says otherwise.
      now.set(id, stated >= 0.5 ? top(to) ?? centre : centre);
      if (stated >= 0.5) known.add(id);
    });
  }
  for (const event of scene.events) {
    const people = [...new Set([...event.actors, ...scene.cast])];
    if (!people.length) continue;
    for (const id of people) if (!now.has(id)) now.set(id, centre);
    const state = `${where}\nScene: ${scene.opening}\nWhere people are now: ${people.map((id) => `${name(id)} — ${known.has(id) ? spotLabel.get(now.get(id)!) : "somewhere in the building (not stated)"}`).join("; ")}.\nThis event: ${event.text}`;
    const who = earlier?.events[event.id] ? null : await decide(state, people.map((id, index): DecisionQuestion => ({ key: `moves_${index}`, primitive: "noul", instructions: `In this event, does ${name(id)} go to a different spot of the place (walk, run, climb, go down, fall, get dragged or teleport)? Talking, looking, or acting in place is not moving.` })));
    const answers: Record<string, MoveAnswer> = who ? Object.fromEntries(people.map((id, index) => [id, { moves: round(Number(who.get(`moves_${index}`)?.value ?? 0)) }])) : { ...earlier!.events[event.id] };
    result.events[event.id] = answers;
    const movers = people.filter((id) => (answers[id]?.moves ?? 0) >= (event.actors.includes(id) ? MOVE_THRESHOLD.named : MOVE_THRESHOLD.other));
    if (!movers.length) continue;
    // Each mover with anyone else present, once per pair.
    const pairs = movers.flatMap((a, i) => people.filter((b) => b !== a && !movers.slice(0, i).includes(b)).map((b) => [a, b] as const));
    const how = await decide(state, [
      ...(who ? movers.flatMap((id, index): DecisionQuestion[] => [
        spotChoice(`to_${index}`, `Where is ${name(id)} at the end of this event?`),
        { key: `how_${index}`, primitive: "choice", instructions: `How does ${name(id)} get there?`, options: [...MANNERS] },
        { key: `dir_${index}`, primitive: "choice", instructions: `Which way does ${name(id)} go in this event? ${DIRECTIONS.map((direction) => `${direction}: ${DIRECTION_HINT[direction]}`).join("; ")}.`, options: [...DIRECTIONS] },
      ]) : []),
      ...pairs.map(([a, b], index) => pairQuestion(`with_${index}`, a, b, "event")),
    ]);
    result.pairs![event.id] = pairs.map(([a, b], index) => [a, b, round(Number(how.get(`with_${index}`)?.value ?? 0) || 0)]);
    movers.forEach((id, index) => {
      if (!who) { if (answers[id].to) now.set(id, Object.entries(answers[id].to!).filter(([spot]) => !known.has(id) || spot !== now.get(id)).sort((first, second) => second[1] - first[1])[0]?.[0] ?? now.get(id)!); known.add(id); return; }
      const to = probabilities(how.get(`to_${index}`)), manner = String(how.get(`how_${index}`)?.value ?? "walk");
      answers[id] = { ...answers[id], to, how: (MANNERS as readonly string[]).includes(manner) ? manner as Manner : "walk", direction: probabilities(how.get(`dir_${index}`)) };
      // Provisional, for the next question's "where people are now": the likeliest spot elsewhere.
      now.set(id, Object.entries(to).filter(([spot]) => !known.has(id) || spot !== now.get(id)).sort((first, second) => second[1] - first[1])[0]?.[0] ?? now.get(id)!);
      known.add(id);
    });
    // Someone who goes along with a mover ends up where they do.
    for (const [a, b, p] of result.pairs![event.id]) if (p >= 0.5 && !movers.includes(b)) { now.set(b, now.get(a)!); if (known.has(a)) known.add(b); }
  }
  return result;
}

/** Every scene, reusing answers whose inputs have not changed, a few scenes at a time, within a request budget. */
export async function askMovement(scenes: MovementScene[], options: { decisions?: DecisionModel; names: Record<string, string>; previous?: MovementReport | null; maxCalls?: number; concurrency?: number; onScene?: (sceneId: string, calls: number) => void }): Promise<MovementReport> {
  const done: Record<string, SceneMovement> = {};
  let calls = 0, reused = 0, skipped = 0, next = 0;
  // Scenes run side by side, so each reserves the most it can cost before asking and gives back what it did not spend: the budget holds across workers.
  let reserved = 0;
  const budget = options.maxCalls ?? Infinity;
  const worker = async () => {
    while (next < scenes.length) {
      const scene = scenes[next++];
      const earlier = options.previous?.scenes[scene.id], same = !!earlier && earlier.inputs === sceneInputs(scene, options.names);
      if (same && earlier.pairs) { done[scene.id] = earlier; reused++; continue; }
      // Asked before pairs were: its answers kept, and only who goes together asked (kept as they are without Jev or budget).
      // Otherwise, without Jev or over budget, the scene is left for a later run (nobody moves until then).
      const limit = same ? pairsCallLimit(scene) : sceneCallLimit(scene);
      if (!options.decisions || reserved + limit > budget) { if (same) { done[scene.id] = earlier; reused++; } else skipped++; continue; }
      reserved += limit;
      const asked = await askSceneMovement(scene, options.decisions, options.names, same ? earlier : undefined);
      const spent = asked.calls - (same ? earlier.calls : 0);
      reserved += spent - limit;
      calls += spent;
      done[scene.id] = asked;
      options.onScene?.(scene.id, spent);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 6, scenes.length)) }, worker));
  return { version: 1, inputs: movementFingerprint(scenes, options.names), model: options.decisions?.modelId ?? null, askedAt: new Date().toISOString(), complete: skipped === 0, usage: { calls, reused, skipped }, names: options.names,
    scenes: Object.fromEntries(scenes.filter((scene) => done[scene.id]).map((scene) => [scene.id, done[scene.id]])) };
}
