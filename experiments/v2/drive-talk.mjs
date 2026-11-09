// Talk while driving, on roads and the expressway (the user, 2026-11-08: "wire the highway transport system in, rebuild
// the terrain, and work on the dialogue/action while driving"). Volume 3's drive (the moving-talk experiment's staged
// sample `v3drive`: two walk through a car park to the 4WD, then four ride it, talking) staged on a city that has a kept
// highway, the drive laid by the road graph (world-engine/world/roads.mjs):
//   A  as the director played a drive before: the walk on its action card, the whole drive on the drive's action card at
//      the car's own speed, the talk after it standing or sitting in the stopped car;
//   H  talk while driving (on-the-move.mjs cutDrive, as the director now plays it): the walk spread over its cards, then
//      the drive at the car's own speed cut across the ride's cards by their reading.
// Private output: it carries the book's lines.
//   node experiments/v2/drive-talk.mjs <run page.json with highways> <moving-talk spec.json> <out dir> [base scene]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceScene, stageUnit, talkInMotion, nodeOf, cellOf } from './moving-talk.mjs';
import { roadGraph, drive, kerbOf } from '../../world-engine/world/roads.mjs';
import { cutDrive, readSeconds, DEMO } from '../../world-engine/director/on-the-move.mjs';
import { inlineStrand } from '../../world-engine/world/export-strand-demo.mjs';

const CELL = 2, FLOOR = 3;
const repo = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

/** Where to drive: a pair of kerbs near two different ramps of the city's highway (a deck's or a tunnel's), both on the page's grid, the drive between them taking the highway. */
export function pickDrive(graph, highways, inGrid) {
  const ramps = highways.flatMap((highway) => highway.ramps.map((ramp) => ({ ...ramp, city: highway.city.id })));
  let best = null;
  for (const a of ramps) for (const b of ramps) {
    if (a === b) continue;
    for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60], [90, 90], [-90, -90]]) {
      const from = kerbOf(graph, a.at[0] + dx, a.at[1] + dz, 40), to = kerbOf(graph, b.at[0] - dx, b.at[1] - dz, 40);
      if (!from || !to || !inGrid(from.at) || !inGrid(to.at)) continue;
      const route = drive(graph, from.at, to.at);
      if (!route || !route.pts.every(([x, , z]) => inGrid([x, z]))) continue;
      const score = route.highway - 0.2 * route.metres;
      if (route.highway > 200 && (!best || score > best.score)) best = { score, from: from.at, to: to.at, route, a: a.label, b: b.label };
    }
  }
  return best;
}

