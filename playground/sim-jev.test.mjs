import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickImpacts } from './impact-choices.mjs';
import { createLive, moveAnswers, outcomeView } from './sim-jev.mjs';

/** A browser that draws nothing: stills are a fixed picture, impact spots two letters, a measure 6 m across. */
const fakeChrome = () => {
  const shots = [];
  return { shots, still: async () => 'iVBORw0KGgo=', evaluate: async expression => {
    shots.push(expression.slice(0, 40));
    if (expression.startsWith('window.__stage.impactSpots')) return [{ label: 'A', x: 4, y: 3, z: 5, from: 'the shop' }, { label: 'B', x: 9, y: 0, z: 2, from: 'the roof' }];
    if (expression.startsWith('window.__stage.measure')) return { across: 6, up: 5 };
    return null;
  } };
};
/** Jev that picks the first lettered option and the second size, and boxes the middle. */
const fakeJev = () => ({ modelId: 'scripted', calls: 0, async decide(state, questions) {
  this.calls++;
  return questions.map(question => question.primitive === 'box' ? { key: question.key, value: 0.8, confidence: 0.8, box: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 } } : { key: question.key, value: question.options[question.key === 'size' ? 1 : 0], confidence: 0.7, distribution: { [question.options[0]]: 0.7, [question.options[1]]: 0.3 } });
} });

test('fight choices stop at the budget, keep every answer and continue where they stopped', async () => {
  const stage = { places: { p: { path: ['City', 'Street'], kind: 'street', lots: 3 } }, fights: [{ scene: 's1', event: 2, place: 'p', text: 'A wall gives way.' }, { scene: 's2', event: 0, place: 'p', text: 'The roof is blown off.' }] };
  const fights = {}, outcomes = [], jev = fakeJev();
  let saves = 0;
  const first = await pickImpacts({ chrome: fakeChrome(), jev, stage, fights, save: async () => { saves++; }, budget: 2, log: () => {}, after: async done => { outcomes.push(done); } });
  assert.deepEqual(first, { calls: 2, asked: 1, reused: 0, left: 1 });
  assert.deepEqual(fights['s1|2'].sphere, { x: 4, y: 3, z: 5, r: 4 }, 'the first spot, the second size (8 m across)');
  assert.equal(saves, 1);
  assert.deepEqual(outcomes.map(done => [done.kind, done.key, done.chosen, done.sphere.r]), [['fight', 's1|2', 'A on the shop', 4]]);
  // Run again: the answered fight is reused without a call, the other asked.
  const second = await pickImpacts({ chrome: fakeChrome(), jev, stage, fights, save: async () => {}, budget: 10, log: () => {} });
  assert.deepEqual(second, { calls: 2, asked: 1, reused: 1, left: 0 });
  assert.equal(jev.calls, 4);
  // A fight with no spot to hit is kept as such (the stand-in stays), so it is not asked again.
  const empty = { ...fakeChrome(), evaluate: async () => [] }, lone = {};
  assert.deepEqual(await pickImpacts({ chrome: empty, jev, stage: { ...stage, fights: stage.fights.slice(0, 1) }, fights: lone, save: async () => {}, log: () => {} }), { calls: 0, asked: 1, reused: 0, left: 0 });
  assert.deepEqual(lone['s1|2'], { spots: [], unplaced: true });
});

