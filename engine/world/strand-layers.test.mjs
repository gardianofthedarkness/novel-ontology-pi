import test from 'node:test';
import assert from 'node:assert/strict';
import { layered, mergeCells, strandLayers } from './strand-layers.mjs';

// A world of three lots of four cells, as the engine keeps it (lists per lot, a live Map of things, the underground's
// damage), and an engine that writes it the way the real one does: a new list over the old one for what stands, the
// rubble's list written in place.
const world = () => {
  const units = [], standing = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]], rubble = [], things = new Map();
  let under = { piles: new Map(), dents: new Map(), breaches: new Map(), marks: [] };
  const state = { lot: index => ({ units: units[index], standing: standing[index], rubble: rubble[index] }), setLot: (index, lot) => { units[index] = lot.units; standing[index] = lot.standing; rubble[index] = lot.rubble; }, things: () => things, under: () => under, setUnder: damage => { under = damage; } };
  return { state, standing, rubble, things, under: () => under };
};
// The strands of a small story: the main (m1 m2 m3 m4 m5), a split (s1 s2: two people gone to another district after m1,
// back at m4), a group first seen elsewhere (n1, joining at m5), and the past told in between (p1).
const ORDER = ['m1', 's1', 'm2', 'n1', 's2', 'p1', 'm3', 'm4', 'm5'];
const forks = [
  { id: 'm1', scenes: ['m1', 'm2', 'm3', 'm4', 'm5'], splitFrom: [], unites: ['s1', 'n1'], open: true },
  { id: 's1', scenes: ['s1', 's2'], splitFrom: ['m1'], into: 'm1', intoAt: 'm4', open: false },
  { id: 'n1', scenes: ['n1'], splitFrom: [], into: 'm1', intoAt: 'm5', open: false },
  { id: 'p1', scenes: ['p1'], splitFrom: [], past: true, open: false },
];
const strands = () => ({ forks, forkOf: new Map(forks.flatMap(fork => fork.scenes.map(scene => [scene, fork.id]))), layer: new Map(ORDER.map((id, rank) => [id, rank])) });
const run = (options = {}) => {
  const w = world(), s = strands(), layers = strandLayers({ forks: s.forks, forkOf: s.forkOf, rankOf: id => s.layer.get(id), state: w.state, ...options });
  const smash = (hit, index, cell) => {
    layers.touch(index);
    const next = w.standing[index].slice(); next[cell] = 0; w.standing[index] = next;
    (w.rubble[index] ??= new Uint8Array(4))[cell] = 1;
    layers.hit(hit);
  };
  const stand = (id, i0) => { const was = w.things.get(id), now = { i0, i1: i0 + 1, j0: 0, j1: 1, top: 1 }; w.things.set(id, now); layers.thing(id, was, now); };
  const lift = id => { const was = w.things.get(id); w.things.delete(id); layers.thing(id, was, null); };
  return { ...w, layers, smash, stand, lift };
};

test('strands of the group builder carry what the layers need; the old lanes do not', () => {
  assert.equal(layered(strands()), true);
  assert.equal(layered({ forks: [{ id: 'a', scenes: [] }], forkOf: new Map(), layer: new Map() }), false);
  assert.equal(layered(null), false);
});

test('a blast on one strand is not in the other; the strand that split off carries what was broken before it left', () => {
  const { layers, smash, standing, rubble } = run();
  layers.enter('m1'); smash('h1', 0, 0);
  const split = layers.enter('s1');
  assert.deepEqual([split.created, split.switched, split.lots, split.unseen], [true, true, [], []], 'the split starts as the main is: nothing differs yet');
  smash('h2', 0, 1); smash('h3', 1, 2);
  assert.deepEqual([standing[0], standing[1]], [[0, 0, 1, 1], [1, 1, 0, 1]]);
  const back = layers.enter('m2');
  assert.deepEqual(back.lots, [0, 1], 'both lots stand differently on the main: only they are reported');
  assert.deepEqual([standing[0], standing[1], [...rubble[0]], rubble[1]], [[0, 1, 1, 1], [1, 1, 1, 1], [1, 0, 0, 0], undefined], "the main has its own blast and none of the split's");
  assert.deepEqual(back.unseen, ['h2', 'h3']);
  smash('h4', 2, 3);
  const again = layers.enter('s2');
  assert.deepEqual([standing[0], standing[1], standing[2], again.unseen], [[0, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 1], ['h4']]);
  assert.deepEqual(layers.unseen('m2'), ['h2', 'h3'], 'what a scene had not seen is kept as it was played');
});

