import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMind } from './mind.mjs';

// Made-up person and models; nothing from any book, no spend.
const self = { id: 'a', name: 'A', about: 'A student.' };
function models({ table = {}, delay = 0, recalls = [] } = {}) {
  const log = { decide: [], spoke: [], started: 0, running: 0, maxRunning: 0 };
  const decide = async (state, questions) => {
    log.running++; log.maxRunning = Math.max(log.maxRunning, log.running);
    await new Promise((r) => setTimeout(r, delay));
    log.running--; log.decide.push({ state, questions });
    return questions.map((q) => {
      const v = typeof table[q.key] === 'function' ? table[q.key](q, state) : table[q.key];
      return { key: q.key, value: v ?? (q.primitive === 'noul' ? 0 : q.options.at(-1)), confidence: 0.8 };
    });
  };
  return {
    log,
    decide,
    speak: async ({ prompt }) => { log.spoke.push(prompt); return 'hello'; },
    recall: async () => recalls,
    cuesOf: () => [],
  };
}
const first = (q) => q.options[0];

test('the departments run at once, each turn', async () => {
  const m = models({ delay: 20 });
  await createMind(self, m).turn({ from: 'B', text: 'hi' });
  assert.equal(m.log.maxRunning, 3, 'emotion, subjectivity and action ask Jev together; memory recalls beside them');
});

test('the brain stem lets one speech through and the speaker is called only then', async () => {
  const m = models({ table: { 'subject.stance': 'answer', 'subject.matters': 1, 'stem.speak': first, 'emotion.arousal': 'stirred', 'emotion.valence': 'bad' } });
  const out = await createMind(self, m).turn({ from: 'B', text: 'hi' });
  assert.equal(out.said, 'hello');
  assert.equal(m.log.spoke.length, 1);
  assert.match(m.log.spoke[0], /What you want to do: answer/);
  assert.ok(out.sank.some((u) => u.kind === 'express'), 'the feeling did not come out: it sank');
  // The trace keeps every department's questions and answers and the stem's choice of each urge.
  assert.deepEqual(Object.keys(out.trace.departments).sort(), ['action', 'emotion', 'memory', 'subjectivity']);
  assert.equal(out.trace.departments.emotion.calls[0].answers.find((a) => a.key === 'emotion.arousal').value, 'stirred');
  assert.equal(out.trace.stem.urges.length, out.trace.stem.surfaced.length);
  assert.ok(out.trace.speaker.prompt.includes('answer'));

  const quiet = models({ table: { 'subject.stance': 'answer' } }); // the stem answers "stay silent"
  const q = await createMind(self, quiet).turn({ from: 'B', text: 'hi' });
  assert.equal(q.said, null);
  assert.equal(quiet.log.spoke.length, 0, 'no speech surfaced, no text call');
});

test('what sinks waits, weaker, and can surface on a later turn or fade', async () => {
  let open = false;
  const m = models({ table: {
    'subject.stance': (q, s) => (s.now.startsWith('A message') ? 'comfort' : 'say nothing'),
    'subject.matters': 1,
    'stem.speak': (q) => (open ? q.options.find((o) => /waiting 1 turn/.test(o)) : 'stay silent'),
  } });
  const mind = createMind(self, m);
  const t1 = await mind.turn({ from: 'B', text: 'I lost my cat' });
  const sunk = t1.sank.find((u) => u.kind === 'speak');
  assert.equal(t1.said, null);
  assert.equal(sunk.age, 1);
  assert.ok(sunk.salience < 1);
  open = true;
  const t2 = await mind.turn(null); // time passes, no message: the urge from before comes out
  assert.equal(t2.said, 'hello');
  assert.match(m.log.spoke[0], /comfort[\s\S]*You write first/);

  const fade = createMind(self, models({ table: { 'subject.stance': (q, s) => (s.now.startsWith('A message') ? 'tease' : 'say nothing') } }));
  let left = (await fade.turn({ from: 'B', text: 'x' })).sank.filter((u) => u.kind === 'speak').length;
  for (let i = 0; i < 6 && left; i++) left = (await fade.turn(null)).sank.filter((u) => u.kind === 'speak').length;
  assert.equal(left, 0, 'an urge never acted on fades out');
});

test('recalls go with the speech when they surface, and stay on the mind for the next turn', async () => {
  const m = models({
    table: { 'subject.stance': 'answer', 'stem.speak': first, 'stem.0': 1 },
    recalls: [{ id: 'm1', summary: 'the fight on the bridge', score: 2 }, { id: 'm2', summary: 'a quiet lunch', score: 0.5 }],
  });
  const mind = createMind(self, m);
  await mind.turn({ from: 'B', text: 'remember the bridge?' });
  assert.match(m.log.spoke[0], /the fight on the bridge/);
  assert.doesNotMatch(m.log.spoke[0], /a quiet lunch/, 'the weaker recall did not surface');
  assert.deepEqual(mind.state.onMind.map((x) => x.id), ['m1', 'm2']);
});
