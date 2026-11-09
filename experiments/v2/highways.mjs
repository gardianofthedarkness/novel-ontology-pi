// A first try of the highway proposal (docs/v2/highway-research.md §3) on one city of a built page, and of the one-way
// effect of its ramps on the buildings (the user, 2026-11-08: "Let's try it out").
//
// The order has no loop: the highway reads the map (districts, their scenes, neighbouring cities), the ground's roads
// and waters, the named patches (whose lots it never takes) and the patches' height targets (the price of land). It
// never reads a building. The buildings then read the highway: those under the deck or a ramp are taken, and the rest
// grow taller the nearer a ramp they stand (accessibility, A = exp(-d / reach)).
//
//   node experiments/v2/highways.mjs <page.json> <out.json> [city id = loc_000001]
//
// Steps: hubs and masses -> links (cost-benefit growth, then loops by detour) -> each link's alignment (least cost over
// an 8 m grid with 16 headings and a minimum radius, so curvature is in the action) -> junctions and ramps -> the
// buildings taken and raised -> numbers for the report and the page.
import { readFileSync, writeFileSync } from 'node:fs';

const [pageFile, outFile, cityId = 'loc_000001'] = process.argv.slice(2);
const page = JSON.parse(readFileSync(pageFile, 'utf8'));
const node = new Map(page.macro.map((entry) => [entry.id, entry]));
const city = node.get(cityId), land = page.landscapes.find((entry) => entry.place === cityId);
if (!city || !land) throw new Error(`no city ${cityId} with a landscape on this page`);
const [CX, CZ] = [city.x, city.z], RC = city.r;
const local = ([x, z]) => [x - CX, z - CZ];

// The knobs, each from the research doc.
const K = {
  radius: 80,       // 50 km/h where unavoidable (Road Structure Ordinance art. 15: 100 m, 80 m where unavoidable)
  deckHalf: 8.5,    // two lanes each way, about 17 m
  deckHeight: 10,
  ramp: 120,        // 10 m at 8.3% (a 30 km/h ramp: 9% desirable most)
  rampHalf: 3.5, rampOffset: 12,
  rampSpacing: 400,
  betaRatio: 0.5,   // beta / beta*: the middle of real railways' 0.20-1.56 (Louf, Jensen, Barthelemy 2013)
  storyShare: 0.4,  // a hub's mass: 0.6 its ground (patch height over its area) + 0.4 its scenes
  gateFloor: 0.08,  // a gate's least mass: a city's ordinary through traffic
  strength: 0.6, reach: 250, // the ramps' pull on buildings (page sliders start here)
};
// Per metre of deck: building it (by what lies under it) plus the travel on it (users' time, the same everywhere), so a
// detour costs even where building is cheap. Riding an earlier deck costs only the travel (Galin 2011's path merging).
const COST = { lot: (H) => 1 + 5 * Math.sqrt(Math.min(1, H / 150)), protected: 400, arterial: 0.3, collector: 0.6, local: 1.5, water: 0.35, outside: 1.2, travel: 2, tunnel: 15, portal: 400 };
// A tunnel (the shallow layer): 15 per metre, whatever is above, and a portal at each end (400 plus 20 x the ground's
// cost where it opens, never in a named place's lot): where the core's named places wall it in, the line goes under.

// ---- The ground on a 2 m mask: 0 lot, 1 local, 2 collector, 3 arterial, 4 water, 9 a named patch's lot.
const M = 2, EXT = RC + 60, N2 = Math.ceil((2 * EXT) / M);
const mask = new Uint8Array(N2 * N2);
const m2 = (x, z) => { const i = Math.floor((x + EXT) / M), j = Math.floor((z + EXT) / M); return i < 0 || j < 0 || i >= N2 || j >= N2 ? -1 : j * N2 + i; };
const inPoly = (pts, x, z) => { let inside = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const [xa, za] = pts[a], [xb, zb] = pts[b]; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside; } return inside; };
const patches = land.patches.map((patch) => ({ ...patch, centre: local(patch.centre), outline: patch.outline.map(local) }));
const districts = new Set(page.macro.filter((entry) => entry.scale === 'district').map((entry) => entry.id));
// A street-scale patch that is not a district is a named place's ground: its roads may carry a deck, its lots are never taken.
const named = patches.filter((patch) => patch.id !== 'p0' && !districts.has(patch.id) && patch.radius <= 150);
for (const patch of named) {
  const r = patch.radius + 4, [px, pz] = patch.centre;
  for (let z = pz - r; z <= pz + r; z += M) for (let x = px - r; x <= px + r; x += M) { const k = m2(x, z); if (k >= 0 && inPoly(patch.outline, x, z)) mask[k] = 9; }
}
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; return Math.hypot(x - ax - t * dx, z - az - t * dz); };
const paint = (a, b, width, code) => {
  const [ax, az] = local(a), [bx, bz] = local(b), h = width / 2;
  for (let z = Math.min(az, bz) - h; z <= Math.max(az, bz) + h; z += M) for (let x = Math.min(ax, bx) - h; x <= Math.max(ax, bx) + h; x += M) {
    const k = m2(x, z); if (k >= 0 && segDist(x, z, ax, az, bx, bz) <= h && (mask[k] === 0 || mask[k] === 9 || mask[k] < code)) mask[k] = code;
  }
};
const LEVEL = { local: 1, collector: 2, arterial: 3, boulevard: 3, avenue: 3 };
for (const [ax, az, bx, bz, width, level] of land.roads) paint([ax, az], [bx, bz], width, LEVEL[level] ?? 1);
for (const [ax, az, bx, bz, width] of land.waters) paint([ax, az], [bx, bz], width, 4);

