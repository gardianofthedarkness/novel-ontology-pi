/**
 * Laying a parent's manifolds out by its topology (docs/v2/borrow-and-spawn.md §8.2–8.5; the user's design, 2026-11-01). A
 * city is one ground of manifolds that fade into each other; each manifold keeps a vector from its parent's centre. New
 * ones go where the parent's energy is least:
 *
 *   E =   Σ ring       how far a manifold lies outside its kind's ring (a share of the parent's radius from its centre)
 *       + Σ pairs      near: the pair's distance; apart: their closeness
 *       + Σ pressure   how much two manifolds overlap beyond the fade they may share
 *       + Σ squeeze    how far a manifold that stood before moved (each only a share of its radius at one spawn)
 *       + extra        the characters' travel and the text's pins, where the caller has them
 *
 * With no room at its distance a new manifold presses on the ones there, which give a little; the parent grows wider only
 * when that costs more than the ring charges for going out. Plain data and arithmetic, tested on its own.
 */
import { seeded, type Topology } from "./config.js";
import { setting } from "../settings.js";

export type Point = [number, number];
/** A manifold of a parent's ground: its kind, its vector from the parent's centre, its radius (metres). */
export interface Manifold { id: string; kind: string; at: Point; r: number }
/** One that stood before this spawn: it may move only a share of its radius (0: it may not move). */
export interface Standing extends Manifold { give: number }

export const LAYOUT = setting<{ cover: number; blend: number; give: number; weights: { ring: number; pairs: number; pressure: number; squeeze: number } }>("spawn.layout");

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** A parent's radius: what holds its manifolds' area at the layout's cover (it grows as they are added). */
export const radiusOf = (manifolds: { r: number }[]) => Math.sqrt(manifolds.reduce((sum, m) => sum + m.r * m.r, 0) / LAYOUT.cover);

export interface Terms { ring: number; pairs: number; pressure: number; squeeze: number; extra: number; total: number }

/** The parent's energy for its manifolds where they stand, each term apart (§8.3). */
export function energyOf(manifolds: Manifold[], topology: Topology, origin: Map<string, Standing> = new Map(), extra: (m: Manifold) => number = () => 0): Terms {
  const R = Math.max(1, radiusOf(manifolds)), w = LAYOUT.weights, terms = { ring: 0, pairs: 0, pressure: 0, squeeze: 0, extra: 0, total: 0 };
  for (const m of manifolds) {
    const ring = topology.ring[m.kind], x = Math.hypot(m.at[0], m.at[1]) / R;
    if (ring) { const outside = Math.max(0, ring[0] - x, x - ring[1]); terms.ring += w.ring * (outside / 0.1) ** 2; }
    const was = origin.get(m.id);
    if (was) terms.squeeze += w.squeeze * (distance(m.at, was.at) / Math.max(1, was.r)) ** 2;
    terms.extra += extra(m);
  }
  manifolds.forEach((a, n) => {
    for (const b of manifolds.slice(n + 1)) {
      const d = distance(a.at, b.at), small = Math.min(a.r, b.r), over = Math.max(0, a.r + b.r - d - LAYOUT.blend * small);
      terms.pressure += w.pressure * (over / Math.max(1, small)) ** 2;
      for (const [p, q, how] of topology.pairs) {
        if (!((a.kind === p && b.kind === q) || (a.kind === q && b.kind === p))) continue;
        terms.pairs += w.pairs * (how === "near" ? d / R : Math.max(0, 0.6 - d / R) / 0.6);
      }
    }
  });
  terms.total = terms.ring + terms.pairs + terms.pressure + terms.squeeze + terms.extra;
  for (const key of Object.keys(terms) as (keyof Terms)[]) terms[key] = Math.round(terms[key] * 1000) / 1000;
  return terms;
}

/**
 * New manifolds laid out among the ones standing (§8.3): each, innermost ring first, where the energy is least among the
 * places its ring (and a little beyond) offers round the centre; then every manifold moves while a move lowers the energy,
 * a standing one only within its give. Returns every manifold where it ends, and the energy's terms before the moves and after.
 */
export function layOut(standing: Standing[], fresh: Omit<Manifold, "at">[], topology: Topology, seed: string, extra?: (m: Manifold) => number): { manifolds: Manifold[]; first: Terms; terms: Terms; radius: number } {
  const origin = new Map(standing.map((m) => [m.id, m])), placed: Manifold[] = standing.map(({ id, kind, at, r }) => ({ id, kind, at: [...at] as Point, r }));
  const innermost = (m: { kind: string }) => topology.ring[m.kind]?.[0] ?? 1;
  for (const m of [...fresh].sort((a, b) => innermost(a) - innermost(b) || a.id.localeCompare(b.id))) {
    const R = radiusOf([...placed, m]), [lo, hi] = topology.ring[m.kind] ?? [0, 1], turn = seeded(`${seed}|${m.id}`) * Math.PI * 2;
    let best: { at: Point; e: number } | null = null;
    for (let i = 0; i <= 6; i++) {
      const x = (lo + ((Math.min(1.3, hi + 0.3) - lo) * i) / 6) * R;
      for (let k = 0; k < (x < 1 ? 1 : 24); k++) {
        const at: Point = [Math.round(Math.cos(turn + (k * Math.PI) / 12) * x), Math.round(Math.sin(turn + (k * Math.PI) / 12) * x)];
        const e = energyOf([...placed, { ...m, at }], topology, origin, extra).total;
        if (!best || e < best.e - 1e-9) best = { at, e };
      }
    }
    placed.push({ ...m, at: best!.at });
  }
  const first = energyOf(placed, topology, origin, extra);
  // Moves: every manifold in turn, in eight directions, at shrinking steps, while the energy falls.
  for (let sweep = 0; sweep < 16; sweep++) {
    let moved = false;
    for (const m of placed) {
      const was = origin.get(m.id), reach = was ? LAYOUT.give * was.give * was.r : Infinity;
      for (const step of [0.5, 0.25, 0.1].map((share) => share * m.r)) {
        const here = energyOf(placed, topology, origin, extra).total;
        let best: { at: Point; e: number } | null = null;
        for (let k = 0; k < 8; k++) {
          const at: Point = [Math.round(m.at[0] + Math.cos((k * Math.PI) / 4) * step), Math.round(m.at[1] + Math.sin((k * Math.PI) / 4) * step)];
          if (was && distance(at, was.at) > reach) continue;
          const keep = m.at;
          m.at = at; const e = energyOf(placed, topology, origin, extra).total; m.at = keep;
          if (e < here - 1e-6 && (!best || e < best.e)) best = { at, e };
        }
        if (best) { m.at = best.at; moved = true; }
      }
    }
    if (!moved) break;
  }
  return { manifolds: placed, first, terms: energyOf(placed, topology, origin, extra), radius: Math.round(radiusOf(placed)) };
}
