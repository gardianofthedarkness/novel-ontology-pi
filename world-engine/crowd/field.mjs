// The crowd as a field (M9; the user, 2026-11-03: "crowd should be fields. They have pronounced states in different
// situations, but the reason why we want them into field is because they could have potential influence back on our
// characters such as slower moving speed"; docs/v2/directing/Crowd-M9.md). A crowd is the place's, not people: a number
// of people over the walkable nodes of the place round its middle, carried by a few samples (each standing for many) that
// the page draws. The director gives the crowd a state, never destinations; one motion law moves it, the state setting
// what pulls (a potential over the walk graph), how fast and how much people follow each other:
//
//   milling    nothing pulls; a random walk over the field (which is the place round its middle)
//   flowing    toward the place's ways out (the edge of the field)
//   gathering  toward a focus, held at Hall's public distance from it (RING)
//   alarmed    away from a hazard and on toward the ways out; alarm spreads from the hazard at running speed
//   gone       out of the field; a sample that reaches the edge leaves it
//
// Speed falls with density (the fundamental diagram, Weidmann's fit: free 1.34 m/s, none at 5.4 people a square metre,
// γ 1.913), for the crowd and, by L20 (crowd drag), for anyone on foot in it. Pure: nodes and their neighbours in, no
// world, no model call; deterministic by its seed.

import { SPEED } from '../laws/laws.mjs';
import { setting } from '../../dist/src/v2/settings.js';

/** Where a gathering crowd holds from its focus: Hall's public distance, 3.6 m (proxemics; closer is social space). */
export const RING = setting('crowd.ring');

/** Weidmann's fundamental diagram: speed (m/s) at a density (people a square metre). */
export const { free: FREE, jam: JAM, gamma: GAMMA } = setting('crowd.weidmann');
export const speedAt = density => (density <= 0 ? FREE : density >= JAM ? 0 : Math.max(0, FREE * (1 - Math.exp(-GAMMA * (1 / density - 1 / JAM)))));

/**
 * People a square metre for a crowd's size, at Fruin's levels of service (walkways: A under 0.31, C 0.43–0.72,
 * E 1.08–2.17, F over 2.17): a few is free walking, some is constrained, many is crowded, packed is a crush.
 */
export const DENSITY = setting('crowd.density');
export const STATES = ['milling', 'flowing', 'gathering', 'alarmed', 'gone'];
/** Each state's pace against walking (L17's speeds: a stroll, a walk, a run), how much people follow, and noise. */
export const MOTION = setting('crowd.motion');
/** The samples a crowd is drawn with at most (a drawing budget, not a number of people). */
export const SAMPLES = setting('crowd.samples');
/** A node's ground (m²): the walk grid's cell, 2 m by 2 m. */
const CELL_AREA = 4;

const seeded = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

/** Graph distance (m) from `sources` over the nodes, by Dijkstra on the edge lengths (a binary heap: a district's frame
 * holds tens of thousands of nodes). */
