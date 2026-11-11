// The road network vehicles drive (docs/v3/design.html#roads-and-transit stage 1, with the expressway of stage 2): a graph of its
// own, derived from the ground's roads and a city's kept highway, never a cost on the walk grid. People walk the walk
// grid; vehicles drive this; the two meet at the kerb (the nearest street to where a ride starts and ends) and the
// highway meets the streets only at its ramps.
//
//   roadGraph({ roads, highways })  the graph: the streets split at their junctions (the fill's side streets end in the
//                                   middle of the road they leave: a T), decks and tunnels along each line, ramps
//   drive(graph, from, to)          the quickest way by road from one point to another: points [x, y, z, t] (metres,
//                                   seconds), keeping left (the books' city is in Tokyo)
//
// Pure: arrays in, arrays out.

import { setting } from '../../dist/src/world/settings.js';
/** Design speeds (km/h): the street classes, a ramp, a deck and a tunnel (Road Structure Ordinance's urban types). */
export const SPEEDS = setting('roads.speeds');
const ms = (kmh) => kmh / 3.6;
/** Expected waits at a street junction (seconds): a crossing of four or more ways has lights (half a 60 s cycle's red, on
 * average less: 12 s); a T gives way (4 s). A bend, a ramp or the expressway has none, which is why it is quicker. */
export const WAITS = setting('roads.waits');
const KEY = setting('roads.junction'); // metres: road ends closer than this are one junction

/** A spatial hash of segments (50 m cells) to find the roads near a point. */
function hashOf(segments, cell = 50) {
  const grid = new Map(), key = (i, j) => `${i},${j}`;
  segments.forEach((s, n) => {
    const [ax, az] = s.a, [bx, bz] = s.b, pad = s.w / 2 + 2;
    for (let i = Math.floor((Math.min(ax, bx) - pad) / cell); i <= Math.floor((Math.max(ax, bx) + pad) / cell); i++) for (let j = Math.floor((Math.min(az, bz) - pad) / cell); j <= Math.floor((Math.max(az, bz) + pad) / cell); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
  });
  return (x, z, r = 0) => { const out = new Set(); for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) for (const n of grid.get(key(i, j)) ?? []) out.add(n); return [...out]; };
}
const project = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; return { t, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) }; };
const crossAt = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99 ? [t, u] : null; };

/**
 * The graph. `roads` [[ax, az, bx, bz, width, level]] (a landscape's, world metres); `highways` kept highway records
 * (engine/world/highways.mjs). Nodes { x, y, z, kind }; edges { a, b, metres, seconds, kind, pts: [[x, y, z]] }
 * both ways; `adj` node -> [edge index].
 */
