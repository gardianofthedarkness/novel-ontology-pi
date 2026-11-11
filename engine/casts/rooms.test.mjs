import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FURNITURE_MODELS, ROOM_TYPE_NAMES, furnish } from './rooms.mjs';

const baked = JSON.parse(await readFile(new URL('../../apps/playground/src/data/furnitureModels.json', import.meta.url), 'utf8'));
const sizes = Object.fromEntries(Object.entries(baked.models).map(([name, model]) => [name.replace('kk-furniture-', ''), model.size]));
const footprint = piece => { const [x, , z] = sizes[piece.model], turned = Math.abs(Math.sin(piece.angle)) > 0.5; return turned ? [z, x] : [x, z]; };
const UNDER = new Set(['rug_oval_A', 'rug_rectangle_stripes_A']);

test('every model a room uses is baked', () => {
  for (const name of FURNITURE_MODELS) assert.ok(sizes[name], name);
});

test('each kind of room furnished in a 6 by 8 m room: inside its walls, nothing overlapping (rugs lie under), the same seed the same room', () => {
  for (const type of ROOM_TYPE_NAMES) {
    const pieces = furnish(type, 6, 8, sizes, `r|${type}`);
    if (type === 'not said') { assert.deepEqual(pieces, []); continue; }
    assert.ok(pieces.length >= 1, `${type}: ${pieces.length} pieces`);
    const solid = pieces.filter(piece => !UNDER.has(piece.model));
    for (const piece of pieces) { const [fw, fd] = footprint(piece); assert.ok(piece.u - fw / 2 >= 0.2 && piece.u + fw / 2 <= 5.8 && piece.v - fd / 2 >= 0.2 && piece.v + fd / 2 <= 7.8, `${type}: ${piece.model} inside`); }
    for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) {
      const [aw, ad] = footprint(solid[a]), [bw, bd] = footprint(solid[b]);
      const overlap = Math.min(solid[a].u + aw / 2, solid[b].u + bw / 2) - Math.max(solid[a].u - aw / 2, solid[b].u - bw / 2) > 0.06 && Math.min(solid[a].v + ad / 2, solid[b].v + bd / 2) - Math.max(solid[a].v - ad / 2, solid[b].v - bd / 2) > 0.06;
      assert.ok(!overlap, `${type}: ${solid[a].model} and ${solid[b].model} overlap`);
    }
    assert.deepEqual(furnish(type, 6, 8, sizes, `r|${type}`), pieces);
  }
});

test('a room reads as its kind: a classroom\'s rows of desks with chairs, a ward\'s beds, a meeting room\'s chairs round its table', () => {
  const count = (pieces, model) => pieces.filter(piece => piece.model === model).length;
  const classroom = furnish('classroom', 8, 10, sizes);
  assert.ok(count(classroom, 'table_small') >= 8 && count(classroom, 'chair_A') === count(classroom, 'table_small'), `${count(classroom, 'table_small')} desks`);
  assert.ok(count(furnish('hospital room', 8, 6, sizes), 'bed_single_B') >= 2);
  const meeting = furnish('meeting room', 6, 8, sizes);
  assert.equal(count(meeting, 'table_medium_long'), 1);
  assert.ok(count(meeting, 'chair_A') >= 4, `${count(meeting, 'chair_A')} chairs`);
  assert.ok(furnish('bedroom', 3, 3, sizes).some(piece => piece.model.startsWith('bed_')), 'a small bedroom still has its bed');
});

test('a narrow strip of a room (14 by 2 m, as vol 1 has) is still furnished: a classroom\'s one row, a bedroom\'s bed or a line of its first piece', () => {
  const strip = furnish('classroom', 14, 2, sizes);
  assert.ok(strip.filter(piece => piece.model === 'table_small').length >= 4, `${strip.length} pieces`);
  for (const type of ['office', 'bedroom', 'meeting room', 'hospital room', 'library or study']) assert.ok(furnish(type, 14, 2, sizes).length >= 1, type);
});
