// The render protocol, version 1 (docs/v3/design.html §12.1; the user, 2026-11-17: "Let's try godot"): what a native
// world client is sent to draw a book's world, made from the same page the web view plays (stage/simulation/live/page.json),
// so the simulation stays the only truth and a client only draws. The client never reads the page: everything it needs is in
// these messages, already in the world's metres (y up, x east, z south, as three.js and Godot both are).
//
// Messages (each one JSON object; big arrays as base64 of little-endian typed arrays, so a client turns them into its own
// arrays in one call):
//   hello      { protocol, title, cell, floor, focus, live }
//   models     { models: { name: { positions: f32 xyz, indices: i32, edges: i32 pairs, size: [w, h, d] } } }
//              each mesh stood on its base and centred (as the web view's shellOf does), edges where faces meet at more than 25°
//   ground     { cell, origin: [i0, j0], width, height, cells: u8 (0 none, else 1 + the ground kind), palette: ["#rrggbb"] }
//   buildings  { kinds: { lot | shell | loose: { models: { name: f32 [x, y, z, turn, w, h, d] }, boxes: f32 same } },
//                floors: f32 [x, y, z, turn, w, d] a line round each floor, labels: [{ text, at: [x, y, z], named }],
//                clutter: f32 [x, z] }
//   people     { duration, from, people: [{ id, name, color, crowd, keys: f32 [t, x, y, z, mode] }] }
//              mode 0: gone from here on; 1: walked to here from the key before; 2: stands here from this moment (no walk)
//
// The people's way through time is the web view's own timeline (engine/view/strand-demo.html buildTimeline, timing,
// position), played on the server: the same cards, events and moves at the same pace, so a moment is at the same second in
// both. Not yet carried (the web view still has them): the smoothing of ways (smoothWay), lift rides, the map's legs between
// places, damage, the sky, rooms and speech.

export const PROTOCOL = 1;
const CELL = 2, FLOOR = 3, DEMO = 3, READ = 2.1, CARD = 2.0, MACRO = 3.8, SAY = 0.16, BLOW = 1.1, BLOW_FROM = 0.35;
const ELEVATION = Math.atan(1 / Math.SQRT2), G = 9.8;
const SPEED = { walk: 1.4, run: 3.6, sneak: 0.8, "climb up": 1.1, "go down": 1.4, fall: 1.6, dragged: 1.2, ride: 12 };
const AIR_SPEED = { flight: 15, leap: 8, climb: 1.5 };
const GROUND = ["#0c1822", "#112532", "#173444", "#15293a", "#112532"];

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

// ---- The timeline (as strand-demo.html plays it) ----
const at = (place, node) => { const i = node % place.NX - (place.oi ?? 0), j = Math.floor(node / place.NX) % place.NZ - (place.oj ?? 0), k = Math.floor(node / (place.NX * place.NZ)) - (place.ok ?? 0); return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, y: k * FLOOR }; };
const flight = (a, b) => {
  const D = Math.hypot(b.x - a.x, b.z - a.z);
  if (D <= 3) return null;
  const denominator = 2 * Math.cos(ELEVATION) ** 2 * (D * Math.tan(ELEVATION) - (b.y - a.y));
  if (denominator <= 0) return null;
  const v = Math.sqrt(G * D * D / denominator);
  return { v, T: D / (v * Math.cos(ELEVATION)) };
};
const along = (a, b, arc, f) => { const t = f * arc.T; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + arc.v * Math.sin(ELEVATION) * t - G * t * t / 2 }; };
const airOf = (move, k) => move.air?.find(([first, last]) => k > first && k <= last)?.[2] ?? null;
function timing(place, move) {
  if (move.how === "teleport") return { total: 0.8, steps: [0, 0.8] };
  if (move.how === "direct") { const a = at(place, move.path[0]), b = at(place, move.path[1]), seconds = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 14 / DEMO; return { total: seconds, steps: [0, seconds] }; }
  if (Array.isArray(move.at) && move.at.length === move.path.length) { const k = move.real ? 1 : DEMO; return { total: move.at.at(-1) / k, steps: move.at.map((s) => s / k) }; }
  const steps = [0], speed = move.pace ?? (SPEED[move.how] || 1.4);
  for (let k = 1; k < move.path.length; k++) {
    const a = at(place, move.path[k - 1]), b = at(place, move.path[k]), rise = b.y - a.y, run = Math.hypot(b.x - a.x, b.z - a.z);
    const air = airOf(move, k), arc = air ? null : flight(a, b);
    steps.push(steps[k - 1] + (air ? Math.hypot(run, rise) / (AIR_SPEED[air] ?? 8) : arc ? arc.T : rise > 0 ? rise / 1.2 : rise < 0 ? (run ? Math.sqrt(-2 * rise / 9.8) : -rise / 2) : run / speed));
  }
  return { total: steps.at(-1) / DEMO, steps: steps.map((s) => s / DEMO) };
}

