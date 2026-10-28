/**
 * Spiral timelines, precomputed (docs/spiral-timelines.md): the story's
 * strands as coils around their own axes along one time axis, laid out
 * offline so the view only draws stored geometry.
 *
 * Time runs along x (a scene's story position); only the transverse
 * position q = (height, depth) is laid out. A strand run e has a constant
 * axis centre c_e, a coil radius a_e and a phase φ_e:
 *
 *   q(x) = c(x) + a_e·f(x)·(cos(ωx + φ_e), sin(ωx + φ_e))
 *
 * c(x) leaves the parent's centre after a fork and joins the merge target's
 * centre with the quintic s(u) = 10u³ − 15u⁴ + 6u⁵ (C²); the coil amplitude
 * f(x) fades to zero at both events so tracks meet with matching
 * derivatives. The objective is the handout's:
 *
 *   J = mean over pairs |Δx| < S of Φ_A(B)        (projected crowding, averaged
 *                                                   exactly over a half-turn)
 *     + λ_b Σ (120/7)‖b/R‖²/(ℓ/L₀)³ + λ_ℓ Σ ℓ/L₀    (bending, transition length)
 *     + λ_s Σ [a_e + a_f + S − ‖c_e − c_f‖]₊²/S²   (unrelated tubes apart)
 *
 * with A = 1 − Δx²/S², B = ‖Δq‖²/S², subject to ‖c‖ + a + r ≤ R (every knot
 * in the frame at every rotation) and bounds on a. Transition lengths take
 * the closed-form optimum ℓ* = [360λ_b‖b̂‖²/(7λ_ℓ)]^¼ L₀ (clipped) between
 * gradient steps. The knot radius r and frame R only normalise the problem
 * (they keep it from spreading without bound); the view draws at any scale.
 * Pure and deterministic: fixed starts, fixed iterations.
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
}

/** x units per story layer, frame radius, knot radius, gap. Normalisation only. */
export const SPIRAL = { dx: 9, radial: 120, knot: 5.5, gap: 2, turnLayers: 8, fadeLayers: 1.5, coil: [6, 30] as [number, number], transitionLayers: [3, 14] as [number, number] };
const S = 2 * SPIRAL.knot + SPIRAL.gap;
const OMEGA = (2 * Math.PI) / (SPIRAL.turnLayers * SPIRAL.dx);
const L0 = 10 * SPIRAL.dx;
const WEIGHTS = { bend: 8e-5, length: 0.01, separation: 0.05 };

/** C² ease and its derivative. */
export const ease = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * t * (10 + t * (-15 + 6 * t)); };

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
  return { runs, index, knots, pairs, span, forkX, mergeX, parent, target, related, events: events.map((xs) => [...new Set(xs)]) };
}

interface Params { c: [number, number][]; a: number[]; p: number[]; lf: number[]; lm: number[] }

/** A knot's position and its sensitivities: centre weights (own, parent, target), coil direction terms. */
function place(prep: Prepared, v: Params, run: number, x: number) {
  const fx = prep.forkX[run], mx = prep.mergeX[run];
  const sf = fx === null ? 1 : ease((x - fx) / v.lf[run]);
  const sm = mx === null ? 0 : ease((x - (mx - v.lm[run])) / v.lm[run]);
  // The coil shrinks to zero at every event on this run, so all tracks of a fork or merge meet on one point with matching derivatives.
  const fade = SPIRAL.fadeLayers * SPIRAL.dx;
  const shrink = prep.events[run].reduce((product, at) => product * ease(Math.abs(x - at) / fade), 1);
  const own = (1 - sm) * sf, fromParent = (1 - sm) * (1 - sf), toTarget = sm;
  const c = v.c[run], cp = prep.parent[run] >= 0 ? v.c[prep.parent[run]] : c, ct = prep.target[run] >= 0 ? v.c[prep.target[run]] : c;
  const center: [number, number] = [own * c[0] + fromParent * cp[0] + toTarget * ct[0], own * c[1] + fromParent * cp[1] + toTarget * ct[1]];
  const amp = v.a[run] * shrink, angle = OMEGA * x + v.p[run];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { q: [center[0] + amp * cos, center[1] + amp * sin] as [number, number], center, amp, own, fromParent, toTarget, dA: [shrink * cos, shrink * sin], dP: [-amp * sin, amp * cos] };
}

