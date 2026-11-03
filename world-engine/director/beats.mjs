// The beats (A4, M3): a hidden Markov model over the block types, each block's whole distribution a soft observation
// weighted by Jev's confidence in it (as occupation.mjs smooths presence), decoded per scene; a beat is a run of one type,
// cut where the type changes and at every scene's start. The camera may cut only at a beat's start.
import { BLOCK_TYPES } from './specialists.mjs';

export const STAY = 0.85;
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

/** Beats from decoded types: runs of one type within a scene. `scenes[n]` is block n's scene. Returns [{ scene, type, from, to }] (block indexes). */
export function beatsOf(types, scenes) {
  const out = [];
  types.forEach((type, n) => { const last = out.at(-1); if (last && last.type === type && last.scene === scenes[n]) last.to = n; else out.push({ scene: scenes[n], type, from: n, to: n }); });
  return out;
}
