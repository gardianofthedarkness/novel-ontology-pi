import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesk, frameOf, inFrame, layoutFaults, reframeOf, strandOrder, castOfCuts } from './workflow.mjs';

test('strands order the cuts: a cut waits for the last earlier cut casting each of its people', () => {
  const cuts = strandOrder([
    { id: 'c1', cast: ['mikoto'] }, { id: 'c2', cast: ['touma'] }, { id: 'c3', cast: ['mikoto'] }, { id: 'c4', cast: ['mikoto', 'touma'] }, { id: 'c5', cast: [] },
  ]);
  assert.deepEqual(cuts.map(cut => cut.after), [[], [], ['c1'], ['c3', 'c2'], []]);
  assert.deepEqual(cuts.map(cut => cut.wave), [0, 0, 1, 2, 0]);
});

test('a cut\'s cast is who acts, speaks or is addressed in its cards', () => {
  const cards = [{ id: 'k1', people: [{ id: 'a', how: ['speaks'] }, { id: 'b', how: ['mentioned'] }] }, { id: 'k2', people: [{ id: 'c', how: ['addressed'] }] }];
  assert.deepEqual(castOfCuts({ storyboard: [{ id: 'cut_1', index: 0, scene: 's', cards: ['k1', 'k2'] }], cards })[0].cast, ['a', 'c']);
});

test('the frame holds its cast at its shot size, and says who stands in it', () => {
  const frame = frameOf({ points: [[0, 0, 0], [2, 0, 0]], size: 'medium shot', angle: 'eye level', move: 'static' });
  assert.deepEqual(frame.centre, [1, 0, 0]);
  assert.equal(frame.window, 2.7);
  assert.equal(frame.follows, false);
  assert.ok(inFrame(frame, [3, 0, 0]));
  assert.ok(!inFrame(frame, [6, 0, 0]));
  assert.ok(!inFrame(frame, [1, 9, 0]), 'three floors up is out of frame');
  assert.equal(frameOf({ points: [[0, 0, 0]], size: 'wide shot', angle: 'high', move: 'pan' }).follows, true);
});

test('the layout check finds two on one cell and a shot size that cannot hold its cast', () => {
  const frame = frameOf({ points: [[0, 0, 0], [40, 0, 0]], size: 'close-up', angle: 'eye level', move: 'static' });
  const faults = layoutFaults({ frame, cast: [{ who: 'a', node: 1, at: [0, 0, 0] }, { who: 'b', node: 1, at: [0, 0, 0] }, { who: 'c', node: 2, at: [40, 0, 0] }] });
  assert.deepEqual(faults.map(fault => fault.fix), ['layout', 'tighten']);
  assert.deepEqual(layoutFaults({ frame: frameOf({ points: [[0, 0, 0], [3, 0, 0]], size: 'medium shot', angle: 'eye level', move: 'static' }), cast: [{ who: 'a', node: 1, at: [0, 0, 0] }, { who: 'b', node: 2, at: [3, 0, 0] }] }), []);
});

test('the reframe: held, followed, exits frame, or a new cut when the one who left is seen again in the cut', () => {
  const still = frameOf({ points: [[0, 0, 0], [2, 0, 0]], size: 'medium shot', angle: 'eye level', move: 'static' });
  const ended = [{ who: 'a', at: [0, 0, 0] }, { who: 'b', at: [20, 0, 0] }];
  assert.equal(reframeOf({ frame: still, ended: [{ who: 'a', at: [0, 0, 0] }], later: new Set() }).decision, 'held');
  assert.equal(reframeOf({ frame: still, ended, later: new Set() }).decision, 'exits frame');
  assert.equal(reframeOf({ frame: still, ended, later: new Set(['b']) }).decision, 'new cut');
  assert.equal(reframeOf({ frame: { ...still, follows: true }, ended, later: new Set(['b']) }).decision, 'followed');
});

test('the desk: versions, automatic retakes up to the cap, then the version with the fewest faults passes', () => {
  let t = 0;
  const desk = createDesk({ cuts: [{ id: 'c1', n: 1, scene: 's', cards: [], cast: ['a'] }], now: () => t++ });
  desk.start('c1', 'frame');
  assert.equal(desk.publish('c1', 'frame', { w: 1 }), 1);
  assert.equal(desk.check('c1', 'layout check', [{ law: 'frame', who: 'a', why: 'x' }, { law: 'frame', who: 'b', why: 'y' }], { of: 'frame' }), 'retake');
  desk.publish('c1', 'frame', { w: 2 });
  assert.equal(desk.check('c1', 'layout check', [{ law: 'frame', who: 'a', why: 'x' }], { of: 'frame' }), 'retake');
  desk.publish('c1', 'frame', { w: 3 });
  assert.equal(desk.check('c1', 'layout check', [{ law: 'frame', who: 'a', why: 'x' }, { law: 'L11', who: 'b', why: 'z' }], { of: 'frame' }), 'passed with faults');
  assert.deepEqual(desk.kept('c1', 'frame'), { w: 2 }, 'the frame the check found fewest faults in');
  assert.deepEqual(desk.kept('c1', 'layout check'), { of: 'frame', v: 2 });
  desk.publish('c1', 'keys', [], 'k1');
  assert.equal(desk.check('c1', 'key check', [{ law: 'L10', who: 'a', why: 'no way' }], { card: 'k1', canRetake: false }), 'passed with faults');
  const split = desk.split('c1', 'k1', 'came back');
  assert.equal(split, 'c1~2');
  const summary = desk.summary();
  assert.equal(summary.tasks['layout check'].retakes, 2);
  assert.equal(summary.tasks['layout check'].versions, 3);
  assert.equal(summary.tasks.frame.versions, 3);
  assert.equal(summary.tasks['key check']['passed with faults'], 1);
  assert.equal(summary.cuts, 1, 'the split has no tasks yet');
  assert.ok(desk.timeline.some(entry => entry.task === 'storyboard' && entry.to === 'c1~2'));
});
