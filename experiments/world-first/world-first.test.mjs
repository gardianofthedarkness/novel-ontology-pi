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
