import { createHash } from "node:crypto";
import type { StoryStrands } from "../../../apps/playground/src/data/storyStrands.js";

/**
 * The stage's simulation environment, per fork of the timeline.
 *
 * The timeline forks: strands part where people go to different places and
 * meet again (storyStrands). A state carried through a place from the start
 * of the timeline would pile up everyone who was ever there; instead each
 * person's state is handed along their own world line, from the last scene
 * they were in to the next. A scene holds only its own cast, each with what
 * they carried in: their position when they were last at this same place,
 * none when they come from elsewhere (they arrive), none in a flashback (it
 * happened earlier and hands nothing on).
 *
 * Forks are the lane runs the story view draws: a strand followed from where
 * it starts until it ends or joins another. Within a scene, every event walks
 * every person of the cast, the event's actors first, and each acts on their
 * own: stays, moves, or goes with someone already handled in that event.
 * Where they end up comes from a mover (Jev's answers and the path engine,
 * or a test double); the environment orders the walk, hands states on, and
 * keys each scene by its own inputs plus the keys of the scenes its people
 * come from. A later run reuses every scene whose people's histories did not
 * change, and forks that do not wait on each other run side by side.
 */
export interface TimelineScene { id: string; index: number; placeId: string | null; flashback: boolean; cast: string[]; events?: { id: string; actors: string[] }[] }
/** How a person enters a scene: the scene they were last in (null: first appearance, or a flashback), and whether it was at this same place. */
export interface Handoff { person: string; from: string | null; samePlace: boolean }
/** A run of scenes one strand follows (reading order), its people, and the forks people come from and go on to. */
export interface Fork { id: string; scenes: string[]; people: string[]; from: string[]; to: string[] }
export interface ForkTimeline { forks: Fork[]; forkOf: Map<string, string>; handoffs: Map<string, Handoff[]>; order: string[] }

export function forkTimeline(scenes: TimelineScene[], strands: Pick<StoryStrands, "layer" | "continues">): ForkTimeline {
  const order = [...scenes].sort((first, second) => first.index - second.index);
  // A scene stays on the fork of the scene its lane continues; predecessors sit on lower layers, so they are placed first.
  const forkOf = new Map<string, string>();
  for (const scene of [...scenes].sort((first, second) => (strands.layer.get(first.id) ?? 0) - (strands.layer.get(second.id) ?? 0) || first.index - second.index)) {
    const previous = strands.continues.get(scene.id);
    forkOf.set(scene.id, previous && forkOf.has(previous) ? forkOf.get(previous)! : scene.id);
  }
  // World lines in reading order, as the strands are built.
  const last = new Map<string, TimelineScene>(), handoffs = new Map<string, Handoff[]>();
  for (const scene of order) {
    handoffs.set(scene.id, scene.cast.map((person) => {
      const from = scene.flashback ? undefined : last.get(person);
      return { person, from: from?.id ?? null, samePlace: !!from && !!scene.placeId && from.placeId === scene.placeId };
    }));
    if (!scene.flashback) for (const person of scene.cast) last.set(person, scene);
  }
  const forks = new Map<string, Fork>();
  for (const scene of order) {
    const id = forkOf.get(scene.id)!;
    if (!forks.has(id)) forks.set(id, { id, scenes: [], people: [], from: [], to: [] });
    const fork = forks.get(id)!;
    fork.scenes.push(scene.id);
    for (const { person, from } of handoffs.get(scene.id)!) {
      if (!fork.people.includes(person)) fork.people.push(person);
      const source = from ? forkOf.get(from)! : null;
      if (source && source !== id && !fork.from.includes(source)) { fork.from.push(source); forks.get(source)!.to.push(id); }
    }
  }
  return { forks: [...forks.values()], forkOf, handoffs, order: order.map((scene) => scene.id) };
}