// ---- The price of land: the highest height target of the patches over a point (what the buildings are made from).
const heightAt = (x, z) => { let H = 0; for (const patch of patches) if (Math.hypot(x - patch.centre[0], z - patch.centre[1]) <= patch.radius + 2 && inPoly(patch.outline, x, z)) H = Math.max(H, patch.height); return H || 22; };

// ---- The cost per metre of the deck's centre line, read off the 2 m ground: over a road (whose width carries the deck,
// its piers in the middle), over water, over a lot (its price), never a named place's lot; plus the travel. The search
// runs on an 8 m grid of 48 headings but every step is costed on the 2 m ground, so the line can keep to an 18 m road.
const G = 8, NG = Math.ceil((2 * EXT) / G), cells = NG * NG;
const Hgrid = new Float32Array(cells);
const disc = []; for (let dz = -K.deckHalf; dz <= K.deckHalf; dz += M) for (let dx = -K.deckHalf; dx <= K.deckHalf; dx += M) if (Math.hypot(dx, dz) <= K.deckHalf) disc.push([dx, dz]);
const gx = (i) => -EXT + (i + 0.5) * G;
const cellOf = (x, z) => { const i = Math.floor((x + EXT) / G), j = Math.floor((z + EXT) / G); return i < 0 || j < 0 || i >= NG || j >= NG ? -1 : j * NG + i; };
for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) Hgrid[j * NG + i] = Math.hypot(gx(i), gx(j)) > RC ? 0 : heightAt(gx(i), gx(j));
const laid = new Uint8Array(N2 * N2); // where an earlier deck runs: riding it costs only the travel (path merging)
const groundCost = (x, z) => {
  if (Math.hypot(x, z) > RC) return COST.outside;
  const k = m2(x, z), v = k < 0 ? 0 : mask[k];
  return v === 9 ? COST.protected : v === 4 ? COST.water : v === 3 ? COST.arterial : v === 2 ? COST.collector : v === 1 ? COST.local : COST.lot(Hgrid[cellOf(x, z)] || 22);
};
const costAt = (x, z) => { const k = m2(x, z); return k < 0 ? 50 : laid[k] ? COST.travel : groundCost(x, z) + COST.travel; };
const base = new Float32Array(cells); for (let c = 0; c < cells; c++) base[c] = groundCost(gx(c % NG), gx(Math.floor(c / NG))) + COST.travel;
const cost = base;

