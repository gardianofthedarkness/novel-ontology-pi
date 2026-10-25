import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { preparePlayground, repository } from './prepare.mjs';
import { createDevPreview } from './dev-preview.mjs';
import { createTeamViewer } from './viewer.mjs';

export function configuration(args = [], env = process.env) {
  const { values } = parseArgs({ args, options: { mode: { type: 'string', default: env.PLAYGROUND_MODE ?? 'view' }, port: { type: 'string', default: env.PLAYGROUND_PORT ?? '5180' }, minutes: { type: 'string', default: env.PLAYGROUND_MINUTES ?? '120' }, home: { type: 'string', default: env.PLAYGROUND_HOME ?? join(repository, '.team-playground') }, origin: { type: 'string', default: env.PLAYGROUND_ORIGIN } } });
  if (!['view', 'agent'].includes(values.mode)) throw new Error('Mode must be view or agent');
  if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) throw new Error('Port must be 1–65535');
  if (!/^\d+$/.test(values.minutes) || Number(values.minutes) < 1 || Number(values.minutes) > 240) throw new Error('Session must be 1–240 minutes');
  if (values.origin) {
    const origin = new URL(values.origin);
    if (origin.origin !== values.origin || !(origin.protocol === 'https:' || origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) throw new Error('Origin must be exact HTTPS or HTTP loopback, without a path or credentials');
  }
  if (values.mode === 'agent' && (!env.WORK_LLM_API_KEY?.trim() || !env.TYPESAFE_API_KEY?.trim())) throw new Error('Agent mode requires WORK_LLM_API_KEY and TYPESAFE_API_KEY through the environment. Use --mode view for a credential-free synthetic snapshot.');
  return { mode: values.mode, port: Number(values.port), minutes: Number(values.minutes), home: resolve(values.home), origin: values.origin, container: env.PLAYGROUND_CONTAINER === '1' };
}

