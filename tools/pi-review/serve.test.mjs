import test from 'node:test';
import assert from 'node:assert/strict';
import { get, request } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createViewer, relativeHTML, validateOrigin, validateResources } from './serve.mjs';
import { createPiConsole } from './pi-console.mjs';
import { applySnapshotChanges } from './snapshot-delta.mjs';

const execute = promisify(execFile);
const controlToken = 'synthetic-operator-capability';
const state = () => ({ world: { laneNodes: [], interiors: {} }, activity: { cursor: 'initial', batch: { id: 'first' } }, status: 'idle' });

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'private-viewer-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const dist = join(directory, 'apps/playground/dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await mkdir(join(dist, 'db/novel'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/app-123.js"></script><link rel="stylesheet" href="/assets/app-123.css">');
  await writeFile(join(dist, 'assets/app-123.js'), 'export const built = true;');
  await writeFile(join(dist, 'assets/app-123.css'), 'body { color: black }');
  await writeFile(join(dist, 'assets/app-123.js.map'), 'PRIVATE_SOURCE_MAP');
  await writeFile(join(dist, 'db/novel/raw.txt'), 'PRIVATE_SOURCE');
  await writeFile(join(directory, 'private-report.json'), 'PRIVATE_REPORT');
  const start = async (options = {}) => {
    const viewer = await createViewer({ dist, port: 0, expiresAt: Date.now() + 60000, readLive: async () => state(), ...options });
    context.after(viewer.close);
    return viewer;
  };
  return { directory, dist, start };
}

function send(viewer, path = '', { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolveResponse, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port: viewer.port, path: `${viewer.privatePath}${path}`, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function connect(context, viewer) {
  const controller = new AbortController();
  context.after(() => controller.abort());
  const response = await fetch(`http://127.0.0.1:${viewer.port}${viewer.privatePath}api/live/stream`, { signal: controller.signal, headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return { controller, reader, async next() {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return { type: event.match(/^event: (.+)/)[1], data: JSON.parse(event.match(/\ndata: (.+)/)[1]) };
      }
      const result = await reader.read();
      if (result.done) throw new Error('Stream closed before an event');
      buffer += result.value;
    }
  } };
}

test('validates exact public/loopback origins and makes build URLs relative', () => {
  assert.equal(validateOrigin('http://127.0.0.1:4324', 4324), 'http://127.0.0.1:4324');
  assert.equal(validateOrigin('https://viewer.example', 4324), 'https://viewer.example');
  assert.equal(validateOrigin('https://viewer.example:8443', 4324), 'https://viewer.example:8443');
  for (const origin of ['http://localhost:4324', 'http://127.0.0.1:4325', 'http://example.com', 'https://viewer.example/', 'https://viewer.example/path', 'https://viewer.example?key=private', 'https://viewer.example#private', 'https://user:secret@viewer.example', 'https://viewer.example:443', 'null', '//viewer.example', 'file:///tmp']) {
    assert.throws(() => validateOrigin(origin, 4324), /origin/);
  }
  assert.equal(relativeHTML('<script src="/assets/app.js"></script><link href=\'assets/app.css\'><img src="data:,">'), '<script src="./assets/app.js"></script><link href=\'./assets/app.css\'><img src="data:,">');
  assert.equal(relativeHTML('<script src="./assets/app.js"></script>'), '<script src="./assets/app.js"></script>');
});

test('validates build resources, rejects missing files and symlinks', async context => {
  const { directory, dist } = await fixture(context);
  const resources = await validateResources(dist);
  assert.equal(resources.clientBundle, 'app-123.js');
  await writeFile(join(dist, 'index.html'), '<script src="/assets/missing.js"></script>');
  await assert.rejects(validateResources(dist), { code: 'ENOENT' });
  await symlink(join(directory, 'private-report.json'), join(dist, 'assets/report.js'));
  await writeFile(join(dist, 'index.html'), '<script src="/assets/report.js"></script>');
  await assert.rejects(validateResources(dist), /outside the build/);
  await writeFile(join(dist, 'index.html'), '<script src="/assets/app-123.js.map"></script>');
  await assert.rejects(validateResources(dist), /built asset/);
});

test('serves only a fresh private path, relative HTML, built assets and public snapshots', async context => {
  const { start } = await fixture(context);
  const viewer = await start();
  const other = await start();
  assert.equal(viewer.server.address().address, '127.0.0.1');
  assert.equal(viewer.server.requestTimeout, 15000);
  assert.equal(viewer.server.headersTimeout, 10000);
  assert.match(viewer.privatePath, /^\/view\/[A-Za-z0-9_-]{43}\/$/);
  assert.notEqual(viewer.privatePath, other.privatePath);
  assert.equal(new URL(viewer.url).hash, '');
  const html = await send(viewer);
  assert.equal(html.status, 200);
  assert.match(html.body, /src="\.\/assets\/app-123.js"/);
  for (const [name, value] of [['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY']]) assert.equal(html.headers[name], value);
  assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await send(viewer, 'assets/app-123.js')).body, 'export const built = true;');
  const head = await send(viewer, 'assets/app-123.css', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /text\/css/);
  const live = await send(viewer, 'api/live');
  assert.deepEqual(JSON.parse(live.body), { ...state(), clientBundle: 'app-123.js' });
  assert.deepEqual(JSON.parse((await send(viewer, 'db/novel/view.json')).body), state().world);
  for (const path of ['/', '/assets/app-123.js', '/api/live', other.privatePath, `${viewer.privatePath.slice(0, -1)}`, '/view/wrong/']) {
    const response = await fetch(`http://127.0.0.1:${viewer.port}${path}`);
    assert.equal(response.status, 401);
    await response.text();
  }
});

test('blocks workspace files, source maps, config, reports, traversal, proxies and replay', async context => {
  const { directory, dist, start } = await fixture(context);
  await symlink(join(directory, 'private-report.json'), join(dist, 'assets/leak.js'));
  await writeFile(join(dist, '.env'), 'PRIVATE_CREDENTIAL');
  await symlink(join(dist, '.env'), join(dist, 'assets/internal.js'));
  const viewer = await start();
  for (const path of ['runtime/pi-control.json', 'runtime/live-volumes.json', 'runtime/pi-console/status.json', 'private-report.json', '.env', 'server.mjs', 'src/App.tsx', 'assets/app-123.js.map', 'db/novel/raw.txt', 'assets/leak.js', 'assets/internal.js', 'assets/../index.html', 'assets/%2e%2e%2f.env', 'assets/%252e%252e%252f.env', 'assets/app-123.js%00', '%zz', 'api/record-source?id=secret', 'api/proxy', 'replay/', 'index.html']) {
    const response = await send(viewer, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.includes('PRIVATE_'), false, path);
  }
});

test('unsupported methods return 405 and volume queries are validated before reading', async context => {
  const { start } = await fixture(context);
  const calls = [];
  const viewer = await start({ readLive: async options => { calls.push(options); return state(); } });
  for (const path of ['', 'api/live', 'api/pi', 'db/novel/view.json', 'assets/app-123.js', 'api/unknown']) {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await send(viewer, path, { method });
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.allow, 'GET, HEAD');
    }
  }
  assert.equal((await send(viewer, 'api/live/stream', { method: 'HEAD' })).headers.allow, 'GET');
  assert.equal((await send(viewer, 'api/pi/messages')).headers.allow, 'POST');
  for (const volume of ['0', '-1', '1.5', '01', 'NaN', '../../private', '9007199254740992']) {
    assert.equal((await send(viewer, `api/live?volume=${encodeURIComponent(volume)}`)).status, 400);
  }
  assert.equal(calls.length, 0);
  for (const volume of ['active', '1', '7']) assert.equal((await send(viewer, `api/live?volume=${volume}`)).status, 200);
  assert.deepEqual(calls.map(call => call.volume), ['active', '1', '7']);
  assert.equal((await send(viewer, 'api/pi')).status, 404);
  assert.equal((await send(viewer, 'api/pi/messages', { method: 'POST' })).status, 404);
});

