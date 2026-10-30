import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedTimes, createWorld, enter } from './world.mjs';
import { compose } from './compose.mjs';

test('nobody vanishes: someone of the scene before who is not mentioned in a scene that carries straight on in the same place is still there', () => {
  const world = createWorld();
  enter(world, { id: 's1', place: 'P', relation: 'after', present: ['x', 'y'] });
  const next = enter(world, { id: 's2', place: 'P', relation: 'after', present: ['x'] });
  assert.deepEqual(next.stayed, ['y']);
  assert.equal(world.people.y.place, 'P');
  assert.ok(world.people.y.log.at(-1).unseen);
  // And a fragment (no one detected at all) keeps everyone.
  assert.deepEqual(enter(world, { id: 's3', place: 'P', relation: 'after', present: [], fragment: true }).stayed.sort(), ['x', 'y']);
});

test('nobody is in two places at once: a scene sharing someone with the scene before, elsewhere, cannot be at the same time; one without can', () => {
  const world = createWorld();
  enter(world, { id: 's1', place: 'P', relation: 'after', present: ['x'] });
  assert.ok(!allowedTimes(world, ['x', 'z'], 'Q').includes('same'));
  assert.deepEqual(allowedTimes(world, ['z'], 'Q'), ['after', 'later', 'same', 'flashback']);
  enter(world, { id: 's2', place: 'Q', relation: 'same', present: ['z'] });
  // A third scene at that same time again cannot have x (at P then) nor z (at Q then) somewhere else.
  enter(world, { id: 's2b', place: 'Q', relation: 'after', present: ['z'] });
  assert.equal(world.scenes[1].clock.join(), world.scenes[0].clock.join());
});

test('people who come from elsewhere travelled between the two scenes; a flashback logs the past and moves nobody', () => {
  const world = createWorld();
  enter(world, { id: 's1', place: 'P', relation: 'after', present: ['x'] });
  const later = enter(world, { id: 's2', place: 'Q', relation: 'later', present: ['x'] });
  assert.deepEqual(later.travelled, [{ person: 'x', from: 'P', to: 'Q', after: 's1' }]);
  enter(world, { id: 's3', place: 'R', relation: 'flashback', present: ['x'] });
  assert.equal(world.people.x.place, 'Q');
  assert.ok(world.people.x.log.at(-1).past);
});

test('context composition keeps the shape and the budget: the oldest story goes first, then a long scene loses its middle, never its start or the question', () => {
  const story = Array.from({ length: 8 }, (_, n) => `scene ${n + 1}: ${'事'.repeat(200)}`), text = `开头${'中'.repeat(6000)}结尾`;
  const context = compose({ world: ['上条当麻 — at 学园都市'], story, text, focus: 'Who is in this scene?', budget: 3000 });
  assert.ok(context.length <= 3000 + 40, `${context.length}`);
  assert.ok(context.includes('上条当麻 — at 学园都市') && context.includes('Who is in this scene?'));
  assert.ok(context.includes('开头') && context.includes('结尾') && context.includes('[…]'));
  assert.ok(!context.includes('scene 1:') && context.includes('scene 8:'), 'the newest story stays');
  assert.ok(compose({ text: 'short', focus: 'q' }).includes('this is the first scene'));
});

test('after a flashback the story stays in the past until a scene goes back to the main time, which picks up after the last scene before it', () => {
  const world = createWorld();
  enter(world, { id: 's1', place: 'P', relation: 'after', present: ['x'] });
  enter(world, { id: 's2', place: 'Q', relation: 'flashback', present: ['x'] });
  assert.deepEqual(allowedTimes(world, ['x'], 'Q'), ['after', 'later', 'back']);
  assert.equal(enter(world, { id: 's3', place: 'Q', relation: 'after', present: ['x'] }).clock, null, 'still the past');
  assert.equal(world.people.x.place, 'P');
  const back = enter(world, { id: 's4', place: 'P', relation: 'back', present: ['x'] });
  assert.deepEqual(back.clock, [1, 2]);
});

test('a dialogue node: live parties join the scene unless they are elsewhere then; a remote party in the scene is a conflict; public listeners are everyone there', async () => {
  const { settle } = await import('./dialogue.mjs');
  const away = id => id === 'far';
  const live = settle({ kind: 'live', parties: ['x', 'y'], inScene: ['x'], elsewhere: away });
  assert.deepEqual([live.joins, live.conflicts, live.geometry], [['y'], [], 'meeting']);
  assert.deepEqual(settle({ kind: 'live', parties: ['x', 'far'], inScene: ['x'], elsewhere: away }).conflicts, ['far is elsewhere at this time']);
  const phone = settle({ kind: 'remote', parties: ['x', 'y'], local: 'x', inScene: ['x', 'y'], elsewhere: away });
  assert.equal(phone.remote, 'y');
  assert.equal(phone.conflicts.length, 1);
  const shout = settle({ kind: 'public', parties: ['x', null], inScene: ['x', 'y', 'z'], elsewhere: away });
  assert.deepEqual([shout.public, shout.listeners], [true, ['y', 'z']]);
  assert.equal(settle({ kind: 'group', parties: ['x', 'y'], inScene: ['x', 'y', 'z'], elsewhere: away }).geometry, 'box');
});

