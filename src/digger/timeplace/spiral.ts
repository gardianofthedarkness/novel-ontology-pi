/**
 * Spiral timelines, precomputed (docs/spiral-timelines.md): the story's
 * strands as coils around their own axes along one time axis, laid out
 * offline so the view only draws stored geometry.
 *
 * Time runs along x (a scene's story position, widened where many strands
 * are alive: stretchTime); only the transverse position q = (height, depth)
 * is laid out. A strand run e has a constant axis centre c_e, one coil
 * radius a for every run and a phase φ_e. The coil winds with the run's own
 * scenes, not with time: each scene turns it by Δθ, spread over a short
 * window around the scene, so a dense strand winds tightly and a strand with
 * almost no scenes runs almost straight:
 *
 *   q(x) = c(x) + a·f(x)·(cos θ_e(x), sin θ_e(x)),
 *   θ_e(x) = φ_e + Δθ·Σ_k s((x − x_k)/h + ½)      (winding)
 *
 * c(x) leaves the parent's centre after a fork and joins the merge target's
 * centre with the quintic s(u) = 10u³ − 15u⁴ + 6u⁵ (C²); the coil amplitude
 * f(x) fades to zero at both events so tracks meet with matching
 * derivatives. Strands sit as far apart as the old stacked coils (readable),
 * but placed per period and spread over the floor before they stack up:
 *
 *   J = mean over pairs |Δx| < S of Φ_A(B)        (projected crowding, averaged
 *                                                   exactly over a half-turn)
 *     + λ_b Σ (120/7)‖b/D‖²/(ℓ/L₀)³ + λ_ℓ Σ ℓ/L₀    (bending, transition length)
 *     + λ_s Σ [a_e + a_f + S + G − ‖c_e − c_f‖]₊²/D²
 *                                                  (tubes alive together apart)
 *     + λ_y Σ (n_e/N)·y_e/H + λ_z Σ (n_e/N)·(z_e/W)²  (busy strands low and
 *                                                   central: the floor fills first)
 *
 * with A = 1 − Δx²/S², B = ‖Δq‖²/S², n_e the run's scenes of N, subject to a
 * box on the floor (a + r ≤ y ≤ H − a − r, |z| ≤ W − a − r, 2W = 3H, sized
 * for the most strands alive at once). Transition lengths
 * take the closed-form optimum ℓ* = [360λ_b‖b/D‖²/(7λ_ℓ)]^¼ L₀ (clipped)
 * between gradient steps. The view draws it at one uniform scale. Pure and
 * deterministic: fixed starts, fixed iterations.
 */
export interface SpiralRun {
  id: string;
  /** Knots (scenes) at their story positions x, in order. */
  knots: { id: string; x: number }[];
  /** The run it forks from, at that run's knot position. */
  from?: { run: string; x: number };
  /** The run it merges into, at that run's knot position. */
  into?: { run: string; x: number };
}
export interface SpiralSolution {
  centers: Map<string, [number, number]>;
  coils: Map<string, number>;
  phases: Map<string, number>;
  /** Fork and merge transition lengths (x units). */
  forks: Map<string, number>;
  merges: Map<string, number>;
  /** Final and initial objective; mean crowding Φ; share of knots in a physical overlap, averaged over viewing angles. */
  objective: number;
  visibility: number;
  overlap: number;
  initial: { objective: number; visibility: number; overlap: number };
  pairs: number;
  /** The floor box the centres were kept in: full width (depth) and height. */
  frame: { width: number; height: number };
}

/** x units per quiet story layer; scene radius and gap; clearance between tubes; floor box width : height. */
export const SPIRAL = { dx: 9, knot: 14, gap: 4, clearance: 90, aspect: 3, coil: 40, turnScenes: 10, twistLayers: 2, fadeLayers: 1.5, transitionLayers: [3, 14] as [number, number] };
const S = 2 * SPIRAL.knot + SPIRAL.gap;
const L0 = 10 * SPIRAL.dx;
/** Nominal spacing of two strands alive together (largest coils): normalises spacing and bending. */
const D = 2 * SPIRAL.coil + S + SPIRAL.clearance;
const WEIGHTS = { bend: 8e-5, length: 0.01, separation: 0.05, low: 0.02, central: 0.05 };

/**
 * Story positions along time for layers 0…layers−1 given each run's layer
 * span: a step widens by half a layer for every extra strand alive at it,
 * so busy stretches get room and quiet ones stay compact.
 */
