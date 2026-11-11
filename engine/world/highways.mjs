// A city's expressway (docs/v3/design.html#highway-research §3 and §7): which districts it links, where it runs, its ramps, and
// what it does to the ground under it. The terrain cast's transport step builds it once and keeps it in the terrain
// record (universe/terrain.json `highways`); a later build only adds what a new district needs (bounded repair: a kept
// line never moves, the research's measure showed a 20 m squeeze can flip a rebuilt route by 120 m).
//
// The order has no loop: the line reads the map (districts, their scenes, the neighbouring cities), the ground's roads
// and water, the named places' patches (whose lots it never takes) and the patches' height targets (the price of land).
// It never reads a building. The buildings then read the line (`groundEffect`): those under a deck or a ramp are not
// built, and the rest stand taller the nearer a ramp, the city's floor area kept (manifold unification).
//
// Pure: plain arrays in (world metres), a record out. Steps:
//   hubs and masses -> links (cost-benefit growth, then loops by detour) -> each link's line (least cost over an 8 m grid
//   of 48 headings, every step costed on the 2 m ground, turns paid for by the step's length at the design radius, a
//   tunnel where named ground walls the way) -> junctions and ramps.

import { setting } from '../../dist/src/world/settings.js';
export const HIGHWAY_VERSION = 1;
export const KNOBS = setting('highway.knobs');
// Per metre: building it (by what lies under it) plus the travel on it, so a detour costs even where building is cheap;
// riding an earlier line costs only the travel (path merging). A tunnel costs 15 a metre and a portal at each end.
const COSTS = setting('highway.cost'), COST = { ...COSTS, lot: (H) => COSTS.lot.base + COSTS.lot.steep * Math.sqrt(Math.min(1, H / COSTS.lot.height)) };
const LEVEL = { local: 1, collector: 2, arterial: 3, boulevard: 3, avenue: 3 };
const round1 = (v) => Math.round(v * 10) / 10;

const inPoly = (pts, x, z) => { let inside = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const [xa, za] = pts[a], [xb, zb] = pts[b]; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside; } return inside; };
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; return Math.hypot(x - ax - t * dx, z - az - t * dz); };
export const lengthOf = (pts) => pts.slice(1).reduce((s, p, n) => s + Math.hypot(p[0] - pts[n][0], p[1] - pts[n][1]), 0);
const chaikin = (pts, rounds = 2) => { let p = pts; for (let r = 0; r < rounds; r++) { const q = [p[0]]; for (let n = 0; n < p.length - 1; n++) { const [a, b] = [p[n], p[n + 1]]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } q.push(p.at(-1)); p = q; } return p; };
export const resample = (pts, step) => { if (pts.length < 2) return pts.map((p) => [...p]); const out = [[...pts[0]]]; let carry = 0; for (let n = 1; n < pts.length; n++) { const [a, b] = [pts[n - 1], pts[n]], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = step - carry; while (t <= L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; } carry = L - (t - step); } if (Math.hypot(out.at(-1)[0] - pts.at(-1)[0], out.at(-1)[1] - pts.at(-1)[1]) > 0.5) out.push([...pts.at(-1)]); return out; };

/**
 * The ground as the line sees it, in the city's own frame (its centre at 0, 0): a 2 m mask of what lies there (0 a lot,
 * 1 a local road, 2 a collector, 3 an arterial, 4 water, 9 a named place's lot), the patches' height target on an 8 m
 * grid, and the cost of the line's centre at any point.
 */
