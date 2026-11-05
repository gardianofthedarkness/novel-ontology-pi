import test from 'node:test';
import assert from 'node:assert/strict';
import { groundMap, groundSettingOf, judged, nearestOf } from './set-dresser.mjs';

test('ground read from its buildings: open, low houses, mid-rise, high-rise by the taller quarter of what stands', () => {
  assert.equal(groundSettingOf({ floors: [], covered: 0 }), 'open ground');
  assert.equal(groundSettingOf({ floors: [2, 2, 3], covered: 0.4 }), 'low houses');
  assert.equal(groundSettingOf({ floors: [3, 5, 6, 8], covered: 0.5 }), 'mid-rise streets');
  assert.equal(groundSettingOf({ floors: [4, 12, 20, 30], covered: 0.5 }), 'high-rise');
  assert.equal(judged('indoors'), false);
});

test('the city cell by cell, and the nearest ground of a setting', () => {
  const lots = [{ i0: 0, j0: 0, nx: 20, nz: 20, floors: 2 }, { i0: 100, j0: 0, nx: 20, nz: 20, floors: 20 }];
  const map = groundMap(lots, { size: 60 });
  assert.deepEqual(map.map(cell => cell.setting).sort(), ['high-rise', 'low houses']);
  assert.ok(nearestOf(map, 'high-rise', [0, 0]).d > 150);
  assert.equal(nearestOf(map, 'high-rise', [0, 0], 100), null);
});