test('Pi POST requires exact Host, Origin and separate capability even with the private path', async context => {
  const { directory, start } = await fixture(context);
  const consoleDirectory = join(directory, 'console');
  const worker = createPiConsole({ directory: consoleDirectory });
  await worker.setStatus('ready', 'Idle', true);
  const origin = 'https://viewer.example';
  const viewer = await start({ origin, console: { directory: consoleDirectory, controlToken } });
  const headers = { Host: 'viewer.example', Origin: origin, 'X-Pi-Control': controlToken, 'Content-Type': 'application/json' };
  const post = overrides => send(viewer, 'api/pi/messages', { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify({ id: randomUUID(), text: 'Inspect the current gate' }) });
  for (const overrides of [{ Origin: '' }, { Origin: 'null' }, { Origin: `${origin}/` }, { Origin: 'https://viewer.example.evil' }, { Origin: 'http://127.0.0.1:4324' }, { 'X-Pi-Control': '' }, { 'X-Pi-Control': 'wrong' }, { Host: 'attacker.example' }]) {
    assert.equal((await post(overrides)).status, 403);
  }
  assert.equal((await worker.read()).pending, 0);
  assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 400);
  assert.equal((await post({})).status, 202);
  assert.equal((await worker.read()).pending, 1);
  const pi = await send(viewer, 'api/pi', { headers: { Host: 'viewer.example' } });
  assert.equal(pi.status, 200);
  assert.equal(pi.body.includes(controlToken), false);
  assert.equal(JSON.parse(pi.body).pending, 1);
  assert.equal((await send(viewer, '', { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await readFile(join(consoleDirectory, 'status.json'), 'utf8')).includes(controlToken), false);
});

test('default loopback Origin permits authenticated console submission', async context => {
  const { directory, start } = await fixture(context);
  const consoleDirectory = join(directory, 'console');
  const worker = createPiConsole({ directory: consoleDirectory });
  await worker.setStatus('ready', '', true);
  const viewer = await start({ console: { directory: consoleDirectory, controlToken } });
  const response = await send(viewer, 'api/pi/messages', { method: 'POST', headers: { Origin: viewer.origin, 'X-Pi-Control': controlToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), text: 'Check status' }) });
  assert.equal(response.status, 202);
  assert.equal((await worker.takeMessages()).length, 1);
});

