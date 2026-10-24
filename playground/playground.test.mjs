import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { configuration, startPlayground } from './start.mjs';
import { preparePlayground } from './prepare.mjs';
import { LadybugStore } from '../dist/src/ground/connectors/ladybug.js';

test('team configuration fails closed and never silently starts paid work', () => {
  assert.equal(configuration([], {}).mode, 'view');
  assert.throws(() => configuration(['--mode', 'agent'], {}), /requires/);
  assert.throws(() => configuration(['--minutes', '241'], {}), /Session/);
  assert.throws(() => configuration(['--port', '0'], {}), /Port/);
  assert.throws(() => configuration(['--mode', 'replay'], {}), /Mode/);
  assert.throws(() => configuration(['--origin', 'http://public.example'], {}), /Origin/);
  assert.equal(configuration(['--mode', 'agent'], { WORK_LLM_API_KEY: 'synthetic', TYPESAFE_API_KEY: 'synthetic' }).mode, 'agent');
});

test('synthetic fixture is deterministic, source-bound and separate from a fresh live database', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'team-data-test-')));
  try {
    const prepared = await preparePlayground(join(home, 'one'));
    const other = await preparePlayground(join(home, 'two'));
    assert.deepEqual(prepared.manifest.counts, { chapters: 2, scenes: 8, events: 8, entities: 5 });
    assert.equal(prepared.manifest.sourceSha256, other.manifest.sourceSha256);
    assert.equal(prepared.manifest.modelCalls, 0);
    assert.equal(await readFile(join(prepared.workspace, 'ontology/events.jsonl'), 'utf8'), '');
    await assert.rejects(readFile(join(prepared.reference, 'events.jsonl')), { code: 'ENOENT' });
    const graph = new LadybugStore(join(prepared.reference, 'ontology/graph.lbug'));
    try { assert.equal((await graph.run('MATCH (event:Event) RETURN count(event) AS total'))[0].total, 8); }
    finally { await graph.close(); }
    const scenes = (await readFile(join(prepared.reference, 'ontology/scenes.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(scenes[4].dialogues[0].participantIds, ['char_xu', 'char_lin']);
    assert.deepEqual(scenes[5].dialogues[0].participantIds, ['char_zhou', 'char_lin']);
    await assert.rejects(preparePlayground(prepared.home), { code: 'EEXIST' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const mode of ['view', 'agent']) test(`end-to-end ${mode} host serves real graph/source APIs and starts no inference`, { timeout: 30000 }, async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'team-host-test-')));
  let host;
  try {
    host = await startPlayground({ home, mode, port: 0, minutes: 1 }, { PATH: process.env.PATH, HOME: process.env.HOME, WORK_LLM_API_KEY: 'synthetic-not-a-provider-key', TYPESAFE_API_KEY: 'synthetic-not-a-provider-key' });
    const base = new URL(host.readOnlyUrl);
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /@vite\/client/);
    const live = await fetch(new URL('api/live', base)).then(response => response.json());
    assert.equal(live.counts.events, mode === 'view' ? 8 : 0);
    assert.match(live.jobLabel, /Synthetic|synthetic/);
    assert.equal((await fetch(base.origin)).status, 401);
    const client = await fetch(new URL('@vite/client', base)).then(response => response.text());
    const token = JSON.parse(client.match(/const wsToken = ("[^"]+")/)[1]);
    await new Promise((done, reject) => {
      let connection;
      const timer = setTimeout(() => { connection?.destroy(); outgoing.destroy(); reject(new Error('Gateway HMR did not connect')); }, 3000);
      const outgoing = request(new URL(`__hmr?token=${token}`, base), { headers: { Origin: base.origin, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol': 'vite-hmr' } });
      outgoing.once('error', error => { clearTimeout(timer); reject(error); });
      outgoing.once('response', response => { response.resume(); clearTimeout(timer); reject(new Error('Gateway HMR upgrade rejected')); });
      outgoing.once('upgrade', (response, socket, head) => {
        connection = socket;
        assert.equal(response.statusCode, 101);
        let received = head.toString('utf8');
        const inspect = () => { if (received.includes('connected')) { clearTimeout(timer); socket.destroy(); done(); } };
        socket.on('data', chunk => { received += chunk.toString('utf8'); inspect(); });
        inspect();
      });
      outgoing.end();
    });
    assert.equal((await fetch(new URL('api/pi/messages', base), { method: 'POST', headers: { Origin: base.origin }, body: '{}' })).status, mode === 'view' ? 404 : 403);
    if (mode === 'view') {
      assert.equal((await fetch(new URL('api/pi', base))).status, 404);
      const source = await fetch(new URL('api/record-source?id=scene_001', base)).then(response => response.json());
      assert.equal(source.complete, true);
      assert.match(source.text, /林岚|周宁/);
      const dialogue = await fetch(new URL('api/record-source?id=view-card:scene_001:0', base)).then(response => response.json());
      assert.equal(dialogue.complete, true);
      assert.doesNotMatch(dialogue.text, /发现桥头/);
    } else {
      const status = await fetch(new URL('api/pi', base)).then(response => response.json());
      assert.equal(status.status, 'ready');
      assert.equal(status.pending, 0);
      assert.equal(status.processing, 0);
      const records = (await readFile(join(host.session, 'runtime/pi-events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(records.every(record => record.type === 'pi.status'));
      assert.equal(await readFile(join(host.prepared.workspace, 'ontology/events.jsonl'), 'utf8'), '');
    }
    await assert.rejects(startPlayground({ home, mode: 'view', port: 0, minutes: 1 }), { code: 'EEXIST' });
  } finally {
    await host?.stop();
    await rm(home, { recursive: true, force: true });
  }
});