export function nodesOfRoute(place, pts) {
  const nodes = [], at = [];
  for (const [x, y, z, t] of pts) {
    const node = nodeOf(place, { i: Math.floor(x / CELL), j: Math.floor(z / CELL), k: Math.round(y / FLOOR) });
    if (nodes.at(-1) === node) { at[at.length - 1] = t; continue; }
    nodes.push(node); at.push(Math.round(t * 100) / 100);
  }
  at[0] = 0;
  return { nodes, at };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pageFile, specFile, outDir, baseScene] = process.argv.slice(2);
  if (!outDir) { console.error('usage: node experiments/v2/drive-talk.mjs <run page.json> <spec.json> <out dir> [base scene]'); process.exit(2); }
  const page = JSON.parse(await readFile(pageFile, 'utf8')), spec = JSON.parse(await readFile(specFile, 'utf8')), sample = spec.samples.find((entry) => entry.id === 'v3drive');
  const template = await readFile(join(repo, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  if (!page.highways?.length) throw new Error('the page has no highway: build the terrain\'s transport step first');
  const sceneId = baseScene ?? page.scenes.find((scene) => page.places[scene.place]?.path?.length >= 2 && page.scenes.some(() => true))?.id;
  const base = sliceScene(page, sceneId), place = base.places[base.scenes[0].place];
  const inGrid = ([x, z]) => { const i = Math.floor(x / CELL), j = Math.floor(z / CELL); return i + place.oi >= 2 && i + place.oi < place.NX - 2 && j + place.oj >= 2 && j + place.oj < place.NZ - 2; };
  const graph = roadGraph({ roads: page.landscapes.flatMap((entry) => entry.roads ?? []), highways: page.highways });
  const chosen = pickDrive(graph, page.highways, inGrid);
  if (!chosen) throw new Error('no drive between two ramps on this page\'s grid');
  const drove = nodesOfRoute(place, chosen.route.pts);
  // The walk to the car: 36 m across the car park toward the kerb where the drive starts, the last node the car's.
  const [cx, cz] = chosen.from, dir = (() => { const [x1, , z1] = chosen.route.pts[3] ?? chosen.route.pts.at(-1); const L = Math.hypot(x1 - cx, z1 - cz) || 1; return [(x1 - cx) / L, (z1 - cz) / L]; })();
  const away = [cx - dir[1] * 36, cz + dir[0] * 36], walk = [];
  for (let s = 0; s <= 36; s += 2) { const node = nodeOf(place, { i: Math.floor((away[0] + (cx - away[0]) * (s / 36)) / CELL), j: Math.floor((away[1] + (cz - away[1]) * (s / 36)) / CELL), k: 0 }); if (walk.at(-1) !== node) walk.push(node); }
  walk.push(drove.nodes[0]);
  const stage = sample.stage, people = Object.fromEntries(Object.entries(stage.people).map(([who, person]) => [who, { ...person, at: person.at === 0 ? 0 : 1 }]));
  const unit = stageUnit(base, { id: 'v3drive', people, cards: stage.cards, route: [walk[0], drove.nodes[0]], hour: stage.hour ?? 17 });
  const scene = unit.scenes[0], weights = scene.events.map((event, index) => readSeconds((unit.director.cards[index]?.lines ?? []).map((line) => ({ text: line.text, kind: line.kind }))));
  const [walkPhase, ridePhase] = stage.phases, walkers = [...walkPhase.who, ...(walkPhase.beside ?? [])], riders = ridePhase.who;
  const lengthOf = (nodes) => nodes.slice(1).reduce((s, node, n) => { const a = cellOf(place, nodes[n]), b = cellOf(place, node); return s + Math.hypot((b.i - a.i) * CELL, (b.j - a.j) * CELL, (b.k - a.k) * FLOOR); }, 0);
  const options = {};
  for (const option of ['A', 'H']) {
    const events = scene.events.map((event) => ({ ...event, moves: [] }));
    if (option === 'A') {
      for (const who of walkers) events[walkPhase.act].moves.push({ person: who, how: 'walk', with: null, ensemble: [], path: walk });
      for (const who of riders) events[ridePhase.act].moves.push({ person: who, how: 'ride', with: null, ensemble: [], path: drove.nodes, at: drove.at });
    } else {
      // The walk spread over its cards, each piece as long as its card's lines (the walking talk the director already has).
      const cards = walkPhase.cards, total = cards.reduce((s, k) => s + weights[k], 0), metres = lengthOf(walk);
      let start = 0, so = 0;
      cards.forEach((k, n) => { so += weights[k]; let end = n === cards.length - 1 ? walk.length - 1 : Math.min(walk.length - 1, Math.round((so / total) * (walk.length - 1))); if (end > start) { const piece = walk.slice(start, end + 1), pace = Math.max(0.3, Math.min(1.4, lengthOf(piece) / (weights[k] * DEMO))); for (const who of walkers) events[k].moves.push({ person: who, how: 'walk', with: null, ensemble: [], path: piece, pace }); } start = end; });
      void metres;
      // The drive at its own speed, cut across the ride's cards by their reading.
      const cuts = cutDrive(drove.at, ridePhase.cards.map((k) => weights[k]));
      cuts.forEach(([from, to], n) => { if (to <= from) return; const k = ridePhase.cards[n], at = drove.at.slice(from, to + 1).map((t) => Math.round((t - drove.at[from]) * 100) / 100); for (const who of riders) events[k].moves.push({ person: who, how: 'ride', with: null, ensemble: [], path: drove.nodes.slice(from, to + 1), at, real: true }); });
    }
    options[option] = { ...unit, scenes: [{ ...scene, events }] };
  }
  await mkdir(outDir, { recursive: true });
  const made = [];
  for (const [option, data] of Object.entries(options)) {
    await writeFile(join(outDir, `drive-${option}.html`), inlineStrand(template, data, { name: `Volume 3's drive · ${option}`, vendor: true }), { mode: 0o600 });
    const rideCards = ridePhase.cards.filter((k) => data.scenes[0].events[k].moves.some((move) => move.how === 'ride'));
    made.push({ option, file: `drive-${option}.html`, rideCards: rideCards.length, ...talkInMotion(data) });
  }
  const talkSeconds = ridePhase.cards.reduce((s, k) => s + weights[k], 0);
  // Which cards of H drive and which are parked (for the page).
  await writeFile(join(outDir, 'drive-H.cards.json'), JSON.stringify(options.H.scenes[0].events.map((event) => (event.moves.some((move) => move.how === 'ride') ? 'drive' : event.moves.length ? 'walk' : null))), { mode: 0o600 });
  const report = { base: sceneId, from: chosen.from.map(Math.round), to: chosen.to.map(Math.round), ramps: [chosen.a, chosen.b], metres: chosen.route.metres, highway: chosen.route.highway, waits: chosen.route.waits, waited: chosen.route.waited, driveSeconds: chosen.route.seconds, driveOnScreenA: Math.round((chosen.route.seconds / DEMO) * 10) / 10, rideTalkOnScreen: Math.round(talkSeconds * 10) / 10, rideCards: ridePhase.cards.length, made };
  await writeFile(join(outDir, 'drive.json'), JSON.stringify(report, null, 1), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 1));
}