function evaluate(prep: Prepared, v: Params, gradient = true) {
  const n = prep.runs.length;
  const placed = prep.knots.map((knot) => place(prep, v, knot.run, knot.x));
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
  const gc = v.c.map(() => [0, 0]), ga = v.a.map(() => 0), gp = v.p.map(() => 0);
  if (gradient) prep.knots.forEach((knot, at) => {
    const k = placed[at], g = gq[at], run = knot.run;
    for (const [target, weight] of [[run, k.own], [prep.parent[run], k.fromParent], [prep.target[run], k.toTarget]] as [number, number][]) {
      if (target < 0 || !weight) continue;
      gc[target][0] += weight * g[0]; gc[target][1] += weight * g[1];
    }
    ga[run] += g[0] * k.dA[0] + g[1] * k.dA[1];
    gp[run] += g[0] * k.dP[0] + g[1] * k.dP[1];
  });
  // Bending and length of every transition (exact for the quintic on a straight trunk).
  let regular = 0;
  const bend = (run: number, other: number, length: number) => {
    const b = [(v.c[run][0] - v.c[other][0]) / SPIRAL.radial, (v.c[run][1] - v.c[other][1]) / SPIRAL.radial], scale = (120 / 7) / (length / L0) ** 3;
    regular += WEIGHTS.bend * scale * (b[0] * b[0] + b[1] * b[1]) + WEIGHTS.length * (length / L0);
    if (!gradient) return;
    for (const axis of [0, 1]) { const g = (WEIGHTS.bend * scale * 2 * b[axis]) / SPIRAL.radial; gc[run][axis] += g; gc[other][axis] -= g; }
  };
  for (let run = 0; run < n; run++) {
    if (prep.parent[run] >= 0) bend(run, prep.parent[run], v.lf[run]);
    if (prep.target[run] >= 0) bend(run, prep.target[run], v.lm[run]);
  }
  // Tubes alive together keep apart once settled (a fork or merge partner may meet it only at the event):
  // a mean over the pairs alive together, so many strands do not drown the visibility term.
  const together: [number, number][] = [];
  for (let e = 0; e < n; e++) for (let f = e + 1; f < n; f++) {
    const [e0, e1] = [prep.span[e][0] + (prep.parent[e] >= 0 ? v.lf[e] : 0), prep.span[e][1] - (prep.target[e] >= 0 ? v.lm[e] : 0)];
    const [f0, f1] = [prep.span[f][0] + (prep.parent[f] >= 0 ? v.lf[f] : 0), prep.span[f][1] - (prep.target[f] >= 0 ? v.lm[f] : 0)];
    if (Math.min(e1, f1) >= Math.max(e0, f0)) together.push([e, f]);
  }
  const share = WEIGHTS.separation / Math.max(1, together.length);
  for (const [e, f] of together) {
    const dy = v.c[e][0] - v.c[f][0], dz = v.c[e][1] - v.c[f][1], d = Math.hypot(dy, dz) || 1e-9, need = v.a[e] + v.a[f] + S;
    if (d >= need) continue;
    regular += (share * (need - d) ** 2) / (S * S);
    if (!gradient) continue;
    const g = (-2 * share * (need - d)) / (S * S);
    gc[e][0] += (g * dy) / d; gc[e][1] += (g * dz) / d; gc[f][0] -= (g * dy) / d; gc[f][1] -= (g * dz) / d;
    ga[e] += (-g); ga[f] += (-g);
  }
  return { objective: visibility + regular, visibility, gc, ga, gp, placed };
}

/** Share of knots in a physical overlap (projected distance < 2r), averaged over evenly spaced half-turn angles. */
function overlapShare(prep: Prepared, v: Params, angles = 90): number {
  const placed = prep.knots.map((knot) => place(prep, v, knot.run, knot.x).q);
  if (!placed.length) return 0;
  let total = 0;
  for (let k = 0; k < angles; k++) {
    const theta = ((k + 0.5) * Math.PI) / angles, cos = Math.cos(theta), sin = Math.sin(theta), hit = new Set<number>();
    for (const [i, j] of prep.pairs) {
      const dx = prep.knots[j].x - prep.knots[i].x, dv = (placed[i][0] - placed[j][0]) * cos + (placed[i][1] - placed[j][1]) * sin;
      if (dx * dx + dv * dv < (2 * SPIRAL.knot) ** 2) { hit.add(i); hit.add(j); }
    }
    total += hit.size / placed.length;
  }
  return total / angles;
}

/** Keep every knot in the frame at every rotation (‖c‖ + a + r ≤ R) and the coils within bounds. */
function project(v: Params) {
  v.a.forEach((a, run) => { v.a[run] = Math.min(SPIRAL.coil[1], Math.max(SPIRAL.coil[0], a)); });
  v.c.forEach((c, run) => {
    const room = SPIRAL.radial - v.a[run] - SPIRAL.knot, length = Math.hypot(c[0], c[1]);
    if (length > room) v.c[run] = [(c[0] / length) * room, (c[1] / length) * room];
  });
}