test('SSE keeps each connection cursor and last batch, and disconnect/close clean up watches', { timeout: 10000 }, async context => {
  const { directory, start } = await fixture(context);
  const calls = [];
  let revision = 0;
  const viewer = await start({ watchPaths: [directory], readLive: async options => {
    calls.push(options.activityAfter);
    return { ...state(), revision, activity: { cursor: `cursor-${revision}`, ...(revision === 0 ? { batch: { id: 'initial-batch' } } : {}) } };
  } });
  const first = await connect(context, viewer);
  const initial = await first.next();
  assert.equal(initial.type, 'snapshot');
  const second = await connect(context, viewer);
  await second.next();
  assert.equal(calls.filter(cursor => cursor === undefined).length, 2);
  revision = 1;
  await writeFile(join(directory, 'update.json'), '{}');
  const patch = await first.next();
  assert.equal(patch.type, 'patch');
  const changed = applySnapshotChanges(initial.data, patch.data);
  assert.equal(changed.revision, 1);
  assert.deepEqual(changed.activity.batch, { id: 'initial-batch' });
  assert.ok(calls.includes('cursor-0'));
  first.controller.abort();
  second.controller.abort();
  await delay(150);
  const readsAfterDisconnect = calls.length;
  await writeFile(join(directory, 'after-disconnect.json'), '{}');
  await delay(150);
  assert.equal(calls.length, readsAfterDisconnect);
  const reconnected = await connect(context, viewer);
  const current = await reconnected.next();
  assert.equal(current.data.revision, 1);
  assert.equal(current.data.activity.batch, undefined);
  assert.equal(calls.filter(cursor => cursor === undefined).length, 3);
  await viewer.close();
  await assert.rejects(reconnected.reader.read());
  const readsAfterClose = calls.length;
  await writeFile(join(directory, 'after-close.json'), '{}');
  await delay(150);
  assert.equal(calls.length, readsAfterClose);
  assert.equal(viewer.server.listening, false);
  await viewer.close();
});