// ---- Hubs and masses.
const ancestors = (id) => { const out = []; for (let at = node.get(id); at; at = node.get(at.parent)) out.push(at.id); return out; };
const sceneHubs = page.scenes.map((scene) => ancestors(scene.place));
const hubDistricts = page.macro.filter((entry) => entry.parent === cityId && entry.scale === 'district');
const groundOf = (d) => { let s = 0; const [dx, dz] = local([d.x, d.z]); for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) { const x = gx(i), z = gx(j); if (Math.hypot(x - dx, z - dz) <= d.r && Math.hypot(x, z) <= RC) s += Hgrid[j * NG + i]; } return s; };
const ground = hubDistricts.map(groundOf), groundSum = ground.reduce((a, b) => a + b, 0) || 1;
const scenesIn = (id) => sceneHubs.filter((chain) => chain.includes(id)).length;
const storySum = hubDistricts.reduce((s, d) => s + scenesIn(d.id), 0) || 1;
const hubs = hubDistricts.map((d, n) => ({ id: d.id, kind: 'district', label: `district ${n + 1}`, at: local([d.x, d.z]), r: d.r, scenes: scenesIn(d.id), mass: (1 - K.storyShare) * ground[n] / groundSum + K.storyShare * scenesIn(d.id) / storySum }));
// Gates: one on the city's edge toward each other city or region of the map that is not this city's own.
const own = new Set(ancestors(cityId));
for (const other of page.macro.filter((entry) => (entry.scale === 'city' || entry.scale === 'region') && entry.parent === null || entry.scale === 'city').filter((entry) => !own.has(entry.id) && entry.id !== cityId)) {
  if (hubs.some((hub) => hub.kind === 'gate' && hub.toward.includes(other.id))) continue;
  const v = local([other.x, other.z]), d = Math.hypot(...v), at = [(v[0] / d) * (RC - 30), (v[1] / d) * (RC - 30)];
  const near = hubs.find((hub) => hub.kind === 'gate' && Math.hypot(hub.at[0] - at[0], hub.at[1] - at[1]) < 300);
  const trips = scenesIn(other.id);
  if (near) { near.toward.push(other.id); near.scenes += trips; continue; }
  hubs.push({ id: `gate:${other.id}`, kind: 'gate', label: 'gate', toward: [other.id], at, r: 0, scenes: trips, mass: 0 });
}
for (const hub of hubs.filter((h) => h.kind === 'gate')) hub.mass = Math.max(K.gateFloor, K.storyShare * hub.scenes / storySum);
// A squeeze, to test how the line answers a manifold moving: HUB_SHIFT="<district id>:<dx>,<dz>[;...]" moves those
// districts' centres by that much before anything is laid (their masses kept).
for (const part of (process.env.HUB_SHIFT ?? '').split(';').filter(Boolean)) { const [id, d] = part.split(':'), [dx, dz] = d.split(',').map(Number), hub = hubs.find((h) => h.id === id); if (hub) hub.at = [hub.at[0] + dx, hub.at[1] + dz]; }
// A hub's point: where its deck stops, the cheapest cell near its middle (a district's middle is where the story's named
// places crowd, whose lots the deck never takes): within 0.6 of its radius (at most 250 m), cost plus 1 per 100 m out.
for (const hub of hubs) {
  let best = null; const reach = hub.kind === 'gate' ? 80 : Math.min(250, 0.6 * hub.r);
  for (let dz = -reach; dz <= reach; dz += G) for (let dx = -reach; dx <= reach; dx += G) { const x = hub.at[0] + dx, z = hub.at[1] + dz, c = cellOf(x, z); if (c < 0 || Math.hypot(dx, dz) > reach || Math.hypot(x, z) > RC - 8) continue; const score = base[c] + Math.hypot(dx, dz) / 100; if (!best || score < best.score) best = { score, x, z }; }
  hub.point = best ? [best.x, best.z] : hub.at;
}