export function stretchTime(spans: [number, number][], layers: number): number[] {
  const alive = new Array<number>(Math.max(1, layers)).fill(0);
  for (const [from, to] of spans) for (let layer = Math.max(0, from); layer <= Math.min(layers - 1, to); layer++) alive[layer]++;
  const x = [0];
  for (let layer = 1; layer < layers; layer++) x.push(x[layer - 1] + SPIRAL.dx * (1 + 0.5 * (Math.max(1, alive[layer - 1], alive[layer]) - 1)));
  return x;
}

/** C² ease and its derivative. */
export const ease = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * t * (10 + t * (-15 + 6 * t)); };

/** How far a run's coil has turned at x (radians, before its phase): Δθ per scene, eased over a short window around each one. */
export function winding(scenes: number[], x: number): number {
  const turn = (2 * Math.PI) / SPIRAL.turnScenes, width = SPIRAL.twistLayers * SPIRAL.dx;
  return scenes.reduce((sum, at) => sum + turn * ease((x - at) / width + 0.5), 0);
}

/** Exact half-turn mean of [A − B cos²θ]₊ (the handout's Φ_A(B)) and its derivative in B. */
export function phi(A: number, B: number): number {
  if (A <= 0) return 0;
  if (B <= A) return A - B / 2;
  const gamma = Math.asin(Math.sqrt(A / B));
  return Math.max(0, ((2 * A - B) * gamma + Math.sqrt(A * (B - A))) / Math.PI);
}
export function dphi(A: number, B: number): number {
  if (A <= 0) return 0;
  if (B <= A) return -0.5;
  return -(Math.asin(Math.sqrt(A / B)) - Math.sqrt((A / B) * (1 - A / B))) / Math.PI;
}

interface Prepared {
  runs: SpiralRun[];
  index: Map<string, number>;
  knots: { run: number; x: number }[];
  pairs: [number, number, number][];
  span: [number, number][];
  forkX: (number | null)[];
  mergeX: (number | null)[];
  parent: number[];
  target: number[];
  related: Set<string>;
  /** Where each run's coil shrinks to zero: its own fork and merge, and wherever another run leaves it or joins it. */
  events: number[][];
  /** Scenes per run over all scenes (how strongly it sinks to the floor's middle); the floor box. */
  weight: number[];
  /** Each run's scene positions (its coil winds with them) and each knot's winding. */
  scenes: number[][];
  turn: number[];
  height: number;
  width: number;
}

function prepare(input: SpiralRun[]): Prepared {
  const runs = input.filter((run) => run.knots.length).sort((first, second) => first.knots[0].x - second.knots[0].x || first.id.localeCompare(second.id));
  const index = new Map(runs.map((run, at) => [run.id, at]));
  const knots = runs.flatMap((run, at) => run.knots.map((knot) => ({ run: at, x: knot.x })));
  const order = knots.map((_, at) => at).sort((first, second) => knots[first].x - knots[second].x);
  const pairs: [number, number, number][] = [];
  for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
    const dx = knots[order[b]].x - knots[order[a]].x;
    if (dx >= S) break;
    pairs.push([order[a], order[b], 1 - (dx * dx) / (S * S)]);
  }
  const parent = runs.map((run) => run.from && index.has(run.from.run) && run.from.x < run.knots[0].x ? index.get(run.from.run)! : -1);
  const target = runs.map((run) => run.into && index.has(run.into.run) && run.into.x > run.knots.at(-1)!.x ? index.get(run.into.run)! : -1);
  const forkX = runs.map((run, at) => parent[at] >= 0 ? run.from!.x : null), mergeX = runs.map((run, at) => target[at] >= 0 ? run.into!.x : null);
  const span = runs.map((run, at): [number, number] => [forkX[at] ?? run.knots[0].x, mergeX[at] ?? run.knots.at(-1)!.x]);
  const related = new Set<string>();
  runs.forEach((_, at) => { for (const other of [parent[at], target[at]]) if (other >= 0) related.add(`${Math.min(at, other)}|${Math.max(at, other)}`); });
  const events = runs.map(() => [] as number[]);
  runs.forEach((_, at) => {
    if (forkX[at] !== null) { events[at].push(forkX[at]!); events[parent[at]].push(forkX[at]!); }
    if (mergeX[at] !== null) { events[at].push(mergeX[at]!); events[target[at]].push(mergeX[at]!); }
  });
  // The box holds the most strands alive at once side by side: area n·D², width : height = aspect.
  const ends = span.flatMap(([from, to]) => [[from, 1], [to, -1]] as [number, number][]).sort((first, second) => first[0] - second[0] || second[1] - first[1]);
  let alive = 0, most = 1;
  for (const [, change] of ends) { alive += change; most = Math.max(most, alive); }
  const height = D * Math.max(1.5, Math.sqrt(most / SPIRAL.aspect));
  const weight = runs.map((run) => run.knots.length / Math.max(1, knots.length));
  const scenes = runs.map((run) => run.knots.map((knot) => knot.x));
  const turn = knots.map((knot) => winding(scenes[knot.run], knot.x));
  return { runs, index, knots, pairs, span, forkX, mergeX, parent, target, related, events: events.map((xs) => [...new Set(xs)]), weight, scenes, turn, height, width: SPIRAL.aspect * height };
}

