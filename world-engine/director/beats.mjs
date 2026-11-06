// The beats (A4, M3): a hidden Markov model over the block types, each block's whole distribution a soft observation
// weighted by Jev's confidence in it (as occupation.mjs smooths presence), decoded per scene; a beat is a run of one type,
// cut where the type changes and at every scene's start. The camera may cut only at a beat's start.
import { BLOCK_TYPES } from './specialists.mjs';

export const STAY = 0.85;
// A scene's cut is itself evidence the type may change: across it, a block keeps its type only this likely.
export const STAY_AT_CUT = 0.4;
const TYPES = Object.keys(BLOCK_TYPES), FLOOR = 0.01;

/**
 * The most likely run of types through `blocks` (each { distribution, confidence }): a block's observation is its
 * distribution, mixed toward uniform as Jev is less sure (an unsure block is a weaker observation).
 */
export function decode(blocks, { stay = STAY } = {}) {
  if (!blocks.length) return [];
  const move = Math.log((1 - stay) / (TYPES.length - 1)), keep = Math.log(stay);
  const emit = block => TYPES.map(type => { const sure = block.confidence ?? 1, p = sure * (block.distribution?.[type] ?? 0) + (1 - sure) / TYPES.length; return Math.log(Math.max(FLOOR, p)); });
  let score = emit(blocks[0]), back = [];
  for (let n = 1; n < blocks.length; n++) {
    const e = emit(blocks[n]), from = [], next = [];
    for (let t = 0; t < TYPES.length; t++) {
      let best = -Infinity, arg = 0;
      for (let s = 0; s < TYPES.length; s++) { const v = score[s] + (s === t ? keep : move); if (v > best) { best = v; arg = s; } }
      next.push(best + e[t]); from.push(arg);
    }
    back.push(from); score = next;
  }
  const path = [score.indexOf(Math.max(...score))];
  for (let n = back.length - 1; n >= 0; n--) path.unshift(back[n][path[0]]);
  return path.map(t => TYPES[t]);
}

/**
 * The block types smoothed (the user, 2026-11-03: "because our data is simply back tested, we don't need to predict the
 * future. You can do smoothing on type distribution confidence scores per strand"): forward-backward over one strand's
 * blocks in story order, each block's posterior over the types given every block of the strand, before and after it.
 * `cuts[k]`: block k starts a new scene (the type changes there more easily). Returns [{ distribution, confidence,
 * type }]: the posterior, its largest share, and that type.
 */
export function smooth(blocks, { stay = STAY, cuts = [] } = {}) {
  const n = blocks.length, T = TYPES.length;
  if (!n) return [];
  const emit = block => TYPES.map(type => { const sure = block.confidence ?? 1; return Math.max(FLOOR, sure * (block.distribution?.[type] ?? 0) + (1 - sure) / T); });
  // A segment says itself how likely its type changes where it begins (`change`: Jev's cut probability, M14).
  const keep = k => (blocks[k]?.change !== undefined && blocks[k]?.change !== null ? 1 - blocks[k].change : cuts[k] ? STAY_AT_CUT : stay), trans = (k, s, t) => (s === t ? keep(k) : (1 - keep(k)) / (T - 1));
  const step = (from, t, k) => from.reduce((sum, p, s) => sum + p * trans(k, s, t), 0);
  const normal = row => { const total = row.reduce((a, b) => a + b, 0) || 1; return row.map(p => p / total); };
  const forward = [], backward = new Array(n);
  forward.push(normal(emit(blocks[0])));
  for (let k = 1; k < n; k++) { const e = emit(blocks[k]); forward.push(normal(TYPES.map((_, t) => e[t] * step(forward[k - 1], t, k)))); }
  backward[n - 1] = TYPES.map(() => 1 / T);
  for (let k = n - 2; k >= 0; k--) { const e = emit(blocks[k + 1]); backward[k] = normal(TYPES.map((_, s) => TYPES.reduce((sum, __, t) => sum + trans(k + 1, s, t) * e[t] * backward[k + 1][t], 0))); }
  return forward.map((alpha, k) => {
    const post = normal(alpha.map((p, t) => p * backward[k][t])), best = post.indexOf(Math.max(...post));
    return { distribution: Object.fromEntries(TYPES.map((type, t) => [type, Math.round(post[t] * 1000) / 1000])), confidence: Math.round(post[best] * 1000) / 1000, type: TYPES[best] };
  });
}

/** Beats from decoded types: runs of one type within a scene. `scenes[n]` is block n's scene. Returns [{ scene, type, from, to }] (block indexes). */
export function beatsOf(types, scenes) {
  const out = [];
  types.forEach((type, n) => { const last = out.at(-1); if (last && last.type === type && last.scene === scenes[n]) last.to = n; else out.push({ scene: scenes[n], type, from: n, to: n }); });
  return out;
}