test('the live record: each question with its pictures and answers, each outcome, the calls spent; a failed call is shown', async (context) => {
  const novel = await mkdtemp(join(tmpdir(), 'sim-live-'));
  context.after(() => rm(novel, { recursive: true, force: true }));
  const live = await createLive(novel, { command: 'pick', budget: 5, model: 'scripted', lines: [{ id: 'line_a', title: 'Station → Street' }] });
  const read = async () => JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'live.json'), 'utf8'));
  assert.equal((await read()).status, 'running');
  await live.line(0, { status: 'asking' });
  await live.phase('fights');
  const watched = live.watch(fakeJev());
  const state = ['A still of a 3D model of a place in a novel.', 'Place: City › Street (street of 3 buildings).', 'Event: A wall gives way.'].join('\n');
  const [answer] = await watched.decide(state, [{ key: 'where', primitive: 'choice', instructions: 'Which sphere?', options: ['A', 'B', 'none'] }], { images: { where: 'iVBORw0KGgo=' } });
  assert.equal(answer.value, 'A');
  await live.outcome({ subject: 's1|2', text: 'hits A on the shop: a 8 m blast', picture: '/9j/4AAQ', jpeg: true });
  const failing = live.watch({ modelId: 'scripted', decide: async () => { throw new Error('Jev is down'); } });
  await assert.rejects(failing.decide(state, [{ key: 'size', primitive: 'choice', instructions: 'How big?', options: ['1', '2'] }], {}), /Jev is down/);
  await live.finish('done', { left: 0 });
  const record = await read();
  assert.equal(record.status, 'done');
  assert.equal(record.calls, 2, 'the failed call counts: it was sent');
  assert.equal(record.ask.error, 'Jev is down');
  assert.equal(record.lines[0].status, 'asking');
  const frames = (await readFile(join(novel, 'stage', 'simulation', 'live', 'frames.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(frames.map(frame => [frame.f, frame.kind, frame.phase, frame.subject]), [[0, 'ask', 'fights', 'A wall gives way.'], [1, 'outcome', 'fights', 's1|2']]);
  assert.deepEqual(frames[0].pictures, [{ name: 'where', file: 'frames/0-0.png' }], 'no browser at hand: kept as it came');
  assert.deepEqual(frames[0].answers[0], { key: 'where', value: 'A', confidence: 0.7, top: [['A', 0.7], ['B', 0.3]] });
  assert.deepEqual(frames[0].context, ['Place: City › Street (street of 3 buildings).', 'Event: A wall gives way.']);
  assert.deepEqual((await readdir(join(novel, 'stage', 'simulation', 'live', 'frames'))).sort(), ['0-0.png', '1-0.jpg']);
  // A second command continues the recording's frame numbers.
  const next = await createLive(novel, { command: 'run', lines: [] });
  await next.outcome({ subject: 'x', text: 'y' });
  assert.equal((await read()).frames, 3);
});

test('what an answer made, as the live record draws it', () => {
  const base = { scene: 's1', event: 2, place: 'p', hide: ['thing_1'] };
  const thing = outcomeView({ kind: 'thing', key: 's1|2|Bus', base, thing: 'Bus', record: { chosen: 'C', spots: [{}] }, box: { x: [2, 12], y: [0, 3], z: [4, 7] } });
  assert.equal(thing.text, '10×3×3 m, at ghost C, 0 m up');
  assert.deepEqual(thing.capture.solved, { x: [2, 12], y: [0, 3], z: [4, 7] });
  assert.deepEqual(thing.capture.focus, { x: 7, y0: 0, z: 5.5, w: 10, h: 3, d: 3 });
  assert.equal(outcomeView({ kind: 'thing', key: 'k', base, thing: 'Bus', record: { spots: [] }, box: null }).text, 'no spot to stand on');
  assert.deepEqual(outcomeView({ kind: 'fight', key: 's1|2', base, none: true }), { subject: 's1|2', text: 'no damage' });
  const hit = outcomeView({ kind: 'fight', key: 's1|2', base, focus: { x: 1 }, chosen: 'A on the shop', sphere: { x: 1, y: 2, z: 3, r: 8 } });
  assert.equal(hit.text, 'hits A on the shop: a 16 m blast');
  assert.deepEqual(hit.capture.spheres, [{ x: 1, y: 2, z: 3, r: 8, outline: true, label: '16 m' }]);
});

test('an event\'s moves with Jev\'s movement answers, by the scene\'s event order', () => {
  const movement = { scenes: { s1: { order: ['e1', 'e2'], events: { e2: { p1: { moves: 0.88, to: { street: 0.1, roof: 0.85, entrance: 0.05 }, how: 'run', direction: { up: 0.9, down: 0.1 } }, p2: { moves: 0.2 } } } } } };
  const moves = [{ person: 'p1', name: 'Ada' }, { person: 'p3', name: 'Cy' }];
  assert.deepEqual(moveAnswers(movement, 's1', 1, 2, moves), [
    { key: 'Ada moves', value: 'yes', confidence: 0.88 },
    { key: 'Ada to', value: 'roof', confidence: 0.85, top: [['roof', 0.85], ['street', 0.1], ['entrance', 0.05]] },
    { key: 'Ada how', value: 'run', confidence: null },
    { key: 'Ada way', value: 'up', confidence: 0.9, top: [['up', 0.9], ['down', 0.1]] },
  ], 'Cy was not asked about: nothing for Cy');
  assert.deepEqual(moveAnswers(movement, 's1', 1, 3, moves), [], 'the run has another count of events: the order cannot be trusted');
  assert.deepEqual(moveAnswers(null, 's1', 1, 2, moves), []);
});

test('a frame of moves is recorded with both pictures, the moves and the answers', async (context) => {
  const novel = await mkdtemp(join(tmpdir(), 'sim-moves-'));
  context.after(() => rm(novel, { recursive: true, force: true }));
  const live = await createLive(novel, { command: 'pick', lines: [{ id: 'line_a', title: 'A' }] });
  await live.phase('moves');
  const moves = [{ person: 'p1', name: 'Ada', color: '#ff8800', how: 'walk', spot: 'roof', overlays: { start: { path: [[0.2, 0.5], [0.6, 0.4]], ensemble: [] }, end: { path: [[0.2, 0.5], [0.6, 0.4]], ensemble: [] } } }];
  await live.frame({ kind: 'move', subject: 'Ada climbs', text: 'Ada → roof (walk)', context: ['Event: Ada climbs.'], pictures: [{ name: 'start', picture: '/9j/', jpeg: true }, { name: 'end', picture: '/9j/', jpeg: true }], moves, answers: [{ key: 'Ada to', value: 'roof', confidence: 0.85 }] });
  const [frame] = (await readFile(join(novel, 'stage', 'simulation', 'live', 'frames.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([frame.kind, frame.phase, frame.text, frame.pictures.map(picture => picture.file)], ['move', 'moves', 'Ada → roof (walk)', ['frames/0-0.jpg', 'frames/0-1.jpg']]);
  assert.deepEqual(frame.moves, moves);
  assert.equal(JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'live.json'), 'utf8')).log[0].text, 'Ada → roof (walk)');
});