// ---- Links: cost-benefit growth (R' = Mi Mj / d - beta d), then loops by gravity-weighted detour.
const dist = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
const T = (a, b) => (a.mass * b.mass) / dist(a, b) ** 2;
const pairs = []; for (let a = 0; a < hubs.length; a++) for (let b = a + 1; b < hubs.length; b++) pairs.push([a, b]);
const betaStar = pairs.reduce((s, [a, b]) => s + T(hubs[a], hubs[b]), 0) / pairs.length, beta = K.betaRatio * betaStar;
const links = [], on = new Set([0]), left = [];
for (let n = 1; n < hubs.length; n++) {
  let best = null;
  for (const j of on) { const value = (hubs[n].mass * hubs[j].mass) / dist(hubs[n], hubs[j]) - beta * dist(hubs[n], hubs[j]); if (!best || value > best.value) best = { j, value }; }
  if (best && best.value > 0) { links.push({ a: best.j, b: n, why: 'tree', value: best.value }); on.add(n); } else left.push(hubs[n].id);
}
const netDist = (withLinks) => {
  const D = hubs.map((_, a) => hubs.map((__, b) => (a === b ? 0 : Infinity)));
  for (const { a, b } of withLinks) D[a][b] = D[b][a] = Math.min(D[a][b], dist(hubs[a], hubs[b]));
  for (let k = 0; k < hubs.length; k++) for (let a = 0; a < hubs.length; a++) for (let b = 0; b < hubs.length; b++) if (D[a][k] + D[k][b] < D[a][b]) D[a][b] = D[a][k] + D[k][b];
  return D;
};
const crosses = ([p, q], [r, s]) => { const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0; };
for (;;) {
  const D = netDist(links); let best = null;
  for (const [a, b] of pairs) {
    if (!on.has(a) || !on.has(b) || links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) continue;
    if (links.some((l) => crosses([hubs[a].at, hubs[b].at], [hubs[l.a].at, hubs[l.b].at]))) continue;
    if (hubs.some((h, k) => k !== a && k !== b && dist(h, hubs[a]) ** 2 + dist(h, hubs[b]) ** 2 < dist(hubs[a], hubs[b]) ** 2)) continue; // a hub between them: go through it
    const D2 = netDist([...links, { a, b }]); let saved = 0;
    for (const [k, l] of pairs) if (on.has(k) && on.has(l)) saved += T(hubs[k], hubs[l]) * (D[k][l] - D2[k][l]);
    const gain = saved / dist(hubs[a], hubs[b]);
    if (!best || gain > best.gain) best = { a, b, gain };
  }
  if (!best || best.gain <= beta) break;
  links.push({ a: best.a, b: best.b, why: 'loop', value: best.gain });
}
const routeFactor = (() => { const D = netDist(links), r = []; for (const [a, b] of pairs) if (on.has(a) && on.has(b)) r.push({ pair: [hubs[a].label, hubs[b].label], factor: +(D[a][b] / dist(hubs[a], hubs[b])).toFixed(3), weight: T(hubs[a], hubs[b]) }); return r; })();

// ---- Alignment: A* over (cell, heading), Galin's large masks: every primitive step of up to 4 cells (48 headings), and a
// change of heading allowed only when the new step is long enough for it at the design radius (|turn| <= length / R),
// so the line can follow a road at any angle and never bends tighter than the radius allows.
const DIRS = []; for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) { const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a)); if ((dx || dz) && gcd(Math.abs(dx), Math.abs(dz)) === 1) DIRS.push([dx, dz]); }
DIRS.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
const ND = DIRS.length, ANG = DIRS.map(([dx, dz]) => Math.atan2(dz, dx)), LEN = DIRS.map(([dx, dz]) => Math.hypot(dx, dz) * G);
const turnOf = (a, b) => { let d = ANG[b] - ANG[a]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const NEXT = DIRS.map((_, k) => DIRS.map((__, k2) => k2).filter((k2) => turnOf(k, k2) <= LEN[k2] / K.radius + 1e-9));
const lineCost = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 2)); let s = 0; for (let t = 0; t < n; t++) { const f = (t + 0.5) / n; s += costAt(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f); } return (s / n) * L; };
function align(from, to) {
  const start = cellOf(...from), goal = cellOf(...to), S = cells * ND * 2, id = (c, k, l) => (c * ND + k) * 2 + l;
  const step = new Float32Array(cells * ND).fill(Infinity);
  for (let c = 0; c < cells; c++) { const i = c % NG, j = Math.floor(c / NG); for (let k = 0; k < ND; k++) { const i2 = i + DIRS[k][0], j2 = j + DIRS[k][1]; if (i2 >= 0 && j2 >= 0 && i2 < NG && j2 < NG) step[c * ND + k] = lineCost(gx(i), gx(j), gx(i2), gx(j2)); } }
  const g = new Float64Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1), shut = new Uint8Array(S);
  let hk = new Float64Array(1 << 16), hv = new Int32Array(1 << 16), hn = 0;
  const push = (f, v) => { if (hn === hk.length) { const k2 = new Float64Array(hn * 2), v2 = new Int32Array(hn * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; } let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= f) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = f; hv[i] = v; };
  const pop = () => { const v = hv[0], lk = hk[--hn], lv = hv[hn]; let i = 0; for (;;) { const l = 2 * i + 1; if (l >= hn) break; const m = l + 1 < hn && hk[l + 1] < hk[l] ? l + 1 : l; if (hk[m] >= lk) break; hk[i] = hk[m]; hv[i] = hv[m]; i = m; } hk[i] = lk; hv[i] = lv; return v; };
  const least = COST.travel;
  const tx = gx(goal % NG), tz = gx(Math.floor(goal / NG)), h = (c) => Math.hypot(gx(c % NG) - tx, gx(Math.floor(c / NG)) - tz) * least;
  for (let k = 0; k < ND; k++) { g[id(start, k, 0)] = 0; push(h(start), id(start, k, 0)); }
  let end = -1;
  while (hn) {
    const s = pop(); if (shut[s]) continue; shut[s] = 1;
    const l = s % 2, k = Math.floor(s / 2) % ND, c = Math.floor(s / 2 / ND);
    if (c === goal && l === 0) { end = s; break; }
    const relaxTo = (s2, v, c2) => { if (v < g[s2]) { g[s2] = v; prev[s2] = s; push(v + h(c2), s2); } };
    if (base[c] < 50) relaxTo(id(c, k, 1 - l), g[s] + COST.portal + 20 * base[c], c); // a portal: down or up
    const i = c % NG, j = Math.floor(c / NG);
    for (const k2 of NEXT[k]) {
      const w = l === 0 ? step[c * ND + k2] : LEN[k2] * (COST.tunnel + COST.travel); if (w === Infinity) continue;
      const i2 = i + DIRS[k2][0], j2 = j + DIRS[k2][1]; if (i2 < 0 || j2 < 0 || i2 >= NG || j2 >= NG) continue;
      const c2 = j2 * NG + i2; relaxTo(id(c2, k2, l), g[s] + w, c2);
    }
  }
  if (end < 0) return null;
  const chain = []; for (let s = end; s >= 0; s = prev[s]) chain.push(s); chain.reverse();
  const pts = [], under = [];
  for (const s of chain) { const c = Math.floor(s / 2 / ND), l = s % 2, p = [gx(c % NG), gx(Math.floor(c / NG))]; if (pts.length && pts.at(-1)[0] === p[0] && pts.at(-1)[1] === p[1]) { under[under.length - 1] = under.at(-1) || l; continue; } pts.push(p); under.push(l); }
  return { pts, under, cost: g[end] };
}
const chaikin = (pts, rounds = 2) => { let p = pts; for (let r = 0; r < rounds; r++) { const q = [p[0]]; for (let n = 0; n < p.length - 1; n++) { const [a, b] = [p[n], p[n + 1]]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } q.push(p.at(-1)); p = q; } return p; };
const resample = (pts, step) => { const out = [pts[0]]; let carry = 0; for (let n = 1; n < pts.length; n++) { const [a, b] = [pts[n - 1], pts[n]], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = step - carry; while (t <= L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; } carry = L - (t - step); } if (Math.hypot(out.at(-1)[0] - pts.at(-1)[0], out.at(-1)[1] - pts.at(-1)[1]) > 0.5) out.push(pts.at(-1)); return out; };
const circum = (a, b, c) => { const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]), area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; return area < 1e-9 ? Infinity : (ab * bc * ca) / (4 * area); };
const lengthOf = (pts) => pts.slice(1).reduce((s, p, n) => s + Math.hypot(p[0] - pts[n][0], p[1] - pts[n][1]), 0);