/** What a person does in an event: stays, moves somewhere, or goes with someone already handled in that event (where they go, or nowhere if they stay). */
export type Outcome<P> = { kind: "stay" } | { kind: "move"; to: P } | { kind: "with"; leader: string };
/** A person entering a scene, with the position they carried in from this same place (null otherwise); `seed` is stable while their history is. */
export interface Arrival<P> { scene: TimelineScene; fork: string; handoff: Handoff; carried: P | null; seed: string }
export interface Turn<P> { scene: TimelineScene; fork: string; event: { id: string; actors: string[] }; person: string; at: P | null; handled: { person: string; outcome: Outcome<P> }[]; seed: string }
export interface Mover<P> { start(arrival: Arrival<P>): P | null | Promise<P | null>; act(turn: Turn<P>): Outcome<P> | Promise<Outcome<P>> }
/** One scene walked: where its cast starts, what each did in each event and where everyone was after it, and where they end (what they hand on). */
export interface SceneRun<P> { fork: string; key: string; starts: Record<string, P | null>; events: { id: string; outcomes: Record<string, Outcome<P>>; at: Record<string, P | null> }[]; ends: Record<string, P | null> }

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/**
 * Walk the timeline: each scene once its people's earlier scenes are done, at
 * most `concurrency` at a time. `previous` runs are reused where their key
 * still matches; `version` names the mover (model, engine), so a new one
 * walks everything again.
 */
export async function walkTimeline<P>(timeline: ForkTimeline, scenes: TimelineScene[], mover: Mover<P>, options: { previous?: Record<string, SceneRun<P>>; version?: string; concurrency?: number } = {}): Promise<{ scenes: Record<string, SceneRun<P>>; walked: number; reused: number }> {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const runs: Record<string, SceneRun<P>> = {}, pending = new Map<string, Promise<SceneRun<P>>>();
  let walked = 0, reused = 0, slots = Math.max(1, options.concurrency ?? 6);
  const waiting: (() => void)[] = [];
  const acquire = () => slots > 0 ? (slots--, Promise.resolve()) : new Promise<void>((resolve) => waiting.push(resolve));
  const release = () => { const next = waiting.shift(); if (next) next(); else slots++; };

  const walk = async (scene: TimelineScene, key: string, handoffs: Handoff[], sources: (SceneRun<P> | null)[]): Promise<SceneRun<P>> => {
    const fork = timeline.forkOf.get(scene.id) ?? scene.id, at = new Map<string, P | null>();
    for (const [index, handoff] of handoffs.entries()) {
      const carried = handoff.samePlace ? sources[index]?.ends[handoff.person] ?? null : null;
      at.set(handoff.person, await mover.start({ scene, fork, handoff, carried, seed: hash([key, "start", handoff.person]) }));
    }
    const starts = Object.fromEntries(at), events: SceneRun<P>["events"] = [];
    for (const event of scene.events ?? []) {
      const handled: { person: string; outcome: Outcome<P> }[] = [], outcomes: Record<string, Outcome<P>> = {}, moved = new Map<string, P>();
      for (const person of [...scene.cast.filter((id) => event.actors.includes(id)), ...scene.cast.filter((id) => !event.actors.includes(id))]) {
        const outcome = await mover.act({ scene, fork, event, person, at: at.get(person) ?? null, handled: [...handled], seed: hash([key, event.id, person]) });
        if (outcome.kind === "with" && !handled.some((entry) => entry.person === outcome.leader)) throw new Error(`${person} can only go with someone already handled in ${event.id}, not ${outcome.leader}.`);
        const to = outcome.kind === "move" ? outcome.to : outcome.kind === "with" ? moved.get(outcome.leader) : undefined;
        if (to !== undefined) { at.set(person, to); moved.set(person, to); }
        handled.push({ person, outcome });
        outcomes[person] = outcome;
      }
      events.push({ id: event.id, outcomes, at: Object.fromEntries(at) });
    }
    return { fork, key, starts, events, ends: Object.fromEntries(at) };
  };

  const run = (id: string): Promise<SceneRun<P>> => {
    if (!pending.has(id)) pending.set(id, (async () => {
      const scene = byId.get(id)!, handoffs = timeline.handoffs.get(id) ?? [];
      const sources = await Promise.all(handoffs.map((handoff) => handoff.from && byId.has(handoff.from) ? run(handoff.from) : null));
      const key = hash([options.version ?? "", id, scene.placeId, scene.flashback, (scene.events ?? []).map((event) => [event.id, event.actors]), handoffs.map((handoff, index) => [handoff.person, sources[index]?.key ?? null, handoff.samePlace])]);
      const earlier = options.previous?.[id];
      if (earlier?.key === key) { reused++; return runs[id] = earlier; }
      await acquire();
      try { walked++; return runs[id] = await walk(scene, key, handoffs, sources); } finally { release(); }
    })());
    return pending.get(id)!;
  };
  await Promise.all(timeline.order.filter((id) => byId.has(id)).map(run));
  return { scenes: runs, walked, reused };
}
