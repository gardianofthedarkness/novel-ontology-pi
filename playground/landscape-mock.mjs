#!/usr/bin/env node
/**
 * A mock place of mixed landscapes (src/ground/stage/landscape.ts), with no book in it:
 * - a city filled from its centre (skyscrapers), with parts added where scenes drift past its edge (commercial,
 *   residential);
 * - districts placed beside it, each filled from its own centre (a castle quarter, docks, a village, fields);
 * - every circle grown to hold what was placed in it, and a named building pinned to a lot it borrowed.
 * Written as one page (playground/landscape-mock.html with the data inlined: cyan holograms, baked Kenney models and
 * procedural forms per landscape) to look at, and as stills.
 *
 *   npm run build && node playground/landscape-mock.mjs <out.html> [--vendor]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(`${repository}/dist/src/ground/stage/landscape.js`));
const { borrowLots } = await import(pathToFileURL(`${repository}/dist/src/ground/stage/cityFill.js`));
const [out = `${repository}/apps/playground/landscape-mock.html`] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), vendor = process.argv.includes('--vendor');
const COLOR = { skyscrapers: '#bfeaff', commercial: '#5fd4c8', residential: '#e6b980', industrial: '#9aa7b2', village: '#c7a27a', castle: '#d8cfb8', farm: '#8fcf6a' };
const FIELD = ['#3d5a2a', '#55702e', '#6b6a2c', '#4a6b3a'];

// The city: skyscrapers at its centre (its core set to peak at 600 m, to show tall ground meeting lower ground); a
// strand's scenes drift east, then south, past the edge, and the city grows there.
let city = L.firstLandscape('mock-city', 'skyscrapers', { by: 'strand', strand: 'mock-strand-1' });
city = { ...city, patches: [{ ...city.patches[0], H: 600 }] };
const growth = [{ radius: Math.round(L.circleOf(city)), by: 'birth' }];
for (const [type, toward, strand] of [['commercial', [1, 0.2], 'mock-strand-1'], ['residential', [-0.2, 1], 'mock-strand-2']]) {
  const edge = city.patches.reduce((far, patch) => Math.max(far, Math.hypot(patch.x, patch.z) + patch.R), 0), drift = [toward[0] * (edge + 5), toward[1] * (edge + 5)];
  city = L.addPatch(city, type, drift, { by: 'drift', strand });
  growth.push({ radius: Math.round(L.circleOf(city)), by: `${type} part, a scene drifted to (${Math.round(drift[0])}, ${Math.round(drift[1])})`, drift });
}
// Districts beside the city's filled centre, each with its own landscape, filled from its own centre.
const placed = [{ id: 'mock-city', name: 'Mock City', x: 0, z: 0, landscape: city }], occupied = [{ x: 0, z: 0, r: L.circleOf(city) }];
for (const [name, type, toward] of [['Old Quarter', 'castle', [-1, -0.6]], ['Dock Works', 'industrial', [0.7, -1]], ['Pier', 'harbour', [1.2, -0.3]], ['Funland', 'park', [0, -1]], ['Arena', 'stadium', [-0.4, 1]], ['Green Hamlet', 'village', [-1, 0.8]], ['Outer Fields', 'farm', [1, 1]]]) {
  const landscape = L.firstLandscape(`mock-${name}`, type, { by: 'strand' }), at = L.placeBeside(occupied, L.circleOf(landscape), `mock-${name}`, toward);
  occupied.push(at); placed.push({ id: `mock-${name}`, name, x: at.x, z: at.z, landscape });
}
const outer = Math.max(...occupied.map(c => Math.hypot(c.x, c.z) + c.r)) + 15;
// Fill every place; a named building borrows a lot in the commercial part and is pinned there.
const round = v => Math.round(v * 10) / 10, P = (p, o) => [round(p[0] + o.x), round(p[1] + o.z)];
const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8'));
const data = { title: 'A place of mixed landscapes, each filled from its centre', extent: Math.round(outer), models: Object.fromEntries(Object.entries(library.models).filter(([id]) => /^(skyscraper|tower|office|block-wide|keep|fountain)/.test(id))), roads: [], buildings: [], named: [], places: [], fields: [], walls: [], outlines: [], growth, counts: { lots: 0, buildings: 0, roads: 0, ms: 0 } };
const started = Date.now();
for (const place of placed) {
  const filled = L.fillLandscape(place.landscape), owner = filled.owner, typeOf = Object.fromEntries(place.landscape.patches.map(p => [p.id, p.type]));
  let pinned = new Set();
  if (place.id === 'mock-city') {
    const commercial = place.landscape.patches.find(p => p.type === 'commercial'), borrowed = borrowLots(filled.fabric, { circle: { x: commercial.x, z: commercial.z, r: commercial.R * 0.6 } }, 'tower', new Set(), 'mock-clock-tower');
    if (borrowed) {
      pinned = new Set(borrowed.lots);
      const lot = filled.fabric.lots.find(l => l.id === borrowed.lots[0]), [a, b] = [lot.frontage.a, lot.frontage.b], angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      data.named.push({ name: 'Clock Tower (named, pinned)', x: round(lot.centre[0] + place.x), z: round(lot.centre[1] + place.z), w: 14, d: 14, angle, floors: 24, lots: borrowed.lots, form: 'sky-spire' });
    }
  }
  for (const road of filled.fabric.roads) data.roads.push({ a: P(road.a, place), b: P(road.b, place), width: road.width, level: road.level });
  for (const b of filled.fabric.buildings) if (!pinned.has(b.lot)) data.buildings.push({ x: round(b.x + place.x), z: round(b.z + place.z), w: round(b.w), d: round(b.d), angle: Math.round(b.angle * 1000) / 1000, floors: b.floors, k: b.kind });
  // Landmarks: a core's signature tower, a stadium's bowl, a plaza's fountain; plazas as open ground.
  for (const mark of filled.landmarks) data.buildings.push({ x: round(mark.x + place.x), z: round(mark.z + place.z), w: mark.w, d: mark.d, angle: mark.angle, floors: mark.floors, k: mark.kind, ...(mark.kind === 'skyscraper' ? { form: 'sky-spire' } : {}) });
  for (const plaza of filled.plazas) data.fields.push({ pts: Array.from({ length: 32 }, (_, n) => [round(place.x + plaza.x + plaza.r * Math.cos(n / 16 * Math.PI)), round(place.z + plaza.z + plaza.r * Math.sin(n / 16 * Math.PI))]), o: 0.1 });
  for (const keep of filled.keeps) data.buildings.push({ x: round(keep.x + place.x), z: round(keep.z + place.z), w: keep.w * 1.6, d: keep.d * 1.6, angle: keep.angle, floors: keep.floors, k: 'keep' });
  // Fields and lawns: the farm's and the park's open lots.
  for (const lot of filled.fabric.lots) if (['farm', 'park'].includes(typeOf[owner[lot.id]])) data.fields.push({ pts: lot.pts.map(p => P(p, place)), o: typeOf[owner[lot.id]] === 'farm' ? 0.07 : 0.04 });
  for (const [a, b] of filled.walls) data.walls.push({ a: P(a, place), b: P(b, place) });
  for (const patch of place.landscape.patches) data.outlines.push({ c: COLOR[patch.type], pts: Array.from({ length: 96 }, (_, n) => { const t = n / 96 * Math.PI * 2, r = L.reachOf(patch, [patch.x + Math.cos(t), patch.z + Math.sin(t)]); return [round(place.x + patch.x + r * Math.cos(t)), round(place.z + patch.z + r * Math.sin(t))]; }), label: `${patch.type}${patch.born?.by === 'drift' ? ' (drift)' : ''}`, at: [round(place.x + patch.x), round(place.z + patch.z)] });
  data.places.push({ name: place.name, born: place.landscape.patches.map(p => p.type).join(' + '), x: round(place.x), z: round(place.z), r: Math.round(L.circleOf(place.landscape)) });
  data.counts.lots += filled.fabric.lots.length; data.counts.buildings += filled.fabric.buildings.length; data.counts.roads += filled.fabric.roads.length;
}
data.counts.ms = Date.now() - started;
const tallest = Math.max(...data.buildings.map(b => b.floors * 3));
data.facts = `${data.counts.lots} lots, ${data.counts.buildings} buildings, ${data.counts.roads} roads in ${data.places.length} places, each filled from its centre (${data.counts.ms} ms). The tallest building: ${tallest} m. The city's circle grew ${growth.map(step => `${step.radius} m`).join(' → ')}.`;
data.drift = { point: growth.at(-1).drift, steps: growth.length - 1 };
data.kept = placed.map(place => ({ place: place.id, landscape: place.landscape, at: { x: place.x, z: place.z } }));
data.legend = ['Each place is filled from its centre only; empty ground lies between places.', 'Mock City: a skyscraper core peaking at 600 m, then a commercial part and a living area, each added where a scene drifted past the edge (red dot: the last drift); modern ground merges, so the new parts rise to meet the core at the seam. Its circle grew each time.', 'Beside it, each with its own landscape: Old Quarter (a castle: walls and a keep), Dock Works (industry), Pier (a harbour), Funland (an amusement park), Arena (a stadium), Green Hamlet (a village), Outer Fields (farmland). The core has a signature tower at its 600 m peak and streets 2.5 times as wide; the commercial part a plaza with a fountain and a boulevard. Ancient ground (castle, village, farm) never overlaps anything and keeps its height cap.', 'All drawn as cyan holograms: baked Kenney models (towers, skyscrapers, offices, the keep) and forms per landscape (stepped towers and spires, slabs, gabled houses, sawtooth halls, warehouses and cranes, pavilions and a Ferris wheel, cottages, farmhouses with silos). White: a named building pinned to the lot it borrowed.', `What is kept, per place: its patches (type, centre, radius, height, lot size, seed and shape numbers), ${JSON.stringify(data.kept).length} bytes for all seven; the filling is drawn again from them.`];
let page = await readFile(`${repository}/playground/landscape-mock.html`, 'utf8');
if (vendor) page = page.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/');
page = page.replace('<script type="application/json" id="fill-data">null</script>', () => `<script type="application/json" id="fill-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
await writeFile(out, page);
console.log(JSON.stringify({ out, ...data.counts, places: data.places.map(p => `${p.name}: ${p.born}, r ${p.r} at (${p.x}, ${p.z})`), growth: growth.map(g => `${g.radius} m (${g.by})`), kept: JSON.stringify(data.kept).length }));
