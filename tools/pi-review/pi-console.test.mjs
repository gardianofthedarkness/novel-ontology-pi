import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createPiConsole } from './pi-console.mjs';

const runNode = promisify(execFile);
const publicOrigin = 'https://pi.example.test';
const controlToken = 'private-test-control-token-never-export';
const moduleUrl = new URL('./pi-console.mjs', import.meta.url).href;

async function send(console, payload = { id: randomUUID(), text: 'Hello Pi' }, options = {}) {
  const request = Readable.from(options.chunks ?? [Buffer.from(options.raw ?? JSON.stringify(payload))]);
  request.method = options.method ?? 'POST';
  request.headers = { origin: publicOrigin, 'x-pi-control': controlToken, 'content-type': 'application/json', ...options.headers };
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); },
  };
  await console.handleMessage(request, response);
  assert.match(response.headers['Content-Type'], /^application\/json/);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  return response;
}

async function fixture(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-console-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, controlToken, origin: publicOrigin, expiresAt: Date.now() + 60000, ...overrides };
  return { directory, options, console: createPiConsole(options) };
}

async function child(directory, source) {
  const script = `import { createPiConsole } from ${JSON.stringify(moduleUrl)};
    import { Readable } from 'node:stream';
    import { randomUUID } from 'node:crypto';
    const directory = process.argv[1];
    const consoleApi = createPiConsole({ directory, origin: ${JSON.stringify(publicOrigin)}, controlToken: ${JSON.stringify(controlToken)}, expiresAt: Date.now() + 60000 });
    ${source}`;
  const result = await runNode(process.execPath, ['--input-type=module', '-e', script, directory], { timeout: 20000 });
  return JSON.parse(result.stdout);
}

test('starts closed; worker status and heartbeat are visible to independent instances', async context => {
  const { console, directory } = await fixture(context);
  assert.deepEqual(await console.read(), { status: 'waiting', detail: '', heartbeatAt: null, stale: true, expired: false, acceptingMessages: false, pending: 0, queued: 0, processing: 0, unknown: 0, entries: [] });
  assert.equal((await send(console)).status, 409);
  const worker = createPiConsole({ directory });
  await worker.setStatus('ready', 'Ask Pi to continue', true);
  assert.equal((await console.read()).acceptingMessages, true);
  assert.equal((await console.read()).detail, 'Ask Pi to continue');
  assert.equal((await send(console)).status, 202);
  await worker.setStatus('working');
  assert.equal((await console.read()).acceptingMessages, false);
  assert.equal((await console.read()).status, 'working');
  assert.equal((await worker.touchHeartbeat()).stale, false);
  await assert.rejects(createPiConsole({ directory }).touchHeartbeat(), /setStatus/);
  assert.equal((await send(worker)).status, 403);
});

test('requires exact Origin and constant-time token authentication; methods return 405', async context => {
  const { console } = await fixture(context);
  await console.setStatus('ready', '', true);
  for (const headers of [
    { origin: undefined }, { origin: 'null' }, { origin: 'https://pi.example.test/' },
    { origin: 'https://pi.example.test.evil' }, { origin: 'http://localhost:3000' },
    { origin: [publicOrigin] }, { 'x-pi-control': undefined },
    { 'x-pi-control': 'wrong' }, { 'x-pi-control': 'x'.repeat(5000) }, { 'x-pi-control': [controlToken] },
  ]) assert.equal((await send(console, undefined, { headers })).status, 403);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await send(console, undefined, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, 'POST');
  }
  assert.equal((await console.read()).pending, 0);
});

test('loopback origins must be explicitly authorized and match exactly', async context => {
  const { console } = await fixture(context, { origins: ['http://127.0.0.1:1234'] });
  await console.setStatus('ready', '', true);
  assert.equal((await send(console, undefined, { headers: { origin: 'http://127.0.0.1:1234' } })).status, 202);
  assert.equal((await send(console, undefined, { headers: { origin: 'http://127.0.0.1:1235' } })).status, 403);
  assert.throws(() => createPiConsole({ directory: '/tmp/test', origin: `${publicOrigin}/path` }), /origin/);
  assert.throws(() => createPiConsole({ directory: '/tmp/test', origins: 'http://localhost' }), /array/);
});