interface Params { c: [number, number][]; a: number[]; p: number[]; lf: number[]; lm: number[] }

/** A point's position and its sensitivities: centre weights (own, parent, target), phase term. A knot passes its precomputed winding. */
function place(prep: Prepared, v: Params, run: number, x: number, turn = winding(prep.scenes[run], x)) {
  const fx = prep.forkX[run], mx = prep.mergeX[run];
  const sf = fx === null ? 1 : ease((x - fx) / v.lf[run]);
  const sm = mx === null ? 0 : ease((x - (mx - v.lm[run])) / v.lm[run]);
  // The coil shrinks to zero at every event on this run, so all tracks of a fork or merge meet on one point with matching derivatives.
  const fade = SPIRAL.fadeLayers * SPIRAL.dx;
  const shrink = prep.events[run].reduce((product, at) => product * ease(Math.abs(x - at) / fade), 1);
  const own = (1 - sm) * sf, fromParent = (1 - sm) * (1 - sf), toTarget = sm;
  const c = v.c[run], cp = prep.parent[run] >= 0 ? v.c[prep.parent[run]] : c, ct = prep.target[run] >= 0 ? v.c[prep.target[run]] : c;
  const center: [number, number] = [own * c[0] + fromParent * cp[0] + toTarget * ct[0], own * c[1] + fromParent * cp[1] + toTarget * ct[1]];
  const amp = v.a[run] * shrink, angle = turn + v.p[run];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { q: [center[0] + amp * cos, center[1] + amp * sin] as [number, number], center, amp, own, fromParent, toTarget, dP: [-amp * sin, amp * cos] };
}