test('the laws on actors, things and knowledge', async () => {
  const { actors, things, knowledge } = await import('./laws.mjs');
  const found = actors({ events: [{ id: 'e1', actors: ['a', 'b', 'c'] }], inScene: ['a'], chance: id => ({ b: 0.4, c: 0.1 })[id], elsewhere: () => false });
  assert.deepEqual([found.add, found.flags.map(flag => flag.person)], [['b'], ['c']]);
  const held = things([{ person: 'a', after: 'e1', holds: ['key'], drops: [] }, { person: 'b', after: 'e2', holds: ['key'], drops: [] }], new Map([['e1', 1], ['e2', 2]]));
  assert.equal(held.flags.length, 1);
  const learned = knowledge([{ person: 'a', after: 'e1', learns: ['the plan'] }, { person: 'z', after: 'e1', learns: ['the plan'] }], new Map([['e1', 's1']]), () => new Set(['a']));
  assert.deepEqual(learned.map(flag => flag.person), ['z']);
});

test('someone a dialogue shows was there joins the scene, and a person elsewhere at that time does not', async () => {
  const { join } = await import('./world.mjs');
  const world = createWorld();
  enter(world, { id: 's1', place: 'P', relation: 'after', present: ['x'] });
  const same = enter(world, { id: 's2', place: 'Q', relation: 'same', present: ['y'] });
  assert.equal(join(world, same, 'x', 'dialogue'), false, 'x is at P at this time');
  assert.equal(join(world, same, 'z', 'dialogue'), true);
  assert.equal(world.people.z.place, 'Q');
});

test('lineage: what led up to an event, from the world alone; EM from world evidence merges only when one person would not be in two places at once', async () => {
  const { lineage, sameness } = await import('./solidify.mjs');
  const script = { names: { a: '御坂美琴', b: '美琴', c: '上条当麻', d: '御坂妹' }, scenes: [
    { id: 's1', place: 'P', clock: [0, 1], present: ['a', 'c'], stayed: [], timeline: [{ type: 'event', id: 'e1', actors: ['a'] }, { type: 'dialogue', id: 'd1', kind: 'live', parties: ['a', 'c'], listeners: [] }] },
    { id: 's2', place: 'Q', clock: [1, 2], present: ['b', 'c'], stayed: [], timeline: [{ type: 'event', id: 'e2', actors: ['c'] }] },
    { id: 's3', place: 'R', clock: [1, 2], present: ['d'], stayed: [], timeline: [] },
  ] };
  const led = lineage(script, 'e2');
  assert.deepEqual(led.map(item => item.id), ['d1'], 'the dialogue c took part in leads to e2; e1 shares nobody and was elsewhere');
  const pairs = sameness(script, script.names);
  const ab = pairs.find(pair => pair.names.includes('美琴') && pair.names.includes('御坂美琴'));
  assert.ok(ab && !ab.conflict, 'never together, names overlap, a companion shared, no clash');
  assert.ok(!pairs.some(pair => pair.names.includes('御坂妹')), 'no shared companion');
});

test('a flashback opens only where the text looks back, and a chapter opens in the main time', async () => {
  const { BACKWARD } = await import('./world.mjs');
  const world = createWorld();
  enter(world, { id: 's1', chapter: 0, place: 'P', relation: 'after', present: ['x'] });
  assert.ok(!allowedTimes(world, ['y'], 'Q', { opening: '第二章变化的学园都市，前夜' }).includes('flashback'));
  assert.ok(allowedTimes(world, ['y'], 'Q', { opening: '事情要追溯到之前上条出门的时候' }).includes('flashback'));
  enter(world, { id: 's2', chapter: 0, place: 'Q', relation: 'flashback', present: ['y'] });
  assert.deepEqual(allowedTimes(world, ['y'], 'Q', { opening: '' }), ['after', 'later', 'back']);
  assert.ok(allowedTimes(world, ['z'], 'R', { opening: '', chapterStart: true }).includes('same'), 'a new chapter is in the main time');
  assert.ok(enter(world, { id: 's3', chapter: 1, place: 'R', relation: 'after', present: ['z'], chapterStart: true }).clock, 'not the past');
  assert.ok(BACKWARD.test('三年前的那天'));
});