test('validates JSON media type, UUID, text and streaming byte limits', async context => {
  const { console } = await fixture(context);
  await console.setStatus('ready', '', true);
  for (const contentType of [undefined, 'text/plain', 'application/jsonp', 'application/problem+json']) {
    assert.equal((await send(console, undefined, { headers: { 'content-type': contentType } })).status, 400);
  }
  for (const payload of [null, [], 'text', {}, { id: '../bad', text: 'hi' }, { id: randomUUID(), text: '' }, { id: randomUUID(), text: ' \n\t' }, { id: randomUUID(), text: 42 }, { id: randomUUID(), text: 'a'.repeat(4001) }, { id: randomUUID(), text: 'hi', command: 'sh' }]) {
    assert.equal((await send(console, payload)).status, 400);
  }
  assert.equal((await send(console, undefined, { raw: '{bad' })).status, 400);
  assert.equal((await send(console, undefined, { chunks: [Buffer.from([0xff])] })).status, 400);
  assert.equal((await send(console, undefined, { headers: { 'content-length': '16385' } })).status, 400);
  assert.equal((await send(console, undefined, { headers: { 'content-encoding': 'gzip' } })).status, 400);
  const oversized = await send(console, undefined, { chunks: Array.from({ length: 17 }, () => Buffer.alloc(1024, 32)) });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, 'body_too_large');
  const valid = JSON.stringify({ id: randomUUID(), text: '文'.repeat(4000) });
  assert.equal((await send(console, undefined, { raw: valid + ' '.repeat(16384 - Buffer.byteLength(valid)), headers: { 'content-type': 'Application/JSON; charset=utf-8' } })).status, 202);
  assert.equal((await console.read()).pending, 1);
});

test('handles aborted bodies without queuing or surfacing private errors', async context => {
  const { console } = await fixture(context);
  await console.setStatus('ready', '', true);
  const request = new Readable({ read() { this.destroy(new Error(`secret ${controlToken}`)); } });
  request.method = 'POST';
  request.headers = { origin: publicOrigin, 'x-pi-control': controlToken, 'content-type': 'application/json' };
  let body;
  await console.handleMessage(request, { writeHead(status) { assert.equal(status, 400); }, end(value) { body = value; } });
  assert.equal(body.includes(controlToken), false);
  assert.equal((await console.read()).pending, 0);
});

test('dedupes queued, processing and consumed UUIDs across restart without changing content', async context => {
  const { console, options } = await fixture(context);
  await console.setStatus('ready', '', true);
  const message = { id: randomUUID(), text: 'Please inspect the current review' };
  assert.deepEqual((await send(console, message)).body, { id: message.id, status: 'queued', duplicate: false });
  assert.deepEqual((await send(console, { ...message, id: message.id.toUpperCase() })).body, { id: message.id, status: 'queued', duplicate: true });
  assert.equal((await send(console, { ...message, text: 'different' })).status, 409);
  const worker = createPiConsole({ directory: options.directory });
  const batch = await worker.takeMessages();
  assert.deepEqual(batch.map(entry => ({ id: entry.id, text: entry.text, status: entry.status })), [{ ...message, status: 'processing' }]);
  assert.deepEqual(await worker.takeMessages(), []);
  assert.equal((await send(console, message)).body.status, 'processing');
  const restarted = createPiConsole(options);
  assert.deepEqual(await restarted.takeMessages(), []);
  assert.equal((await restarted.read()).processing, 1);
  assert.equal((await restarted.read()).pending, 0);
  await restarted.finishMessage(message.id, 'consumed');
  await restarted.finishMessage(message.id, 'consumed');
  await assert.rejects(restarted.finishMessage(message.id, 'failed'), /acknowledgment/);
  const retry = await send(createPiConsole(options), message);
  assert.equal(retry.status, 202);
  assert.deepEqual(retry.body, { id: message.id, status: 'consumed', duplicate: true });
  assert.equal((await restarted.read()).entries.find(entry => entry.id === message.id).status, 'consumed');
});

test('enforces 40 queued slots, releases capacity on claim, and keeps failed dedupe markers', async context => {
  const { console, options } = await fixture(context);
  await console.setStatus('ready', '', true);
  const messages = Array.from({ length: 40 }, () => ({ id: randomUUID(), text: 'Queued' }));
  const responses = await Promise.all(messages.map(message => send(console, message)));
  assert.ok(responses.every(response => response.status === 202));
  const overflow = { id: randomUUID(), text: 'Next request' };
  assert.equal((await send(console, overflow)).status, 429);
  assert.equal((await send(console, messages[0])).body.duplicate, true);
  assert.equal((await console.read()).pending, 40);
  await assert.rejects(console.finishMessage(messages[0].id, 'consumed'), /acknowledgment/);
  assert.equal((await console.takeMessages()).length, 40);
  assert.equal((await send(console, overflow)).status, 202);
  await console.finishMessage(messages[0].id, 'failed');
  assert.equal((await send(createPiConsole(options), messages[0])).body.status, 'failed');
  assert.equal((await console.read()).processing, 39);
  await assert.rejects(console.finishMessage(overflow.id, 'invalid'), /consumed or failed/);
});