export function roadGraph({ roads = [], highways = [] } = {}) {
  const segments = roads.map(([ax, az, bx, bz, w, level]) => ({ a: [ax, az], b: [bx, bz], w, level })).filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.5);
  // Split each road where another ends on it (a T) or crosses it (an X), and where a ramp of the highway lands on it.
  const cuts = segments.map(() => []), near = hashOf(segments);
  const feet = [];
  for (const highway of highways) for (const ramp of highway.ramps ?? []) for (const leg of ramp.legs) {
    const foot = leg.reduce((best, p) => (Math.abs(p[2]) < Math.abs(best[2]) ? p : best));
    let best = null;
    for (const m of near(foot[0], foot[1], 60)) { const o = segments[m], { t, d } = project(foot, o.a, o.b); if (t >= 0 && t <= 1 && d <= 60 && (!best || d < best.d)) best = { m, t, d }; }
    if (!best) { feet.push(null); continue; }
    if (best.t > 0.01 && best.t < 0.99) cuts[best.m].push(best.t);
    const o = segments[best.m]; feet.push([o.a[0] + (o.b[0] - o.a[0]) * best.t, o.a[1] + (o.b[1] - o.a[1]) * best.t]);
  }
  segments.forEach((s, n) => {
    for (const end of [s.a, s.b]) for (const m of near(end[0], end[1], 12)) {
      if (m === n) continue; const o = segments[m], { t, d } = project(end, o.a, o.b);
      if (t > 0.01 && t < 0.99 && d <= Math.max(2, o.w / 2 + 1.5)) cuts[m].push(t);
    }
    for (const m of near((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2)) { if (m <= n) continue; const hit = crossAt(s.a, s.b, segments[m].a, segments[m].b); if (hit) { cuts[n].push(hit[0]); cuts[m].push(hit[1]); } }
  });
  const nodes = [], buckets = new Map(), nodeAt = (x, z, y = 0, kind = 'street', snap = KEY) => {
    const i = Math.floor(x / snap), j = Math.floor(z / snap);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const n of buckets.get(`${kind === 'street' ? 's' : 'h'}${i + di},${j + dj}`) ?? []) if (Math.hypot(nodes[n].x - x, nodes[n].z - z) < snap && Math.abs(nodes[n].y - y) < 3) return n;
    const id = nodes.push({ x, y, z, kind }) - 1, k = `${kind === 'street' ? 's' : 'h'}${i},${j}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(id); return id;
  };
  const edges = [], adj = [];
  const link = (a, b, kind, pts, kmh, width = 8) => {
    if (a === b) return; let metres = 0; for (let k = 1; k < pts.length; k++) metres += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2], pts[k][1] - pts[k - 1][1]);
    for (const [from, to, line] of [[a, b, pts], [b, a, [...pts].reverse()]]) { const e = edges.push({ a: from, b: to, metres, seconds: metres / ms(kmh), kind, width, pts: line }) - 1; (adj[from] ??= []).push(e); }
  };
  segments.forEach((s, n) => {
    const ts = [0, ...[...new Set(cuts[n].map((t) => Math.round(t * 1000) / 1000))].sort((p, q) => p - q), 1];
    for (let k = 1; k < ts.length; k++) {
      const p = [s.a[0] + (s.b[0] - s.a[0]) * ts[k - 1], s.a[1] + (s.b[1] - s.a[1]) * ts[k - 1]], q = [s.a[0] + (s.b[0] - s.a[0]) * ts[k], s.a[1] + (s.b[1] - s.a[1]) * ts[k]];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5) continue;
      link(nodeAt(p[0], p[1]), nodeAt(q[0], q[1]), s.level, [[p[0], 0, p[1]], [q[0], 0, q[1]]], SPEEDS[s.level] ?? SPEEDS.local, s.w);
    }
  });
  // Stitching: the fill lays each patch's streets on its own (and a child place's circle cuts the roads through it), so the
  // streets come in pieces. Pieces whose ends lie within 40 m of each other are joined by a short street, the shortest
  // joins first (a spanning forest over the pieces), so a car can drive from any street to any other.
  const streetNodes = nodes.map((node, n) => n), parent = streetNodes.map((n) => n), find = (n) => { while (parent[n] !== n) n = parent[n] = parent[parent[n]]; return n; };
  for (const e of edges) parent[find(e.a)] = find(e.b);
  const close = [], cell = 40, grid = new Map();
  streetNodes.forEach((n) => { const k = `${Math.floor(nodes[n].x / cell)},${Math.floor(nodes[n].z / cell)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); });
  for (const n of streetNodes) { const i = Math.floor(nodes[n].x / cell), j = Math.floor(nodes[n].z / cell); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const m of grid.get(`${i + di},${j + dj}`) ?? []) { if (m <= n || find(m) === find(n)) continue; const d = Math.hypot(nodes[m].x - nodes[n].x, nodes[m].z - nodes[n].z); if (d <= 40) close.push([d, n, m]); } }
  let stitched = 0;
  for (const [, n, m] of close.sort((a, b) => a[0] - b[0])) { if (find(n) === find(m)) continue; parent[find(n)] = find(m); link(n, m, 'local', [[nodes[n].x, 0, nodes[n].z], [nodes[m].x, 0, nodes[m].z]], SPEEDS.local, 6); stitched++; }
  // A piece still apart (a river, a wide plaza, a place's circle between them): joined to the largest by its nearest node,
  // up to 150 m.
  { const size = new Map(); for (const n of streetNodes) size.set(find(n), (size.get(find(n)) ?? 0) + 1);
    const main = [...size].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const [root, count] of [...size].sort((a, b) => b[1] - a[1]).slice(1)) {
      if (count < 10 || find(root) === find(main)) continue;
      let best = null;
      for (const n of streetNodes) { if (find(n) !== find(root)) continue; const i = Math.floor(nodes[n].x / cell), j = Math.floor(nodes[n].z / cell); for (let di = -4; di <= 4; di++) for (let dj = -4; dj <= 4; dj++) for (const m of grid.get(`${i + di},${j + dj}`) ?? []) { if (find(m) !== find(main)) continue; const d = Math.hypot(nodes[m].x - nodes[n].x, nodes[m].z - nodes[n].z); if (d <= 150 && (!best || d < best.d)) best = { n, m, d }; } }
      if (best) { parent[find(best.n)] = find(best.m); link(best.n, best.m, 'local', [[nodes[best.n].x, 0, nodes[best.n].z], [nodes[best.m].x, 0, nodes[best.m].z]], SPEEDS.local, 6); stitched++; }
    }
  }
  let footAt = 0;
  // The highway: each line a chain of nodes every 20 m (shared stretches merge onto the earlier line's nodes), its height
  // the deck's or the tunnel's, eased between them at no more than 10% (a portal's slope).
  const highwayNodes = [];
  for (const highway of highways) {
    const up = highway.knobs?.deckHeight ?? 12, down = -(highway.knobs?.tunnelDepth ?? 12), ends = [];
    for (const line of highway.lines ?? []) {
      if (line.failed || line.pts.length < 2) continue;
      // The line comes down to the street at its two ends (its hubs: where lines meet, whatever their levels, and where it
      // lands on the street as a terminal ramp), eased at no more than 10% to its deck or its tunnel.
      const ys = line.pts.map((_, n) => (n === 0 || n === line.pts.length - 1 ? 0 : line.tunnel[n] ? down : up));
      const along = line.pts.map((p, n) => (n ? Math.hypot(p[0] - line.pts[n - 1][0], p[1] - line.pts[n - 1][1]) : 0));
      for (let n = 1; n < ys.length; n++) ys[n] = Math.max(ys[n], ys[n - 1] - 0.1 * along[n]), ys[n] = Math.min(ys[n], ys[n - 1] + 0.1 * along[n]);
      for (let n = ys.length - 2; n >= 0; n--) ys[n] = Math.max(ys[n], ys[n + 1] - 0.1 * along[n + 1]), ys[n] = Math.min(ys[n], ys[n + 1] + 0.1 * along[n + 1]);
      const onEarlier = (n) => { if (!line.shared?.[n]) return -1; let best = -1, d = 9; for (const id of highwayNodes) { const e = Math.hypot(nodes[id].x - line.pts[n][0], nodes[id].z - line.pts[n][1]); if (e < d) { d = e; best = id; } } return best; };
      const nodeHere = (n) => { const shared = onEarlier(n); if (shared >= 0) { ys[n] = nodes[shared].y; return shared; } const id = nodeAt(line.pts[n][0], line.pts[n][1], ys[n], 'highway', 9); if (!highwayNodes.includes(id)) highwayNodes.push(id); return id; };
      let last = nodeHere(0), pts = [[line.pts[0][0], ys[0], line.pts[0][1]]];
      ends.push(last);
      for (let n = 1; n < line.pts.length; n++) {
        if (n % 5 && n !== line.pts.length - 1) { pts.push([line.pts[n][0], ys[n], line.pts[n][1]]); continue; }
        const here = nodeHere(n);
        pts.push([line.pts[n][0], ys[n], line.pts[n][1]]);
        link(last, here, line.tunnel[n] ? 'tunnel' : 'deck', pts, line.tunnel[n] ? SPEEDS.tunnel : SPEEDS.deck, 17);
        last = here; pts = [[line.pts[n][0], ys[n], line.pts[n][1]]];
      }
      ends.push(last);
    }
    // Each line's ends land on the street nearest them (within 60 m): a terminal ramp at the hub.
    for (const end of ends) { const kerb = nearestNode(nodes, nodes[end].x, nodes[end].z, 'street', 60); if (kerb >= 0) link(kerb, end, 'ramp', [[nodes[kerb].x, 0, nodes[kerb].z], [nodes[end].x, nodes[end].y, nodes[end].z]], SPEEDS.ramp, 7); }
    // Ramps: each leg from the street it lands on (split there above) to the line at its top.
    for (const ramp of highway.ramps ?? []) for (const leg of ramp.legs) {
      const landing = feet[footAt++], top = leg.reduce((best, p) => (Math.abs(p[2]) > Math.abs(best[2]) ? p : best));
      if (!landing) continue;
      const onLine = nearestNode(nodes, top[0], top[1], 'highway', 30, top[2]), onStreet = nearestNode(nodes, landing[0], landing[1], 'street', 6);
      if (onLine < 0 || onStreet < 0) continue;
      const ordered = [...leg].sort((p, q) => Math.abs(p[2]) - Math.abs(q[2])).map(([x, z, y]) => [x, y, z]);
      link(onStreet, onLine, 'ramp', [[nodes[onStreet].x, 0, nodes[onStreet].z], ...ordered, [nodes[onLine].x, nodes[onLine].y, nodes[onLine].z]], SPEEDS.ramp, 7);
    }
  }
  // The streets' edges (one of each pair) in a hash, to find the street right outside a door (the kerb).
  const streets = edges.map((edge, n) => n).filter((n) => n % 2 === 0 && edges[n].kind !== 'ramp' && edges[n].kind !== 'deck' && edges[n].kind !== 'tunnel');
  const streetHash = hashOf(streets.map((n) => ({ a: [edges[n].pts[0][0], edges[n].pts[0][2]], b: [edges[n].pts.at(-1)[0], edges[n].pts.at(-1)[2]], w: edges[n].width })));
  return { nodes, edges, adj, streetNodes, streets, streetHash, stitched };
}

