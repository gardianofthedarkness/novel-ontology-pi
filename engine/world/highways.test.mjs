import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHighway, groundEffect, lengthOf } from './highways.mjs';

// A small city: a grid of arterials every 160 m, three districts, one of them named ground in its middle.
const CITY = { id: 'city', x: 1000, z: -500, r: 700 };
const roads = [];
for (let v = -640; v <= 640; v += 160) { roads.push([CITY.x - 680, CITY.z + v, CITY.x + 680, CITY.z + v, 18, 'arterial'], [CITY.x + v, CITY.z - 680, CITY.x + v, CITY.z + 680, 18, 'arterial']); }
const ring = (cx, cz, r) => Array.from({ length: 24 }, (_, n) => [cx + Math.cos((n / 24) * 2 * Math.PI) * r, cz + Math.sin((n / 24) * 2 * Math.PI) * r]);
const patches = [
  { id: 'p0', centre: [CITY.x, CITY.z], radius: 680, height: 22, outline: ring(CITY.x, CITY.z, 680) },
  { id: 'named', centre: [CITY.x + 30, CITY.z + 30], radius: 60, height: 40, outline: ring(CITY.x + 30, CITY.z + 30, 60) },
];
const districts = [
  { id: 'd1', x: CITY.x - 400, z: CITY.z, r: 250, scenes: 10 },
  { id: 'd2', x: CITY.x + 400, z: CITY.z, r: 250, scenes: 8 },
  { id: 'd3', x: CITY.x, z: CITY.z + 420, r: 250, scenes: 4 },
];
const ground = { roads, waters: [], patches, named: ['named'] };

test('links the districts, rides the roads, never takes a named lot, and keeps what it built', () => {
  const first = planHighway({ city: CITY, districts, ground, at: 't0' });
  assert.ok(first.links.length >= 2, `${first.links.length} links`);
  assert.equal(first.lines.filter((line) => line.failed).length, 0);
  assert.equal(first.report.footprint.named, 0, 'no deck over a named lot');
  assert.ok(first.report.footprint.road >= 50, `mostly over roads (${first.report.footprint.road}%)`);
  for (const line of first.lines) assert.ok(lengthOf(line.pts) > 300);
  assert.ok(first.ramps.length >= 2, `${first.ramps.length} ramps`);
  // Nothing new: the same record back.
  assert.equal(planHighway({ city: CITY, districts, ground, keep: first, at: 't1' }), first);
  // A new district: the kept lines stay exactly; at most a link is added.
  const more = [...districts, { id: 'd4', x: CITY.x, z: CITY.z - 420, r: 250, scenes: 6 }];
  const second = planHighway({ city: CITY, districts: more, ground, keep: first, at: 't2' });
  for (const line of first.lines) assert.ok(second.lines.some((other) => JSON.stringify(other.pts) === JSON.stringify(line.pts)), 'kept line unchanged');
  assert.ok(second.links.length >= first.links.length);
  assert.equal(second.built, 't0');
});

test('the buildings read the line one way: taken under it, taller near a ramp, the floor area kept', () => {
  const highway = planHighway({ city: CITY, districts, ground, at: 't0' });
  const deck = highway.decks[0], mid = deck[Math.floor(deck.length / 2)], foot = highway.ramps[0].at;
  const buildings = [
    { x: mid[0], z: mid[1], w: 20, d: 20, angle: 0, floors: 6, fixed: false },
    { x: foot[0] + 40, z: foot[1] + 40, w: 20, d: 20, angle: 0, floors: 6, fixed: false },
    { x: CITY.x + 600, z: CITY.z + 600, w: 20, d: 20, angle: 0, floors: 6, fixed: false },
    { x: foot[0] + 30, z: foot[1] - 40, w: 20, d: 20, angle: 0, floors: 9, fixed: true },
  ];
  const effect = groundEffect(highway, buildings);
  assert.equal(effect[0].taken, 'deck');
  assert.ok(effect[1].floors > effect[2].floors, `near ${effect[1].floors} against far ${effect[2].floors}`);
  assert.equal(effect[3].floors, 9, 'the text\'s own keep theirs');
  const area = (list) => list.reduce((s, f, n) => s + (buildings[n].fixed || effect[n].taken ? 0 : 400 * f), 0);
  assert.ok(Math.abs(area(effect.map((e) => e.floors)) - area(buildings.map((b) => b.floors))) <= 400 * 2, 'floor area kept (within rounding)');
});
