import { createHash } from "node:crypto";
import type { ArchitectureKind } from "../../../apps/playground/src/data/placeArchitecture.js";
import { navGrid, solveChain, type ChainStep, type MovePlan } from "../../../apps/playground/src/data/holoNav.js";
import type { ArchitectureReport } from "./architecture.js";
import type { MovementReport } from "./movement.js";

/**
 * Animation prep for read mode: the last step of a book's analysis, run only
 * once every other faculty is done (novel checklist). No model calls: from
 * the stage faculties' raw answers it checks each person's chain of moves
 * physically (holoNav solveChain — an unstated start is the building's
 * centre, revised backwards when the later moves cannot follow from it;
 * going down needs height, underground only when said; an impossible
 * low-confidence move is dropped) and writes one movement plan per place,
 * what the read page replays. Rebuilt whenever its inputs change.
 */
export interface StagePlan {
  version: 1;
  /** The stage faculties' fingerprints and the physics version this plan was built from. */
  inputs: string;
  preparedAt: string;
  /** Each place's building (a sub-kind of place), or none. */
  architecture: Record<string, ArchitectureKind | "none">;
  places: Record<string, MovePlan>;
  /** droppedMoves: a move that could not physically follow (they did not move); stayedMoves: Jev's spot was where they already stood (a move within the spot). */
  counts: { places: number; scenes: number; moves: number; revisedStarts: number; droppedMoves: number; stayedMoves: number };
}

/** Bump when solveChain or the nav grids change, so every book's plan is rebuilt. */
export const STAGE_PHYSICS_VERSION = 1;
export const prepFingerprint = (architectureInputs: string, movementInputs: string) => createHash("sha256").update(JSON.stringify([architectureInputs, movementInputs, STAGE_PHYSICS_VERSION])).digest("hex").slice(0, 16);

export function prepareStage(architecture: ArchitectureReport, movement: MovementReport): StagePlan {
  const places: Record<string, MovePlan> = {};
  const counts = { places: 0, scenes: 0, moves: 0, revisedStarts: 0, droppedMoves: 0, stayedMoves: 0 };
  for (const [sceneId, scene] of Object.entries(movement.scenes)) {
    const grid = navGrid(scene.kind);
    const plan = places[scene.place] ??= { place: scene.place, kind: scene.kind, starts: {}, moves: {}, notes: {} };
    counts.scenes++;
    // Each person's steps in reading order: the events where they moved.
    const chains = new Map<string, { start: Record<string, number>; stated: number; steps: ChainStep[]; events: string[]; p: number[] }>();
    for (const id of scene.cast) chains.set(id, { start: scene.starts[id]?.to ?? {}, stated: scene.starts[id]?.stated ?? 0, steps: [], events: [], p: [] });
    for (const eventId of scene.order) for (const [id, answer] of Object.entries(scene.events[eventId] ?? {})) {
      if (!answer.to) continue;
      const chain = chains.get(id) ?? chains.set(id, { start: {}, stated: 0, steps: [], events: [], p: [] }).get(id)!;
      chain.steps.push({ to: answer.to, how: answer.how ?? "walk", direction: answer.direction ?? {}, p: answer.moves });
      chain.events.push(eventId);
      chain.p.push(answer.moves);
    }
    plan.starts[sceneId] = {};
    plan.notes![sceneId] = {};
    for (const [id, chain] of chains) {
      const solved = solveChain(grid, chain);
      plan.starts[sceneId][id] = solved.start;
      plan.notes![sceneId][id] = { stated: chain.stated, assumed: solved.assumed, revised: solved.revised, ...(solved.why ? { why: solved.why } : {}) };
      if (solved.revised) counts.revisedStarts++;
      chain.steps.forEach((step, index) => {
        const jev = Object.entries(step.to).sort((first, second) => second[1] - first[1])[0]?.[0], to = solved.spots[index + 1];
        if (solved.dropped[index]) { if (jev === solved.spots[index]) counts.stayedMoves++; else counts.droppedMoves++; return; }
        (plan.moves[chain.events[index]] ??= []).push({ actor: id, to, how: step.how, p: chain.p[index], ...(jev && to !== jev ? { jev, revised: true } : {}) });
        counts.moves++;
      });
    }
  }
  counts.places = Object.keys(places).length;
  return {
    version: 1, inputs: prepFingerprint(architecture.inputs, movement.inputs), preparedAt: new Date().toISOString(),
    architecture: Object.fromEntries(Object.entries(architecture.places).map(([id, pick]) => [id, pick.kind])),
    places, counts,
  };
}
