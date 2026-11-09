// Fill operators (src/v2/world/fillOps.ts; milestones M8c; docs/v2/models-and-settings.md §4; after gkNextEngine's layout kit): what a place's fill
// scatters, the setting `fill.ops` (per universe, book or place). Structures stay the fill's and the text's, never
// scattered (the article's lesson: random buildings never look lived in); the operators put the small things of a street:
// trees, street lights, benches, bins, parked cars, bollards. Each operator is a line an agent can read and change:
//   { "op": "scatter", "what": "tree", "on": "open" | "street" | "plaza", "n": 400, "seed": 7, "gap": 4 }
//   { "op": "line", "what": "street-light", "along": "arterial" | "collector" | "local" | "boulevard" | "any", "every": 30, "side": "both" | "left" | "right", "offset": 1.5 }
//   { "op": "ring", "what": "bench", "n": 12, "r": 20, "at": [x, z] }          (at: the place's own metres; default its middle)
// Nothing is put inside a building's footprint or on a road's carriageway. Pure: geometry in, props out.

export const PROP_KINDS = ['tree', 'street-light', 'bench', 'bin', 'car', 'bollard'] as const;
export type PropKind = (typeof PROP_KINDS)[number];
/* eslint-disable @typescript-eslint/no-explicit-any */
type Op = Record<string, any>;
export interface OpsGeometry { roads?: { a: [number, number]; b: [number, number]; width: number; level: string }[]; buildings?: { x: number; z: number; w: number; d: number; angle?: number }[]; plazas?: { x: number; z: number; r: number }[]; centre?: [number, number]; radius?: number; origin?: [number, number]; seed?: string }
const MOST = 20000;

const rngOf = (text: unknown) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } let s = h >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** What is wrong with a list of operators (an empty list when it is fine). */
export function checkOps(ops: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(ops)) return ['fill.ops must be a list of operators'];
  (ops as Op[]).forEach((op, n) => {
    const at = `fill.ops[${n}]`;
    if (!op || typeof op !== 'object') { out.push(`${at} must be an object`); return; }
    if (!['scatter', 'line', 'ring'].includes(op.op)) out.push(`${at}.op must be scatter, line or ring`);
    // A kind beyond the six built in (a wind turbine, a shrine lantern) is drawn only where fill.props connects a part to it (milestones M13; the no-hint test, 2026-11-09).
    if (!(PROP_KINDS as readonly string[]).includes(op.what) && !/^[a-z][a-z0-9-]{0,30}$/.test(String(op.what))) out.push(`${at}.what must be one of ${PROP_KINDS.join(', ')}, or a kind's name (lower-case letters, digits, -) that fill.props connects a part to`);
    const number = (name: string, low: number, high: number, needed = false) => { if (op[name] === undefined) { if (needed) out.push(`${at}.${name} is needed`); return; } if (typeof op[name] !== 'number' || op[name] < low || op[name] > high) out.push(`${at}.${name} must be a number from ${low} to ${high}`); };
    if (op.op === 'scatter') { number('n', 1, 5000, true); number('gap', 0.5, 100); if (op.on !== undefined && !['open', 'street', 'plaza'].includes(op.on)) out.push(`${at}.on must be open, street or plaza`); }
    if (op.op === 'line') { number('every', 2, 400, true); number('offset', 0, 20); if (op.along !== undefined && !['arterial', 'collector', 'local', 'boulevard', 'avenue', 'any'].includes(op.along)) out.push(`${at}.along must be a road level or any`); if (op.side !== undefined && !['both', 'left', 'right'].includes(op.side)) out.push(`${at}.side must be both, left or right`); }
    if (op.op === 'ring') { number('n', 1, 500, true); number('r', 1, 1000, true); if (op.at !== undefined && !(Array.isArray(op.at) && op.at.length === 2 && op.at.every((v: unknown) => typeof v === 'number'))) out.push(`${at}.at must be [x, z]`); }
    const known = new Set(['op', 'what', 'n', 'on', 'seed', 'gap', 'along', 'every', 'side', 'offset', 'r', 'at']);
    for (const name of Object.keys(op)) if (!known.has(name)) out.push(`${at}.${name} is not a part of an operator`);
  });
  return out;
}

/**
 * The props a place's operators put down. Geometry in world metres: roads {a, b, width, level}, buildings {x, z, w, d,
 * angle}, plazas {x, z, r}; the place's middle and reach (for `open` scatter and a ring's default); `origin`, the place's
 * own 0 in world metres (a ring's `at` is the place's own). Props [kind, x, z, turn], and a line per operator: asked, put.
 */