function groundOf({ city, ground, knobs }) {
  const RC = city.r, local = ([x, z]) => [x - city.x, z - city.z];
  const M = 2, EXT = RC + 60, N2 = Math.ceil((2 * EXT) / M), mask = new Uint8Array(N2 * N2);
  const m2 = (x, z) => { const i = Math.floor((x + EXT) / M), j = Math.floor((z + EXT) / M); return i < 0 || j < 0 || i >= N2 || j >= N2 ? -1 : j * N2 + i; };
  const patches = (ground.patches ?? []).map((patch) => ({ ...patch, centre: local(patch.centre), outline: patch.outline.map(local) }));
  const named = new Set(ground.named ?? []);
  for (const patch of patches.filter((p) => named.has(p.id))) {
    const r = patch.radius + 4, [px, pz] = patch.centre;
    for (let z = pz - r; z <= pz + r; z += M) for (let x = px - r; x <= px + r; x += M) { const k = m2(x, z); if (k >= 0 && inPoly(patch.outline, x, z)) mask[k] = 9; }
  }
  const paint = (a, b, width, code) => {
    const [ax, az] = local(a), [bx, bz] = local(b), h = width / 2;
    for (let z = Math.min(az, bz) - h; z <= Math.max(az, bz) + h; z += M) for (let x = Math.min(ax, bx) - h; x <= Math.max(ax, bx) + h; x += M) {
      const k = m2(x, z); if (k >= 0 && segDist(x, z, ax, az, bx, bz) <= h && (mask[k] === 0 || mask[k] === 9 || mask[k] < code)) mask[k] = code;
    }
  };
  for (const [ax, az, bx, bz, width, level] of ground.roads ?? []) paint([ax, az], [bx, bz], width, LEVEL[level] ?? 1);
  for (const [ax, az, bx, bz, width] of ground.waters ?? []) paint([ax, az], [bx, bz], width, 4);
  const heightAt = (x, z) => { let H = 0; for (const patch of patches) if (Math.hypot(x - patch.centre[0], z - patch.centre[1]) <= patch.radius + 2 && inPoly(patch.outline, x, z)) H = Math.max(H, patch.height); return H || 22; };
  const G = 8, NG = Math.ceil((2 * EXT) / G), cells = NG * NG, Hgrid = new Float32Array(cells);
  const gx = (i) => -EXT + (i + 0.5) * G;
  const cellOf = (x, z) => { const i = Math.floor((x + EXT) / G), j = Math.floor((z + EXT) / G); return i < 0 || j < 0 || i >= NG || j >= NG ? -1 : j * NG + i; };
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) Hgrid[j * NG + i] = Math.hypot(gx(i), gx(j)) > RC ? 0 : heightAt(gx(i), gx(j));
  const laid = new Uint8Array(N2 * N2);
  const groundCost = (x, z) => {
    if (Math.hypot(x, z) > RC) return COST.outside;
    const k = m2(x, z), v = k < 0 ? 0 : mask[k];
    return v === 9 ? COST.protected : v === 4 ? COST.water : v === 3 ? COST.arterial : v === 2 ? COST.collector : v === 1 ? COST.local : COST.lot(Hgrid[cellOf(x, z)] || 22);
  };
  const costAt = (x, z) => { const k = m2(x, z); return k < 0 ? 50 : laid[k] ? COST.travel : groundCost(x, z) + COST.travel; };
  const base = new Float32Array(cells); for (let c = 0; c < cells; c++) base[c] = groundCost(gx(c % NG), gx(Math.floor(c / NG))) + COST.travel;
  const lay = (pts) => { for (const [x, z] of pts) for (let dz = -4; dz <= 4; dz += M) for (let dx = -4; dx <= 4; dx += M) { const k = m2(x + dx, z + dz); if (k >= 0) laid[k] = 1; } };
  const disc = []; for (let dz = -knobs.deckHalf; dz <= knobs.deckHalf; dz += M) for (let dx = -knobs.deckHalf; dx <= knobs.deckHalf; dx += M) if (Math.hypot(dx, dz) <= knobs.deckHalf) disc.push([dx, dz]);
  const footprint = (x, z, half) => { const tally = { road: 0, water: 0, lot: 0, named: 0 }; for (const [dx, dz] of disc) { if (Math.hypot(dx, dz) > half) continue; const k = m2(x + dx, z + dz), v = k < 0 ? 0 : mask[k]; if (v === 9) tally.named++; else if (v === 4) tally.water++; else if (v) tally.road++; else tally.lot++; } return tally; };
  return { RC, local, mask, m2, G, NG, cells, gx, cellOf, Hgrid, base, costAt, lay, footprint };
}

