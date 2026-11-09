import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadGraph, drive, kerbOf, SPEEDS } from './roads.mjs';

// A cross of two arterials and a side street ending in the middle of one (a T, as the city fill makes them).
const ROADS = [
  [-200, 0, 200, 0, 18, 'arterial'],
  [0, -200, 0, 200, 18, 'arterial'],
  [100, 0, 100, 150, 8, 'local'],
];

test('streets split where they cross and where a side street ends on one', () => {
  const g = roadGraph({ roads: ROADS });
  const at = (x, z) => g.nodes.findIndex((node) => Math.hypot(node.x - x, node.z - z) < 1);
  assert.ok(at(0, 0) >= 0, 'the crossing is a junction');
  assert.ok(at(100, 0) >= 0, 'the T is a junction');
  assert.equal(g.adj[at(0, 0)].length, 4);
  assert.equal(g.adj[at(100, 0)].length, 3);
});

test('a drive keeps left of the way it goes and takes as long as its roads allow', () => {
  const g = roadGraph({ roads: ROADS });
  const route = drive(g, [-190, 5], [100, 140]);
  assert.ok(route, 'a way by road');
  // Going east along z = 0, the left is -z (north): the lane is on the negative side.
  const east = route.pts.slice(2).filter(([x, , z]) => x > -201 && x < 1 && Math.abs(z) < 10); // past the door and the kerb
  assert.ok(east.length && east.every(([, , z]) => z < -1), `keeps left (${east.map((p) => p[2]).join(', ')})`);
  const seconds = 290 / (SPEEDS.arterial / 3.6) + 140 / (SPEEDS.local / 3.6);
  assert.ok(route.seconds > seconds * 0.9 && route.seconds < seconds * 1.3, `${route.seconds} s against ${Math.round(seconds)} s`);
  assert.ok(route.pts.every(([, y]) => y === 0), 'all on the street');
});

test('the expressway joins the streets only at its ramps, and a long trip takes it', () => {
  const roads = [[-1000, 0, 1000, 0, 8, 'local'], [-1000, 40, -1000, -40, 8, 'local'], [1000, 40, 1000, -40, 8, 'local']];
  const line = { a: 'A', b: 'B', why: 'tree', pts: Array.from({ length: 501 }, (_, n) => [-1000 + n * 4, 60]), tunnel: Array(501).fill(0), shared: Array(501).fill(0) };
  const leg = (x0, x1) => Array.from({ length: 21 }, (_, n) => [x0 + ((x1 - x0) * n) / 20, 60, (12 * n) / 20]);
  const highway = { knobs: { deckHeight: 12, tunnelDepth: 12 }, lines: [line], ramps: [{ hub: 'A', at: [-900, 0], under: false, legs: [leg(-900, -780)] }, { hub: 'B', at: [900, 0], under: false, legs: [leg(900, 780)] }] };
  const g = roadGraph({ roads, highways: [highway] });
  assert.ok(g.nodes.some((node) => node.kind === 'highway' && node.y === 12));
  const route = drive(g, [-950, 0], [950, 0]);
  assert.ok(route.highway > 1200, `rides the deck ${route.highway} m`);
  assert.ok(route.pts.some(([, y]) => y === 12), 'up on the deck');
  const short = drive(g, [-100, 0], [100, 0]);
  assert.equal(short.highway, 0, 'a short trip stays on the street');
  assert.equal(kerbOf(g, 5000, 5000), null, 'nothing within reach far away');
});