function nearestNode(nodes, x, z, kind, within, y = null) {
  let best = -1, d = within;
  nodes.forEach((node, n) => { if (node.kind !== kind) return; const e = Math.hypot(node.x - x, node.z - z) + (y === null ? 0 : Math.abs(node.y - y) * 0.5); if (e < d) { d = e; best = n; } });
  return best;
}

/** The kerb: the point of the street nearest [x, z] within `within` metres: { edge (a street edge's index), t, at: [x, z], d }. */
export function kerbOf(graph, x, z, within = 150) {
  let best = null;
  for (const k of graph.streetHash(x, z, within)) {
    const n = graph.streets[k], e = graph.edges[n], a = [e.pts[0][0], e.pts[0][2]], b = [e.pts.at(-1)[0], e.pts.at(-1)[2]], { t, d } = project([x, z], a, b), tt = Math.max(0, Math.min(1, t));
    const at = [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], dd = Math.hypot(at[0] - x, at[1] - z);
    if (dd <= within && (!best || dd < best.d)) best = { edge: n, t: tt, at, d: dd };
  }
  return best;
}

/**
 * The quickest way by road from one point [x, z] to another: from the kerb outside the one (the nearest point of a
 * street) to the kerb outside the other, least time over the graph, the stretch from the door to the kerb driven slowly.
 * Points [x, y, z, t] along the way, each road's lane on the left of the way it goes. Null when no road joins them (or no
 * street lies within `within` of either).
 */
