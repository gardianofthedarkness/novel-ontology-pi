// Windows on a building's rooms: only outer walls, never doors, the kind's pattern, seeded, a balcony upstairs by chance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPENING, heightsOf, patternOf, useOfModel, windowsOf } from './windows.mjs';

const TABLE = JSON.parse(readFileSync(new URL('../../config/windows.json', import.meta.url), 'utf8'));
// A plan of 6 x 4 cells and 2 floors: a corridor along j = 2 (tiles '1'), rooms north of it (j 0..1) and one south (j 3);
// the room at i 0..2 has its door on the corridor (cell (1, 2)).
const plan = (role, k0 = 0) => {
  const sx = 6, sz = 4, cells = Array.from({ length: 2 * sz * sx }, (_, n) => (Math.floor(n / sx) % sz === 2 ? '1' : '0')).join('');
  const at = (k, i, j) => (k * sz + j) * sx + i;
  return { sx, sz, cells, floors: 2, k0, role, rooms: [[0, 0, 0, 2, 1, 0, 0, [at(0, 1, 2)]], [0, 3, 0, 5, 1, 0, 0, [at(0, 4, 2)]], [1, 0, 0, 5, 1, 1, 0, [at(1, 2, 2)]], [0, 0, 3, 5, 3, 0, 0, [at(0, 2, 2)]]] };
};

test('windows only on outer walls, never toward the corridor or a door; the same every time for the same lot', () => {
  const lot = plan('office'), out = windowsOf(lot, TABLE, 'lot-a');
  assert.ok(out.length > 0);
  for (const [k, i, j, side] of out) {
    const [di, dj] = [[0, -1], [0, 1], [-1, 0], [1, 0]][side], ni = i + di, nj = j + dj;
    assert.ok(ni < 0 || nj < 0 || ni >= lot.sx || nj >= lot.sz, `floor ${k} cell ${i},${j} side ${side} faces the plan's edge`);
  }
  assert.deepEqual(windowsOf(lot, TABLE, 'lot-a'), out, 'seeded');
  assert.equal(out.filter(([, , j, side]) => j === 1 && side === 1).length, 0, 'none on the corridor side');
});

test('the kind decides: an office a window every cell, a home every other with balconies upstairs, a shop glass on the ground floor', () => {
  const office = windowsOf(plan('office'), TABLE, 's'), home = windowsOf(plan('home'), TABLE, 's'), shop = windowsOf(plan('shop'), TABLE, 's');
  assert.ok(office.length > home.length, 'denser');
  assert.ok(shop.filter(([k]) => k === 0).every(entry => entry[4] === OPENING.storefront), 'ground floor glass');
  const balconies = [0, 1, 2, 3, 4, 5, 6, 7].flatMap(n => windowsOf(plan('home'), TABLE, `s${n}`)).filter(entry => entry[4] === OPENING.balcony);
  assert.ok(balconies.length > 0 && balconies.every(([k]) => k >= 1), 'balconies only above the ground floor');
  assert.deepEqual(windowsOf(plan('home'), { ...TABLE, roles: { home: { every: 0 } } }, 's'), [], 'every 0: none');
  assert.deepEqual([heightsOf(OPENING.window, patternOf({ role: 'office' }, TABLE)), heightsOf(OPENING.balcony)], [[0.8, 2.4], [0, 2.2]]);
});

test('every room with an outer wall has a window at least', () => {
  const sparse = { ...TABLE, roles: { home: { every: 9 } } }, out = windowsOf(plan('home'), sparse, 'x');
  for (const r of [0, 1, 2, 3]) { const [k, i0, j0, i1, j1] = plan('home').rooms[r]; assert.ok(out.some(([f, i, j]) => f === k && i >= i0 && i <= i1 && j >= j0 && j <= j1), `room ${r}`); }
});

test('a building model says its use: the use in its name, else the first that lists it', () => {
  const uses = JSON.parse(readFileSync(new URL('../../config/models.json', import.meta.url), 'utf8')).uses;
  assert.deepEqual(['kk-dormitory', 'suburban-01', 'industrial-h', 'office-c', 'nothing-like-it'].map(model => useOfModel(model, uses)), ['dormitory', 'house', 'warehouse', 'office', null]);
  assert.equal(patternOf({ role: 'office', use: 'dormitory' }, TABLE).balcony, 0.8, 'the use wins over the role');
});
