import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothBlasts } from './blasts.mjs';

const world = { NX: 600, NZ: 10, K: 1, oi: 0, oj: 0, ok: 0 };
const node = (x, z = 1) => Math.floor(x / 2) + Math.floor(z / 2) * world.NX;
const told = (sizes, sure = 0.7) => ({ card: 'action:c3', hit: { centre: { x: 100, y: 0, z: 1 }, across: 8, sizes, sure } });

test('with nothing against it, a blast stays where the text told it, at Jev\'s size', () => {
  const record = { scenes: [{ scene: 's1', cards: [{ card: 'action:c1', moves: [] }, { card: 'action:c2', moves: [] }, told({ 4: 0.2, 8: 0.6, 16: 0.15, 32: 0.05 })] }] };
  const [blast] = smoothBlasts({ page: { world }, record });
  assert.equal(blast.atCard, 'action:c3');
  assert.equal(blast.r, 4);
  assert.ok(blast.earlier < 0.5);
});

test('walks that failed through its sphere before it was told move it earlier, and wider where they pass far', () => {
  const failed = (from, to) => ({ person: 'p', moved: false, code: 'NO_PATH', why: 'digest: nearby toward q (walk, stated, 90%)', replay: { from: node(from), targets: [node(to)] } });
  const record = { scenes: [{ scene: 's1', cards: [{ card: 'action:c1', moves: [failed(90, 110)] }, { card: 'action:c2', moves: [failed(90, 120, 10)] }, told({ 4: 0.1, 8: 0.6, 16: 0.25, 32: 0.05 })] }] };
  const [blast] = smoothBlasts({ page: { world }, record });
  assert.equal(blast.atCard, 'action:c1', 'it had already happened when the first walk failed through it');
  assert.ok(blast.earlier > 0.5);
  assert.equal(blast.evidence, 2);
});
