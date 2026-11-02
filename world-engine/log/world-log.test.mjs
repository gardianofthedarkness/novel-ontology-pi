import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnchor, proposalsOf, worldLog } from './world-log.mjs';

// A 10 × 10 grid, one floor: node = j * 10 + i, a cell 2 m.
const world = { NX: 10, NZ: 10, oi: 0, oj: 0, ok: 0 };
const page = {
  world, people: { a: { name: 'A' }, b: { name: 'B' } },
  scenes: [
    { id: 's1', place: 'p1', starts: { a: 0, b: 5 }, events: [{ id: 'action:x1', moves: [{ person: 'a', how: 'run', path: [0, 1, 2] }], hit: null }, { id: 'dialogue:x2', moves: [{ person: 'b', how: 'walk', path: [5, 4, 3] }], hit: { lot: 7, sphere: { x: 1, y: 0, z: 1, r: 4 }, strength: 0.5 } }] },
    { id: 's2', place: 'p1', starts: { a: 2, b: 3 }, events: [] },
  ],
};
const record = { scenes: [
  { scene: 's1', spawned: ['a', 'b'], carried: [], offPage: [], cards: [{ card: 'action:x1', kind: 'action', event: 0, moves: [{ person: 'a', direction: 'C', how: 'run', moved: true }] }, { card: 'dialogue:x2', kind: 'dialogue', event: 1, moves: [{ person: 'b', why: 'spoken to by A', moved: true }] }] },
  { scene: 's2', spawned: [], carried: ['a', 'b'], offPage: [], cards: [] },
] };
const spawn = { scenes: [{ id: 's1', target: { kind: 'building', box: [0, 0, 10, 10, 0] }, starts: [{ who: 'a', by: 'spatial' }, { who: 'b', by: 'ground' }] }] };
const strands = { scenes: [{ id: 's1', fork: 's1' }, { id: 's2', fork: 's1' }] };

test('the world log: each position with its rank, what it carries on from and whom it is tied to', () => {
  const log = worldLog({ run: 'r', record, page, spawn, strands });
  const of = (kind, who, scene) => log.find(entry => entry.kind === kind && entry.who === who && entry.scene === scene);
  assert.deepEqual([of('presence', 'a', 's1').rank, of('presence', 'b', 's1').rank], ['stated', 'ruled'], 'a placed by the text, b by spawning\'s rule');
  assert.ok(isAnchor(of('presence', 'a', 's1')) && !isAnchor(of('presence', 'b', 's1')));
  const run = of('position', 'a', 's1'), talk = of('position', 'b', 's1');
  assert.deepEqual([run.rank, run.source, run.metres, run.at], ['answered', 'answer', 4, { x: 5, y: 0, z: 1 }]);
  assert.deepEqual([talk.rank, talk.source, talk.ties], ['ruled', 'talk', ['a']], 'gathered to A by rule, tied to A');
  const carried = of('presence', 'a', 's2');
  assert.deepEqual([carried.how, carried.from, carried.rank], ['carried', run.id, 'answered'], 'carried on from the run, at its rank');
  assert.ok(log.some(entry => entry.kind === 'meeting') && log.some(entry => entry.kind === 'damage' && entry.lot === 7) && log.some(entry => entry.kind === 'binding'));
});

test('the ledger: locations by canon event, a timeline per strand, damage, and the laws\' breaks held', () => {
  const log = worldLog({ run: 'r', record, page, spawn, strands });
  const laws = [{ law: 'L10', violations: [{ who: 'a', what: 's1 · x', why: 'no way there on foot' }] }];
  const ledger = proposalsOf({ run: 'r', log, laws, eventOf: card => (card === 'action:x1' ? 'evt_1' : null) });
  const moved = ledger.find(entry => entry.kind === 'state-change' && entry.value.afterEventId === 'evt_1');
  assert.deepEqual([moved.subject, moved.value.location, moved.state], ['a', 'p1', 'proposed']);
  assert.equal(ledger.filter(entry => entry.kind === 'timeline').length, 1);
  assert.deepEqual(ledger.filter(entry => entry.kind === 'held').map(entry => [entry.law, entry.state]), [['L10', 'held']]);
});
