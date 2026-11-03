import test from 'node:test';
import assert from 'node:assert/strict';

test('a rehearsal measures what the milestones changed: camera jumps, moves by source, basements, fights, talk', async () => {
  // measure() only reads a record; importing rehearsal.mjs loads the director, so the record is built by hand.
  const { measure } = await import('./rehearsal.mjs');
  const card = (x, moves = [], extra = {}) => ({ camera: { focus: { x, z: 0 } }, moves, laws: [], ...extra });
  const record = { calls: 3, gate: { beats: 2 }, scenes: [
    { scene: 's1', starts: { a: 1 }, cards: [card(0, [{ moved: true, why: 'digest: step' }]), card(10, [{ moved: true, why: 'implied: indoors', to: 'under the office (5 floors)' }]), card(90, [{ moved: true, why: 'journey: to x', airborne: true }], { exchanges: [{ by: 'jev' }, { by: 'reader' }], conditions: [{}], talk: { kind: 'remote' } })] },
    { scene: 's2', starts: {}, castFrom: 'the scene before', cards: [] },
  ] };
  const out = measure(record);
  assert.equal(out.jumps, 1, 'one jump over 40 m');
  assert.deepEqual(out.bySource, { digest: 1, implied: 1, journey: 1 });
  assert.equal(out.basement, 1); assert.equal(out.airborne, 1);
  assert.deepEqual([out.exchanges, out.askedJev, out.conditions], [2, 1, 1]);
  assert.deepEqual(out.talkKinds, { remote: 1 }); assert.deepEqual(out.castFrom, { 'the scene before': 1 });
});
