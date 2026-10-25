import type { WorldNode } from "../types.js";
import type { Position3 } from "./spatialLayout.js";
import type { OrbitalDraw, OrbitalPose } from "./orbitalLayout.js";
import type { LiveActivity } from "./liveActivity.js";

/** One real EM identity merge waiting to be shown (dropId joins keepId). */
export interface PendingJoin { id: string; dropId: string; keepId: string; seq: number }
export type IdentityEvent = LiveActivity["identityEvents"][number];

/**
 * Identity events new since the last snapshot. The first snapshot after
 * connecting (or after switching book) is a baseline: its historical events
 * are only marked seen, never replayed as live. Reconnects re-deliver the
 * same ids and are ignored.
 */
export function freshIdentityEvents(records: IdentityEvent[], seen: Set<string>, baselineDone: boolean): { events: IdentityEvent[]; baselineDone: true } {
  const events: IdentityEvent[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    if (baselineDone) events.push(record);
  }
  return { events, baselineDone: true };
}

/** What the explorer last drew, so a dropped entity can still be shown. */
export interface LastPose { node: WorldNode; position: Position3; radius: number }

export interface JoinPlan {
  /** Dropped entities already gone from the new world: transient view-only
   * preimages at the survivor, gliding in from their last drawn pose. */
  preimages: OrbitalDraw[];
  /** Dropped entities still drawn (e.g. a ghost layer): retarget onto the survivor. */
  moves: Map<string, Position3>;
  /** Morph start poses for the preimages. */
  from: Map<string, OrbitalPose>;
  /** Joins that cannot be shown on this level (no last pose or no visible
   * survivor): settle at once; the activity notice still reports them. */
  offscreen: PendingJoin[];
  animated: PendingJoin[];
}

export const preimageId = (dropId: string) => `join-preimage:${dropId}`;

/**
 * Plan a batch of joins against the current draws. Handles removal before
 * render: the snapshot that announces a merge has already dropped the
 * entity, so its pose comes from the previous frame, never from canon.
 */
export function planJoins(joins: PendingJoin[], last: Map<string, LastPose>, current: OrbitalDraw[]): JoinPlan {
  const byId = new Map(current.map((draw) => [draw.node.id, draw]));
  const plan: JoinPlan = { preimages: [], moves: new Map(), from: new Map(), offscreen: [], animated: [] };
  for (const join of joins) {
    const keep = byId.get(join.keepId) ?? byId.get(preimageId(join.keepId));
    const stillDrawn = byId.get(join.dropId);
    const previous = last.get(join.dropId);
    if (!keep || (!stillDrawn && !previous)) { plan.offscreen.push(join); continue; }
    if (stillDrawn) plan.moves.set(join.dropId, keep.position);
    else {
      const id = preimageId(join.dropId);
      plan.preimages.push({ node: { ...previous!.node, id, label: previous!.node.label }, position: keep.position, radius: previous!.radius, role: "preimage" });
      plan.from.set(id, { position: previous!.position, radius: previous!.radius });
    }
    plan.animated.push(join);
  }
  return plan;
}