/** Transition lengths at the closed-form optimum of bending + length for the current centres, clipped. */
function transitions(prep: Prepared, v: Params) {
  const [low, high] = SPIRAL.transitionLayers.map((layers) => layers * SPIRAL.dx);
  const best = (run: number, other: number) => {
    const b2 = ((v.c[run][0] - v.c[other][0]) ** 2 + (v.c[run][1] - v.c[other][1]) ** 2) / SPIRAL.radial ** 2;
    return Math.min(high, Math.max(low, L0 * ((360 * WEIGHTS.bend * b2) / (7 * WEIGHTS.length)) ** 0.25));
  };
  prep.runs.forEach((run, at) => {
    const room = Math.max(SPIRAL.dx, (prep.span[at][1] - prep.span[at][0]) / (prep.parent[at] >= 0 && prep.target[at] >= 0 ? 2 : 1));
    if (prep.parent[at] >= 0) v.lf[at] = Math.min(room, best(at, prep.parent[at]));
    if (prep.target[at] >= 0) v.lm[at] = Math.min(room, best(at, prep.target[at]));
  });
}

/** Deterministic starts: runs on a sunflower inside the frame, rotated per start; phases spread by the golden angle. */
function start(prep: Prepared, rotation: number): Params {
  const n = prep.runs.length, golden = Math.PI * (3 - Math.sqrt(5));
  const c = prep.runs.map((_, at): [number, number] => {
    const radius = 0.5 * SPIRAL.radial * Math.sqrt((at + 0.5) / Math.max(1, n)), angle = rotation + at * golden;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return { c, a: prep.runs.map(() => 16), p: prep.runs.map((_, at) => at * golden), lf: prep.runs.map(() => 5 * SPIRAL.dx), lm: prep.runs.map(() => 5 * SPIRAL.dx) };
}

const clone = (v: Params): Params => ({ c: v.c.map((c) => [...c] as [number, number]), a: [...v.a], p: [...v.p], lf: [...v.lf], lm: [...v.lm] });

/** Lay the runs out: a few fixed starts, Adam steps with projection, the best result kept. */
export function solveSpiral(input: SpiralRun[], options: { iterations?: number; starts?: number } = {}): SpiralSolution {
  const prep = prepare(input);
  const iterations = options.iterations ?? 400, starts = options.starts ?? 3;
  let best: { v: Params; objective: number } | null = null;
  let initial: { objective: number; visibility: number; overlap: number } | null = null;
  for (let s = 0; s < starts; s++) {
    const v = start(prep, (2 * Math.PI * s) / Math.max(1, starts));
    project(v); transitions(prep, v);
    if (!initial) { const first = evaluate(prep, v, false); initial = { objective: first.objective, visibility: first.visibility, overlap: overlapShare(prep, v) }; }
    const rates = { c: 1.5, a: 0.4, p: 0.04 }, beta = [0.9, 0.999];
    const m = { c: v.c.map(() => [0, 0]), a: v.a.map(() => 0), p: v.p.map(() => 0) }, s2 = { c: v.c.map(() => [0, 0]), a: v.a.map(() => 0), p: v.p.map(() => 0) };
    let kept = { v: clone(v), objective: evaluate(prep, v, false).objective };
    for (let t = 1; t <= iterations; t++) {
      const { gc, ga, gp } = evaluate(prep, v);
      const correct = (moment: number, power: number) => moment / (1 - beta[power] ** t);
      v.c.forEach((c, run) => { for (const axis of [0, 1]) {
        m.c[run][axis] = beta[0] * m.c[run][axis] + (1 - beta[0]) * gc[run][axis];
        s2.c[run][axis] = beta[1] * s2.c[run][axis] + (1 - beta[1]) * gc[run][axis] ** 2;
        c[axis] -= (rates.c * correct(m.c[run][axis], 0)) / (Math.sqrt(correct(s2.c[run][axis], 1)) + 1e-12);
      } });
      v.a.forEach((_, run) => { m.a[run] = beta[0] * m.a[run] + (1 - beta[0]) * ga[run]; s2.a[run] = beta[1] * s2.a[run] + (1 - beta[1]) * ga[run] ** 2; v.a[run] -= (rates.a * correct(m.a[run], 0)) / (Math.sqrt(correct(s2.a[run], 1)) + 1e-12); });
      v.p.forEach((_, run) => { m.p[run] = beta[0] * m.p[run] + (1 - beta[0]) * gp[run]; s2.p[run] = beta[1] * s2.p[run] + (1 - beta[1]) * gp[run] ** 2; v.p[run] -= (rates.p * correct(m.p[run], 0)) / (Math.sqrt(correct(s2.p[run], 1)) + 1e-12); });
      project(v);
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