function evaluate(prep: Prepared, v: Params, gradient = true) {
  const n = prep.runs.length;
  const placed = prep.knots.map((knot, at) => place(prep, v, knot.run, knot.x, prep.turn[at]));
  const gq = placed.map(() => [0, 0]);
  let visibility = 0;
  const P = Math.max(1, prep.pairs.length);
  for (const [i, j, A] of prep.pairs) {
    const dy = placed[i].q[0] - placed[j].q[0], dz = placed[i].q[1] - placed[j].q[1], B = (dy * dy + dz * dz) / (S * S);
    visibility += phi(A, B) / P;
    if (!gradient) continue;
    const g = (dphi(A, B) * 2) / (S * S) / P;
    gq[i][0] += g * dy; gq[i][1] += g * dz; gq[j][0] -= g * dy; gq[j][1] -= g * dz;
  }
  const gc = v.c.map(() => [0, 0]), gp = v.p.map(() => 0);
  if (gradient) prep.knots.forEach((knot, at) => {
    const k = placed[at], g = gq[at], run = knot.run;
    for (const [target, weight] of [[run, k.own], [prep.parent[run], k.fromParent], [prep.target[run], k.toTarget]] as [number, number][]) {
      if (target < 0 || !weight) continue;
      gc[target][0] += weight * g[0]; gc[target][1] += weight * g[1];
    }
    gp[run] += g[0] * k.dP[0] + g[1] * k.dP[1];
  });
  // Bending and length of every transition (exact for the quintic on a straight trunk).
  let regular = 0;
  const bend = (run: number, other: number, length: number) => {
    const b = [(v.c[run][0] - v.c[other][0]) / D, (v.c[run][1] - v.c[other][1]) / D], scale = (120 / 7) / (length / L0) ** 3;
    regular += WEIGHTS.bend * scale * (b[0] * b[0] + b[1] * b[1]) + WEIGHTS.length * (length / L0);
    if (!gradient) return;
    for (const axis of [0, 1]) { const g = (WEIGHTS.bend * scale * 2 * b[axis]) / D; gc[run][axis] += g; gc[other][axis] -= g; }
  };
  for (let run = 0; run < n; run++) {
    if (prep.parent[run] >= 0) bend(run, prep.parent[run], v.lf[run]);
    if (prep.target[run] >= 0) bend(run, prep.target[run], v.lm[run]);
  }
  // Tubes alive together keep apart once settled (a fork or merge partner may meet it only at the event):
  // every pair in full, so a small strand cannot fold back into its parent's tube to save a bend.
  const together: [number, number][] = [];
  for (let e = 0; e < n; e++) for (let f = e + 1; f < n; f++) {
    const [e0, e1] = [prep.span[e][0] + (prep.parent[e] >= 0 ? v.lf[e] : 0), prep.span[e][1] - (prep.target[e] >= 0 ? v.lm[e] : 0)];
    const [f0, f1] = [prep.span[f][0] + (prep.parent[f] >= 0 ? v.lf[f] : 0), prep.span[f][1] - (prep.target[f] >= 0 ? v.lm[f] : 0)];
    if (Math.min(e1, f1) >= Math.max(e0, f0)) together.push([e, f]);
  }
  const share = WEIGHTS.separation;
  for (const [e, f] of together) {
    const dy = v.c[e][0] - v.c[f][0], dz = v.c[e][1] - v.c[f][1], d = Math.hypot(dy, dz) || 1e-9, need = v.a[e] + v.a[f] + S + SPIRAL.clearance;
    if (d >= need) continue;
    regular += (share * (need - d) ** 2) / (D * D);
    if (!gradient) continue;
    const g = (-2 * share * (need - d)) / (D * D);
    gc[e][0] += (g * dy) / d; gc[e][1] += (g * dz) / d; gc[f][0] -= (g * dy) / d; gc[f][1] -= (g * dz) / d;
  }
  // Busy strands sink low and to the middle, so strands spread over the floor before they stack up.
  for (let run = 0; run < n; run++) {
    const [y, z] = v.c[run], w = prep.weight[run], half = prep.width / 2;
    regular += WEIGHTS.low * w * (y / prep.height) + WEIGHTS.central * w * (z / half) ** 2;
    if (gradient) { gc[run][0] += (WEIGHTS.low * w) / prep.height; gc[run][1] += (2 * WEIGHTS.central * w * z) / (half * half); }
  }
  return { objective: visibility + regular, visibility, gc, gp, placed };
}

/** Share of knots in a physical overlap with another strand's knot (projected distance < 2r), averaged over evenly spaced half-turn angles. */
function overlapShare(prep: Prepared, v: Params, angles = 90): number {
  const placed = prep.knots.map((knot, at) => place(prep, v, knot.run, knot.x, prep.turn[at]).q);
  if (!placed.length) return 0;
  let total = 0;
  for (let k = 0; k < angles; k++) {
    const theta = ((k + 0.5) * Math.PI) / angles, cos = Math.cos(theta), sin = Math.sin(theta), hit = new Set<number>();
    for (const [i, j] of prep.pairs) {
      if (prep.knots[i].run === prep.knots[j].run) continue;
      const dx = prep.knots[j].x - prep.knots[i].x, dv = (placed[i][0] - placed[j][0]) * cos + (placed[i][1] - placed[j][1]) * sin;
      if (dx * dx + dv * dv < (2 * SPIRAL.knot) ** 2) { hit.add(i); hit.add(j); }
    }
    total += hit.size / placed.length;
  }
  return total / angles;
}

/** Keep every knot inside the floor box at every rotation (a + r ≤ y ≤ H − a − r, |z| ≤ W − a − r). */
function project(prep: Prepared, v: Params) {
  v.c.forEach((c, run) => {
    const edge = v.a[run] + SPIRAL.knot, side = prep.width / 2 - edge;
    v.c[run] = [Math.min(prep.height - edge, Math.max(edge, c[0])), Math.min(side, Math.max(-side, c[1]))];
  });
}

