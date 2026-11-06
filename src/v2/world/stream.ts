/** A seeded random stream for the stage's generated ground: the same parts give the same numbers (the view's skeletonStream, the same numbers). */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const stageStream = (...parts: (number | string)[]) => { let hash = 2166136261; for (const char of parts.join(":")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return mulberry32(hash >>> 0); };