const decks = [];
const order = links.map((link, n) => ({ ...link, n, flow: T(hubs[link.a], hubs[link.b]) })).sort((a, b) => b.flow - a.flow);
for (const link of order) {
  const t0 = Date.now(), path = align(hubs[link.a].point, hubs[link.b].point);
  if (!path) { decks.push({ link: link.n, failed: true }); continue; }
  // The search already bends no tighter than the radius (each turn paid for by the step's length); two rounds of corner
  // cutting only round the lattice's vertices, so the line keeps to the roads it chose.
  const pts = resample(chaikin(path.pts, 2), 4);
  // Which smoothed points lie in a tunnel: those nearest a tunnel point of the search's line.
  const tunnel = pts.map(([x, z]) => { let best = 0, d = Infinity; path.pts.forEach(([u, w], n) => { const e = Math.hypot(u - x, w - z); if (e < d) { d = e; best = n; } }); return path.under[best] === 1; });
  // Merging: what a later link shares with an earlier deck is one deck; mark where it joins and leaves (junctions).
  const raw = pts.map(([x, z]) => decks.some((deck) => !deck.failed && deck.pts.some(([u, w]) => Math.hypot(u - x, w - z) < 9)));
  // A shared or own stretch shorter than 24 m is noise (two decks brushing): it takes its neighbours' state.
  const onEarlier = [...raw]; for (let n = 0; n < raw.length;) { let m = n; while (m < raw.length && raw[m] === raw[n]) m++; if (m - n < 6 && n > 0 && m < raw.length) for (let q = n; q < m; q++) onEarlier[q] = raw[n - 1]; n = m; }
  decks.push({ link: link.n, a: hubs[link.a].label, b: hubs[link.b].label, why: link.why, flow: link.flow, pts, tunnel, shared: onEarlier, cost: path.cost, ms: Date.now() - t0 });
  for (const [x, z] of pts) for (let dz = -4; dz <= 4; dz += M) for (let dx = -4; dx <= 4; dx += M) { const k = m2(x + dx, z + dz); if (k >= 0) laid[k] = 1; }
}
const junctions = [];
for (const deck of decks.filter((d) => !d.failed)) for (let n = 1; n < deck.pts.length; n++) if (deck.shared[n] !== deck.shared[n - 1]) junctions.push(deck.shared[n] ? deck.pts[n] : deck.pts[n - 1]);
// The deck to draw: each deck's own stretch (what it shares is drawn by the earlier one).
// Surface stretches (a deck on piers) and tunnels apart; each drawn once, by the first deck that built it.
const pieces = [], tunnels = [];
for (const deck of decks.filter((d) => !d.failed)) { let cur = [], under = null; const flush = () => { if (cur.length > 1) (under ? tunnels : pieces).push(cur); cur = []; }; deck.pts.forEach((p, n) => { if (deck.shared[n]) { flush(); under = null; return; } if (under !== null && deck.tunnel[n] !== under) { cur.push(p); flush(); } under = deck.tunnel[n]; cur.push(p); }); flush(); }