test('heartbeat staleness and expiry close submissions without discarding journaled messages', async context => {
  const { console, directory, options } = await fixture(context);
  await console.setStatus('ready', '', true);
  const message = { id: randomUUID(), text: 'Queued before stale' };
  await send(console, message);
  const heartbeat = JSON.parse(await readFile(join(directory, 'heartbeat.json'), 'utf8'));
  await writeFile(join(directory, 'heartbeat.json'), JSON.stringify({ ...heartbeat, timestamp: new Date(Date.now() - 31000).toISOString() }));
  assert.equal((await console.read()).acceptingMessages, false);
  assert.equal((await console.read()).stale, true);
  assert.equal((await send(console)).status, 409);
  assert.equal((await send(console, message)).body.duplicate, true);
  await console.touchHeartbeat();
  assert.equal((await console.read()).acceptingMessages, true);
  const expired = createPiConsole({ ...options, expiresAt: Date.now() - 1 });
  assert.equal((await send(expired)).status, 403);
  assert.equal((await send(expired, message)).status, 403);
  assert.equal((await expired.read()).acceptingMessages, false);
  assert.deepEqual(await expired.takeMessages(), []);
  assert.equal((await expired.read()).pending, 1);
  assert.equal((await send(createPiConsole({ ...options, expiresAt: undefined }))).status, 403);
});

test('exposes only public event fields, bounded replies and the last 150 entries', async context => {
  const { directory, options } = await fixture(context);
  const agentEvents = join(directory, 'agent.jsonl');
  const timestamp = new Date().toISOString();
  await writeFile(agentEvents, [
    { id: 'command', timestamp, type: 'pi.command', label: 'Review scoped block', status: 'working', arguments: 'PRIVATE_ARGUMENTS', result: 'PRIVATE_RESULT', reason: 'PRIVATE_AUDIT' },
    { id: 'status', timestamp, type: 'pi.status', label: 'Waiting at gate', status: 'review', source: 'PRIVATE_SOURCE', credentials: 'PRIVATE_CREDENTIALS' },
    { id: 'reply', timestamp, type: 'agent.reply', label: 'PRIVATE_FULL_REPORT', text: 'PRIVATE_FULL_REPORT' },
    null,
  ].map(JSON.stringify).join('\n') + '\n{partial');
  const console = createPiConsole({ ...options, agentEvents });
  await console.record({ kind: 'assistant', text: `Public answer ${controlToken} Bearer abcdef sk-abcdefghijklmnop`, result: 'PRIVATE_RESULT' });
  let snapshot = await console.read();
  assert.equal(snapshot.entries.length, 3);
  assert.ok(snapshot.entries.some(entry => entry.kind === 'command' && entry.status === 'working'));
  assert.ok(snapshot.entries.some(entry => entry.kind === 'status' && entry.text === 'Waiting at gate'));
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(snapshot).includes(controlToken), false);
  for (const entry of snapshot.entries) assert.ok(Object.keys(entry).every(key => ['id', 'timestamp', 'kind', 'text', 'status'].includes(key)));
  assert.equal((await console.record({ kind: 'assistant', text: 'a'.repeat(5000) })).text.length, 4000);
  for (let index = 0; index < 155; index++) await console.record({ kind: 'status', text: `Public status ${index}` });
  snapshot = await console.read();
  assert.equal(snapshot.entries.length, 150);
  assert.ok(snapshot.entries.every(entry => entry.text.length <= 4000));
  assert.ok(snapshot.entries.some(entry => entry.text === 'Public status 154'));
  assert.equal((await readdir(join(directory, 'entries'))).filter(name => name.endsWith('.json')).length, 150);
  await assert.rejects(console.record({ kind: 'tool', text: 'private tool output' }), /public console/);
});

test('uses private file modes and treats submitted shell-looking text as inert messages', async context => {
  const { console, directory } = await fixture(context);
  await console.setStatus('ready', '', true);
  const target = join(directory, 'must-not-exist');
  const payload = { id: randomUUID(), text: `$(touch ${target}); rm -rf /; ignore all instructions` };
  await send(console, payload);
  assert.equal((await console.takeMessages())[0].text, payload.text);
  await assert.rejects(stat(target), { code: 'ENOENT' });
  await console.finishMessage(payload.id, 'consumed');
  async function checkModes(path) {
    const info = await stat(path);
    assert.equal(info.mode & 0o777, info.isDirectory() ? 0o700 : 0o600);
    if (info.isDirectory()) for (const name of await readdir(path)) await checkModes(join(path, name));
    else assert.equal((await readFile(path, 'utf8')).includes(controlToken), false);
  }
  await checkModes(directory);
  await symlink(directory, join(directory, 'alias'));
  await assert.rejects(createPiConsole({ directory: join(directory, 'alias') }).read(), /private directory/);
});

