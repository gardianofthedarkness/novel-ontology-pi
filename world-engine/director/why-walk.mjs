// Why a move found no way (L10; the user, 2026-11-04: "this issue has been here for so long time. I need you to give me
// the exact building and path screenshot to understand why"). For each move a run held as unreachable, the walk graph is
// rebuilt where it failed (the engine's own world and windows, read only), searched from where the person stood, and
// drawn floor by floor: every walkable cell by kind, what the start reaches, the targets, the buildings' footprints and
// where floors join (stairs, roofs' drops). A JSON of the findings beside the pictures.
//
//   node world-engine/director/why-walk.mjs <novel-dir> --reading <reading>/v2/data.json --run <run id> --out <folder>
//
// Reads the run's record (stage/director/runs/<id>/run.json) and page (stage/simulation/runs/director/<id>.page.json);
// writes only into --out. Pictures are SVG, and PNG where rsvg-convert is installed.

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand, strandDemo } from '../world/export-strand-demo.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CELL = 2, FLOOR = 3;
const KIND = { 1: ['open ground', '#d9d4c3'], 2: ['corridor / stair', '#8fa6bf'], 3: ['room', '#e2b980'], 4: ['roof', '#b48fd6'], 5: ['underground hall', '#5f9e98'], 6: ['rubble', '#a1785c'] };

