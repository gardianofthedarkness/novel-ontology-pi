// Through the air (docs/v3/design.html#terrain-levels §6.2, §6.0): a flight, a leap or a climb up a wall that the walk graph has
// no way for, as points in metres. Before, each went in one straight line from where the person stood to the target,
// through whatever stood between (the director's journeys: tower to tower in scene 26, scenes 162 and 168's leaps). The
// page plays the points as straight segments at the move's own pace (strand-demo.html, a move's `air`).
// Pure: the director hands in the buildings round the way, each { x0, z0, x1, z1, top } in metres (its plan's bounds and
// its roof's height), and which of them the two ends stand in.

const inside = (lot, p, pad = 0) => p[0] >= lot.x0 - pad && p[0] <= lot.x1 + pad && p[2] >= lot.z0 - pad && p[2] <= lot.z1 + pad;
const flat = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);

/** The highest roof under the line from a to b (metres), the lots `skip` names left out; `ground` over open ground (the street's 0, a deep floor's own). */
export function clearance(a, b, lots, skip = new Set(), pad = 2, ground = 0) {
  const n = Math.max(1, Math.ceil(flat(a, b) / 2));
  let top = ground;
  for (let s = 0; s <= n; s++) {
    const t = s / n, p = [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t];
    for (const [index, lot] of lots.entries()) if (!skip.has(index) && lot.top > top && inside(lot, p, pad)) top = lot.top;
  }
  return top;
}

/**
 * Out of the building a point stands in, below its roof, toward another point: where that line leaves its plan, a metre
 * clear, at the point's own height (a window, not up through the floors above). On its roof or outside any: the point.
 */
export function wayOut(p, lot, toward) {
  if (!lot || !inside(lot, p) || p[1] >= lot.top - 0.5) return p;
  const d = flat(p, toward) || 1, ux = (toward[0] - p[0]) / d, uz = (toward[2] - p[2]) / d;
  const exits = [ux > 0 ? (lot.x1 - p[0]) / ux : ux < 0 ? (lot.x0 - p[0]) / ux : Infinity, uz > 0 ? (lot.z1 - p[2]) / uz : uz < 0 ? (lot.z0 - p[2]) / uz : Infinity];
  const t = Math.min(...exits) + 1;
  return Number.isFinite(t) ? [p[0] + ux * t, p[1], p[2] + uz * t] : p;
}

/**
 * The points of a move through the air from a to b ([x, y, z] metres). `lots`: the buildings round the way; `from`, `to`:
 * the index in `lots` of the one each end stands in (-1: none).
 *   flight  out (its window), up to `margin` over every roof under its line and over both ends, level across, down
 *           outside the far building and in (onto its roof: straight down onto it);
 *   leap    out, one arc over what lies between, its top clearing every roof under it by `margin`, in;
 *   climb   out, across to the far building's wall, up it to the far end's height, in (onto its roof).
 * Consecutive points are at most `step` metres apart along a leap's arc; a flight's legs are straight.
 * Under a ceiling (terrain-levels §8.3: the ground skin over a hall, the deep layer's hard ceiling; `ceiling` its underside,
 * metres), nothing goes higher than a body below it: a flight cruises there, a leap's arc tops out there. The path then says
 * so (`capped`).
 */
export function airPath(a, b, { lots = [], from = -1, to = -1, kind = 'flight', margin = 10, step = 8, ceiling = Infinity, body = 1.8 } = {}) {
  // Both ends in one building: no way through the air between them (its stairs and lifts are the walk's).
  if (from >= 0 && from === to) return [a, b];
  const start = from >= 0 ? lots[from] : null, end = to >= 0 ? lots[to] : null, skip = new Set([from, to].filter(index => index >= 0));
  // The ground between: the street's, or a floor below it both ends stand on (the deep layer's: §3.5).
  const ground = Math.min(0, a[1], b[1]), clear = (p, q) => clearance(p, q, lots, skip, 2, ground);
  const out = wayOut(a, start, b), into = wayOut(b, end, a), points = [a, out], cap = ceiling - body;
  let capped = false;
  if (kind === 'climb') {
    // The far wall where it faces the way they come, a metre out (for an end on the roof, just under its edge): across to
    // its foot at their own height, up it, in.
    const wall = end ? wayOut([b[0], Math.min(b[1], end.top - 1), b[2]], end, out) : b;
    points.push([wall[0], out[1], wall[2]], [wall[0], b[1], wall[2]], b);
  } else if (kind === 'leap') {
    // One arc: its middle as high as clears what lies under it, raised where a sample would still clip a roof.
    const ya = out[1], yb = into[1], under = clear(out, into), n = Math.max(2, Math.ceil(flat(out, into) / step));
    let h = Math.max(2, Math.max(under + margin, Math.max(ya, yb) + 2) - (ya + yb) / 2);
    const arc = () => Array.from({ length: n - 1 }, (_, s) => { const t = (s + 1) / n; return [out[0] + (into[0] - out[0]) * t, ya + (yb - ya) * t + 4 * h * t * (1 - t), out[2] + (into[2] - out[2]) * t]; });
    for (let tries = 0; tries < 6; tries++) {
      const low = arc().map((p, s) => { const t = (s + 1) / n, roof = clear(p, p); return roof + 1 > p[1] ? (roof + 1 - p[1]) / (4 * t * (1 - t)) : 0; });
      const more = Math.max(0, ...low);
      if (!more) break;
      h += more;
    }
    // Under a ceiling the arc is cut flat a body below it: up, along under the ceiling, down (lowering the whole arc would
    // bring its sides down through the roofs it clears).
    const shaped = arc().map(p => { if (p[1] <= cap) return p; capped = true; return [p[0], cap, p[2]]; });
    points.push(...shaped, into, b);
  } else {
    let cruise = Math.max(a[1], b[1], clear(out, into)) + margin;
    if (cruise > cap) { cruise = Math.max(a[1], b[1], cap); capped = true; }
    points.push([out[0], cruise, out[2]], [into[0], cruise, into[2]], into, b);
  }
  // Without the repeats (an end on its roof is its own way out).
  const path = points.filter((p, n) => n === 0 || Math.hypot(p[0] - points[n - 1][0], p[1] - points[n - 1][1], p[2] - points[n - 1][2]) > 0.5);
  return capped ? Object.assign(path, { capped: true }) : path;
}