/** The 48 headings of Galin's large masks (every primitive step of up to 4 cells), and which turns each step allows. */
function headings(G, radius) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a)), DIRS = [];
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if ((dx || dz) && gcd(Math.abs(dx), Math.abs(dz)) === 1) DIRS.push([dx, dz]);
  DIRS.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  const ANG = DIRS.map(([dx, dz]) => Math.atan2(dz, dx)), LEN = DIRS.map(([dx, dz]) => Math.hypot(dx, dz) * G);
  const turnOf = (a, b) => { let d = ANG[b] - ANG[a]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
  return { DIRS, LEN, NEXT: DIRS.map((_, k) => DIRS.map((__, k2) => k2).filter((k2) => turnOf(k, k2) <= LEN[k2] / radius + 1e-9)) };
}

/** The least-cost line from one point to another (city frame), on the surface or in a tunnel: { pts, under } or null. */
function align(g, H, from, to) {
  const { cells, NG, gx, cellOf, base, costAt } = g, { DIRS, LEN, NEXT } = H, ND = DIRS.length;
  const start = cellOf(...from), goal = cellOf(...to), S = cells * ND * 2, id = (c, k, l) => (c * ND + k) * 2 + l;
  if (start < 0 || goal < 0) return null;
  const lineCost = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 2)); let s = 0; for (let t = 0; t < n; t++) { const f = (t + 0.5) / n; s += costAt(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f); } return (s / n) * L; };
  const step = new Float32Array(cells * ND).fill(Infinity);
  for (let c = 0; c < cells; c++) { const i = c % NG, j = Math.floor(c / NG); for (let k = 0; k < ND; k++) { const i2 = i + DIRS[k][0], j2 = j + DIRS[k][1]; if (i2 >= 0 && j2 >= 0 && i2 < NG && j2 < NG) step[c * ND + k] = lineCost(gx(i), gx(j), gx(i2), gx(j2)); } }
  const gs = new Float64Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1), shut = new Uint8Array(S);
  let hk = new Float64Array(1 << 16), hv = new Int32Array(1 << 16), hn = 0;
  const push = (f, v) => { if (hn === hk.length) { const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; } let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= f) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = f; hv[i] = v; };
  const pop = () => { const v = hv[0], lk = hk[--hn], lv = hv[hn]; let i = 0; for (;;) { const l = 2 * i + 1; if (l >= hn) break; const m = l + 1 < hn && hk[l + 1] < hk[l] ? l + 1 : l; if (hk[m] >= lk) break; hk[i] = hk[m]; hv[i] = hv[m]; i = m; } hk[i] = lk; hv[i] = lv; return v; };
  const tx = gx(goal % NG), tz = gx(Math.floor(goal / NG)), h = (c) => Math.hypot(gx(c % NG) - tx, gx(Math.floor(c / NG)) - tz) * COST.travel;
  for (let k = 0; k < ND; k++) { gs[id(start, k, 0)] = 0; push(h(start), id(start, k, 0)); }
  let end = -1;
  while (hn) {
    const s = pop(); if (shut[s]) continue; shut[s] = 1;
    const l = s % 2, k = Math.floor(s / 2) % ND, c = Math.floor(s / 2 / ND);
    if (c === goal && l === 0) { end = s; break; }
    const relax = (s2, v, c2) => { if (v < gs[s2]) { gs[s2] = v; prev[s2] = s; push(v + h(c2), s2); } };
    if (base[c] < 50) relax(id(c, k, 1 - l), gs[s] + COST.portal + 20 * base[c], c); // a portal: down or up
    const i = c % NG, j = Math.floor(c / NG);
    for (const k2 of NEXT[k]) {
      const w = l === 0 ? step[c * ND + k2] : LEN[k2] * (COST.tunnel + COST.travel); if (w === Infinity) continue;
      const i2 = i + DIRS[k2][0], j2 = j + DIRS[k2][1]; if (i2 < 0 || j2 < 0 || i2 >= NG || j2 >= NG) continue;
      const c2 = j2 * NG + i2; relax(id(c2, k2, l), gs[s] + w, c2);
    }
  }
  if (end < 0) return null;
  const chain = []; for (let s = end; s >= 0; s = prev[s]) chain.push(s); chain.reverse();
  const pts = [], under = [];
  for (const s of chain) { const c = Math.floor(s / 2 / ND), l = s % 2, p = [gx(c % NG), gx(Math.floor(c / NG))]; if (pts.length && pts.at(-1)[0] === p[0] && pts.at(-1)[1] === p[1]) { under[under.length - 1] = under.at(-1) || l; continue; } pts.push(p); under.push(l); }
  return { pts, under, cost: gs[end] };
}