export async function startPlayground(config, env = process.env) {
  process.umask(0o077);
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  const info = await lstat(config.home);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Playground home must be a private directory, not a symlink');
  const lockPath = join(config.home, 'host.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await lock.close();
  const sockets = new Set();
  let backend;
  let preview;
  let worker;
  let workerExit;
  let workerEnded = false;
  let expiry;
  let closing;
  let gateway;
  let session;
  let publicOrigin;
  const stop = () => closing ??= (async () => {
    clearTimeout(expiry);
    if (worker && !workerEnded) worker.kill('SIGTERM');
    for (const socket of sockets) socket.destroy();
    if (gateway?.listening) await new Promise(done => gateway.close(done));
    await preview?.close();
    await backend?.close();
    if (worker && !workerEnded) {
      await Promise.race([workerExit, delay(5000, undefined, { ref: false })]);
      if (!workerEnded) { worker.kill('SIGKILL'); await workerExit; }
    }
    await unlink(lockPath);
  })();
  try {
    gateway = createServer((request, response) => {
      if (!preview) { response.writeHead(503).end('Playground starting'); return; }
      if (request.headers.host !== new URL(publicOrigin).host) { request.resume(); response.writeHead(403).end(); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: preview.port, path: request.url, method: request.method, headers: request.headers }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
      request.once('aborted', () => upstream.destroy());
      response.once('close', () => upstream.destroy());
      request.pipe(upstream);
    });
    gateway.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    gateway.on('upgrade', (request, socket, head) => {
      if (!preview || request.headers.host !== new URL(publicOrigin).host || request.headers.origin !== publicOrigin) { socket.destroy(); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: preview.port, path: request.url, headers: request.headers });
      upstream.once('error', () => socket.destroy());
      upstream.once('response', incoming => { incoming.resume(); socket.destroy(); });
      upstream.once('upgrade', (incoming, connection, remainder) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(incoming.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) connection.write(head);
        if (remainder.length) socket.write(remainder);
        connection.on('error', () => socket.destroy());
        socket.on('error', () => connection.destroy());
        socket.once('close', () => connection.destroy());
        connection.pipe(socket).pipe(connection);
      });
      upstream.end();
    });
    await new Promise((ready, reject) => { gateway.once('error', reject); gateway.listen(config.port, config.container ? '0.0.0.0' : '127.0.0.1', ready); });
    publicOrigin = config.origin ?? `http://127.0.0.1:${gateway.address().port}`;
    const expiresAt = new Date(Date.now() + config.minutes * 60000).toISOString();
    session = join(config.home, `session-${Date.now()}-${randomBytes(4).toString('hex')}`);
    const prepared = await preparePlayground(session);
    const runtime = join(session, 'runtime');
    await mkdir(runtime, { mode: 0o700 });
    if (config.mode === 'agent') {
      const job = JSON.parse(await readFile(prepared.job, 'utf8'));
      job.minutes = config.minutes;
      await writeFile(prepared.job, JSON.stringify(job, null, 2), { mode: 0o600 });
      const log = await open(join(session, 'pi.log'), 'wx', 0o600);
      worker = spawn(process.execPath, [join(repository, 'tools/pi-review/run.mjs'), prepared.job, '--interactive'], { cwd: repository, env: { PATH: env.PATH, HOME: env.HOME, LANG: 'en_US.UTF-8', NOVEL_REVIEW_HOME: session, NOVEL_DIALOGUE_SCOPE: 'block-turn', WORK_LLM_API_KEY: env.WORK_LLM_API_KEY, TYPESAFE_API_KEY: env.TYPESAFE_API_KEY }, stdio: ['ignore', log.fd, log.fd] });
      await log.close();
      workerExit = new Promise(done => { worker.once('exit', () => { workerEnded = true; done(); }); worker.once('error', () => { workerEnded = true; done(); }); });
      await writeFile(join(session, 'pi.pid'), String(worker.pid), { mode: 0o600 });
      let ready = false;
      for (let attempt = 0; attempt < 150 && !workerEnded; attempt++) {
        const status = await readFile(join(runtime, 'pi-console/status.json'), 'utf8').then(JSON.parse, () => null);
        if (status?.status === 'ready') { ready = true; break; }
        await delay(200);
      }
      if (!ready) throw new Error('Idle Pi did not become ready. Inspect the private session pi.log; no prompt was sent.');
      void workerExit.then(() => { if (!closing) void stop(); });
    }
    backend = await createTeamViewer({ prepared, mode: config.mode, expiresAt, runtime, dist: join(repository, 'apps/playground/dist') });
    preview = await createDevPreview({ backend: { ...backend, expiresAt }, port: 0, origin: publicOrigin });
    const links = { mode: config.mode, readOnlyUrl: preview.readOnlyUrl, ...(config.mode === 'agent' ? { operatorUrl: preview.operatorUrl } : {}), expiresAt, pid: process.pid, session, workerPid: worker?.pid ?? null, synthetic: true };
    await writeFile(join(session, 'links.json'), JSON.stringify(links, null, 2), { mode: 0o600 });
    await writeFile(join(config.home, 'active.json'), JSON.stringify({ session, mode: config.mode, expiresAt }), { mode: 0o600 });
    expiry = setTimeout(() => { void stop(); }, Date.parse(expiresAt) - Date.now());
    return { ...links, prepared, stop, port: gateway.address().port };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = await startPlayground(configuration(process.argv.slice(2)));
  console.log(`Mode: ${host.mode === 'agent' ? 'Real Pi hosted idle; no prompt sent. User messages can incur model costs.' : 'Read-only synthetic illustration; no model calls or Pi extraction.'}`);
  console.log(`Read-only link: ${host.readOnlyUrl}`);
  if (host.operatorUrl) console.log(`Operator link: ${host.operatorUrl}`);
  console.log(`Expires: ${host.expiresAt}\nPrivate session: ${host.session}`);
  process.once('SIGTERM', () => { void host.stop(); });
  process.once('SIGINT', () => { void host.stop(); });
}