/** The segments of the line (macro, card, event), each with its start, end, who stands where and the moves. */
export function timeline(data) {
  const segments = [], live = !!data.live;
  const sayings = new Map((data.director?.cards ?? []).map((card) => [`${card.scene}|${card.event}`, (card.lines ?? []).filter((line) => line.kind === "spoken" && line.text?.trim())]));
  const landedOnly = live && data.scenes.some((scene) => scene.landed === false) && data.scenes.some((scene) => scene.landed);
  const heldAll = new Map(), crowdOf = (who) => who.startsWith("crowd:") || !!data.people?.[who]?.crowd;
  let clock = 0;
  for (const [index, scene] of data.scenes.entries()) {
    if (landedOnly && !scene.landed) continue;
    const place = data.places[scene.place], positions = { ...scene.starts }, held = {};
    for (const [who, spot] of heldAll) if (!(who in scene.starts)) held[who] = spot;
    const migrations = (data.migrations ?? []).filter((migration) => migration.scene === scene.id);
    if (migrations.length) {
      // The map between places: as long as the web view's (its legs are not carried yet; the people wait at the old place).
      const length = Math.max(MACRO, ...migrations.map((migration) => macroLength(data, migration, scene, place) + 0.6));
      segments.push({ kind: "macro", scene, index, place, held, start: clock, end: clock + length, positions: { ...positions }, moves: [] });
      clock += length;
    }
    segments.push({ kind: "card", scene, index, place, held, start: clock, end: clock + CARD, positions: { ...positions }, moves: [] });
    clock += CARD;
    for (const [eventIndex, event] of scene.events.entries()) {
      const moves = (event.moves ?? []).map((move) => ({ ...move, time: timing(place, move) }));
      const said = sayings.get(`${scene.id}|${eventIndex}`) ?? [], chars = said.reduce((sum, line) => sum + line.text.length, 0);
      const length = Math.max(READ, event.hit ? 2.6 : 0, chars ? chars * SAY + 0.6 : 0, event.blows?.length ? BLOW_FROM + event.blows.length * BLOW + 0.5 : 0, ...moves.map((move) => move.time.total + 0.6));
      segments.push({ kind: "event", scene, index, eventIndex, event, place, held, start: clock, end: clock + length, positions: { ...positions }, moves });
      for (const move of moves) positions[move.person] = move.path.at(-1);
      clock += length;
    }
    if (place?.world) for (const [who, node] of Object.entries(positions)) if (node != null && !crowdOf(who)) heldAll.set(who, { node, place: scene.place });
  }
  return { segments, total: clock };
}
// A migration's length on the map (strand-demo.html travelOf): out of the old place, across, into the new one.
function macroLength(data, migration, scene, place) {
  const route = migration.route, leg = (placeId, path) => (path?.length > 1 ? timing(data.places[placeId], { how: "walk", path }).total / 2 : 0);
  const spot = (id) => data.macro?.find((node) => node.id === id);
  let metres = route?.metres;
  if (metres == null) {
    const startNode = scene?.starts?.[migration.person], arrive = !route && place?.world && startNode != null ? at(place, startNode) : null;
    const a = [spot(migration.from)?.spotX ?? 0, spot(migration.from)?.spotZ ?? 0], b = arrive ? [arrive.x, arrive.z] : [spot(migration.to)?.spotX ?? 0, spot(migration.to)?.spotZ ?? 0];
    metres = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return leg(migration.from, route?.exit) + Math.min(7, Math.max(2.4, metres / 45)) + leg(migration.to, route?.entry);
}

/** Each person's keys over the line: [t, x, y, z, mode] (see the header). Only places drawn in the world's metres. */
export function peopleTracks(data, { segments }) {
  const keys = new Map(), last = new Map();
  const put = (who, t, p, mode) => {
    if (!keys.has(who)) keys.set(who, []);
    const before = last.get(who);
    if (mode === 0) { if (before && before.mode !== 0) { keys.get(who).push(t, 0, 0, 0, 0); last.set(who, { mode: 0 }); } return; }
    if (mode === 2 && before && before.mode !== 0 && Math.abs(before.x - p.x) < 1e-3 && Math.abs(before.y - p.y) < 1e-3 && Math.abs(before.z - p.z) < 1e-3) return;
    keys.get(who).push(round(t), round(p.x, 2), round(p.y, 2), round(p.z, 2), mode); last.set(who, { ...p, mode });
  };
  for (const segment of segments) {
    if (segment.kind === "macro") continue;
    const { place } = segment, here = new Set();
    if (place?.world) {
      for (const [who, node] of Object.entries(segment.positions)) {
        if (node == null) continue;
        here.add(who);
        const move = segment.moves.find((entry) => entry.person === who);
        if (!move) { put(who, segment.start, at(place, node), 2); continue; }
        for (const [t, p, mode] of movePoints(place, move)) put(who, segment.start + t, p, mode);
      }
      for (const [who, spot] of Object.entries(segment.held)) { if (here.has(who) || !data.places[spot.place]?.world) continue; here.add(who); put(who, segment.start, at(data.places[spot.place], spot.node), 2); }
    }
    for (const who of last.keys()) if (!here.has(who)) put(who, segment.start, null, 0);
  }
  return keys;
}
// A move's points in time from its start: where a key must be for the client's straight lines to follow it.
function movePoints(place, move) {
  const steps = move.time.steps, out = [];
  if (move.how === "teleport") return [[0, at(place, move.path[0]), 2], [0.4, at(place, move.path[1]), 2]];
  if (move.how === "direct") {
    const a = at(place, move.path[0]), b = at(place, move.path[1]);
    out.push([0, a, 2]);
    for (let n = 1; n <= 6; n++) { const f = n / 6; out.push([steps[1] * f, { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f + Math.sin(Math.PI * f) * 3 }, 1]); }
    return out;
  }
  out.push([0, at(place, move.path[0]), 2]);
  for (let k = 1; k < move.path.length; k++) {
    const a = at(place, move.path[k - 1]), b = at(place, move.path[k]), arc = airOf(move, k) ? null : flight(a, b);
    if (arc) for (let n = 1; n < 8; n++) out.push([steps[k - 1] + (steps[k] - steps[k - 1]) * (n / 8), along(a, b, arc, n / 8), 1]);
    out.push([steps[k], b, 1]);
  }
  return out;
}

// ---- The world ----
/** A baked model (positions base64 Int16 × step, indices base64 Uint16) as the client draws it: stood on its base, centred. */
function modelOf(model) {
  const raw = new Int16Array(Uint8Array.from(Buffer.from(model.positions, "base64")).buffer), positions = Float32Array.from(raw, (value) => value * model.step);
  const indices = Int32Array.from(new Uint16Array(Uint8Array.from(Buffer.from(model.indices, "base64")).buffer));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < positions.length; n += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], positions[n + c]); max[c] = Math.max(max[c], positions[n + c]); }
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  for (let n = 0; n < positions.length; n += 3) for (let c = 0; c < 3; c++) positions[n + c] += shift[c];
  return { positions, indices, edges: creases(positions, indices, 25), size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => round(v)) };
}
/** The edges three.js's EdgesGeometry draws: where one face ends, or two meet at more than `degrees`. */
function creases(positions, indices, degrees) {
  const limit = Math.cos((degrees * Math.PI) / 180), keyOf = (n) => `${Math.round(positions[3 * n] * 1e4)},${Math.round(positions[3 * n + 1] * 1e4)},${Math.round(positions[3 * n + 2] * 1e4)}`;
  const seen = new Map(), out = [];
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]], p = (n) => [positions[3 * n], positions[3 * n + 1], positions[3 * n + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)], u = pb.map((v, i) => v - pa[i]), v = pc.map((w, i) => w - pa[i]);
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...nrm);
    if (!len) continue;
    const normal = nrm.map((x) => x / len), keys = [keyOf(a), keyOf(b), keyOf(c)];
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const id = keys[i] < keys[j] ? `${keys[i]}_${keys[j]}` : `${keys[j]}_${keys[i]}`, other = seen.get(id);
      if (!other) seen.set(id, { a: [a, b, c][i], b: [a, b, c][j], normal });
      else { if (other.normal[0] * normal[0] + other.normal[1] * normal[1] + other.normal[2] * normal[2] <= limit) out.push(other.a, other.b); seen.delete(id); }
    }
  }
  for (const edge of seen.values()) out.push(edge.a, edge.b);
  return Int32Array.from(out);
}
// A lot's footprint in the world (strand-demo.html planOf): its frame's true size and turn, or square to the grid at i0, j0.
function planOf(lot) {
  const sx = lot.sx ?? lot.nx, sz = lot.sz ?? lot.nz, frame = Array.isArray(lot.frame) ? { x: lot.frame[0], z: lot.frame[1], angle: lot.frame[2] } : lot.frame;
  const w = frame?.w ?? sx * CELL, d = frame?.d ?? sz * CELL;
  return { w, d, x: frame ? frame.x : lot.i0 * CELL + w / 2, z: frame ? frame.z : lot.j0 * CELL + d / 2, angle: frame?.angle ?? 0 };
}