/** Transition lengths at the closed-form optimum of bending + length for the current centres, clipped. */
function transitions(prep: Prepared, v: Params) {
  const [low, high] = SPIRAL.transitionLayers.map((layers) => layers * SPIRAL.dx);
  const best = (run: number, other: number) => {
    const b2 = ((v.c[run][0] - v.c[other][0]) ** 2 + (v.c[run][1] - v.c[other][1]) ** 2) / D ** 2;
    return Math.min(high, Math.max(low, L0 * ((360 * WEIGHTS.bend * b2) / (7 * WEIGHTS.length)) ** 0.25));
  };
  prep.runs.forEach((run, at) => {
    const room = Math.max(SPIRAL.dx, (prep.span[at][1] - prep.span[at][0]) / (prep.parent[at] >= 0 && prep.target[at] >= 0 ? 2 : 1));
    if (prep.parent[at] >= 0) v.lf[at] = Math.min(room, best(at, prep.parent[at]));
    if (prep.target[at] >= 0) v.lm[at] = Math.min(room, best(at, prep.target[at]));
  });
}

/**
 * A packed start: busiest runs first, each in the cheapest free slot of a
 * grid on the floor box (low and central first, by the same weights as the
 * objective), free meaning no run alive with it took it. Gradient steps alone
 * cannot swap two strands through each other, so this sets the order.
 */
function packed(prep: Prepared, mirror: boolean): [number, number][] {
  const edge = SPIRAL.coil + SPIRAL.knot, half = prep.width / 2;
  const slots: [number, number][] = [];
  for (let y = edge; y <= prep.height - edge + 1e-9; y += D) for (let k = 0; k * D <= half - edge; k++) for (const z of k ? [k * D, -k * D] : [0]) slots.push([y, mirror ? -z : z]);
  const cost = ([y, z]: [number, number]) => WEIGHTS.low * (y / prep.height) + WEIGHTS.central * (z / half) ** 2;
  slots.sort((first, second) => cost(first) - cost(second));
  const together = (e: number, f: number) => Math.min(prep.span[e][1], prep.span[f][1]) > Math.max(prep.span[e][0], prep.span[f][0]);
  const taken = slots.map(() => [] as number[]), at = prep.runs.map((): [number, number] => [edge, 0]);
  for (const run of prep.runs.map((_, index) => index).sort((first, second) => prep.weight[second] - prep.weight[first] || first - second)) {
    const slot = Math.max(0, taken.findIndex((runs) => !runs.some((other) => together(run, other))));
    taken[slot].push(run);
    at[run] = [...slots[slot]];
  }
  return at;
}

/** Deterministic starts: the packed grid and its mirror, then runs on a sunflower stretched over the floor box; phases spread by the golden angle. */
function start(prep: Prepared, attempt: number, starts: number): Params {
  const n = prep.runs.length, golden = Math.PI * (3 - Math.sqrt(5)), rotation = (2 * Math.PI * attempt) / Math.max(1, starts);
  const c = attempt < 2 ? packed(prep, attempt === 1) : prep.runs.map((_, at): [number, number] => {
    const radius = 0.8 * Math.sqrt((at + 0.5) / Math.max(1, n)), angle = rotation + at * golden;
    return [prep.height * (0.5 + 0.5 * radius * Math.sin(angle)), (prep.width / 2) * radius * Math.cos(angle)];
  });
  return { c, a: prep.runs.map(() => SPIRAL.coil), p: prep.runs.map((_, at) => at * golden), lf: prep.runs.map(() => 5 * SPIRAL.dx), lm: prep.runs.map(() => 5 * SPIRAL.dx) };
}

const clone = (v: Params): Params => ({ c: v.c.map((c) => [...c] as [number, number]), a: [...v.a], p: [...v.p], lf: [...v.lf], lm: [...v.lm] });

