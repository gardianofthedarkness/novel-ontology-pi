// L21 · Attack reach (the user, 2026-11-05: "attacks can be simplify to the following, attack close up, attack with a
// lined beam/bullet/canon, attack with explosion at certain position"). A blow the action director noted, sorted into one
// of the three (in-use.mjs attackKindOf), holds only within what the attacker can do: their own ability's limits (the
// settei sheet), else a weapon they hold, else a person's.
//
//   close  the target within the attacker's reach;
//   line   the target within its range, and no building standing between them along the line (a bullet, a beam);
//   area   the explosion placed within its range of the attacker, the target within its radius of it.
//
// Pure: points in metres ([x, y, z]), lots as the world has them (cells of CELL m, floors of FLOOR m).

import { setting } from '../../dist/src/v2/settings.js';
export const CELL = setting('grid.cell'), FLOOR = setting('grid.floor');
/** What a person can do without an ability or a weapon: a fist's reach with a step (3 m), a throw's range; no explosion. */
export const PERSON = setting('laws.person');

/** The limits a blow of this kind has: the attacker's own, else the weapon's they hold, else a person's; null when none can. */
export function limitsOf(kind, { own = null, weapons = [] } = {}) {
  if (own?.[kind]) return { ...own[kind], by: 'ability' };
  const weapon = weapons.find(entry => entry?.attack?.kind === kind);
  if (weapon) { const { kind: _, sure, ...limits } = weapon.attack; return { ...limits, by: 'weapon', weapon: weapon.label }; }
  return PERSON[kind] ? { ...PERSON[kind], by: 'person' } : null;
}

/** Whether a building stands across the line from a to b (sampled every metre): a lot whose top is above the line there. */
export function lineBlocked(a, b, lots) {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]), steps = Math.max(1, Math.ceil(length));
  const own = new Set([lotAt(a, lots), lotAt(b, lots)].filter(index => index >= 0));
  for (let n = 1; n < steps; n++) {
    const u = n / steps, x = a[0] + (b[0] - a[0]) * u, z = a[2] + (b[2] - a[2]) * u, y = a[1] + 1.4 + (b[1] - a[1]) * u, index = lotAt([x, y, z], lots);
    if (index >= 0 && !own.has(index) && (lots[index].floors ?? lots[index].height ?? 0) * FLOOR > y) return { lot: index };
  }
  return null;
}
function lotAt(p, lots) {
  const i = Math.floor(p[0] / CELL), j = Math.floor(p[2] / CELL);
  for (let k = 0; k < lots.length; k++) { const lot = lots[k]; if (i >= lot.i0 && i < lot.i0 + lot.nx && j >= lot.j0 && j < lot.j0 + lot.nz) return k; }
  return -1;
}

/** L21 over one blow: { law, verdict: 'ok' | 'held', why, limits }. A blow with no target point is not judged. */
export function attackCheck({ kind, from, to, limits, lots = [] }) {
  if (!from || !to) return null;
  const d = Math.round(Math.hypot(to[0] - from[0], to[2] - from[2], (to[1] - from[1]) * 0.5) * 10) / 10;
  if (!limits) return { law: 'L21', verdict: 'held', why: `a ${kind} attack the attacker has nothing to make (${d} m)` };
  if (kind === 'close') return d <= limits.reach + 0.5 ? { law: 'L21', verdict: 'ok', why: `close, ${d} m within a reach of ${limits.reach} m` } : { law: 'L21', verdict: 'held', why: `close, but ${d} m off (reach ${limits.reach} m)` };
  if (kind === 'line') {
    if (d > limits.range) return { law: 'L21', verdict: 'held', why: `a line ${d} m long, beyond its range of ${limits.range} m` };
    const wall = lineBlocked(from, to, lots);
    return wall ? { law: 'L21', verdict: 'held', why: `a line through a building (lot ${wall.lot}) at ${d} m` } : { law: 'L21', verdict: 'ok', why: `a clear line of ${d} m within ${limits.range} m` };
  }
  return d <= (limits.range ?? 0) + (limits.radius ?? 0) ? { law: 'L21', verdict: 'ok', why: `an explosion within ${limits.range} m, the target inside its ${limits.radius} m` } : { law: 'L21', verdict: 'held', why: `an explosion ${d} m off, beyond ${limits.range} m and its ${limits.radius} m` };
}