/** Every message for a page, in the order a client wants them. */
export function messagesOf(data) {
  const world = data.world;
  if (!world) return [{ type: "hello", protocol: PROTOCOL, title: data.title ?? "", cell: CELL, floor: FLOOR, focus: null, live: data.live ?? null, empty: "This page has no streamed world." }];
  const used = new Set(), models = {};
  const kinds = {}, floors = [], labels = [];
  const add = (kind, model, values) => {
    kinds[kind] ??= { models: {}, boxes: [] };
    if (model && data.models?.[model]) { used.add(model); (kinds[kind].models[model] ??= []).push(...values); } else kinds[kind].boxes.push(...values);
  };
  for (const lot of world.lots ?? []) {
    const { w, d, x, z, angle } = planOf(lot), levels = lot.height ?? lot.floors, y = (lot.k0 ?? 0) * FLOOR;
    add("lot", lot.model, [x, y, z, angle, w, levels * FLOOR, d]);
    for (let k = 1; k <= levels; k++) floors.push(x, y + k * FLOOR, z, angle, w, d);
    // Its name: the terrain's (white), else the story's first mention of it (gold; the web view shows it from then).
    const text = typeof lot.label === "string" ? lot.label : lot.detected?.name ?? null;
    if (text) labels.push({ text: String(text).slice(0, 14), at: [round(x, 1), round(y + levels * FLOOR + 2.4, 1), round(z, 1)], named: typeof lot.label === "string" });
  }
  for (const lot of world.shells ?? []) {
    const { w, d, x, z, angle } = planOf(lot), levels = lot.height ?? lot.floors, y = lot.y0 ?? 0;
    add("shell", lot.model, [x, y, z, angle, w, levels * FLOOR, d]);
    for (let k = 1; k <= levels; k++) floors.push(x, y + k * FLOOR, z, angle, w, d);
  }
  for (const [x, z, w, d, angle, levels, model] of world.loose ?? []) add("loose", model, [x, 0, z, angle, w, Math.max(1, levels) * FLOOR, d]);
  for (const name of used) { const made = modelOf(data.models[name]); models[name] = { positions: b64(made.positions), indices: b64(made.indices), edges: b64(made.edges), size: made.size }; }
  const packed = Object.fromEntries(Object.entries(kinds).map(([kind, { models: byModel, boxes }]) => [kind, { models: Object.fromEntries(Object.entries(byModel).map(([name, values]) => [name, b64(Float32Array.from(values))])), boxes: b64(Float32Array.from(boxes)) }]));
  const clutter = new Float32Array(world.clutter?.length ?? 0);
  for (let n = 0; n < clutter.length; n += 2) { clutter[n] = (world.clutter[n] + 0.5) * CELL; clutter[n + 1] = (world.clutter[n + 1] + 0.5) * CELL; }

  // The ground: every chunk's 16 × 16 cells in one grid over the chunks' bounds.
  const chunks = world.chunks ?? [];
  const ci0 = Math.min(...chunks.map((c) => c[0])), cj0 = Math.min(...chunks.map((c) => c[1])), ci1 = Math.max(...chunks.map((c) => c[0])), cj1 = Math.max(...chunks.map((c) => c[1]));
  const width = chunks.length ? (ci1 - ci0 + 1) * 16 : 0, height = chunks.length ? (cj1 - cj0 + 1) * 16 : 0, cells = new Uint8Array(width * height);
  for (const [ci, cj, , ground] of chunks) for (let n = 0; n < 256; n++) cells[((cj - cj0) * 16 + Math.floor(n / 16)) * width + (ci - ci0) * 16 + (n % 16)] = 1 + (Number(ground[n]) || 0);

  const line = timeline(data), tracks = peopleTracks(data, line);
  const people = [...tracks].filter(([, keys]) => keys.length).map(([id, keys]) => ({ id, name: data.people?.[id]?.name ?? id, color: data.people?.[id]?.color ?? "#9fd8ff", crowd: id.startsWith("crowd:") || !!data.people?.[id]?.crowd, keys: b64(Float32Array.from(keys)) }));
  // Live: the newest moment (as the web view's live frame starts); else the line from its start.
  const from = data.live ? line.segments.at(-1)?.start ?? 0 : 0;
  const focus = data.live?.focus ?? (width ? { x: round((ci0 * 16 + width / 2) * CELL, 1), z: round((cj0 * 16 + height / 2) * CELL, 1), r: round(Math.max(width, height) * CELL / 4, 1) } : null);
  return [
    { type: "hello", protocol: PROTOCOL, title: data.title ?? "", cell: CELL, floor: FLOOR, focus, live: data.live ?? null },
    { type: "models", models },
    { type: "ground", cell: CELL, origin: [ci0 * 16, cj0 * 16], width, height, cells: b64(cells), palette: GROUND },
    { type: "buildings", kinds: packed, floors: b64(Float32Array.from(floors)), labels, clutter: b64(clutter) },
    { type: "people", duration: round(line.total), from: round(from), people },
  ];
}
