#!/usr/bin/env node
/**
 * A small mock of the auto-filled city (src/ground/stage/cityFill.ts), with no book in it:
 * - an invented city filled from its seed;
 * - three districts born one after another;
 * - a named street borrowing a road;
 * - named buildings borrowing lots (a hospital, a whole block);
 * - two people with no stated start;
 * - one growth step after a scene drifts past the edge.
 * Written as one page (playground/city-fill-mock.html with the data inlined) to look at, and as stills.
 *
 *   npm run build && node playground/city-fill-mock.mjs <out.html> [--vendor]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { materialize, placeChild, borrowLots, borrowRoad, spawnOf, growToReach } = await import(pathToFileURL(`${repository}/dist/src/ground/stage/cityFill.js`));
const [out = `${repository}/apps/playground/city-fill-mock.html`] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), vendor = process.argv.includes('--vendor');

// The invented city as born: 900 m across.
const city = { seed: 'mock-city', r0: 450, r: 450 }, parent = { x: 0, z: 0, r: city.r0 };
const fabric = materialize(city);
// Places born one after another; each is placed once and kept.
const places = [];
for (const [n, [name, r]] of [['North Ward', 150], ['River Ward', 130], ['Old Town', 120]].entries()) places.push({ name, born: n + 1, ...placeChild(parent, places, r, `mock-${name}`) });
const ward = name => places.find(place => place.name === name);
// A named street borrows a road in its district; named buildings borrow lots (a hospital needs a whole block).
const takenRoads = new Set(), takenLots = new Set(), street = borrowRoad(fabric, ward('Old Town'), [80, 260], takenRoads, 'mock-market-street');
if (street) takenRoads.add(street);
const FLOORS = { hospital: 9, school: 4, tower: 22, shop: 2 };
const named = [['General Hospital', 'hospital', { circle: ward('River Ward') }], ['Academy', 'school', { circle: ward('North Ward') }], ['Clock Tower', 'tower', { road: street }], ['Corner Café', 'shop', { road: street }]].flatMap(([name, kind, region]) => {
  const borrowed = borrowLots(fabric, region, kind, takenLots, `mock-${name}`);
  if (!borrowed) return [];
  borrowed.lots.forEach(id => takenLots.add(id));
  // The named building over its ground: the footprint of its lots, faced to the first lot's road, set back 3 m.
  const lots = borrowed.lots.map(id => fabric.lots.find(lot => lot.id === id)), [a, b] = [lots[0].frontage.a, lots[0].frontage.b], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], v = [-u[1], u[0]], pts = lots.flatMap(lot => lot.pts), us = pts.map(p => p[0] * u[0] + p[1] * u[1]), vs = pts.map(p => p[0] * v[0] + p[1] * v[1]);
  const cu = (Math.max(...us) + Math.min(...us)) / 2, cv = (Math.max(...vs) + Math.min(...vs)) / 2;
  return [{ name, kind, lots: borrowed.lots, block: borrowed.block ?? null, x: u[0] * cu + v[0] * cv, z: u[1] * cu + v[1] * cv, w: Math.max(6, Math.max(...us) - Math.min(...us) - 6), d: Math.max(6, Math.max(...vs) - Math.min(...vs) - 6), angle: Math.atan2(u[1], u[0]), floors: FLOORS[kind] }];
});
// People with no stated start: the door of a free lot near the middle of the place they are known to be in.
const spawns = [['Aya', 'River Ward', '#ff8fb1'], ['Ben', 'Old Town', '#7ce6ff']].map(([name, place, color]) => ({ name, place, color, ...spawnOf(fabric, ward(place), name, `mock-${place}`, takenLots) }));
// A scene in North Ward drifts past the city's edge: the city grows outward; nothing inside moves.
const north = ward('North Ward'), away = Math.hypot(north.x, north.z) || 1, point = [north.x / away * (city.r0 + 40), north.z / away * (city.r0 + 40)], grown = growToReach(city, point);
const started = Date.now(), grownCity = { ...city, r: grown.r }, full = materialize(grownCity), ms = Date.now() - started;
const bornLots = new Set(fabric.lots.map(lot => lot.id)), buildings = full.buildings.filter(b => !takenLots.has(b.lot)).sort((p, q) => Number(!bornLots.has(p.lot)) - Number(!bornLots.has(q.lot)));
const round = value => Math.round(value * 10) / 10, roundPoint = p => [round(p[0]), round(p[1])];
const data = {
  title: 'Mock City, filled from its seed', city: { r0: city.r0, r: round(grown.r) },
  roads: full.roads.map(road => ({ a: roundPoint(road.a), b: roundPoint(road.b), width: road.width, level: road.level, ...(road.id === street ? { named: true } : {}) })),
  bornRoads: fabric.roads.map(road => ({ a: roundPoint(road.a), b: roundPoint(road.b), width: road.width, level: road.level, ...(road.id === street ? { named: true } : {}) })),
  buildings: buildings.map(b => ({ x: round(b.x), z: round(b.z), w: round(b.w), d: round(b.d), angle: Math.round(b.angle * 1000) / 1000, floors: b.floors })), bornBuildings: buildings.filter(b => bornLots.has(b.lot)).length,
  named: named.map(b => ({ ...b, x: round(b.x), z: round(b.z), w: round(b.w), d: round(b.d) })), places: places.map(p => ({ ...p, x: round(p.x), z: round(p.z) })),
  spawns: spawns.map(s => ({ ...s, door: roundPoint(s.door) })), drift: { point: roundPoint(point), steps: grown.steps },
  counts: { lots: full.lots.length, buildings: full.buildings.length, roads: full.roads.length, ms },
  legend: ['Blue ring: the city as born (900 m). Gold ring: after one growth step (× 1.3), when a scene in North Ward drifted past the edge (red dot); everything inside stayed as it was.', 'Green rings: districts, placed in birth order and never moved.', 'Gold: named buildings on the lots they borrowed (the hospital takes a whole block) and the named street on its road.', 'Pins: people with no stated start, at a door near the middle of their district.'],
};
let page = await readFile(`${repository}/playground/city-fill-mock.html`, 'utf8');
if (vendor) page = page.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/');
page = page.replace('<script type="application/json" id="fill-data">null</script>', () => `<script type="application/json" id="fill-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
await writeFile(out, page);
console.log(JSON.stringify({ out, ...data.counts, places: data.places.map(p => `${p.name} (${p.x}, ${p.z}) r${p.r}`), street, named: named.map(b => `${b.name}: ${b.lots.length} lot(s)${b.block ? ' (a block)' : ''}`), spawns: spawns.map(s => `${s.name} → ${s.lot}`), grown: data.city }));