function distances(nodes, neighbours, sources) {
  const at = new Map(nodes.map(node => [node.id, node])), out = new Map(), heap = [];
  const push = item => { heap.push(item); let n = heap.length - 1; while (n > 0) { const up = (n - 1) >> 1; if (heap[up][0] <= heap[n][0]) break; [heap[up], heap[n]] = [heap[n], heap[up]]; n = up; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const a = 2 * n + 1, b = a + 1; let m = n; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  const queue = { get length() { return heap.length; } };
  for (const id of sources) if (at.has(id)) { out.set(id, 0); push([0, id]); }
  while (queue.length) {
    const [d, id] = pop();
    if (d > (out.get(id) ?? Infinity)) continue;
    const a = at.get(id);
    for (const next of neighbours.get(id) ?? []) { const b = at.get(next); if (!b) continue; const e = d + Math.hypot(b.x - a.x, b.z - a.z); if (e < (out.get(next) ?? Infinity)) { out.set(next, e); push([e, next]); } }
  }
  return out;
}

/**
 * A crowd field over `nodes` ({ id, x, z }, the walkable open ground round the place's middle) joined by `neighbours`
 * (id → ids). `size` (DENSITY's keys) sets how many people; they are spread over the nodes, carried by samples.
 */
export function crowdField({ nodes, neighbours, size = 'few', state = 'milling', seed = 'crowd' }) {
  const rng = seeded(seed), area = nodes.length * CELL_AREA, people = Math.round((DENSITY[size] ?? 0) * area);
  const count = Math.min(SAMPLES, people), at = new Map(nodes.map(node => [node.id, node]));
  const middle = nodes.length ? { x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length, z: nodes.reduce((s, n) => s + n.z, 0) / nodes.length } : { x: 0, z: 0 };
  let radius = 1;
  for (const node of nodes) radius = Math.max(radius, Math.hypot(node.x - middle.x, node.z - middle.z));
  // The ways out: the field's rim, the nodes farthest from its middle.
  const rim = nodes.filter(node => Math.hypot(node.x - middle.x, node.z - middle.z) >= radius * 0.85).map(node => node.id);
  const samples = Array.from({ length: count }, (_, k) => ({ id: k, node: nodes[Math.floor(rng() * nodes.length)]?.id, gone: false }));
  // A gathering's ring: Hall's public distance, wider as the crowd needs room to stand at Fruin's crowded density (a disc
  // that holds them all), so a gathering is never a crush.
  const ring = Math.max(RING, Math.sqrt(people / (Math.PI * DENSITY.many)));
  const field = { size, state, people, ring, weight: count ? people / count : 0, samples, focus: null, hazards: [], time: 0, rim, middle, radius };
  let toRim = null;
  const potentials = new Map();
  const potentialOf = key => {
    if (potentials.has(key)) return potentials.get(key);
    let value = null;
    if (key === 'rim') value = (toRim ??= distances(nodes, neighbours, rim));
    else if (key.startsWith('focus:') || key.startsWith('hazard:')) { const [, x, z] = key.split(':').map(Number), near = nodes.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a), nodes[0]); value = distances(nodes, neighbours, [near.id]); }
    potentials.set(key, value);
    return value;
  };
  /** People a square metre round a point: the samples within a few metres, each standing for `weight` people. */
  field.densityAt = (x, z, within = 4) => {
    if (!field.people) return 0;
    const near = field.samples.filter(sample => !sample.gone && at.has(sample.node) && Math.hypot(at.get(sample.node).x - x, at.get(sample.node).z - z) <= within).length;
    return Math.min(JAM, (near * field.weight) / (Math.PI * within * within));
  };
  /** L20, crowd drag: the share of free speed left to someone on foot at a point. */
  field.dragAt = (x, z) => speedAt(field.densityAt(x, z)) / FREE;
  /** The state now (one of STATES), with a focus ({ x, z }) to gather round. */
  field.set = (state, focus = null) => { if (STATES.includes(state)) field.state = state; if (focus) field.focus = focus; };
  /** A hazard at a point from now: alarm spreads from it at running speed (L17's run). */
  field.hazard = (x, z) => field.hazards.push({ x, z, from: field.time });
  /**
   * The crowd moved on `seconds`: each sample walks the graph down its state's potential, as far as the speed at its
   * density allows; returns each sample's path (node ids) for the page. Alarm overrides where its front has reached.
   */
  field.step = seconds => {
    const paths = [];
    field.time += seconds;
    for (const sample of field.samples) {
      if (sample.gone || !at.has(sample.node)) { paths.push(null); continue; }
      const here = at.get(sample.node), alarm = field.hazards.find(h => Math.hypot(here.x - h.x, here.z - h.z) <= SPEED.run * (field.time - h.from));
      const state = alarm ? 'alarmed' : field.state, motion = MOTION[state], pull = (() => {
        // Alarmed with no hazard reached yet (the text says so before any blast): scatter toward the ways out, away from
        // the nearest hazard where there is one.
        const source = alarm ?? field.hazards.reduce((a, b) => (!a || Math.hypot(b.x - here.x, b.z - here.z) < Math.hypot(a.x - here.x, a.z - here.z) ? b : a), null);
        if (state === 'alarmed') { const away = source ? potentialOf(`hazard:${source.x}:${source.z}`) : null, out = potentialOf('rim'); return id => -(away?.get(id) ?? 0) + (away ? 0.5 : 1) * (out?.get(id) ?? 0); }
        if (state === 'flowing' || state === 'gone') { const out = potentialOf('rim'); return id => out?.get(id) ?? 0; }
        if (state === 'gathering' && field.focus) { const to = potentialOf(`focus:${field.focus.x}:${field.focus.z}`); return id => Math.abs((to?.get(id) ?? 0) - ring); }
        return () => 0;
      })();
      let budget = speedAt(field.densityAt(here.x, here.z)) * motion.pace * seconds;
      const path = [sample.node];
      while (budget > 0) {
        const from = at.get(path.at(-1)), options = (neighbours.get(from.id) ?? []).filter(id => at.has(id));
        if (!options.length) break;
        const score = id => pull(id) + motion.noise * 4 * (rng() - 0.5);
        const next = options.reduce((a, b) => (score(b) < score(a) ? b : a));
        if (pull(next) > pull(from.id) + motion.noise * 2 && state !== 'milling') break;
        budget -= Math.hypot(at.get(next).x - from.x, at.get(next).z - from.z);
        path.push(next);
        if ((state === 'gone' || state === 'alarmed') && field.rim.includes(next)) { sample.gone = state === 'gone'; break; }
      }
      sample.node = path.at(-1);
      paths.push(path.length > 1 ? path : null);
    }
    return paths;
  };
  /** What the field is now, for the record. */
  field.summary = () => { const live = field.samples.filter(sample => !sample.gone); return { state: field.state, size: field.size, people: Math.round(live.length * field.weight), samples: live.length, alarmed: field.hazards.length, densest: Math.round(Math.max(0, ...live.map(sample => field.densityAt(at.get(sample.node).x, at.get(sample.node).z))) * 100) / 100 }; };
  return field;
}