test('expiry closes open streams and listener; expired or excessive lifetimes cannot restart', { timeout: 5000 }, async context => {
  const { start } = await fixture(context);
  const viewer = await start({ expiresAt: Date.now() + 500 });
  const stream = await connect(context, viewer);
  await stream.next();
  await new Promise(resolveClose => viewer.server.once('close', resolveClose));
  await assert.rejects(stream.reader.read());
  assert.equal(viewer.server.listening, false);
  await assert.rejects(start({ expiresAt: Date.now() - 1 }), /expiry/);
  await assert.rejects(start({ expiresAt: Date.now() + 241 * 60000 }), /expiry/);
  await assert.rejects(start({ expiresAt: undefined }), /expiry/);
  await assert.rejects(start({ port: -1 }), /port/);
});

test('bounds a stalled reader to 15 seconds without leaking a stream after disconnect', { timeout: 5000 }, async context => {
  const { directory, start } = await fixture(context);
  let beginRead;
  let finishRead;
  let reads = 0;
  const reading = new Promise(resolveRead => { beginRead = resolveRead; });
  const result = new Promise(resolveRead => { finishRead = resolveRead; });
  const viewer = await start({ watchPaths: [directory], readLive: () => { reads++; beginRead(); return result; } });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const disconnected = new Promise(resolveDisconnect => {
    const outgoing = get(`http://127.0.0.1:${viewer.port}${viewer.privatePath}api/live/stream`);
    outgoing.on('error', resolveDisconnect);
  });
  await reading;
  context.mock.timers.tick(15001);
  await disconnected;
  context.mock.timers.reset();
  finishRead(state());
  await delay(100);
  await writeFile(join(directory, 'late-result.json'), '{}');
  await delay(150);
  assert.equal(reads, 1);
});

async function cliFixture(context) {
  const setup = await fixture(context);
  const tools = join(setup.directory, 'tools/pi-review');
  await mkdir(tools, { recursive: true });
  for (const filename of ['serve.mjs', 'config.mjs', 'pi-console.mjs', 'live-stream.mjs', 'snapshot-delta.mjs', 'snapshot.mjs', 'run-outcome.mjs', 'scene-context.mjs', 'live-activity.mjs', 'time-place.mjs', 'book-catalog.mjs', 'review-progress.mjs', 'guard.mjs', 'library-live.mjs', 'album.mjs', 'timeplace-access.mjs', 'universe-time-place.mjs', 'strand-answers.mjs', 'stage-reports.mjs', 'sim-play.mjs', 'run-report.mjs', 'sim-live.html', 'sim-world.html', 'calendar-view.mjs']) {
    await copyFile(fileURLToPath(new URL(filename, import.meta.url)), join(tools, filename));
  }
  const home = join(setup.directory, 'configured-home');
  const runtime = join(home, 'runtime');
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, 'live-volumes.json'), JSON.stringify([{ id: 7, workspace: 'workspace', metadataDirectory: 'metadata', label: 'Synthetic' }]));
  await writeFile(join(runtime, 'active-volume.json'), JSON.stringify({ volume: 7 }));
  return { ...setup, home, runtime, entry: join(tools, 'serve.mjs') };
}

test('CLI help documents runtime configuration and optional replay; bad options fail privately', async context => {
  const { entry, home } = await cliFixture(context);
  const options = { cwd: tmpdir(), env: { ...process.env, NOVEL_REVIEW_HOME: home } };
  const help = await execute(process.execPath, [entry, '--help'], options);
  assert.match(help.stdout, /NOVEL_REVIEW_HOME/);
  assert.match(help.stdout, /replay is optional and returns 404/);
  for (const args of [['--minutes', '241'], ['--minutes', '0'], ['--port', '0'], ['--port', '65536'], ['--origin', 'http://public.example'], ['--unknown', controlToken]]) {
    await assert.rejects(execute(process.execPath, [entry, ...args], options), error => error.code === 1 && !error.stderr.includes(controlToken));
  }
});