// ---- What the deck rides over, and its tightest curve.
const footprintKinds = (x, z, half) => { const tally = { road: 0, water: 0, lot: 0, named: 0 }; for (const [dx, dz] of disc) { if (Math.hypot(dx, dz) > half) continue; const k = m2(x + dx, z + dz), v = k < 0 ? 0 : mask[k]; if (v === 9) tally.named++; else if (v === 4) tally.water++; else if (v) tally.road++; else tally.lot++; } return tally; };
const over = { road: 0, water: 0, lot: 0, named: 0 };
for (const piece of pieces) for (const [x, z] of piece) { const t = footprintKinds(x, z, K.deckHalf), n = t.road + t.water + t.lot + t.named; for (const key of Object.keys(over)) over[key] += t[key] / n; }
const samples = pieces.reduce((s, p) => s + p.length, 0);
const tightest = (() => { let r = Infinity; for (const piece of pieces) for (let n = 8; n < piece.length - 8; n++) { const [a, b, c] = [piece[n - 8], piece[n], piece[n + 8]], ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]), area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; if (area > 1e-6) r = Math.min(r, (ab * bc * ca) / (4 * area)); } return r; })();

// ---- Ramps: at each district, the deck point nearest its middle where 120 m each way runs over roads.
const publicShare = (pts) => { let s = 0; for (const [x, z] of pts) { const t = footprintKinds(x, z, K.deckHalf); s += (t.road + t.water) / (t.road + t.water + t.lot + t.named); } return s / pts.length; };
const ramps = [];
const sites = [];
for (const deck of decks.filter((d) => !d.failed)) {
  const flips = deck.shared.flatMap((v, n) => (n && v !== deck.shared[n - 1] ? [n] : []));
  for (let n = 0; n < deck.pts.length; n += 2) {
    const along = n * 4, toEnd = Math.min(along, (deck.pts.length - 1 - n) * 4), toFlip = Math.min(Infinity, ...flips.map((f) => Math.abs(f - n) * 4));
    // Anywhere along a line but within 60 m of where it joins another: at a line's end (a district only one link reaches)
    // the ramps are its terminal, the line itself coming down to (or up from under) the street.
    if (toFlip < 60) continue;
    sites.push({ deck, n, under: deck.tunnel[n] });
  }
}
// The heaviest district places its ramps first.
for (const hub of hubs.filter((h) => h.kind === 'district').sort((a, b) => b.mass - a.mass)) {
  let best = null;
  for (const { deck, n, under } of sites) {
    const [x, z] = deck.pts[n], d = Math.hypot(x - hub.at[0], z - hub.at[1]);
    if (d > Math.min(450, hub.r) || ramps.some((r) => Math.hypot(r.at[0] - x, r.at[1] - z) < K.rampSpacing)) continue;
    if (junctions.some(([u, w]) => Math.hypot(u - x, w - z) < 60)) continue;
    const share = publicShare(deck.pts.slice(Math.max(0, n - 30), n + 31));
    // What the four legs would stand on: a named place's lot costs a lot, any other lot a little.
    const [px, pz] = deck.pts[Math.max(0, n - 2)], [qx, qz] = deck.pts[Math.min(deck.pts.length - 1, n + 2)], tl = Math.hypot(qx - px, qz - pz) || 1, tt = [(qx - px) / tl, (qz - pz) / tl];
    let legNamed = 0, legLot = 0;
    for (const sign of [1, -1]) for (const dir of [1, -1]) for (let u = 0; u <= K.ramp; u += 6) { const k = m2(x + tt[0] * u * dir - tt[1] * K.rampOffset * sign, z + tt[1] * u * dir + tt[0] * K.rampOffset * sign), v = k < 0 ? 0 : mask[k]; if (v === 9) legNamed++; else if (v === 0) legLot++; }
    const score = d / 400 + (1 - share) * 2 + legNamed * 0.2 + legLot * 0.02;
    if (!best || score < best.score) best = { score, piece: deck.pts, n, share, d, under };
  }
  if (!best) continue;
  const { piece, n } = best, [x, z] = piece[n], [ax, az] = piece[Math.max(0, n - 2)], [bx, bz] = piece[Math.min(piece.length - 1, n + 2)], L = Math.hypot(bx - ax, bz - az), t = [(bx - ax) / L, (bz - az) / L], side = [-t[1], t[0]];
  // Four legs, each 120 m beside the line, one off and one on for each direction: from the deck (10 m up) or the tunnel
  // (12 m down) to the street at the ramp's foot.
  const level = best.under ? -12 : K.deckHeight;
  const leg = (sign, fromDeck) => { const pts = []; for (let s = 0; s <= K.ramp; s += 6) { const f = s / K.ramp, off = K.rampOffset * sign; pts.push([x + t[0] * s * (fromDeck ? -sign : sign) + side[0] * off, z + t[1] * s * (fromDeck ? -sign : sign) + side[1] * off, level * f]); } return pts; };
  ramps.push({ hub: hub.label, at: [x, z], under: !!best.under, share: +best.share.toFixed(2), fromCentre: Math.round(best.d), legs: [leg(1, false), leg(-1, false), leg(1, true), leg(-1, true)] });
}