export function applyOps(ops: Op[] | null | undefined, { roads = [], buildings = [], plazas = [], centre = [0, 0], radius = 200, origin = [0, 0], seed = 'fill' }: OpsGeometry): { props: [string, number, number, number][]; report: { op: string; what: string; asked: number | null; put: number }[] } {
  if (!ops?.length) return { props: [], report: [] };
  const problems = checkOps(ops);
  if (problems.length) throw new Error(`fill.ops: ${problems.join('; ')}`);
  const inBuilding = (x: number, z: number, margin = 0.5) => buildings.some((b) => { const c = Math.cos(-(b.angle ?? 0)), s = Math.sin(-(b.angle ?? 0)), dx = x - b.x, dz = z - b.z, u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) <= b.w / 2 + margin && Math.abs(v) <= b.d / 2 + margin; });
  const onRoad = (x: number, z: number, margin = 0.3) => roads.some((road) => { const [ax, az] = road.a, [bx, bz] = road.b, L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2)); return Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))) < road.width / 2 + margin; });
  const props: [string, number, number, number][] = [], taken = new Map<string, [number, number][]>(), report: { op: string; what: string; asked: number | null; put: number }[] = [];
  const free = (x: number, z: number, gap: number) => { const k = `${Math.round(x / Math.max(gap, 1))},${Math.round(z / Math.max(gap, 1))}`; for (const [px, pz] of taken.get(k) ?? []) if (Math.hypot(px - x, pz - z) < gap) return false; return true; };
  const put = (what: string, x: number, z: number, turn: number, gap: number) => { if (props.length >= MOST || inBuilding(x, z) || onRoad(x, z) || !free(x, z, gap)) return false; const cell = Math.max(gap, 1); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const k = `${Math.round(x / cell) + i},${Math.round(z / cell) + j}`; if (!taken.has(k)) taken.set(k, []); } taken.get(`${Math.round(x / cell)},${Math.round(z / cell)}`)!.push([x, z]); props.push([what, Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(turn * 100) / 100]); return true; };
  ops.forEach((op, n) => {
    const rng = rngOf(`${seed}|${n}|${op.seed ?? ''}`), gap = op.gap ?? (op.what === 'tree' ? 4 : 1.5), before = props.length;
    if (op.op === 'scatter') {
      const on = op.on ?? 'open';
      for (let tries = 0, made = 0; made < op.n && tries < op.n * 30; tries++) {
        let x: number, z: number, turn = rng() * Math.PI * 2;
        if (on === 'open') { const r = radius * Math.sqrt(rng()), a = rng() * Math.PI * 2; x = centre[0] + r * Math.cos(a); z = centre[1] + r * Math.sin(a); if (onRoad(x, z, 1)) continue; }
        else if (on === 'plaza') { if (!plazas.length) break; const p = plazas[Math.floor(rng() * plazas.length)], r = p.r * Math.sqrt(rng()), a = rng() * Math.PI * 2; x = p.x + r * Math.cos(a); z = p.z + r * Math.sin(a); }
        else { if (!roads.length) break; const road = roads[Math.floor(rng() * roads.length)], t = rng(), side = rng() < 0.5 ? -1 : 1, [ax, az] = road.a, [bx, bz] = road.b, L = Math.hypot(bx - ax, bz - az) || 1, off = road.width / 2 + 1.5; x = ax + t * (bx - ax) - side * ((bz - az) / L) * off; z = az + t * (bz - az) + side * ((bx - ax) / L) * off; turn = Math.atan2(bz - az, bx - ax); }
        if (put(op.what, x, z, turn, gap)) made++;
      }
    } else if (op.op === 'line') {
      const along = op.along ?? 'any', sides = op.side === 'left' ? [1] : op.side === 'right' ? [-1] : [1, -1];
      for (const road of roads.filter((road) => along === 'any' || road.level === along)) {
        const [ax, az] = road.a, [bx, bz] = road.b, L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
        const off = road.width / 2 + (op.offset ?? 1.5), nx = -(bz - az) / L, nz = (bx - ax) / L, turn = Math.atan2(bz - az, bx - ax);
        for (let s = op.every / 2; s < L; s += op.every) for (const side of sides) put(op.what, ax + ((bx - ax) * s) / L + side * nx * off, az + ((bz - az) * s) / L + side * nz * off, turn, gap);
      }
    } else {
      const [cx, cz] = op.at ? [op.at[0] + origin[0], op.at[1] + origin[1]] : centre;
      for (let k = 0; k < op.n; k++) { const a = (k / op.n) * Math.PI * 2; put(op.what, cx + op.r * Math.cos(a), cz + op.r * Math.sin(a), a + Math.PI / 2, Math.min(gap, (2 * Math.PI * op.r) / op.n / 2)); }
    }
    report.push({ op: op.op, what: op.what, asked: op.op === 'line' ? null : op.n, put: props.length - before });
  });
  return { props, report };
}
