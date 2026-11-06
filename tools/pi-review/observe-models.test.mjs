import test from 'node:test';
import assert from 'node:assert/strict';
import { observeModels } from './observe-models.mjs';

test('the observer passes Jev\'s image opt-in on, and nothing else of the caller\'s headers', async context => {
  const key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-jev-key';
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.typesafe.ai/')) return realFetch(url, init);
    sent.push(init.headers);
    return new Response('{"answers":[]}', { status: 200 });
  };
  const observer = await observeModels('test-work-key', async () => {});
  context.after(async () => { globalThis.fetch = realFetch; await observer.close(); if (key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = key; });
  const ask = headers => realFetch(observer.env.JEV_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jev-key', 'X-Other': 'no', ...headers }, body: '{"questions":{}}' });
  assert.equal((await ask({ 'TypeSafe-Danger-Zone-Images': 'true' })).status, 200);
  assert.equal((await ask({})).status, 200);
  assert.equal(sent[0]['TypeSafe-Danger-Zone-Images'], 'true');
  assert.equal(sent[1]['TypeSafe-Danger-Zone-Images'], undefined);
  assert.ok(sent.every(headers => !('X-Other' in headers)));
});