// ---- The buildings: taken under the deck or a ramp; the rest read the ramps (one way).
const corners = ([x, z, w, d, angle]) => { const c = Math.cos(angle), s = Math.sin(angle), out = [[x, z]]; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]) out.push([x + (u * w / 2) * c - (v * d / 2) * s, z + (u * w / 2) * s + (v * d / 2) * c]); return out; };
const near = (pts, half) => (p) => pts.some(([u, w]) => Math.hypot(u - p[0], w - p[1]) <= half);
const deckNear = pieces.map((piece) => near(piece, K.deckHalf + 1)), rampNear = ramps.flatMap((r) => r.legs.map((leg) => near(leg, K.rampHalf + 1)));
const namedIds = new Set(named.map((patch) => patch.id));
const placesAt = Object.values(page.places).filter((place) => place.anchor && (place.scale === 'building' || place.scale === 'room')).map((place) => local([place.anchor.x, place.anchor.z]));
const buildings = land.buildings.map((b, n) => {
  const [x, z] = local([b[0], b[1]]), rec = [x, z, b[2], b[3], b[4]], pts = corners(rec), floors = b[5];
  const taken = deckNear.some((f) => pts.some(f)) ? 'deck' : rampNear.some((f) => pts.some(f)) ? 'ramp' : null;
  const fixed = placesAt.some(([u, w]) => Math.hypot(u - x, w - z) < 30); // the text's own buildings keep their floors
  const toRamp = ramps.length ? Math.min(...ramps.map((r) => Math.hypot(r.at[0] - x, r.at[1] - z))) : Infinity;
  return { x, z, w: b[2], d: b[3], angle: b[4], floors, use: land.uses[n], named: namedIds.has(land.owners[n]), fixed, taken, toRamp };
});
const raised = (b, strength = K.strength, reach = K.reach) => (b.fixed || b.taken ? b.floors : Math.round(b.floors * (1 + strength * Math.exp(-b.toRamp / reach))));
const within = buildings.filter((b) => !b.taken && b.toRamp <= 300);
const area = (list, f) => list.reduce((s, b) => s + b.w * b.d * f(b), 0);
const standing = buildings.filter((b) => !b.taken);
const report = {
  page: pageFile.split('/').pop(), city: cityId, radius: RC,
  hubs: hubs.map((h) => ({ label: h.label, kind: h.kind, scenes: h.scenes, mass: +h.mass.toFixed(3), r: Math.round(h.r) })),
  betaStar: +betaStar.toExponential(3), beta: +beta.toExponential(3), notLinked: left,
  links: links.map((l) => ({ a: hubs[l.a].label, b: hubs[l.b].label, why: l.why, straight: Math.round(dist(hubs[l.a], hubs[l.b])) })),
  routeFactor: routeFactor.sort((a, b) => b.weight - a.weight).slice(0, 8).map(({ pair, factor }) => ({ pair, factor })),
  decks: decks.map((d) => d.failed ? { link: d.link, failed: true } : { a: d.a, b: d.b, why: d.why, metres: Math.round(lengthOf(d.pts)), shared: Math.round(d.shared.filter(Boolean).length * 4), alignmentDetour: +(lengthOf(d.pts) / Math.hypot(d.pts.at(-1)[0] - d.pts[0][0], d.pts.at(-1)[1] - d.pts[0][1])).toFixed(3), ms: d.ms }),
  deckKm: +(pieces.reduce((s, p) => s + lengthOf(p), 0) / 1000).toFixed(2), tunnelKm: +(tunnels.reduce((s, p) => s + lengthOf(p), 0) / 1000).toFixed(2), junctions: junctions.length,
  footprint: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, Math.round((100 * v) / samples) + '%'])),
  tightestRadius: Math.round(tightest),
  ramps: ramps.map((r) => ({ hub: r.hub, fromCentre: r.fromCentre, overRoad: r.share, from: r.under ? 'tunnel' : 'deck' })),
  centreLineOverRoad: (() => { let on = 0, n = 0; for (const piece of pieces) for (const [x, z] of piece) { const k = m2(x, z), v = k < 0 ? 0 : mask[k]; n++; if (v >= 1 && v <= 4) on++; } return Math.round((100 * on) / n) + '%'; })(),
  rampSpacingMin: ramps.length > 1 ? Math.round(Math.min(...ramps.flatMap((r, i) => ramps.slice(i + 1).map((q) => Math.hypot(r.at[0] - q.at[0], r.at[1] - q.at[1]))))) : null,
  taken: { deck: buildings.filter((b) => b.taken === 'deck').length, ramp: buildings.filter((b) => b.taken === 'ramp').length, ofNamedPatches: buildings.filter((b) => b.taken && b.named).length, textBuildings: buildings.filter((b) => b.taken && b.fixed).length },
  effect: { strength: K.strength, reach: K.reach, within300: within.length, meanFloorsBefore: +(within.reduce((s, b) => s + b.floors, 0) / within.length).toFixed(2), meanFloorsAfter: +(within.reduce((s, b) => s + raised(b), 0) / within.length).toFixed(2), raised: standing.filter((b) => raised(b) > b.floors).length, cityFloorArea: `+${(100 * (area(standing, raised) / area(standing, (b) => b.floors) - 1)).toFixed(1)}%`, kept: buildings.filter((b) => b.fixed).length },
};
const round1 = (v) => Math.round(v * 10) / 10;
writeFileSync(outFile, JSON.stringify({
  report, knobs: K,
  roads: land.roads.map(([ax, az, bx, bz, w, level]) => [...local([ax, az]).map(round1), ...local([bx, bz]).map(round1), w, level]),
  waters: land.waters.map(([ax, az, bx, bz, w]) => [...local([ax, az]).map(round1), ...local([bx, bz]).map(round1), w]),
  buildings: buildings.map((b) => [round1(b.x), round1(b.z), round1(b.w), round1(b.d), Math.round(b.angle * 1000) / 1000, b.floors, b.taken === 'deck' ? 1 : b.taken === 'ramp' ? 2 : 0, b.fixed ? 1 : 0, round1(b.toRamp)]),
  hubs: hubs.map((h) => ({ label: h.label, kind: h.kind, at: h.at.map(round1), r: Math.round(h.r), mass: +h.mass.toFixed(3) })),
  decks: pieces.map((piece) => piece.map(([x, z]) => [round1(x), round1(z)])),
  tunnels: tunnels.map((piece) => piece.map(([x, z]) => [round1(x), round1(z)])),
  junctions: junctions.map((p) => p.map(round1)),
  ramps: ramps.map((r) => ({ hub: r.hub, under: r.under, at: r.at.map(round1), legs: r.legs.map((leg) => leg.map(([x, z, y]) => [round1(x), round1(z), round1(y)])) })),
  radius: RC,
}));
console.log(JSON.stringify(report, null, 1));