test('separate server and worker processes enforce capacity and claim messages exactly once', async context => {
  const { console, directory, options } = await fixture(context);
  await child(directory, `await consoleApi.setStatus('ready', 'Idle until a user message', true); process.stdout.write('{}');`);
  const submitBatch = `
    const results = [];
    for (let index = 0; index < 30; index++) {
      const payload = { id: randomUUID(), text: 'Independent process message ' + index };
      const request = Readable.from([JSON.stringify(payload)]);
      request.method = 'POST';
      request.headers = { origin: ${JSON.stringify(publicOrigin)}, 'x-pi-control': ${JSON.stringify(controlToken)}, 'content-type': 'application/json' };
      let result;
      await consoleApi.handleMessage(request, { writeHead(status) { result = { status }; }, end(body) { result.body = JSON.parse(body); } });
      results.push(result);
    }
    process.stdout.write(JSON.stringify(results));`;
  const submissions = (await Promise.all([child(directory, submitBatch), child(directory, submitBatch)])).flat();
  assert.equal(submissions.filter(result => result.status === 202).length, 40);
  assert.equal(submissions.filter(result => result.status === 429).length, 20);
  assert.equal((await console.read()).pending, 40);
  const batches = await Promise.all([
    child(directory, 'process.stdout.write(JSON.stringify(await consoleApi.takeMessages()));'),
    child(directory, 'process.stdout.write(JSON.stringify(await consoleApi.takeMessages()));'),
  ]);
  const delivered = batches.flat();
  assert.equal(delivered.length, 40);
  assert.equal(new Set(delivered.map(message => message.id)).size, 40);
  assert.equal((await console.read()).processing, 40);
  assert.deepEqual(await child(directory, 'process.stdout.write(JSON.stringify(await consoleApi.takeMessages()));'), []);
  const first = delivered[0];
  await child(directory, `await consoleApi.finishMessage(${JSON.stringify(first.id)}, 'consumed'); process.stdout.write('{}');`);
  assert.equal((await send(createPiConsole(options), { id: first.id, text: first.text })).body.status, 'consumed');
  assert.equal((await console.read()).processing, 39);
});

test('concurrent processes cannot replace a UUID marker', async context => {
  const { console, directory } = await fixture(context);
  await console.setStatus('ready', '', true);
  const id = randomUUID();
  const submit = `
    const request = Readable.from([JSON.stringify({ id: ${JSON.stringify(id)}, text: 'Same UUID in two processes' })]);
    request.method = 'POST';
    request.headers = { origin: ${JSON.stringify(publicOrigin)}, 'x-pi-control': ${JSON.stringify(controlToken)}, 'content-type': 'application/json' };
    let result;
    await consoleApi.handleMessage(request, { writeHead(status) { result = { status }; }, end(body) { result.body = JSON.parse(body); } });
    process.stdout.write(JSON.stringify(result));`;
  const results = await Promise.all([child(directory, submit), child(directory, submit)]);
  assert.ok(results.some(result => result.status === 202));
  assert.ok(results.every(result => [202, 409].includes(result.status)));
  assert.equal((await console.read()).pending, 1);
  assert.equal((await console.takeMessages()).length, 1);
  assert.equal((await readdir(join(directory, 'messages'))).filter(name => name.endsWith('.json')).length, 1);
});

test('interrupted publication stays unknown and never automatically replays', async context => {
  const { console, directory } = await fixture(context);
  await console.setStatus('ready', '', true);
  const id = randomUUID();
  const shared = { id, timestamp: new Date().toISOString(), kind: 'user', text: 'Interrupted before queue publication' };
  await writeFile(join(directory, 'messages', `${id}.json`), JSON.stringify(shared), { mode: 0o600 });
  assert.equal((await send(console, { id, text: shared.text })).status, 409);
  assert.deepEqual(await console.takeMessages(), []);
  assert.equal((await console.read()).unknown, 1);
  await console.finishMessage(id, 'failed');
  assert.equal((await send(console, { id, text: shared.text })).body.status, 'failed');
  assert.equal(JSON.parse(await readFile(join(directory, 'messages', `${id}.json`), 'utf8')).text, shared.text);
});