/**
 * A city's expressway.
 *   city      { id, x, z, r } (world metres)
 *   districts [{ id, x, z, r, scenes }] the city's districts in the order the map gave them their places
 *   gates     [{ id, x, z, scenes, toward }] a point on the city's edge toward each other city or region of the map
 *   ground    { roads: [[ax, az, bx, bz, width, level]], waters: [[ax, az, bx, bz, width]], patches: [{ id, centre, radius,
 *             height, outline }], named: [patch ids whose lots are never taken] }
 *   keep      the record a build made before (bounded repair: its lines and ramps stay; new districts may add links)
 * Returns the record kept in the terrain (world metres).
 */
export function planHighway({ city, districts, gates = [], ground, keep = null, knobs: given = {}, at = null }) {
  const knobs = { ...KNOBS, ...given };
  if (keep && keep.version === HIGHWAY_VERSION && keep.city?.id === city.id) {
    const known = new Set(keep.hubs.map((hub) => hub.id)), fresh = [...districts, ...gates].filter((hub) => !known.has(hub.id));
    if (!fresh.length) return keep;
  }
  const g = groundOf({ city, ground, knobs }), H = headings(g.G, knobs.radius), { RC, local } = g;
  const world = ([x, z]) => [round1(x + city.x), round1(z + city.z)];
  // Hubs and masses: a district's mass its ground (the patches' height targets over its circle) and its scenes; a gate's
  // its scenes, at least a city's ordinary through traffic.
  const groundMass = (d) => { const [dx, dz] = local([d.x, d.z]); let s = 0; for (let j = 0; j < g.NG; j++) for (let i = 0; i < g.NG; i++) { const x = g.gx(i), z = g.gx(j); if (Math.hypot(x - dx, z - dz) <= d.r && Math.hypot(x, z) <= RC) s += g.Hgrid[j * g.NG + i]; } return s; };
  const groundAll = districts.map(groundMass), groundSum = groundAll.reduce((a, b) => a + b, 0) || 1, storySum = districts.reduce((s, d) => s + (d.scenes ?? 0), 0) || 1;
  const hubs = [
    ...districts.map((d, n) => ({ id: d.id, kind: 'district', label: `district ${n + 1}`, at: local([d.x, d.z]), r: d.r, scenes: d.scenes ?? 0, mass: (1 - knobs.storyShare) * groundAll[n] / groundSum + knobs.storyShare * (d.scenes ?? 0) / storySum })),
    ...gates.map((gate) => ({ id: gate.id, kind: 'gate', label: 'gate', toward: gate.toward ?? [], at: local([gate.x, gate.z]), r: 0, scenes: gate.scenes ?? 0, mass: Math.max(knobs.gateFloor, knobs.storyShare * (gate.scenes ?? 0) / storySum) })),
  ];
  // Where a hub's line stops: the cheapest point near its middle (a district's middle is where the story's named places
  // crowd), within 0.6 of its radius (at most 250 m), cost plus 1 per 100 m out.
  for (const hub of hubs) {
    const kept = keep?.hubs.find((entry) => entry.id === hub.id);
    if (kept) { hub.point = local(kept.point); continue; }
    let best = null; const reach = hub.kind === 'gate' ? 80 : Math.min(250, 0.6 * hub.r);
    for (let dz = -reach; dz <= reach; dz += g.G) for (let dx = -reach; dx <= reach; dx += g.G) { const x = hub.at[0] + dx, z = hub.at[1] + dz, c = g.cellOf(x, z); if (c < 0 || Math.hypot(dx, dz) > reach || Math.hypot(x, z) > RC - 8) continue; const score = g.base[c] + Math.hypot(dx, dz) / 100; if (!best || score < best.score) best = { score, x, z }; }
    hub.point = best ? [best.x, best.z] : hub.at;
  }
  const index = new Map(hubs.map((hub, n) => [hub.id, n]));
  const dist = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]), T = (a, b) => (a.mass * b.mass) / Math.max(1, dist(a, b)) ** 2;
  const pairs = []; for (let a = 0; a < hubs.length; a++) for (let b = a + 1; b < hubs.length; b++) pairs.push([a, b]);
  const betaStar = pairs.length ? pairs.reduce((s, [a, b]) => s + T(hubs[a], hubs[b]), 0) / pairs.length : 0, beta = knobs.betaRatio * betaStar;
  // Links: kept ones first; each hub not yet on the line joins the existing hub worth most to it (R' = Mi Mj / d - beta d),
  // if that pays; then loops where they save the most gravity-weighted detour per metre, while that beats beta.
  const links = (keep?.links ?? []).map((link) => ({ a: index.get(link.a), b: index.get(link.b), why: link.why, kept: true })).filter((link) => link.a !== undefined && link.b !== undefined);
  const on = new Set(links.flatMap((link) => [link.a, link.b])), left = [];
  if (!on.size && hubs.length) on.add(0);
  for (let n = 0; n < hubs.length; n++) {
    if (on.has(n)) continue;
    let best = null;
    for (const j of on) { const value = (hubs[n].mass * hubs[j].mass) / dist(hubs[n], hubs[j]) - beta * dist(hubs[n], hubs[j]); if (!best || value > best.value) best = { j, value }; }
    if (best && best.value > 0) { links.push({ a: best.j, b: n, why: 'tree' }); on.add(n); } else left.push(hubs[n].id);
  }
  const netDist = (withLinks) => {
    const D = hubs.map((_, a) => hubs.map((__, b) => (a === b ? 0 : Infinity)));
    for (const { a, b } of withLinks) D[a][b] = D[b][a] = Math.min(D[a][b], dist(hubs[a], hubs[b]));
    for (let k = 0; k < hubs.length; k++) for (let a = 0; a < hubs.length; a++) for (let b = 0; b < hubs.length; b++) if (D[a][k] + D[k][b] < D[a][b]) D[a][b] = D[a][k] + D[k][b];
    return D;
  };
  const crosses = ([p, q], [r, s]) => { const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0; };
  const freshIds = new Set(hubs.filter((hub) => !keep?.hubs.some((entry) => entry.id === hub.id)).map((hub) => index.get(hub.id)));
  for (;;) {
    const D = netDist(links); let best = null;
    for (const [a, b] of pairs) {
      if (keep && !freshIds.has(a) && !freshIds.has(b)) continue; // a kept city's loops are kept as they were
      if (!on.has(a) || !on.has(b) || links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) continue;
      if (links.some((l) => crosses([hubs[a].at, hubs[b].at], [hubs[l.a].at, hubs[l.b].at]))) continue;
      if (hubs.some((h, k) => k !== a && k !== b && dist(h, hubs[a]) ** 2 + dist(h, hubs[b]) ** 2 < dist(hubs[a], hubs[b]) ** 2)) continue;
      const D2 = netDist([...links, { a, b }]); let saved = 0;
      for (const [k, l] of pairs) if (on.has(k) && on.has(l)) saved += T(hubs[k], hubs[l]) * (D[k][l] - D2[k][l]);
      const gain = saved / dist(hubs[a], hubs[b]);
      if (!best || gain > best.gain) best = { a, b, gain };
    }
    if (!best || best.gain <= beta) break;
    links.push({ a: best.a, b: best.b, why: 'loop' });
  }
  // Lines: kept ones as they were (and laid, so a new line merges onto them); new ones by least cost, heaviest first.
  const lines = [];
  for (const line of keep?.lines ?? []) { const pts = line.pts.map(local); lines.push({ ...line, pts }); g.lay(pts); }
  const fresh = links.filter((link) => !link.kept).map((link) => ({ ...link, flow: T(hubs[link.a], hubs[link.b]) })).sort((a, b) => b.flow - a.flow);
  for (const link of fresh) {
    const path = align(g, H, hubs[link.a].point, hubs[link.b].point);
    if (!path) { lines.push({ a: hubs[link.a].id, b: hubs[link.b].id, why: link.why, failed: true, pts: [], tunnel: [], shared: [] }); continue; }
    const pts = resample(chaikin(path.pts, 2), 4);
    const tunnel = pts.map(([x, z]) => { let best = 0, d = Infinity; path.pts.forEach(([u, w], n) => { const e = Math.hypot(u - x, w - z); if (e < d) { d = e; best = n; } }); return path.under[best] === 1 ? 1 : 0; });
    const raw = pts.map(([x, z]) => lines.some((line) => !line.failed && line.pts.some(([u, w]) => Math.hypot(u - x, w - z) < 9)));
    const shared = [...raw]; for (let n = 0; n < raw.length;) { let m = n; while (m < raw.length && raw[m] === raw[n]) m++; if (m - n < 6 && n > 0 && m < raw.length) for (let q = n; q < m; q++) shared[q] = raw[n - 1]; n = m; }
    lines.push({ a: hubs[link.a].id, b: hubs[link.b].id, why: link.why, pts, tunnel, shared: shared.map(Number) });
    g.lay(pts);
  }
  // Junctions (where a line joins or leaves an earlier one) and the pieces to draw, each once.
  const ok = lines.filter((line) => !line.failed), junctions = [], decks = [], tunnels = [];
  for (const line of ok) for (let n = 1; n < line.pts.length; n++) if (line.shared[n] !== line.shared[n - 1]) junctions.push(line.shared[n] ? line.pts[n] : line.pts[n - 1]);
  for (const line of ok) { let cur = [], under = null; const flush = () => { if (cur.length > 1) (under ? tunnels : decks).push(cur); cur = []; }; line.pts.forEach((p, n) => { if (line.shared[n]) { flush(); under = null; return; } if (under !== null && line.tunnel[n] !== under) { cur.push(p); flush(); } under = line.tunnel[n]; cur.push(p); }); flush(); }
  // Ramps: kept ones stay; each district with none gets one where its line passes nearest its middle over roads, its legs
  // off named ground, away from junctions and other ramps; heaviest district first.
  const ramps = (keep?.ramps ?? []).map((ramp) => ({ ...ramp, at: local(ramp.at), legs: ramp.legs.map((leg) => leg.map(([x, z, y]) => [...local([x, z]), y])) }));
  const publicShare = (pts) => { let s = 0; for (const [x, z] of pts) { const t = g.footprint(x, z, knobs.deckHalf); s += (t.road + t.water) / Math.max(1, t.road + t.water + t.lot + t.named); } return s / Math.max(1, pts.length); };
  const sites = [];
  for (const line of ok) {
    const flips = line.shared.flatMap((v, n) => (n && v !== line.shared[n - 1] ? [n] : []));
    for (let n = 0; n < line.pts.length; n += 2) if (Math.min(Infinity, ...flips.map((f) => Math.abs(f - n) * 4)) >= 60) sites.push({ line, n, under: line.tunnel[n] });
  }
  for (const hub of hubs.filter((h) => h.kind === 'district' && !ramps.some((ramp) => ramp.hub === h.id)).sort((a, b) => b.mass - a.mass)) {
    let best = null;
    for (const { line, n, under } of sites) {
      const [x, z] = line.pts[n], d = Math.hypot(x - hub.at[0], z - hub.at[1]);
      if (d > Math.min(450, hub.r) || ramps.some((r) => Math.hypot(r.at[0] - x, r.at[1] - z) < knobs.rampSpacing)) continue;
      if (junctions.some(([u, w]) => Math.hypot(u - x, w - z) < 60)) continue;
      const share = publicShare(line.pts.slice(Math.max(0, n - 30), n + 31));
      const [px, pz] = line.pts[Math.max(0, n - 2)], [qx, qz] = line.pts[Math.min(line.pts.length - 1, n + 2)], tl = Math.hypot(qx - px, qz - pz) || 1, tt = [(qx - px) / tl, (qz - pz) / tl];
      let legNamed = 0, legLot = 0;
      for (const sign of [1, -1]) for (const dir of [1, -1]) for (let u = 0; u <= knobs.ramp; u += 6) { const k = g.m2(x + tt[0] * u * dir - tt[1] * knobs.rampOffset * sign, z + tt[1] * u * dir + tt[0] * knobs.rampOffset * sign), v = k < 0 ? 0 : g.mask[k]; if (v === 9) legNamed++; else if (v === 0) legLot++; }
      const score = d / 400 + (1 - share) * 2 + legNamed * 0.2 + legLot * 0.02;
      if (!best || score < best.score) best = { score, line, n, share, d, under };
    }
    if (!best) continue;
    const { line, n } = best, [x, z] = line.pts[n];
    // Four legs, each beside the line and following its curve, an off and an on for each direction: the street at the
    // ramp's foot (its `at`, the line's point there) up (the deck) or down (the tunnel) to the line's level a ramp's length
    // along it, either way. `sign` the side (1: the side on the left of the line's own direction), `dir` the way along.
    const level = best.under ? -knobs.tunnelDepth : knobs.deckHeight, steps = Math.round(knobs.ramp / 4);
    const normalAt = (k) => { const [ax, az] = line.pts[Math.max(0, k - 2)], [bx, bz] = line.pts[Math.min(line.pts.length - 1, k + 2)], L = Math.hypot(bx - ax, bz - az) || 1; return [-(bz - az) / L, (bx - ax) / L]; };
    const leg = (sign, dir) => { const pts = []; for (let s = 0; s <= steps; s += 1) { const k = Math.max(0, Math.min(line.pts.length - 1, n + dir * s)), [px, pz] = line.pts[k], nn = normalAt(k), f = s / steps; pts.push([px + nn[0] * knobs.rampOffset * sign, pz + nn[1] * knobs.rampOffset * sign, round1(level * f)]); } return pts; };
    ramps.push({ hub: hub.id, label: hub.label, at: [x, z], under: !!best.under, legs: [leg(1, 1), leg(-1, 1), leg(1, -1), leg(-1, -1)] });
  }
  const over = { road: 0, water: 0, lot: 0, named: 0 }; let samples = 0;
  for (const piece of decks) for (const [x, z] of piece) { const tl = g.footprint(x, z, knobs.deckHalf), n = tl.road + tl.water + tl.lot + tl.named || 1; for (const key of Object.keys(over)) over[key] += tl[key] / n; samples++; }
  return {
    version: HIGHWAY_VERSION, city: { id: city.id, x: city.x, z: city.z, r: city.r }, built: keep?.built ?? at ?? null, ...(keep ? { repaired: at } : {}),
    knobs: { radius: knobs.radius, deckHeight: knobs.deckHeight, tunnelDepth: knobs.tunnelDepth, ramp: knobs.ramp, pull: knobs.pull, reach: knobs.reach },
    hubs: hubs.map((hub) => ({ id: hub.id, kind: hub.kind, label: hub.label, at: world(hub.at), point: world(hub.point), r: Math.round(hub.r), scenes: hub.scenes, mass: Math.round(hub.mass * 1000) / 1000 })),
    links: links.map((link) => ({ a: hubs[link.a].id, b: hubs[link.b].id, why: link.why })), notLinked: left,
    lines: lines.map((line) => ({ a: line.a, b: line.b, why: line.why, ...(line.failed ? { failed: true } : {}), pts: line.pts.map(world), tunnel: line.tunnel, shared: line.shared })),
    decks: decks.map((piece) => piece.map(world)), tunnels: tunnels.map((piece) => piece.map(world)), junctions: junctions.map(world),
    ramps: ramps.map((ramp) => ({ hub: ramp.hub, label: ramp.label, at: world(ramp.at), under: ramp.under, legs: ramp.legs.map((leg) => leg.map(([x, z, y]) => [...world([x, z]), y])) })),
    report: { deckKm: Math.round(decks.reduce((s, p) => s + lengthOf(p), 0) / 10) / 100, tunnelKm: Math.round(tunnels.reduce((s, p) => s + lengthOf(p), 0) / 10) / 100, footprint: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, Math.round((100 * v) / Math.max(1, samples))])) },
  };
}

