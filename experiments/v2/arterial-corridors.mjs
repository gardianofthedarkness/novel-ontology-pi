// Could an expressway ride over the city fill's arterials? (docs/v2/highway-research.md §2)
//
// For a few cities of the plain fill (src/v2/world/cityFill.ts), born with radius r0:
// - the arterial net: segments, km, median segment, junction degrees;
// - the turn at each junction when going the straightest way on;
// - for each design speed's minimum curve radius R (Japan's Road Structure Ordinance, art. 15), the share of those turns
//   where the curve stays over the road (it leaves the centre line by E = R(sec(t/2) - 1) at a turn of t);
// - the detour of following arterials (shortest path on the arterial graph / straight line) between junctions
//   0.8 to 2 km apart.
//
//   npm run build && node experiments/v2/arterial-corridors.mjs [r0=1101]
import { materialize } from '../../dist/src/v2/world/cityFill.js';

const r0 = Number(process.argv[2] ?? 1101), HALF = 9; // half of an 18 m arterial
const SPEEDS = [[40, 60], [50, 100], [60, 150], [60, 120, 'exception'], [80, 280]];
const E = (R, deg) => R * (1 / Math.cos((deg * Math.PI) / 360) - 1);
const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;

function measure(seed) {
  const arterials = materialize({ seed, r0, r: r0 }).roads.filter((road) => road.level === 'arterial');
  const pos = new Map(), adj = new Map(), out = new Map();
  for (const road of arterials) {
    const a = key(road.a), b = key(road.b), w = Math.hypot(road.b[0] - road.a[0], road.b[1] - road.a[1]);
    pos.set(a, road.a); pos.set(b, road.b);
    for (const [u, v, p, q] of [[a, b, road.a, road.b], [b, a, road.b, road.a]]) {
      if (!adj.has(u)) adj.set(u, []), out.set(u, []);
      adj.get(u).push([v, w]); out.get(u).push(Math.atan2(q[1] - p[1], q[0] - p[0]));
    }
  }
  const turns = [];
  for (const dirs of out.values()) for (let i = 0; i < dirs.length; i++) {
    const heading = dirs[i] + Math.PI; let best = Infinity;
    for (let j = 0; j < dirs.length; j++) if (j !== i) best = Math.min(best, Math.abs((((dirs[j] - heading) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI));
    if (dirs.length > 1) turns.push((best * 180) / Math.PI);
  }
  turns.sort((a, b) => a - b);
  const at = (list, f) => +list[Math.floor(f * (list.length - 1))].toFixed(2);
  const lengths = arterials.map((road) => Math.hypot(road.b[0] - road.a[0], road.b[1] - road.a[1])).sort((a, b) => a - b);
  // Detours: Dijkstra from every 7th junction inside 0.85 r0.
  const inner = [...pos.keys()].filter((k) => Math.hypot(...pos.get(k)) < r0 * 0.85), ratios = [];
  for (let i = 0; i < inner.length; i += 7) {
    const dist = new Map([[inner[i], 0]]), done = new Set();
    for (;;) {
      let u = null, best = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
      if (u === null) break;
      done.add(u);
      for (const [v, w] of adj.get(u) ?? []) if (best + w < (dist.get(v) ?? Infinity)) dist.set(v, best + w);
    }
    for (const k of inner) {
      const straight = Math.hypot(pos.get(k)[0] - pos.get(inner[i])[0], pos.get(k)[1] - pos.get(inner[i])[1]);
      if (straight >= 800 && straight <= 2000 && dist.has(k)) ratios.push(dist.get(k) / straight);
    }
  }
  ratios.sort((a, b) => a - b);
  const degrees = {};
  for (const dirs of out.values()) degrees[dirs.length] = (degrees[dirs.length] ?? 0) + 1;
  return {
    seed, segments: arterials.length, km: +(lengths.reduce((s, x) => s + x, 0) / 1000).toFixed(1), medianSegment: Math.round(lengths[lengths.length >> 1]), degrees,
    straightestTurn: Object.fromEntries([['p10', 0.1], ['p25', 0.25], ['median', 0.5], ['p75', 0.75], ['p90', 0.9]].map(([name, f]) => [name, +at(turns, f).toFixed(1)])),
    staysOverRoad: Object.fromEntries(SPEEDS.map(([v, R, note]) => [`${v} km/h R ${R} m${note ? ' (' + note + ')' : ''}`, Math.round((100 * turns.filter((t) => E(R, t) <= HALF).length) / turns.length) + '%'])),
    detour: { pairs: ratios.length, median: at(ratios, 0.5), p90: at(ratios, 0.9) },
  };
}

const rows = ['loc_000001', 'city-a', 'city-b', 'city-c'].map(measure);
console.log(JSON.stringify({ r0, rows }, null, 1));
for (const [v, R, note] of SPEEDS) {
  let t = 0; while (E(R, t + 0.1) <= HALF) t += 0.1;
  console.log(`${v} km/h, R ${R} m${note ? ' (' + note + ')' : ''}: over the road up to a ${t.toFixed(0)} deg turn; at a 45 deg turn its tangent runs ${(R * Math.tan(Math.PI / 8)).toFixed(0)} m each way`);
}
