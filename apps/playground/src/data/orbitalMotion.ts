import type { WorldEdge } from "../types.js";
import type { Position3 } from "./spatialLayout.js";
import type { OrbitalDraw } from "./orbitalLayout.js";

/**
 * Ambient and responsive motion for the orbital world — view only. Nothing
 * here changes layout, data, selection rules or navigation; offsets are added
 * to drawn poses each frame and vanish entirely under reduced motion.
 *
 * - breathing: spine spheres bob in a slow wave travelling along time;
 *   surrounding entities drift around their place (weak links drift more);
 * - ripples: a click on empty space pushes nearby spheres outward and back;
 *   selecting a sphere sends a lift wave along its timeline;
 * - glints: entities linked to a new selection flash in order of link strength.
 */
export interface Ripple { kind: "blank" | "select"; origin: Position3; start: number }
export interface MotionBus {
  ripples: Ripple[];
  /** Hovered draw id (pointer or label), read by glyphs every frame. */
  hoveredId: string | null;
  /** Glint start times (seconds) per draw id. */
  glints: Map<string, number>;
}
export const createMotionBus = (): MotionBus => ({ ripples: [], hoveredId: null, glints: new Map() });

export const RIPPLE_SPEED = 2600;
export const RIPPLE_LIFE = 2.4;
const RIPPLE_WIDTH = 520;
const AMPLITUDE = { blank: 70, select: 60 } as const;
const GLINT_DURATION = 0.9;

export const now = () => performance.now() / 1000;

export function addRipple(bus: MotionBus, ripple: Ripple): void {
  bus.ripples = [...bus.ripples.filter((entry) => ripple.start - entry.start < RIPPLE_LIFE), ripple].slice(-6);
}

const hash = (id: string) => { let value = 2166136261; for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; };

/** Gentle idle motion for one draw at time t (seconds). */
export function breathOffset(draw: OrbitalDraw, t: number): Position3 {
  if (draw.role === "main") {
    // A wave travelling along the spine: neighbours rise one after another.
    return [0, draw.radius * 0.05 * Math.sin(t * 0.9 - draw.position[0] / 600 * 0.7), 0];
  }
  if (draw.role === "nebula" || draw.role === "preimage") {
    const loose = 1 - Math.min(1, Math.max(0, draw.prominence ?? 0.7));
    const reach = 8 + 22 * loose;
    const seed = hash(draw.node.id);
    const angle = t * (0.12 + 0.1 * loose) + (seed % 6283) / 1000;
    return [Math.cos(angle) * reach, Math.sin(angle * 1.3 + seed % 7) * reach * 0.6, Math.sin(angle) * reach];
  }
  if (draw.role === "preview") return [0, draw.radius * 0.08 * Math.sin(t * 1.1 + draw.position[0] * 0.01), 0];
  return [0, 0, 0];
}

/** Displacement from active ripples: a travelling, fading ring front. */
export function rippleOffset(position: Position3, t: number, ripples: Ripple[]): Position3 {
  const offset: Position3 = [0, 0, 0];
  for (const ripple of ripples) {
    const age = t - ripple.start;
    if (age < 0 || age > RIPPLE_LIFE) continue;
    const delta = position.map((value, axis) => value - ripple.origin[axis]);
    const distance = ripple.kind === "select" ? Math.abs(delta[0]) : Math.hypot(...delta);
    const front = (distance - RIPPLE_SPEED * age) / RIPPLE_WIDTH;
    const envelope = Math.exp(-front * front) * (1 - age / RIPPLE_LIFE) ** 2;
    if (envelope < 1e-3) continue;
    if (ripple.kind === "select") offset[1] += AMPLITUDE.select * envelope;
    else if (distance > 1) delta.forEach((value, axis) => { offset[axis] += value / distance * AMPLITUDE.blank * envelope; });
  }
  return offset;
}

/** 0 → 1 → 0 flash for a glint that started at `start` (seconds). */
export function glintLevel(start: number | undefined, t: number): number {
  if (start === undefined) return 0;
  const age = t - start;
  if (age < 0 || age > GLINT_DURATION) return 0;
  return Math.sin(Math.PI * age / GLINT_DURATION);
}

/** Linked entities glint in order of link strength, 90 ms apart (at most 12). */
export function scheduleGlints(bus: MotionBus, selectedId: string, edges: WorldEdge[], t: number): string[] {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    const other = edge.from === selectedId ? edge.to : edge.to === selectedId ? edge.from : null;
    if (other) weights.set(other, (weights.get(other) ?? 0) + (edge.weight ?? 1));
  }
  const order = [...weights].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0])).slice(0, 12).map(([id]) => id);
  order.forEach((id, index) => bus.glints.set(id, t + 0.15 + index * 0.09));
  return order;
}

/** Point where a camera ray meets the horizontal plane y = height (null if parallel or behind). */
export function rayPlanePoint(origin: Position3, direction: Position3, height = 0): Position3 | null {
  if (Math.abs(direction[1]) < 1e-6) return null;
  const distance = (height - origin[1]) / direction[1];
  return distance > 0 ? origin.map((value, axis) => value + direction[axis] * distance) as Position3 : null;
}

/**
 * Pi heartbeat route: along the spine from its head to the spine point nearest
 * the record Pi is touching, then a final hop to the record itself.
 */
export function heartbeatRoute(spine: Position3[], target: Position3): Position3[] {
  if (!spine.length) return [target];
  let nearest = 0;
  spine.forEach((point, index) => { if (Math.hypot(...point.map((value, axis) => value - target[axis])) < Math.hypot(...spine[nearest].map((value, axis) => value - target[axis]))) nearest = index; });
  const route = spine.slice(0, nearest + 1);
  const last = route[route.length - 1];
  if (Math.hypot(...last.map((value, axis) => value - target[axis])) > 1) route.push(target);
  return route;
}

/** Point at fraction u (0..1) of a polyline's length. */
export function pointAlong(route: Position3[], u: number): Position3 {
  if (route.length < 2) return route[0] ?? [0, 0, 0];
  const lengths = route.slice(1).map((point, index) => Math.hypot(...point.map((value, axis) => value - route[index][axis])));
  let remaining = Math.min(1, Math.max(0, u)) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const f = lengths[index] ? Math.min(1, remaining / lengths[index]) : 1;
      return route[index].map((value, axis) => value + (route[index + 1][axis] - value) * f) as Position3;
    }
    remaining -= lengths[index];
  }
  return route[route.length - 1];
}
