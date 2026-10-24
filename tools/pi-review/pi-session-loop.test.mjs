import test from 'node:test';
import assert from 'node:assert/strict';
import { runConsoleSession } from './pi-session-loop.mjs';

test('Pi stays idle without user messages, then processes messages serially without inventing a continue prompt', async () => {
  const prompts = [];
  const acknowledgments = [];
  const entries = [];
  let polls = 0;
  let stop = false;
  let active = 0;
  const channel = {
    async setStatus() {}, async touchHeartbeat() {},
    async takeMessages() { return ++polls === 3 ? [{ id: 'a', text: 'Continue the next chapter.' }, { id: 'b', text: 'Report status.' }] : []; },
    async record(entry) { entries.push(entry); },
    async finishMessage(id, status) { acknowledgments.push({ id, status }); if (id === 'b') stop = true; },
  };
  const session = {
    messages: [],
    async prompt(text) { assert.equal(active++, 0); prompts.push(text); this.messages.push({ role: 'assistant', stopReason: 'stop' }); active--; },
    getLastAssistantText() { return 'Actual Pi response'; },
  };
  await runConsoleSession({ console: channel, session, deadline: Date.now() + 1000, stopped: () => stop, interval: 1 });
  assert.equal(polls, 3);
  assert.deepEqual(prompts, ['Continue the next chapter.', 'Report status.']);
  assert.deepEqual(acknowledgments, [{ id: 'a', status: 'consumed' }, { id: 'b', status: 'consumed' }]);
  assert.equal(entries.filter(entry => entry.kind === 'assistant').length, 2);
});

test('failed Pi turns are acknowledged as failed, never retried or reported complete', async () => {
  let stop = false;
  let calls = 0;
  let failed = false;
  const channel = {
    async setStatus() {}, async touchHeartbeat() {},
    async takeMessages() { return [{ id: 'a', text: 'Continue.' }]; },
    async finishMessage(_, status) { failed = status === 'failed'; stop = true; },
    async record(entry) { assert.equal(entry.kind, 'status'); assert.equal(entry.status, 'error'); },
  };
  await runConsoleSession({ console: channel, session: { async prompt() { calls++; throw new Error('private model error'); } }, deadline: Date.now() + 1000, stopped: () => stop });
  assert.equal(calls, 1);
  assert.ok(failed);
});