export function drive(graph, from, to, { within = 150, lane = true } = {}) {
  const start = kerbOf(graph, from[0], from[1], within), goal = kerbOf(graph, to[0], to[1], within);
  if (!start || !goal) return null;
  const { nodes, edges, adj } = graph, time = new Float64Array(nodes.length).fill(Infinity), via = new Int32Array(nodes.length).fill(-1), done = new Uint8Array(nodes.length);
  const speedOf = (e) => edges[e].metres / edges[e].seconds, se = edges[start.edge], ge = edges[goal.edge];
  // The wait at a street junction the drive goes through (WAITS): the car holds still there that long.
  const waitAt = (u) => { const node = nodes[u]; if (node.kind !== 'street') return 0; const ways = (adj[u] ?? []).filter((e) => edges[e].kind !== 'ramp').length; return ways >= 4 ? WAITS.signal : ways === 3 ? WAITS.give : 0; };
  let waits = 0, waited = 0;
  const heap = [];
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  // From the kerb along its street to either end of that piece of street.
  for (const [node, share] of [[se.a, start.t], [se.b, 1 - start.t]]) { const t = (se.metres * share) / speedOf(start.edge); if (t < time[node]) { time[node] = t; via[node] = -2; push([t, node]); } }
  while (heap.length) {
    const [t, u] = pop(); if (done[u]) continue; done[u] = 1;
    if (done[ge.a] && done[ge.b]) break;
    for (const e of adj[u] ?? []) { const v = edges[e].b, w = t + edges[e].seconds + waitAt(v); if (w < time[v]) { time[v] = w; via[v] = e; push([w, v]); } }
  }
  // To the goal's kerb from either end of its piece of street, or straight along one street when both kerbs are on it.
  const ends = [[ge.a, goal.t], [ge.b, 1 - goal.t]].map(([node, share]) => ({ node, total: time[node] + (ge.metres * share) / speedOf(goal.edge), share }));
  const same = start.edge === goal.edge || start.edge === (goal.edge ^ 1);
  const direct = same ? Math.abs((goal.edge === start.edge ? goal.t : 1 - goal.t) - start.t) * se.metres / speedOf(start.edge) : Infinity;
  const end = ends.sort((m, n) => m.total - n.total)[0];
  if (direct === Infinity && end.total === Infinity) return null;
  const out = [], put = (x, y, z, dt) => { const last = out.at(-1); out.push([x, y, z, (last?.[3] ?? 0) + dt]); }, kerbSpeed = ms(SPEEDS.kerb);
  const offsetOf = (e) => (lane && edges[e].kind !== 'ramp' ? Math.min(5, Math.max(2, edges[e].width / 4)) : 0);
  // A stretch of one edge's line from share s0 to s1 (of its length), in its lane.
  const along = (e, s0, s1) => {
    const edge = edges[e], [a, b] = [edge.pts[0], edge.pts.at(-1)], dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, off = offsetOf(e), sign = s1 >= s0 ? 1 : -1, nx = ((dz / L) * off) * sign, nz = ((-dx / L) * off) * sign;
    const p0 = [a[0] + dx * s0 + nx, a[2] + dz * s0 + nz], p1 = [a[0] + dx * s1 + nx, a[2] + dz * s1 + nz], prev = out.at(-1), speed = speedOf(e);
    put(p0[0], 0, p0[1], Math.hypot(p0[0] - prev[0], p0[1] - prev[2]) / speed);
    put(p1[0], 0, p1[1], (Math.abs(s1 - s0) * edge.metres) / speed);
  };
  put(from[0], 0, from[1], 0);
  put(start.at[0], 0, start.at[1], start.d / kerbSpeed);
  let metres = 0, highway = 0, count = 0;
  if (direct <= end.total) {
    along(start.edge, start.t, goal.edge === start.edge ? goal.t : 1 - goal.t); metres += Math.round(Math.abs((goal.edge === start.edge ? goal.t : 1 - goal.t) - start.t) * se.metres);
  } else {
    const chain = []; for (let u = end.node; via[u] !== -2; u = edges[via[u]].a) chain.push(via[u]); chain.reverse();
    const first = chain.length ? edges[chain[0]].a : end.node;
    along(start.edge, start.t, first === se.a ? 0 : 1); metres += (first === se.a ? start.t : 1 - start.t) * se.metres;
    let hold = 0;
    for (const e of chain) {
      const edge = edges[e], speed = speedOf(e), off = offsetOf(e);
      if (hold++) { const wait = waitAt(edge.a); if (wait) { const last = out.at(-1); put(last[0], last[1], last[2], wait); waits++; waited += wait; } }
      for (let k = 1; k < edge.pts.length; k++) {
        const [ax, ay, az] = edge.pts[k - 1], [bx, by, bz] = edge.pts[k], L = Math.hypot(bx - ax, bz - az) || 1, nx = ((bz - az) / L) * off, nz = (-(bx - ax) / L) * off;
        if (k === 1) { const prev = out.at(-1); put(ax + nx, ay, az + nz, Math.hypot(ax + nx - prev[0], az + nz - prev[2], ay - prev[1]) / speed); }
        const d = Math.hypot(bx - ax, bz - az, by - ay); metres += d; if (edge.kind === 'deck' || edge.kind === 'tunnel') highway += d;
        put(bx + nx, by, bz + nz, d / speed);
      }
      count++;
    }
    along(goal.edge, end.node === ge.a ? 0 : 1, goal.t); metres += end.share * ge.metres;
  }
  put(goal.at[0], 0, goal.at[1], Math.hypot(goal.at[0] - out.at(-1)[0], goal.at[1] - out.at(-1)[2]) / speedOf(goal.edge));
  put(to[0], 0, to[1], goal.d / kerbSpeed);
  return { pts: out, metres: Math.round(metres), highway: Math.round(highway), seconds: Math.round(out.at(-1)[3] * 10) / 10, edges: count, waits, waited };
}