test('CLI reads only configured runtime, caps expiry, prints distinct links and exits on signal', { timeout: 8000 }, async context => {
  const { entry, home, runtime, start } = await cliFixture(context);
  const reservation = await start();
  const port = reservation.port;
  await reservation.close();
  const configuredExpiry = new Date(Date.now() + 45000).toISOString();
  await writeFile(join(runtime, 'pi-control.json'), JSON.stringify({ token: controlToken, expiresAt: configuredExpiry }));
  const child = spawn(process.execPath, [entry, '--port', String(port), '--minutes', '1'], { cwd: tmpdir(), env: { ...process.env, NOVEL_REVIEW_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  context.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  let output = '';
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolveReady, reject) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('Viewer expires:')) resolveReady(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`CLI exited before ready: ${errors}`)));
  });
  const readOnly = output.match(/Read-only link: (.+)/)[1];
  const operator = output.match(/Operator link: (.+)/)[1];
  assert.equal(new URL(readOnly).hash, '');
  assert.equal(operator, `${readOnly}#pi=${controlToken}`);
  assert.match(output, new RegExp(`Viewer expires: ${configuredExpiry.replaceAll('.', '\\.')}`));
  assert.equal(output.split(controlToken).length - 1, 1);
  const response = await fetch(readOnly);
  assert.equal(response.status, 200);
  await response.text();
  const initial = await fetch(new URL('api/live', readOnly)).then(result => result.json());
  assert.equal(initial.volume, 7);
  assert.deepEqual(initial.availableVolumes, [7]);
  assert.deepEqual(initial.books, [{ id: 7, title: 'Book 7', sourceFile: null }]);
  assert.equal(initial.activeVolume, 7);
  assert.equal(initial.clientBundle, 'app-123.js');
  const volumes = [{ id: 7, workspace: 'workspace', metadataDirectory: 'metadata' }, { id: 8, workspace: 'workspace-two', metadataDirectory: 'metadata-two' }];
  await writeFile(join(runtime, 'live-volumes.json'), JSON.stringify(volumes));
  await writeFile(join(runtime, 'active-volume.json'), JSON.stringify({ volume: 8 }));
  assert.equal((await fetch(new URL('api/live', readOnly)).then(result => result.json())).volume, 7);
  assert.equal((await fetch(new URL('api/live?volume=8', readOnly)).then(result => result.json())).volume, 8);
  await mkdir(join(home, 'workspace-two'), { recursive: true });
  await writeFile(join(home, 'workspace-two/events.jsonl'), JSON.stringify({ id: 'started', timestamp: new Date().toISOString(), event: { type: 'block.started', blockId: 'b0001' } }) + '\n');
  assert.equal((await fetch(new URL('api/live', readOnly)).then(result => result.json())).volume, 8);
  const streamViewer = { port, privatePath: new URL(readOnly).pathname };
  const liveStream = await connect(context, streamViewer);
  assert.equal((await liveStream.next()).data.volume, 8);
  liveStream.controller.abort();
  assert.equal(await readFile(join(runtime, 'pi-control.json'), 'utf8'), JSON.stringify({ token: controlToken, expiresAt: configuredExpiry }));
  const unavailable = await fetch(new URL('runtime/pi-control.json', readOnly));
  assert.equal(unavailable.status, 404);
  await unavailable.text();
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(errors, '');
  await writeFile(join(runtime, 'pi-control.json'), JSON.stringify({ token: controlToken, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  await assert.rejects(execute(process.execPath, [entry], { env: { ...process.env, NOVEL_REVIEW_HOME: home } }), error => error.code === 1 && !error.stdout.includes('link:') && !error.stderr.includes(controlToken));
});

test('album assets are served read-only per book, and only when the host resolves workspaces', async context => {
  const { directory, start } = await fixture(context);
  const workspace = join(directory, 'workspace');
  await mkdir(join(workspace, 'ontology'), { recursive: true });
  await mkdir(join(workspace, 'assets'), { recursive: true });
  await writeFile(join(workspace, 'assets', 'ill_0001.jpg'), 'jpeg-bytes');
  await writeFile(join(workspace, 'ontology', 'illustrations.jsonl'), JSON.stringify({ id: 'ill_0001', asset: 'assets/ill_0001.jpg', sentenceId: null, kind: 'plate' }));
  const requested = [];
  const viewer = await start({ resolveWorkspace: async (volume) => { requested.push(volume); return workspace; } });
  const image = await send(viewer, 'api/album-asset?id=ill_0001&volume=2');
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.equal(image.body, 'jpeg-bytes');
  assert.deepEqual(requested, ['2']);
  assert.equal((await send(viewer, 'api/album-asset?id=../private-report.json')).status, 404);
  assert.equal((await send(viewer, 'api/album-asset?id=ill_0001&volume=../x')).status, 404);
  assert.equal((await send(viewer, 'api/album-asset?id=ill_0001', { method: 'POST' })).status, 405);
  const without = await start();
  assert.equal((await send(without, 'api/album-asset?id=ill_0001')).status, 404, 'a custom host without a workspace resolver serves nothing');
});

test('read mode text: a block is found by its file name, a missing one is a 404 rather than another block under its ids', async (context) => {
  const { bookText } = await import('./serve.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'book-text-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'b0001.txt'), '第一句。');
  await writeFile(join(directory, 'b0003.txt'), '第三句。');
  assert.equal(await bookText(directory, 1), null, 'b0002.txt is missing');
  const third = await bookText(directory, 2);
  assert.deepEqual([third.block, third.blocks, third.sentences[0].id.startsWith('b0002_')], [2, 3, true]);
  assert.equal(await bookText(directory, 3), null);
});