/** The failed moves of a run: those with a replay (NO_PATH, OFF_WALK) and journeys that did not move and said nothing. */
export function heldMoves(record) {
  const out = [];
  for (const scene of record.scenes) for (const card of scene.cards) (card.moves ?? []).forEach((move, n) => {
    if (move.moved || !move.person || move.person.startsWith('crowd:') || !(move.replay?.from !== undefined || move.journey)) return;
    // Their moves in this card that played before this one (the page keeps only moves that went).
    const before = (card.moves ?? []).slice(0, n).filter(other => other.person === move.person && other.moved).length;
    out.push({ container: scene.scene, card: card.card, who: move.person, why: move.why, code: move.code ?? null, how: move.how ?? move.replay?.how ?? move.journey?.manner, journey: move.journey ?? null, box: move.box ?? null, height: move.height ?? null, spot: move.spot ?? null, before });
  });
  // Routes from afar that stopped (arrivals off-page): one case where they stopped, those who stopped at the same leg
  // (within 4 m, the same aim) drawn together.
  for (const scene of record.scenes) for (const route of (scene.routes ?? []).filter(entry => !entry.reached && entry.stopped?.here)) {
    const same = out.find(entry => entry.route && entry.container === scene.scene && Math.hypot(entry.at.x - route.stopped.here.x, entry.at.z - route.stopped.here.z) <= 4 && Math.hypot((entry.aim?.x ?? 0) - (route.stopped.aim?.x ?? 0), (entry.aim?.z ?? 0) - (route.stopped.aim?.z ?? 0)) <= 4);
    if (same) { same.who += `, ${route.who}`; continue; }
    out.push({ container: scene.scene, card: `arrive:${scene.scene}`, who: route.who, why: `a route from ${Math.round(Math.hypot(route.dest.x - route.from.x, route.dest.z - route.from.z))} m away stopped at leg ${route.stopped.leg} of ${route.stopped.of}: ${route.stopped.why ?? route.stopped.code}`, code: route.stopped.code, how: route.by, at: route.stopped.here, aim: route.stopped.aim, route: { from: route.from, dest: route.dest, of: route.stopped.of, leg: route.stopped.leg } });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, run: { type: 'string' }, out: { type: 'string' }, stills: { type: 'boolean' } } });
  if (!novelDir || !values.reading || !values.run || !values.out) { console.error('usage: node world-engine/director/why-walk.mjs <novel-dir> --reading <data.json> --run <id> --out <folder>'); process.exit(2); }
  const dir = resolve(novelDir), out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const record = JSON.parse(await readFile(join(dir, 'stage', 'director', 'runs', values.run, 'run.json'), 'utf8'));
  const page = JSON.parse(await readFile(join(dir, 'stage', 'simulation', 'runs', 'director', `${values.run}.page.json`), 'utf8'));
  let reading = JSON.parse(await readFile(resolve(values.reading), 'utf8'));
  const worldFile = async name => JSON.parse(await readFile(join(dir, 'stage', 'world', name), 'utf8').catch(() => 'null'));
  const SG = await import('./segments.mjs'), seg = SG.segmentWorld({ reading, script: await worldFile('script.json'), spawn: await worldFile('spawn.json') });
  const segStrands = SG.strandsFile(seg.script, await (await import('./strand-builder.mjs')).strandBuilder(dir), { reading: seg.reading });
  const held = heldMoves(record);
  const scenesOf = held.map(entry => entry.container).sort();
  // The page's nodes are its grid's dense cells; the engine's are numbered as first asked for (W.nodeId), so a run's
  // record (its replays) cannot be read back offline: positions come from the page, the engine's ids from the cells.
  const g = page.world, decode = node => { const i = node % g.NX - g.oi, j = Math.floor(node / g.NX) % g.NZ - g.oj, k = Math.floor(node / (g.NX * g.NZ)) - g.ok; return { i, j, k, x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, y: k * FLOOR }; };
  // Where each person stood just before a card's event: the page's starts, then every move's path end in order.
  const standing = (container, cardId, who, before) => {
    const scene = page.scenes.find(entry => entry.id === container);
    let at = scene?.starts?.[who] ?? null;
    for (const event of scene?.events ?? []) {
      if (event.id === cardId) { for (const move of (event.moves ?? []).filter(entry => entry.person === who && entry.path?.length).slice(0, before)) at = move.path.at(-1); return at; }
      for (const move of event.moves ?? []) if (move.person === who && move.path?.length) at = move.path.at(-1);
    }
    return at;
  };
  const slotOf = new Map((reading.slots ?? []).map(slot => [slot.id, slot]));
  const findings = [];
  await strandDemo(dir, { from: scenesOf[0], to: scenesOf.at(-1), worldOnly: true, plain: true, title: 'Why walk', played: { cast: Object.fromEntries(seg.script.scenes.map(entry => [entry.id, entry.present])), spawn: seg.spawn, strands: segStrands.strands }, engine: async E => {
    const { world, W } = E;
    const nodeAt = (i, j, k) => W.nodeId(world, i, j, k), cellOfId = id => { const c = W.cellOf(world, id); return { ...c, x: (c.i + 0.5) * CELL, z: (c.j + 0.5) * CELL, y: c.k * FLOOR }; };
    const typeOf = (built, id) => (id < built.type.length ? built.type[id] : 0), edgesOf = (built, id) => (id < built.type.length ? built.graph.offsets[id + 1] - built.graph.offsets[id] : 0);
    const placeBox = new Map(seg.spawn?.scenes?.filter(entry => entry.target?.box).map(entry => [entry.place, entry.target.box]) ?? []);
    const lotName = index => { const lot = world.lots[index]; return lot ? lot.label ?? `the ${lot.role ?? 'building'} (${lot.height ?? lot.floors} floors)` : null; };
    let n = 0;
    for (const entry of held) {
      n++;
      const name = `${String(n).padStart(2, '0')}-${entry.container.replace('scene_', '')}-${entry.who}`;
      const slot = slotOf.get(entry.who), what = slot ? { slot: slot.label, kind: slot.kind } : null;
      const dense = entry.at ? null : standing(entry.container, entry.card, entry.who, entry.before);
      if (!entry.at && (dense === null || dense === undefined)) { findings.push({ name, ...entry, what, finding: 'no start found on the page' }); continue; }
      const fromMetres = p => { const i = Math.floor(p.x / CELL), j = Math.floor(p.z / CELL), k = Math.round((p.y ?? 0) / FLOOR); return { i, j, k, x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, y: k * FLOOR }; };
      const start = entry.at ? fromMetres(entry.at) : decode(dense), from = nodeAt(start.i, start.j, start.k);
      // The world round where they stood, loaded as the run had it (its buildings reached, so named as the run named them).
      E.reach(start.x, start.z, 300);
      // The targets: the replay's (its first eight), else the journey's lot as the director finds it (by its name, nearest).
      let targets = [], lot = null, targetNote = null;
      const box = entry.journey ? placeBox.get(entry.journey.to) ?? null : null;
      if (entry.aim) {
        // As the director's runTo: open ground within 12 m of the leg's aim on the straight line, the nearest eight.
        E.reach(entry.aim.x, entry.aim.z, 40);
        const built = E.graphOf({ x: entry.aim.x, z: entry.aim.z }, 36), near = [];
        for (let id = 0; id < built.type.length; id++) if (built.type[id] === 1 && edgesOf(built, id) && Math.hypot(built.graph.x[id] - entry.aim.x, built.graph.z[id] - entry.aim.z) <= 12) near.push(id);
        targets = near.sort((a, b) => Math.hypot(built.graph.x[a] - entry.aim.x, built.graph.z[a] - entry.aim.z) - Math.hypot(built.graph.x[b] - entry.aim.x, built.graph.z[b] - entry.aim.z)).slice(0, 8).map(cellOfId);
        targetNote = `leg ${entry.route.leg} of ${entry.route.of}: open ground within 12 m of its aim on the straight line (${near.length} cells; the nearest eight)`;
      } else if (box) {
        // As the director's megaMove: open ground (or roofs) round the box's middle, nearest first.
        const centre = [box[0], box[1]], radius = Math.max(box[2], box[3]) / 2, roofward = ['leaps between roofs', 'up or along a wall', 'flight'].includes(entry.journey.manner);
        E.reach(centre[0], centre[1], radius + 20);
        const built = E.graphOf({ x: centre[0], z: centre[1] }, radius + 28), nodes = [];
        for (let id = 0; id < built.type.length; id++) if (built.type[id] && edgesOf(built, id) && Math.abs(built.graph.x[id] - centre[0]) <= radius + 4 && Math.abs(built.graph.z[id] - centre[1]) <= radius + 4) nodes.push(id);
        const wanted = nodes.filter(id => built.type[id] === (roofward ? 4 : 1)), chosen = (wanted.length ? wanted : nodes).sort((a, b) => Math.hypot(built.graph.x[a] - start.x, built.graph.z[a] - start.z) - Math.hypot(built.graph.x[b] - start.x, built.graph.z[b] - start.z)).slice(0, 40);
        targets = chosen.map(cellOfId);
        const kinds = {}; for (const id of nodes) kinds[KIND[built.type[id]]?.[0] ?? built.type[id]] = (kinds[KIND[built.type[id]]?.[0] ?? built.type[id]] ?? 0) + 1;
        targetNote = `the place's box (${box.map(v => Math.round(v)).join(', ')}): ${nodes.length} walkable cells in it (${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ')}); ${chosen.length} targets, ${wanted.length ? (roofward ? 'roofs' : 'open ground') : 'any cell'}`;
      } else if (entry.box) {
        const [x0, z0, x1, z1] = entry.box, k = /ground/.test(entry.height ?? '') ? 0 : null, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        E.reach(cx, cz, 30);
        const built = E.graphOf({ x: cx, z: cz }, 40), chosen = [];
        for (let id = 0; id < built.type.length; id++) if (built.type[id] && edgesOf(built, id) && built.graph.x[id] >= x0 && built.graph.x[id] <= x1 && built.graph.z[id] >= z0 && built.graph.z[id] <= z1 && (k === null || Math.round(built.graph.y[id] / FLOOR) === k)) chosen.push(id);
        targets = chosen.slice(0, 40).map(cellOfId);
        targetNote = `the spot's box on the map (${entry.box.map(v => Math.round(v)).join(', ')}), ${entry.height ?? 'any height'}: ${chosen.length} walkable cells`;
      } else if (entry.journey) {
        const label = String(entry.why ?? '').replace(/^journey: to /, '').replace(/ \([^()]*\)$/, '');
        const lots = world.lots.map((entry_, index) => ({ index, name: lotName(index), d: Math.hypot((entry_.i0 + entry_.nx / 2) * CELL - start.x, (entry_.j0 + entry_.nz / 2) * CELL - start.z) })).filter(entry_ => entry_.name === label && entry_.d <= 2000).sort((a, b) => a.d - b.d);
        if (lots.length) {
          lot = lots[0].index;
          const L = world.lots[lot], centre = [(L.i0 + L.nx / 2) * CELL, (L.j0 + L.nz / 2) * CELL], radius = Math.max(L.nx, L.nz) * CELL / 2 + 6;
          E.reach(centre[0], centre[1], radius + 20);
          const built = E.graphOf({ x: centre[0], z: centre[1] }, radius + 28), roofward = ['leaps between roofs', 'up or along a wall', 'flight'].includes(entry.journey.manner);
          const nodes = [];
          for (let id = 0; id < built.type.length; id++) if (built.type[id] && built.graph.offsets[id + 1] > built.graph.offsets[id] && Math.abs(built.graph.x[id] - centre[0]) <= radius + 4 && Math.abs(built.graph.z[id] - centre[1]) <= radius + 4) nodes.push(id);
          const fits = id => built.lot[id] === lot || Math.hypot(built.graph.x[id] - centre[0], built.graph.z[id] - centre[1]) <= radius;
          const wanted = nodes.filter(id => fits(id) && built.type[id] === (roofward ? 4 : 1));
          const chosen = (wanted.length ? wanted : nodes.filter(fits)).sort((a, b) => Math.hypot(built.graph.x[a] - start.x, built.graph.z[a] - start.z) - Math.hypot(built.graph.x[b] - start.x, built.graph.z[b] - start.z)).slice(0, 40);
          targets = chosen.map(cellOfId);
          targetNote = `the nearest ${lotName(lot)} by name, ${Math.round(lots[0].d)} m away (${lots.length} so named within 2 km); ${chosen.length} targets, ${wanted.length ? (roofward ? 'its roof' : 'open ground round it') : 'any cell of it'}`;
        } else targetNote = `no building named ${label} within 2 km`;
      }
      if (!targets.length) { findings.push({ name, ...entry, what, start, finding: targetNote ?? 'no targets' }); continue; }
      // Searched twice from the start: on the run's own window (the director's walk builds its graph round where the person
      // stands, E.graphOf at the start: what the run could reach), and on one window over start and targets (whether the
      // city has a way at all).
      const xs = [start.x, ...targets.map(t => t.x)], zs = [start.z, ...targets.map(t => t.z)];
      const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }, half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 40;
      E.reach(start.x, start.z, 60); E.reach(targets[0].x, targets[0].z, 60); E.reach(mid.x, mid.z, half + 16);
      const ids = targets.map(t => nodeAt(t.i, t.j, t.k));
      const search = built => { const seen = new Uint8Array(world.cells.length / 3 + 1), queue = from < built.type.length && edgesOf(built, from) ? [from] : []; seen[from] = 1; while (queue.length) { const node = queue.pop(); for (let e = built.graph.offsets[node]; e < built.graph.offsets[node + 1]; e++) { const to = built.graph.to[e]; if (!seen[to]) { seen[to] = 1; queue.push(to); } } } return seen; };
      const built = E.graphOf({ x: start.x, z: start.z }), graph = built.graph, seen = search(built), city = E.graphOf(mid, half + 24), seenCity = search(city);
      const win = built.box, inWindow = t => t.x >= win.x0 && t.x <= win.x1 && t.z >= win.z0 && t.z <= win.z1;
      // The solver's own room (export-strand-demo.mjs solve): the walk's field is solved only on the box round its start and
      // targets with 40 m to spare; a way that must leave that box is no way at all to the solver.
      const pad = 40, sx = [start.x, ...targets.map(t => t.x)], sz = [start.z, ...targets.map(t => t.z)], solverBox = { x0: Math.min(...sx) - pad, x1: Math.max(...sx) + pad, z0: Math.min(...sz) - pad, z1: Math.max(...sz) + pad };
      const inSolver = id => { const p = cellOfId(id); return p.x >= solverBox.x0 && p.x <= solverBox.x1 && p.z >= solverBox.z0 && p.z <= solverBox.z1; };
      const seenSolver = (() => { const seen_ = new Uint8Array(world.cells.length / 3 + 1), queue = from < built.type.length && edgesOf(built, from) ? [from] : []; seen_[from] = 1; while (queue.length) { const node = queue.pop(); for (let e = built.graph.offsets[node]; e < built.graph.offsets[node + 1]; e++) { const to = built.graph.to[e]; if (!seen_[to] && inSolver(to)) { seen_[to] = 1; queue.push(to); } } } return seen_; })();
      const reachedInSolver = ids.filter(id => seenSolver[id]).length;
      // The run's own solve and draw (E.solve, E.sampleWalk; the path integral): whether the field converged, its largest
      // weight at the start (zero there and the walk has no first step: "no way there on foot"), and a draw from each heading.
      const field = E.solve(null, `why|${entry.container}|${entry.who}|${entry.code}`, ids, entry.how === 'walk' ? 'walk' : 'run', from), D = field.h.length / (field.target.length || 1);
      const local = field.part ? field.part.local[from] : from, hStart = local >= 0 ? Math.max(...Array.from({ length: D }, (_, d) => field.h[local * D + d] ?? 0)) : null;
      const draws = Array.from({ length: 4 }, (_, d) => { let seed = 7 + d; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); return E.sampleWalk(null, field, from, d, rng); });
      const graphOfField = field.part?.graph, nanWeight = [], kinds = {};
      if (graphOfField) for (let e = 0; e < field.weight.length; e++) if (!Number.isFinite(field.weight[e])) { const k = graphOfField.kind[e]; kinds[k] = (kinds[k] ?? 0) + 1; if (nanWeight.length < 3) { let lo = 0, hi = graphOfField.nodes; while (lo < hi) { const mid = (lo + hi) >> 1; if (graphOfField.offsets[mid + 1] <= e) lo = mid + 1; else hi = mid; } const to = graphOfField.to[e], pos = n => [graphOfField.x[n], graphOfField.z[n], graphOfField.y[n]]; nanWeight.push({ e, kind: k, cost: graphOfField.cost[e], from: lo, to, nodes: graphOfField.nodes, fromAt: pos(lo), toAt: pos(to), world: [field.part.ids[lo], field.part.ids[to]].map(id => id === undefined ? null : cellOfId(id)) }); } }
      const nanH = Array.from(field.h).filter(v => !Number.isFinite(v)).length, zeroH = Array.from(field.h).filter(v => v === 0).length;
      // What the walk's own rules reach inside the solver's field (world.ts reachableIn on the field's graph, its way's factors).
      const fieldReach = field.part && E.W?.reachableIn ? (() => { const seen = E.W.reachableIn(field.part.graph, field.part.local[from], field.factors); return ids.filter(id => field.part.local[id] >= 0 && seen[field.part.local[id]]).length; })() : null;
      const solver = { sweeps: field.sweeps, converged: field.converged, phiScale: field.scale ?? null, nodes: field.part?.graph.nodes ?? null, reachedInField: fieldReach, pocket300: E.onFoot ? E.onFoot(from, 300, entry.how === "walk" ? "walk" : "run").size : null, pocket300climb: E.onFoot ? E.onFoot(from, 300, "climb:6").size : null, hStart: Number.isFinite(hStart) ? hStart : String(hStart), drawn: draws.filter(Boolean).length, of: draws.length, T: E.T, h: { size: field.h.length, notFinite: nanH, zero: zeroH }, weightsNotFinite: kinds, examples: nanWeight };
      // Lifts and shafts from deep halls in the run's window: a climb far cheaper than its height (a flat cost), where the
      // solver's weight overflowed before the fix (pathIntegral.ts solveWalk, 2026-11-04).
      const lifts = [];
      for (let n = 0; n < built.type.length; n++) for (let e = built.graph.offsets[n]; e < built.graph.offsets[n + 1]; e++) { const to = built.graph.to[e], rise = built.graph.y[to] - built.graph.y[n]; if (built.graph.kind[e] === 1 && rise > 15 && built.graph.cost[e] < E.lambda * rise) lifts.push({ x: built.graph.x[n], z: built.graph.z[n], depth: Math.round(rise), cost: built.graph.cost[e] }); }
      const reachedTargets = ids.filter(id => seen[id]).length, reachedCity = ids.filter(id => seenCity[id]).length, startIsTarget = ids.includes(from), targetsInWindow = targets.filter(inWindow).length;
      const reachable = []; for (let id = 0; id < seen.length; id++) if (seen[id]) reachable.push(id);
      const byFloor = {}; for (const id of reachable) { const k = cellOfId(id).k; byFloor[k] = (byFloor[k] ?? 0) + 1; }
      const nearest = targets.map(t => { let best = null; for (const id of reachable) { const p = cellOfId(id), d = Math.hypot(p.x - t.x, p.z - t.z, p.y - t.y); if (!best || d < best.d) best = { d, p }; } return best; }).filter(Boolean).sort((a, b) => a.d - b.d)[0] ?? null;
      const lotAt = (b, id) => (id < b.lot.length && b.lot[id] >= 0 && b.lot[id] < 1000 ? b.lot[id] : null);
      const startLot = lotAt(built, from), targetLots = [...new Set(ids.map(id => lotAt(city, id)).filter(lot_ => lot_ !== null))];
      const finding = {
        name, ...entry, what, start: { ...start, type: KIND[typeOf(built, from)]?.[0] ?? 'not walkable', edges: edgesOf(built, from), building: startLot !== null ? lotName(startLot) : null },
        targets: targets.slice(0, 8).map((t, k) => ({ ...t, type: KIND[typeOf(city, ids[k])]?.[0] ?? 'not walkable', edges: edgesOf(city, ids[k]), building: lotAt(city, ids[k]) !== null ? lotName(lotAt(city, ids[k])) : null })),
        targetNote, metres: Math.round(Math.hypot(targets[0].x - start.x, targets[0].z - start.z)), window: { ...win, metres: Math.round(win.x1 - win.x0) }, targetsInWindow, solverBox: { ...solverBox, metres: [Math.round(solverBox.x1 - solverBox.x0), Math.round(solverBox.z1 - solverBox.z0)] }, reachedInSolver, solver, lifts,
        reachable: reachable.length, reachableByFloor: byFloor, reachedTargets, reachedCity, startIsTarget,
        nearestReached: nearest ? { metres: Math.round(nearest.d), at: nearest.p } : null, buildings: { start: startLot !== null ? lotName(startLot) : null, targets: targetLots.map(lotName) },
      };
      findings.push(finding);
      // The pictures: an overview where the trip is long (the run's window, start, targets), then one plan per floor that
      // matters, round the start and round the targets. Cells the start reaches in the run's window in full colour, the
      // rest faded; buildings' cells that are not walkable on that floor grey.
      const floors = [...new Set([start.k, ...targets.map(t => t.k), 0])].sort((a, b) => b - a);
      const far = finding.metres > 120 || !!entry.route, areas = far ? [{ label: 'where they stood', c: start }, { label: 'where they were to go', c: targets[0] }] : [{ label: 'start and targets', c: { x: mid.x, z: mid.z } }];
      const R = far ? 50 : Math.min(70, Math.max(30, half - 20)), px = Math.max(5, Math.round(330 / R)), size = Math.round(2 * R / CELL) * px;
      const panels = [...(far ? [{ overview: true }] : []), ...areas.flatMap(area => floors.map(k => ({ area, k })))];
      const cols = Math.min(panels.length, 3), rows = Math.ceil(panels.length / cols), W_ = Math.max(960, cols * (size + 24) + 24), top = 192, H = rows * (size + 56) + top + 70;
      const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W_}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>`];
      const say = (y, text, size_ = 13, weight = 400) => parts.push(`<text x="24" y="${y}" font-size="${size_}" font-weight="${weight}">${esc(text)}</text>`);
      say(30, `${entry.container} · ${entry.card} · ${entry.who}${what ? ` (the reading's slot: a ${what.kind})` : ''}`, 18, 700);
      say(52, `${entry.why ?? ''} · ${entry.how ?? ''} · ${finding.metres} m`);
      say(72, `start: ${finding.start.type}${finding.start.building ? ` in ${finding.start.building}` : ''}, floor ${start.k} · targets: ${[...new Set(finding.targets.map(t => `${t.type}${t.building ? ` of ${t.building}` : ''}, floor ${t.k}`))].join('; ')}`);
      if (targetNote) say(92, targetNote);
      if (lifts.length) say(154, `in the run's walk graph: ${lifts.length} lift${lifts.length > 1 ? 's' : ''} from deep halls (up to ${Math.max(...lifts.map(lift => lift.depth))} m at a flat cost of ${lifts[0].cost}), purple: the solver's weight overflowed there and its field turned NaN`, 13, 600);
      say(114, `the run's walk graph: the ${finding.window.metres} m square round the start; ${targetsInWindow} of ${ids.length} targets inside it; reached ${reachedTargets} there`, 13, 600);
      say(134, `${startIsTarget ? 'the start is itself a target: already there · ' : ''}inside the solver's box (start and targets with 40 m to spare): reached ${reachedInSolver} of ${ids.length} · over the whole city: ${reachedCity}`, 13, 600);
      panels.forEach((panel, p) => {
        const ox = 24 + (p % cols) * (size + 24), oy = top + Math.floor(p / cols) * (size + 56);
        if (panel.overview) {
          const ends = entry.route ? [entry.route.from, entry.route.dest] : [start, targets[0]], length = Math.hypot(ends[1].x - ends[0].x, ends[1].z - ends[0].z);
          const span = Math.max(length * 1.3, win.x1 - win.x0 + 80), cx = (ends[0].x + ends[1].x) / 2, cz = (ends[0].z + ends[1].z) / 2, scale = size / span, X = x => ox + (x - cx) * scale + size / 2, Z = z => oy + (z - cz) * scale + size / 2;
          parts.push(`<text x="${ox}" y="${oy - 8}" font-size="13" font-weight="600">the trip · ${Math.round(span)} m across</text><rect x="${ox}" y="${oy}" width="${size}" height="${size}" fill="#f4f4f2" stroke="#999"/><clipPath id="trip-${p}"><rect x="${ox}" y="${oy}" width="${size}" height="${size}"/></clipPath><g clip-path="url(#trip-${p})">`);
          for (const L of world.lots) { const x0 = L.i0 * CELL, z0 = L.j0 * CELL; if (x0 > cx + span / 2 || x0 + L.nx * CELL < cx - span / 2 || z0 > cz + span / 2 || z0 + L.nz * CELL < cz - span / 2) continue; parts.push(`<rect x="${X(x0)}" y="${Z(z0)}" width="${Math.max(0.6, L.nx * CELL * scale)}" height="${Math.max(0.6, L.nz * CELL * scale)}" fill="#c9c9c9"/>`); }
          parts.push(`<rect x="${X(win.x0)}" y="${Z(win.z0)}" width="${(win.x1 - win.x0) * scale}" height="${(win.z1 - win.z0) * scale}" fill="none" stroke="#f77f00" stroke-width="2" stroke-dasharray="6 4"/>`);
          parts.push(`<text x="${X(win.x0) + 4}" y="${Z(win.z0) + 14}" font-size="11" fill="#b35c00">the run's walk graph</text>`);
          for (const lift of lifts) parts.push(`<rect x="${X(lift.x) - 5}" y="${Z(lift.z) - 5}" width="10" height="10" transform="rotate(45 ${X(lift.x)} ${Z(lift.z)})" fill="#8e44ad" stroke="#fff"/>`);
          if (lifts.length) parts.push(`<text x="${X(lifts[0].x) + 9}" y="${Z(lifts[0].z) + 4}" font-size="11" fill="#6c2d8a">lift from ${lifts[0].depth} m down</text>`);
          if (entry.route) {
            // The whole way: where they came from (green) to where they arrive (dark red), each leg's aim on the line.
            const { from: o, dest: d, of: legsOf } = entry.route;
            parts.push(`<line x1="${X(o.x)}" y1="${Z(o.z)}" x2="${X(d.x)}" y2="${Z(d.z)}" stroke="#7a1f1f" stroke-width="1.5" stroke-dasharray="4 3"/>`);
            for (let leg = 1; leg <= legsOf; leg++) { const t = leg / legsOf; parts.push(`<circle cx="${X(o.x + (d.x - o.x) * t)}" cy="${Z(o.z + (d.z - o.z) * t)}" r="${leg === entry.route.leg ? 5 : 3}" fill="${leg === entry.route.leg ? '#d62828' : '#7a1f1f'}"/>`); }
            parts.push(`<circle cx="${X(o.x)}" cy="${Z(o.z)}" r="6" fill="#2a9d3c" stroke="#fff" stroke-width="2"/><text x="${X(o.x) + 8}" y="${Z(o.z) + 4}" font-size="11">from</text><text x="${X(d.x) + 8}" y="${Z(d.z) + 4}" font-size="11">arrives</text>`);
          } else parts.push(`<line x1="${X(start.x)}" y1="${Z(start.z)}" x2="${X(targets[0].x)}" y2="${Z(targets[0].z)}" stroke="#d62828" stroke-width="1.5" stroke-dasharray="3 3"/>`);
          parts.push(`<circle cx="${X(start.x)}" cy="${Z(start.z)}" r="6" fill="#1f6feb" stroke="#fff" stroke-width="2"/><path d="M${X(targets[0].x) - 6} ${Z(targets[0].z) - 6}L${X(targets[0].x) + 6} ${Z(targets[0].z) + 6}M${X(targets[0].x) - 6} ${Z(targets[0].z) + 6}L${X(targets[0].x) + 6} ${Z(targets[0].z) - 6}" stroke="#d62828" stroke-width="3"/>`);
          parts.push(`</g><text x="${ox + size - 4}" y="${oy + size + 16}" font-size="11" text-anchor="end">buildings grey · north up</text>`);
          return;
        }
        const { area, k } = panel, i0 = Math.floor((area.c.x - R) / CELL), j0 = Math.floor((area.c.z - R) / CELL), cells = Math.round(2 * R / CELL);
        parts.push(`<text x="${ox}" y="${oy - 8}" font-size="13" font-weight="600">${esc(area.label)} · floor ${k}${k < 0 ? ' (below the street)' : k === 0 ? ' (street)' : ''}</text>`);
        parts.push(`<rect x="${ox}" y="${oy}" width="${size}" height="${size}" fill="#f4f4f2" stroke="#999"/>`);
        const shown = (x, z) => x >= win.x0 && x <= win.x1 && z >= win.z0 && z <= win.z1 ? built : city;
        for (let dj = 0; dj < cells; dj++) for (let di = 0; di < cells; di++) {
          const i = i0 + di, j = j0 + dj, x = ox + di * px, y = oy + dj * px, b = shown((i + 0.5) * CELL, (j + 0.5) * CELL), id = nodeAt(i, j, k), type = typeOf(b, id);
          if (world.lotAt.get(W.cellKey(i, j)) !== undefined && !type) parts.push(`<rect x="${x}" y="${y}" width="${px}" height="${px}" fill="#c4c4c4"/>`);
          if (!type) continue;
          parts.push(`<rect x="${x}" y="${y}" width="${px}" height="${px}" fill="${KIND[type]?.[1] ?? '#000'}" opacity="${seen[id] ? 1 : 0.28}"/>`);
          let vertical = false; for (let e = b.graph.offsets[id]; e < b.graph.offsets[id + 1]; e++) if (cellOfId(b.graph.to[e]).k !== k) vertical = true;
          if (vertical) parts.push(`<circle cx="${x + px / 2}" cy="${y + px / 2}" r="${Math.max(1.5, px / 4)}" fill="#1d3557"/>`);
        }
        for (let dj = 0; dj < cells; dj++) for (let di = 0; di < cells; di++) {
          const a = world.lotAt.get(W.cellKey(i0 + di, j0 + dj)), right = world.lotAt.get(W.cellKey(i0 + di + 1, j0 + dj)), down = world.lotAt.get(W.cellKey(i0 + di, j0 + dj + 1)), x = ox + di * px, y = oy + dj * px;
          if (a !== right) parts.push(`<line x1="${x + px}" y1="${y}" x2="${x + px}" y2="${y + px}" stroke="#333" stroke-width="1.2"/>`);
          if (a !== down) parts.push(`<line x1="${x}" y1="${y + px}" x2="${x + px}" y2="${y + px}" stroke="#333" stroke-width="1.2"/>`);
        }
        // The run's window edge where it crosses this panel.
        const ex = v => ox + (v / CELL - i0) * px, ez = v => oy + (v / CELL - j0) * px;
        parts.push(`<rect x="${Math.max(ox, ex(win.x0))}" y="${Math.max(oy, ez(win.z0))}" width="${Math.max(0, Math.min(ox + size, ex(win.x1)) - Math.max(ox, ex(win.x0)))}" height="${Math.max(0, Math.min(oy + size, ez(win.z1)) - Math.max(oy, ez(win.z0)))}" fill="none" stroke="#f77f00" stroke-width="2" stroke-dasharray="6 4"/>`);
        parts.push(`<rect x="${Math.max(ox, ex(solverBox.x0))}" y="${Math.max(oy, ez(solverBox.z0))}" width="${Math.max(0, Math.min(ox + size, ex(solverBox.x1)) - Math.max(ox, ex(solverBox.x0)))}" height="${Math.max(0, Math.min(oy + size, ez(solverBox.z1)) - Math.max(oy, ez(solverBox.z0)))}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="2 3"/>`);
        const mark = (p_, draw) => { const di = Math.floor(p_.x / CELL) - i0, dj = Math.floor(p_.z / CELL) - j0; if (di < 0 || dj < 0 || di >= cells || dj >= cells) return; draw(ox + di * px + px / 2, oy + dj * px + px / 2); };
        for (const t of targets) if (t.k === k) mark(t, (x, y) => parts.push(`<path d="M${x - px * 0.7} ${y - px * 0.7}L${x + px * 0.7} ${y + px * 0.7}M${x - px * 0.7} ${y + px * 0.7}L${x + px * 0.7} ${y - px * 0.7}" stroke="#d62828" stroke-width="2.2"/>`));
        if (start.k === k) mark(start, (x, y) => parts.push(`<circle cx="${x}" cy="${y}" r="${Math.max(5, px)}" fill="#1f6feb" stroke="#fff" stroke-width="2"/>`));
        if (nearest && nearest.p.k === k && !reachedTargets && nearest.d > 1) mark(nearest.p, (x, y) => parts.push(`<circle cx="${x}" cy="${y}" r="${Math.max(5, px)}" fill="none" stroke="#f77f00" stroke-width="3"/>`));
        parts.push(`<text x="${ox + size - 4}" y="${oy + size + 16}" font-size="11" text-anchor="end">${2 * R} m across · north up</text>`);
      });
      const ky = H - 40; let kx = 24;
      const key = (label, swatch, width) => { parts.push(`${swatch(kx, ky)}<text x="${kx + 18}" y="${ky}" font-size="12">${label}</text>`); kx += width; };
      for (const [label, colour] of Object.values(KIND)) key(label, (x, y) => `<rect x="${x}" y="${y - 11}" width="12" height="12" fill="${colour}"/>`, 28 + label.length * 6.6);
      key('building, not walkable', (x, y) => `<rect x="${x}" y="${y - 11}" width="12" height="12" fill="#c4c4c4"/>`, 160);
      key('faded: not reached from the start', (x, y) => `<rect x="${x}" y="${y - 11}" width="12" height="12" fill="#d9d4c3" opacity="0.28" stroke="#999"/>`, 215);
      const ky2 = H - 12; kx = 24;
      const key2 = (label, swatch, width) => { parts.push(`${swatch(kx, ky2)}<text x="${kx + 18}" y="${ky2}" font-size="12">${label}</text>`); kx += width; };
      key2('start', (x, y) => `<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="#1f6feb"/>`, 64);
      key2('target', (x, y) => `<path d="M${x} ${y - 10}L${x + 10} ${y}M${x} ${y}L${x + 10} ${y - 10}" stroke="#d62828" stroke-width="2.4"/>`, 70);
      key2('nearest reached', (x, y) => `<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="none" stroke="#f77f00" stroke-width="3"/>`, 128);
      key2('joins another floor', (x, y) => `<circle cx="${x + 6}" cy="${y - 5}" r="3" fill="#1d3557"/>`, 150);
      key2("the run's walk graph", (x, y) => `<rect x="${x}" y="${y - 11}" width="12" height="12" fill="none" stroke="#f77f00" stroke-width="2" stroke-dasharray="3 2"/>`, 160);
      key2("the solver's box", (x, y) => `<rect x="${x}" y="${y - 11}" width="12" height="12" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="2 2"/>`, 130);
      parts.push('</svg>');
      await writeFile(join(out, `${name}.svg`), parts.join(''));
      try { execFileSync('rsvg-convert', ['-o', join(out, `${name}.png`), join(out, `${name}.svg`)]); } catch { /* SVG only */ }
    }
  } });
  await writeFile(join(out, 'why-walk.json'), JSON.stringify(findings, null, 1));
  // The building in 3D (--stills): the run's own page in a headless Chrome, at the card's moment, its people where they
  // stood, the buildings in front seen through; the start and the targets marked. A long trip gets one still at each end.
  if (values.stills) {
    const { browser, serve } = await import('../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../live/sim-jev.mjs');
    const work = join(out, 'page');
    for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
    await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
    const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    try {
      await chrome.size(1440, 900);
      await chrome.open(server.url);
      for (const finding of findings.filter(entry => entry.start && entry.targets?.length)) {
        const scene = page.scenes.find(entry => entry.id === finding.container), t = finding.targets[0], far = finding.metres > 120;
        const ends = far ? [['start', [finding.start]], ['targets', finding.targets]] : [['', [finding.start, ...finding.targets]]];
        for (const [part, points] of ends) {
          const xs = points.map(p => p.x), zs = points.map(p => p.z), span = Math.max(16, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)), top = Math.max(...points.map(p => p.y));
          const spheres = [...(part !== 'targets' ? [{ x: finding.start.x, y: finding.start.y + 2.2, z: finding.start.z, r: 0.9, label: 'start', labelScale: 1.2 }] : []), ...(part !== 'start' ? [{ x: t.x, y: t.y + 2.2, z: t.z, r: 0.9, label: 'target', labelScale: 1.2 }] : [])];
          for (const [view, elevation, yaw] of [['side', 28, 0.6], ['above', 70, 0]]) {
            await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `${finding.name}-${view}`, scene: finding.container, event: finding.card, place: scene?.place, mover: finding.who, people: true, mask: true, frame: [1440, 900], focus: { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, y0: 0, w: span, d: span, h: top + 6 }, radius: Math.max(22, span * 0.9, top * 0.8), elevation, yaw, spheres })})`);
            await writeFile(join(out, `${finding.name}${part ? `-${part}` : ''}-${view}.png`), Buffer.from(await chrome.still('png'), 'base64'));
          }
        }
      }
    } finally { await chrome.close(); server.server.close(); }
  }
  for (const entry of findings) console.log(`${entry.name}: ${entry.finding ?? `${entry.metres} m, reached ${entry.reachedTargets}/${entry.targets?.length}${entry.startIsTarget ? ', start is a target' : ''}, reachable ${entry.reachable} ${JSON.stringify(entry.reachableByFloor)}`}`);
  process.exit(0);
}

function esc(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