/**
 * What the line does to the buildings planned round it (one way: the buildings read the line, never the other way).
 * `buildings` [{ x, z, w, d, angle, floors, fixed }] (world metres; `fixed` the text's own: they keep their floors).
 * Returns, for each, whether a deck or a ramp stands on it (`taken`: it is not built) and its floors: × (1 + pull ×
 * e^(-distance to the nearest ramp / reach)), the whole set then scaled so its floor area stays what it was (manifold
 * unification: a district's average kept; the text's buildings add, as nominated ones do).
 */
export function groundEffect(highway, buildings, { pull = highway?.knobs?.pull ?? KNOBS.pull, reach = highway?.knobs?.reach ?? KNOBS.reach } = {}) {
  if (!highway) return buildings.map((b) => ({ taken: null, floors: b.floors }));
  const pieces = [...(highway.decks ?? []).map((pts) => ({ pts, half: KNOBS.deckHalf + 1 })), ...(highway.ramps ?? []).filter((ramp) => !ramp.under).flatMap((ramp) => ramp.legs.map((leg) => ({ pts: leg, half: KNOBS.rampHalf + 1, ramp: true })))];
  const boxes = pieces.map(({ pts, half }) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0 - half - 40, z0 - half - 40, x1 + half + 40, z1 + half + 40]; });
  const corners = ({ x, z, w, d, angle }) => { const c = Math.cos(angle), s = Math.sin(angle), out = [[x, z]]; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]) out.push([x + (u * w / 2) * c - (v * d / 2) * s, z + (u * w / 2) * s + (v * d / 2) * c]); return out; };
  const feet = (highway.ramps ?? []).map((ramp) => ramp.at);
  const out = buildings.map((b) => {
    let taken = null;
    pieces.forEach((piece, n) => { if (taken) return; const [x0, z0, x1, z1] = boxes[n]; if (b.x < x0 || b.x > x1 || b.z < z0 || b.z > z1) return; const pts = corners(b); if (pts.some(([px, pz]) => piece.pts.some(([u, w]) => Math.hypot(u - px, w - pz) <= piece.half))) taken = piece.ramp ? 'ramp' : 'deck'; });
    const near = feet.length ? Math.min(...feet.map(([u, w]) => Math.hypot(u - b.x, w - b.z))) : Infinity;
    return { taken, near, raw: b.fixed || taken ? b.floors : b.floors * (1 + pull * Math.exp(-near / reach)) };
  });
  let before = 0, after = 0;
  buildings.forEach((b, n) => { if (!out[n].taken && !b.fixed) { before += b.w * b.d * b.floors; after += b.w * b.d * out[n].raw; } });
  const scale = after > 0 ? before / after : 1;
  return out.map((entry, n) => ({ taken: entry.taken, near: Math.round(entry.near), floors: buildings[n].fixed || entry.taken ? buildings[n].floors : Math.max(1, Math.round(entry.raw * scale)) }));
}