test('read mode book: the EPUB a spine document at a time, made safe, its pictures served by their path in the book', async (context) => {
  const { createZip } = await import('../../dist/src/reading/album/zip.js');
  const { directory, start } = await fixture(context);
  const epub = join(directory, 'book.epub');
  await writeFile(epub, createZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: '<package><metadata><dc:title>书</dc:title></metadata><manifest><item id="a" href="Text/a.xhtml" media-type="application/xhtml+xml"/><item id="p" href="Images/p.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="a"/></spine></package>' },
    { name: 'OEBPS/Text/a.xhtml', data: '<html><head><style>p{}</style></head><body onload="x()"><h1>第一章</h1><p style="color:red">第一句。<a href="https://example.com">链接</a></p><script>alert(1)</script><img src="../Images/p.jpg"/></body></html>' },
    { name: 'OEBPS/Images/p.jpg', data: Buffer.from([255, 216, 255]) },
  ]));
  const viewer = await start({ resolveWorkspace: async () => directory, resolveSource: async () => ({ workspace: directory, metadataDirectory: directory, epub }) });
  const first = await send(viewer, 'api/book-epub?item=0');
  assert.equal(first.status, 200);
  const { html, items, title } = JSON.parse(first.body);
  assert.deepEqual([items, title], [1, '书']);
  assert.match(html, /<h1>第一章<\/h1>/);
  assert.match(html, /<img data-epub="OEBPS\/Images\/p\.jpg" alt="">/);
  assert.doesNotMatch(html, /script|onload|style=|href=|alert/);
  assert.equal((await send(viewer, 'api/book-epub?item=1')).status, 404);
  const picture = await send(viewer, 'api/book-epub-file?path=OEBPS/Images/p.jpg');
  assert.deepEqual([picture.status, picture.headers['content-type']], [200, 'image/jpeg']);
  assert.equal((await send(viewer, 'api/book-epub-file?path=OEBPS/Text/a.xhtml')).status, 404, 'only pictures');
  assert.equal((await send(viewer, 'api/book-epub-file?path=../x.jpg')).status, 400);
});