test('a union merges: a unit broken in either is broken, rubble of either lies, and the hits are seen from there on', () => {
  const { layers, smash, standing, rubble } = run();
  layers.enter('m1'); smash('h1', 0, 0);
  layers.enter('s1'); smash('h2', 0, 1); smash('h3', 1, 2);
  layers.enter('m2'); smash('h4', 0, 3); smash('h5', 2, 3);
  layers.enter('s2');
  assert.deepEqual(layers.enter('m3').unseen, ['h2', 'h3'], 'still apart at m3');
  const union = layers.enter('m4');
  assert.deepEqual(union.merged.map(entry => [entry.kind, entry.strand, entry.into, entry.lots, entry.hits]), [['union', 's1', 'm1', 2, 2]]);
  assert.deepEqual([standing[0], standing[1], standing[2]], [[0, 0, 1, 0], [1, 1, 0, 1], [1, 1, 1, 0]]);
  assert.deepEqual([[...rubble[0]], [...rubble[1]], [...rubble[2]]], [[1, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.deepEqual([union.lots, union.unseen, layers.layerOf('s1') === layers.layerOf('m1')], [[0, 1], [], true], "the lots the split changed are reported; its layer is the main's now");
  smash('h6', 1, 0);
  assert.deepEqual(layers.enter('m5').unseen, [], 'nothing unseen after the union');
  assert.deepEqual(layers.report().layers.map(entry => [entry.strand, entry.lots, entry.hits]), [['m1', 3, 6]]);
});

test('people first seen elsewhere and the past start from the built world; the past hands nothing on', () => {
  const { layers, smash, standing } = run();
  layers.enter('m1'); smash('h1', 0, 0);
  const elsewhere = layers.enter('n1');
  assert.deepEqual([elsewhere.created, elsewhere.lots, elsewhere.unseen, standing[0]], [true, [0], ['h1'], [1, 1, 1, 1]], 'a new group elsewhere has seen none of it');
  smash('h2', 1, 1);
  const past = layers.enter('p1');
  assert.deepEqual([past.lots, standing[0], standing[1], past.unseen], [[1], [1, 1, 1, 1], [1, 1, 1, 1], ['h1', 'h2']], 'the past is the world as built');
  smash('h3', 2, 2);
  layers.enter('m3'); layers.enter('m4');
  assert.deepEqual([standing[0], standing[1], standing[2]], [[0, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]], "neither the new group's nor the past's blast is on the main yet");
  const joined = layers.enter('m5');
  assert.deepEqual([standing[1], standing[2], joined.unseen], [[1, 0, 1, 1], [1, 1, 1, 1], ['h3']], "the group's blast came with it; the past's never does");
});

test('a thing moved by both strands is where the later scene left it; one taken away on a strand stands on the other', () => {
  const { layers, stand, lift, things } = run();
  stand('truck', 0); stand('car', 10); stand('van', 20);
  layers.enter('m1');
  layers.enter('s1'); stand('car', 12); lift('truck');
  const back = layers.enter('m2');
  assert.deepEqual([things.get('car').i0, things.get('truck').i0, back.things.map(entry => entry.id).sort()], [10, 0, ['car', 'truck']], 'the main still has both where they stood');
  stand('car', 14); stand('van', 22);
  layers.enter('s2'); stand('car', 16);
  assert.deepEqual([things.get('van').i0, things.has('truck')], [20, false]);
  layers.enter('m3'); stand('truck', 2);
  const union = layers.enter('m4');
  assert.deepEqual([things.get('car').i0, things.get('van').i0, things.get('truck').i0], [16, 22, 2], 'the car where s2 left it (later than m2), the van where the main moved it, the truck where m3 stood it after the split took it');
  assert.deepEqual(union.things.map(entry => entry.id), ['car']);
});

test('the underground is the strand\'s too: a cave-in of one is not under the other until they are one', () => {
  const { layers, under } = run();
  layers.enter('m1'); under().breaches.set('a', 0);
  layers.enter('s1');
  const mark = { x: 1, y: -3, z: 1, r: 2 };
  under().breaches.set('b', 1); under().piles.set(1, new Map([['b', 3]])); under().dents.set('c', 1); under().marks.push(mark);
  const main = layers.enter('m2');
  assert.deepEqual([[...under().breaches.keys()], under().piles.size, under().marks.length, main.cells.sort(), main.marks], [['a'], 0, 0, ['b', 'c'], [mark]]);
  under().piles.set(1, new Map([['b', 1], ['d', 2]]));
  layers.enter('s2'); layers.enter('m3');
  const union = layers.enter('m4');
  assert.deepEqual([[...under().breaches.keys()].sort(), [...under().piles.get(1)].sort(), [...under().dents], under().marks], [['a', 'b'], [['b', 3], ['d', 2]], [['c', 1]], [mark]], 'the deeper pile of the two, every breach and dent, the same mark once');
  assert.deepEqual(union.cells.sort(), ['b', 'c']);
});

test('a union whose scene is never played is made by the next scene after it; a closed strand read late plays in the kept one', () => {
  const { layers, smash, standing } = run();
  layers.enter('m1'); layers.enter('s1'); smash('h1', 0, 0);
  const late = layers.enter('m5');
  assert.deepEqual([late.merged.map(entry => entry.strand), standing[0], late.unseen], [['s1'], [0, 1, 1, 1], []], 'm4 was skipped: the union is due by m5');
  const closed = layers.enter('s2');
  assert.deepEqual([closed.layer, closed.switched, layers.playedIn('s2')], ['m1', false, 'm1']);
  // A run that begins after a strand has closed: nothing to merge, its id leads to the kept one.
  const middle = run();
  assert.deepEqual([middle.layers.enter('m5').layer, middle.layers.enter('s2').layer, middle.layers.report().layers.length], ['m1', 'm1', 1]);
});

test('the kept strand never played takes the closed one\'s layer; a scene of no strand changes nothing', () => {
  const { layers, smash, standing } = run();
  layers.enter('s1'); smash('h1', 1, 1);
  assert.equal(layers.enter('nowhere'), null);
  const kept = layers.enter('m4');
  assert.deepEqual([kept.layer, kept.lots, standing[1], kept.unseen], ['m1', [], [1, 0, 1, 1], []]);
});

test('before the first scene the world is common: what is written then is under every layer', () => {
  const { layers, smash, standing, state } = run();
  smash('h0', 0, 0);
  layers.enter('m1'); layers.enter('n1');
  assert.deepEqual([standing[0], layers.unseen('n1')], [[0, 1, 1, 1], []]);
  smash('h1', 0, 1);
  layers.enter('p1');
  assert.deepEqual([standing[0], state.lot(0).standing === standing[0]], [[0, 1, 1, 1], true], 'the built world keeps what was written before any layer');
});

test('the engine may settle a merged lot its own way; cells alone merge by standing in both', () => {
  assert.deepEqual(mergeCells({ standing: [1, 0, 1], rubble: undefined, units: undefined }, { standing: [1, 1, 0], rubble: Uint8Array.of(0, 0, 1), units: Uint8Array.of(1, 1, 0, 1) }), { units: Uint8Array.of(1, 1, 0, 1), standing: [1, 0, 0], rubble: Uint8Array.of(0, 0, 1) });
  const calls = [], { layers, smash, standing } = run({ mergeLot: (index, first, second) => { calls.push(index); return { ...mergeCells(first, second), standing: [0, 0, 0, 0] }; } });
  layers.enter('m1'); layers.enter('s1'); smash('h1', 0, 0); smash('h2', 1, 0);
  layers.enter('m2'); smash('h3', 0, 1);
  layers.enter('m4');
  assert.deepEqual([calls, standing[0], standing[1]], [[0], [0, 0, 0, 0], [0, 1, 1, 1]], 'only the lot both changed is merged; the other is taken as it is');
});

test('the picture of the whole run has every layer\'s holes at once; the layer playing keeps only its own', () => {
  const { layers, under } = run();
  layers.enter('m1'); under().breaches.set('a', 0);
  layers.enter('s1'); under().breaches.set('b', 1); under().piles.set(1, new Map([['b', 3]]));
  layers.enter('m2'); under().dents.set('c', 2);
  const all = layers.underAll();
  assert.deepEqual([[...all.breaches.keys()].sort(), [...all.piles.get(1)], [...all.dents]], [['a', 'b'], [['b', 3]], [['c', 2]]]);
  assert.deepEqual([[...under().breaches.keys()], under().piles.size], [['a'], 0], 'the main strand\'s own underground is as it was');
  all.breaches.set('z', 9);
  assert.equal(under().breaches.has('z'), false, 'the picture is a copy');
});

test('a retake: the layers back as they stood before a unit, and the units after it played again as the first time', () => {
  const { layers, smash, standing, rubble } = run();
  layers.enter('m1'); smash('h1', 0, 0);
  // Before s1: the engine keeps its lists (here by hand), the layers their own.
  const kept = { standing: standing.map(cells => cells.slice()), rubble: rubble.map(cells => cells?.slice()) }, point = layers.checkpoint();
  layers.enter('s1'); smash('h2', 0, 1); layers.enter('m2'); smash('h3', 1, 2);
  kept.standing.forEach((cells, n) => { standing[n] = cells.slice(); }); rubble.length = 0; kept.rubble.forEach((cells, n) => { rubble[n] = cells?.slice(); });
  layers.restore(point);
  assert.deepEqual([layers.active(), standing[0], standing[1]], ['m1', [0, 1, 1, 1], [1, 1, 1, 1]], 'm1 playing, only its own blast standing');
  const split = layers.enter('s1');
  assert.deepEqual([split.created, split.unseen], [true, []], 'the split begins again, as it did the first time');
  smash('h2', 0, 1);
  const back = layers.enter('m2');
  assert.deepEqual([back.unseen, standing[0], standing[1]], [['h2'], [0, 1, 1, 1], [1, 1, 1, 1]], 'm2 has not seen the retaken split\'s blast, and h3 of the take thrown away is gone');
  layers.restore(point);
  assert.equal(layers.report().hits, 1, 'a checkpoint restores again as often as asked');
});
