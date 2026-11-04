import test from 'node:test';
import assert from 'node:assert/strict';
import { firedSpans } from './faculties.mjs';

test('a faculty reads where the gate fires it: overlapping windows joined, sixty lines a request', () => {
  const scene = { id: 'u1', sentences: Array.from({ length: 130 }, (_, k) => `s${k}`) };
  const gate = { windows: [
    { scene: 'u1', first: 's0', last: 's11', fired: ['journeys'] }, { scene: 'u1', first: 's6', last: 's17', fired: ['journeys', 'conversation'] },
    { scene: 'u1', first: 's40', last: 's129', fired: ['journeys'] }, { scene: 'u2', first: 's0', last: 's5', fired: ['journeys'] },
  ] };
  assert.deepEqual(firedSpans(gate, scene, 'journeys').map(span => [span[0], span.at(-1), span.length]), [['s0', 's17', 18], ['s40', 's99', 60], ['s100', 's129', 30]]);
  assert.deepEqual(firedSpans(gate, scene, 'conversation').map(span => span.length), [12]);
  assert.deepEqual(firedSpans(gate, scene, 'choreography'), []);
});

test('a journey said in words takes the place offered that fits, near ones first', async () => {
  const { placeOfWords, placedJourney } = await import('./faculties.mjs');
  const places = [{ id: 'loc_a', label: '小巷' }, { id: 'loc_b', label: '小巷', near: true }, { id: 'loc_c', label: '车站' }, { id: 'loc_d', label: '北区' }];
  assert.equal(placeOfWords('loc_c', places), 'loc_c');
  assert.equal(placeOfWords('小巷', places), 'loc_b');
  assert.equal(placeOfWords('两栋楼之间的小巷', places), 'loc_b');
  assert.equal(placeOfWords('前方', places), null);
  assert.equal(placeOfWords('', places), null);
  const placed = placedJourney({ who: 'p', from: '车站前', to: '前方', via: ['小巷'] }, places);
  assert.deepEqual([placed.from, placed.to, placed.via], ['loc_c', '前方', ['loc_b']]);
  assert.deepEqual(placed.said, { from: '车站前' });
  assert.equal(placeOfWords('小巷中', [{ id: 'unnamed:x', label: '小巷 (scene 8)' }, { id: 'loc_p', label: '北区 · pool' }]), 'unnamed:x', 'the world script\'s marks are not the text\'s');
  assert.equal(placeOfWords('北区', [{ id: 'loc_p', label: '北区 · pool' }]), 'loc_p');
});