test('notes on the director\'s cards: added from the reader, listed for both, nothing else written', async (context) => {
  const { directory, start } = await fixture(context);
  const viewer = await start({ resolveWorkspace: async () => directory });
  assert.deepEqual(JSON.parse((await send(viewer, 'play/notes.json')).body), []);
  const added = await send(viewer, 'play/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: 'action:b0000_s0110', scene: 'scene_000001', event: 14, sentence: 'b0000_s0110', text: 'jumps to a roof, ends on the street' }) });
  assert.equal(added.status, 200);
  assert.equal((await send(viewer, 'play/notes', { method: 'POST', body: '{"card":"x"}' })).status, 400, 'a note needs its text');
  assert.equal((await send(viewer, 'play/notes', { method: 'POST', body: 'x'.repeat(5000) })).status, 413);
  const [note] = JSON.parse((await send(viewer, 'play/notes.json')).body);
  assert.deepEqual([note.card, note.event, note.text], ['action:b0000_s0110', 14, 'jumps to a roof, ends on the street']);
  assert.match(await readFile(join(directory, 'stage', 'director', 'notes.jsonl'), 'utf8'), /ends on the street/);
  assert.equal((await send(viewer, 'play/reading.json')).status, 404, 'no reading before a director run');
  await writeFile(join(directory, 'stage', 'director', 'reading.json'), JSON.stringify({ version: 2, kinds: { b0000_s0001: 'spoken' } }));
  assert.deepEqual(JSON.parse((await send(viewer, 'play/reading.json')).body).kinds, { b0000_s0001: 'spoken' });
  // What the laws and the review made of the run (W7): per card, and the run's report.
  assert.equal((await send(viewer, 'play/review.json')).status, 404, 'no review before a director run');
  await mkdir(join(directory, 'stage', 'world', 'ledger'), { recursive: true });
  await writeFile(join(directory, 'stage', 'director', 'run.json'), JSON.stringify({ model: 'm', from: 's1', to: 's1', scenes: [{ scene: 'scene_000001', cards: [{ card: 'dialogue:b0000_s0001', lines: [{ id: 'b0000_s0001' }], laws: [{ law: 'L6', who: 'char_1', verdict: 'held', why: 'out of earshot' }] }] }] }));
  await writeFile(join(directory, 'stage', 'world', 'pool.jsonl'), JSON.stringify({ id: 'wi_1', kind: 'talk', scene: 'scene_000001', lines: ['b0000_s0001'], question: 'How?', options: ['live', 'remote'], status: 'answered' }) + '\n');
  await writeFile(join(directory, 'stage', 'world', 'answers.jsonl'), JSON.stringify({ item: 'wi_1', verdict: 'remote', reason: 'a phone, b0000_s0001' }) + '\n');
  const review = JSON.parse((await send(viewer, 'play/review.json')).body), card = review.cards['scene_000001|dialogue:b0000_s0001'];
  assert.deepEqual([card.laws[0].verdict, card.review[0].answer], ['held', 'remote']);
  assert.deepEqual(review.report.laws, { 'L6 held': 1 });
  // The run report (W7): the same in words, a page of its own with no script.
  const report = await send(viewer, 'play/report');
  assert.equal(report.status, 200);
  assert.match(report.body, /Run report/);
  assert.match(report.body, /Talk needs nearness/);
  assert.match(report.body, /a phone, b0000_s0001/, 'the main agent\'s answer and reason');
  assert.doesNotMatch(report.body, /<script/);
  // Developer mode: every record of one card; a bad scene refused; no run accepted yet, no run files.
  const dev = JSON.parse((await send(viewer, 'play/dev.json?scene=scene_000001&card=dialogue%3Ab0000_s0001')).body);
  assert.deepEqual([dev.cardRecord.laws[0].law, dev.review[0].answer.verdict], ['L6', 'remote']);
  assert.equal((await send(viewer, 'play/dev.json?scene=../x&card=y')).status, 400);
  assert.equal((await send(viewer, 'play/dev/file?name=record')).status, 404);
  assert.equal((await send(viewer, 'play/dev/file?name=..%2F..%2Fsecret')).status, 404);
});