/** Lay the runs out: a few fixed starts, Adam steps with projection, the best result kept. */
export function solveSpiral(input: SpiralRun[], options: { iterations?: number; starts?: number } = {}): SpiralSolution {
  const prep = prepare(input);
  const iterations = options.iterations ?? 400, starts = options.starts ?? 3;
  let best: { v: Params; objective: number } | null = null;
  let initial: { objective: number; visibility: number; overlap: number } | null = null;
  for (let s = 0; s < starts; s++) {
    const v = start(prep, s, starts);
    project(prep, v); transitions(prep, v);
    if (!initial) { const first = evaluate(prep, v, false); initial = { objective: first.objective, visibility: first.visibility, overlap: overlapShare(prep, v) }; }
    const rates = { c: 4, p: 0.04 }, beta = [0.9, 0.999];
    const m = { c: v.c.map(() => [0, 0]), p: v.p.map(() => 0) }, s2 = { c: v.c.map(() => [0, 0]), p: v.p.map(() => 0) };
    let kept = { v: clone(v), objective: evaluate(prep, v, false).objective };
    for (let t = 1; t <= iterations; t++) {
      const { gc, gp } = evaluate(prep, v);
      const correct = (moment: number, power: number) => moment / (1 - beta[power] ** t);
      v.c.forEach((c, run) => { for (const axis of [0, 1]) {
        m.c[run][axis] = beta[0] * m.c[run][axis] + (1 - beta[0]) * gc[run][axis];
        s2.c[run][axis] = beta[1] * s2.c[run][axis] + (1 - beta[1]) * gc[run][axis] ** 2;
        c[axis] -= (rates.c * correct(m.c[run][axis], 0)) / (Math.sqrt(correct(s2.c[run][axis], 1)) + 1e-12);
      } });
      v.p.forEach((_, run) => { m.p[run] = beta[0] * m.p[run] + (1 - beta[0]) * gp[run]; s2.p[run] = beta[1] * s2.p[run] + (1 - beta[1]) * gp[run] ** 2; v.p[run] -= (rates.p * correct(m.p[run], 0)) / (Math.sqrt(correct(s2.p[run], 1)) + 1e-12); });
      project(prep, v);
      if (t % 20 === 0) transitions(prep, v);
      const now = evaluate(prep, v, false).objective;
      if (now < kept.objective) kept = { v: clone(v), objective: now };
    }
    if (!best || kept.objective < best.objective) best = kept;
  }
  const v = best!.v, final = evaluate(prep, v, false);
  const map = <T>(values: T[]) => new Map(prep.runs.map((run, at) => [run.id, values[at]]));
  return {
    centers: map(v.c), coils: map(v.a), phases: map(v.p),
    forks: new Map(prep.runs.flatMap((run, at) => prep.parent[at] >= 0 ? [[run.id, v.lf[at]] as [string, number]] : [])),
    merges: new Map(prep.runs.flatMap((run, at) => prep.target[at] >= 0 ? [[run.id, v.lm[at]] as [string, number]] : [])),
    objective: final.objective, visibility: final.visibility, overlap: overlapShare(prep, v), initial: initial ?? { objective: 0, visibility: 0, overlap: 0 }, pairs: prep.pairs.length,
    frame: { width: Math.round(prep.width), height: Math.round(prep.height) },
  };
}

/** What the view draws: each run's knots, its coil track and axis (dense samples) and tube-guide radius. Geometry only. */
export interface SpiralTrack { id: string; knots: { id: string; x: number; q: [number, number] }[]; track: [number, number, number][]; axis: [number, number, number][]; tube: number }
export function spiralTracks(input: SpiralRun[], solution: SpiralSolution, samplesPerLayer = 6): SpiralTrack[] {
  const prep = prepare(input);
  const v: Params = {
    c: prep.runs.map((run) => solution.centers.get(run.id)!), a: prep.runs.map((run) => solution.coils.get(run.id)!), p: prep.runs.map((run) => solution.phases.get(run.id)!),
    lf: prep.runs.map((run) => solution.forks.get(run.id) ?? SPIRAL.dx), lm: prep.runs.map((run) => solution.merges.get(run.id) ?? SPIRAL.dx),
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  return prep.runs.map((run, at) => {
    const [x0, x1] = prep.span[at], step = SPIRAL.dx / samplesPerLayer;
    const xs = [...new Set([...Array.from({ length: Math.max(1, Math.ceil((x1 - x0) / step)) + 1 }, (_, k) => Math.min(x1, x0 + k * step)), ...run.knots.map((knot) => knot.x)])].sort((first, second) => first - second);
    const track: [number, number, number][] = [], axis: [number, number, number][] = [];
    for (const x of xs) { const k = place(prep, v, at, x); track.push([round(x), round(k.q[0]), round(k.q[1])]); axis.push([round(x), round(k.center[0]), round(k.center[1])]); }
    return { id: run.id, knots: run.knots.map((knot) => { const k = place(prep, v, at, knot.x); return { id: knot.id, x: round(knot.x), q: [round(k.q[0]), round(k.q[1])] }; }), track, axis, tube: round(v.a[at] + SPIRAL.knot) };
  });
}
