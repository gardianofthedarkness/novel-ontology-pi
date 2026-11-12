// The agent's workflows: the runner keeps the agent at a step until its check passes, in the fixed format, or gives up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKFLOWS, followUp, runWorkflow } from './workflows.mjs';

const book = async () => { const root = await mkdtemp(join(tmpdir(), 'workflow-')), novel = join(root, 'vol-1', 'novel'); await mkdir(novel, { recursive: true }); return novel; };
const definition = (left) => ({ title: 'test', verbs: ['places'], format: ['Done', 'Left'], rounds: 3, prompt: novel => `do it on ${novel}`, check: async () => ({ done: left.length === 0, left: [...left], summary: {} }) });

test('every workflow names its whole job, its commands, a fixed format and a check', () => {
  for (const [id, workflow] of Object.entries(WORKFLOWS)) {
    assert.ok(workflow.verbs.length && workflow.format.length && workflow.rounds >= 2 && typeof workflow.check === 'function', id);
    const prompt = workflow.prompt('/lib/vol-1/novel');
    for (const heading of workflow.format) assert.ok(prompt.includes(`## ${heading}`), `${id}: ${heading}`);
  }
  assert.match(WORKFLOWS.places.prompt('/b'), /buildings and rooms/);
  assert.match(WORKFLOWS.places.prompt('/b'), /novel places check \/b/);
});

test('the agent is sent the follow-up with what is left until the check passes, in the same session', async () => {
  const novel = await book(), left = ['unproved placement: u4', 'unplaced story unit: u5'], sent = [];
  const driver = async ({ message, session }) => { sent.push({ message, session }); left.shift(); return { reply: '## Done\nyes\n## Left\nnone', session: 's1', commands: 3 }; };
  const result = await runWorkflow('places', novel, { driver, definition: definition(left) });
  assert.deepEqual([result.done, result.rounds], [true, 2]);
  assert.equal(sent[0].session, null); assert.equal(sent[1].session, 's1');
  assert.match(sent[1].message, /Not finished: .* 1 thing left:\n- unplaced story unit: u5/s);
  const record = JSON.parse(await readFile(result.record, 'utf8'));
  assert.deepEqual(record.rounds.map(round => round.check.left), [1, 0]);
});

test('a reply out of the fixed format is sent back even when the check passes; the rounds run out and the step fails', async () => {
  const novel = await book(), sent = [];
  const driver = async ({ message }) => { sent.push(message); return { reply: 'all good' }; };
  const result = await runWorkflow('places', novel, { driver, definition: definition([]) });
  assert.deepEqual([result.done, result.rounds], [true, 3]);
  assert.match(sent[1], /not in the fixed format/);
  const stuck = await runWorkflow('places', novel, { driver: async () => ({ reply: '## Done\n## Left' }), definition: definition(['x']) });
  assert.deepEqual([stuck.done, stuck.rounds, stuck.left], [false, 3, ['x']]);
  assert.match(followUp(definition(['x']), novel, { done: false, left: ['x'] }, false), /When it is done, reply in exactly this format:\n## Done\n## Left/);
});
