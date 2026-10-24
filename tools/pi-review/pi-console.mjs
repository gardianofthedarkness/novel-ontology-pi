import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';

const bodyLimit = 16 * 1024;
const textLimit = 4000;
const queueLimit = 40;
const entryLimit = 150;
const heartbeatLimit = 30000;
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const kinds = new Set(['command', 'status', 'user', 'assistant']);
const statuses = new Set(['waiting', 'ready', 'working', 'busy', 'paused', 'review', 'complete', 'stopped', 'cancelled', 'ok', 'error', 'queued', 'processing', 'unknown', 'consumed', 'failed']);

function httpError(status, code) {
  return Object.assign(new Error(code), { httpStatus: status, code });
}

function publicOrigin(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) throw new TypeError('Expected an exact HTTP origin');
  return value;
}

function messageId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw httpError(400, 'invalid_id');
  return value.toLowerCase();
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Console directory must be a private directory');
  await chmod(path, 0o700);
}

async function jsonFile(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid console file');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

async function writeAtomic(directory, path, value, exclusive = false) {
  const temporary = join(directory, `.write-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  try {
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
    await syncDirectory(directory);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function files(directory) {
  return (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
}

async function agentLabels(path, clean) {
  if (!path) return [];
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) return [];
    const start = Math.max(0, info.size - 262144);
    const buffer = Buffer.alloc(Math.min(info.size, 262144));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let tail = buffer.subarray(0, bytesRead).toString('utf8');
    if (start) tail = tail.slice(tail.indexOf('\n') + 1);
    const entries = [];
    for (const line of tail.split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event || !['pi.command', 'pi.status'].includes(event.type) || typeof event.label !== 'string' || typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))) continue;
      const text = clean(event.label, 240);
      if (!text) continue;
      const id = `agent-${createHash('sha256').update(line).digest('hex').slice(0, 32)}`;
      entries.push({ id, timestamp: new Date(event.timestamp).toISOString(), kind: event.type === 'pi.command' ? 'command' : 'status', text, ...(statuses.has(event.status) ? { status: event.status } : {}) });
    }
    return entries.slice(-entryLimit);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  } finally { await handle?.close(); }
}

async function requestBody(request, expiresAt) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    const finish = (error) => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAbort);
      if (error) { request.resume(); rejectBody(error); }
      else {
        try { resolveBody(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
        catch { rejectBody(httpError(400, 'invalid_json')); }
      }
    };
    const onData = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > bodyLimit) finish(httpError(400, 'body_too_large'));
      else chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = () => finish(httpError(400, 'invalid_body'));
    const onAbort = () => finish(httpError(400, 'invalid_body'));
    const timer = setTimeout(() => finish(httpError(Date.now() >= expiresAt ? 403 : 400, Date.now() >= expiresAt ? 'expired' : 'body_timeout')), Math.max(1, Math.min(10000, expiresAt - Date.now())));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAbort);
  });
}

export function createPiConsole({ directory, agentEvents, controlToken, origin, origins, expiresAt } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('A private console directory is required');
  if (origins !== undefined && !Array.isArray(origins)) throw new TypeError('origins must be an array');
  const allowedOrigins = new Set([...(origin === undefined ? [] : [origin]), ...(origins ?? [])].map(publicOrigin));
  if (controlToken !== undefined && (typeof controlToken !== 'string' || !controlToken || Buffer.byteLength(controlToken) > 4096)) throw new TypeError('Invalid control token');
  const deadline = expiresAt === undefined ? null : typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  if (deadline !== null && !Number.isFinite(deadline)) throw new TypeError('Invalid expiry');
  const tokenDigest = controlToken ? createHash('sha256').update(controlToken).digest() : null;
  const root = resolve(directory);
  const paths = Object.fromEntries(['messages', 'queued', 'processing', 'acks', 'entries'].map(name => [name, join(root, name)]));
  const workerId = randomUUID();
  let initialized;
  let serial = Promise.resolve();
  const initialize = () => initialized ??= (async () => {
    await privateDirectory(root);
    for (const path of Object.values(paths)) await privateDirectory(path);
    await syncDirectory(root);
  })();
  const run = action => {
    const operation = serial.then(initialize).then(action);
    serial = operation.catch(() => {});
    return operation;
  };
  const clean = (value, limit = textLimit) => {
    let text = value;
    if (controlToken) text = text.split(controlToken).join('[redacted]');
    return text.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]').replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[redacted]').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, limit);
  };
  const statusNow = async () => {
    const status = await jsonFile(join(root, 'status.json'));
    const heartbeat = await jsonFile(join(root, 'heartbeat.json'));
    const heartbeatAt = heartbeat?.workerId === status?.workerId ? heartbeat?.timestamp ?? null : null;
    const age = Date.now() - Date.parse(heartbeatAt);
    const stale = !Number.isFinite(age) || age < -5000 || age >= heartbeatLimit;
    const expired = deadline !== null && Date.now() >= deadline;
    return { status: status?.status ?? 'waiting', detail: clean(status?.detail ?? ''), heartbeatAt, stale, expired, acceptingMessages: status?.acceptingMessages === true && !stale && !expired };
  };
  const location = async id => {
    const ack = await jsonFile(join(paths.acks, `${id}.json`));
    if (ack) return { status: ack.status };
    for (const name of await files(paths.processing)) {
      const message = await jsonFile(join(paths.processing, name));
      if (message?.id === id) return { status: 'processing', path: join(paths.processing, name) };
    }
    for (let slot = 0; slot < queueLimit; slot++) {
      const message = await jsonFile(join(paths.queued, `${slot}.json`));
      if (message?.id === id) return { status: 'queued' };
    }
    return { status: 'unknown' };
  };
  const submit = async payload => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['id', 'text'].includes(key))) throw httpError(400, 'invalid_message');
    const id = messageId(payload.id);
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > textLimit) throw httpError(400, 'invalid_text');
    const text = payload.text.trim();
    if (Date.now() >= deadline) throw httpError(403, 'expired');
    const path = join(paths.messages, `${id}.json`);
    const duplicate = async () => {
      const previous = await jsonFile(path);
      if (!previous || previous.text !== text) throw httpError(409, 'id_conflict');
      const { status } = await location(id);
      if (status === 'unknown') throw httpError(409, 'submission_unknown');
      return { id, status, duplicate: true };
    };
    if (await jsonFile(path)) return duplicate();
    if (!(await statusNow()).acceptingMessages) throw httpError(409, 'worker_not_ready');
    const message = { id, timestamp: new Date().toISOString(), kind: 'user', text };
    try { await writeAtomic(paths.messages, path, message, true); }
    catch (error) { if (error.code === 'EEXIST') return duplicate(); throw error; }
    for (let slot = 0; slot < queueLimit; slot++) {
      try { await link(path, join(paths.queued, `${slot}.json`)); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      await syncDirectory(paths.queued);
      return { id, status: 'queued', duplicate: false };
    }
    await unlink(path);
    await syncDirectory(paths.messages);
    throw httpError(429, 'queue_full');
  };
  const appendEntry = async event => {
    if (!event || !kinds.has(event.kind) || typeof event.text !== 'string' || !event.text.trim()) throw new TypeError('Expected a public console event');
    const entry = { id: randomUUID(), timestamp: new Date().toISOString(), kind: event.kind, text: clean(event.text), ...(statuses.has(event.status) ? { status: event.status } : {}) };
    await writeAtomic(paths.entries, join(paths.entries, `${String(Date.now()).padStart(16, '0')}-${entry.id}.json`), entry, true);
    const older = (await files(paths.entries)).slice(0, -entryLimit);
    for (const name of older) await unlink(join(paths.entries, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return entry;
  };

  return {
    async read() {
      await initialize();
      const entries = [];
      const locations = new Map();
      for (const [name, status] of [['queued', 'queued'], ['processing', 'processing'], ['acks', null]]) {
        for (const file of await files(paths[name])) {
          const value = await jsonFile(join(paths[name], file));
          if (value) locations.set(value.id, status ?? value.status);
        }
      }
      const counts = { queued: 0, processing: 0, unknown: 0 };
      for (const file of await files(paths.messages)) {
        const message = await jsonFile(join(paths.messages, file));
        if (!message) continue;
        const status = locations.get(message.id) ?? 'unknown';
        if (Object.hasOwn(counts, status)) counts[status]++;
        entries.push({ id: message.id, timestamp: message.timestamp, kind: 'user', text: clean(message.text), status });
      }
      for (const file of await files(paths.entries)) {
        const entry = await jsonFile(join(paths.entries, file));
        if (entry) entries.push({ id: entry.id, timestamp: entry.timestamp, kind: entry.kind, text: clean(entry.text), ...(statuses.has(entry.status) ? { status: entry.status } : {}) });
      }
      entries.push(...await agentLabels(agentEvents, clean));
      entries.sort((first, second) => first.timestamp.localeCompare(second.timestamp) || first.id.localeCompare(second.id));
      return { ...await statusNow(), ...counts, pending: counts.queued, entries: entries.slice(-entryLimit) };
    },

    async handleMessage(request, response) {
      let status = 202;
      let result;
      request.once('error', () => {});
      try {
        if (request.method !== 'POST') throw httpError(405, 'method_not_allowed');
        const supplied = request.headers?.['x-pi-control'];
        const digest = createHash('sha256').update(typeof supplied === 'string' && Buffer.byteLength(supplied) <= 4096 ? supplied : '').digest();
        const matches = timingSafeEqual(tokenDigest ?? Buffer.alloc(32), digest);
        if (!tokenDigest || !matches || typeof request.headers?.origin !== 'string' || !allowedOrigins.has(request.headers.origin) || deadline === null) throw httpError(403, 'forbidden');
        if (Date.now() >= deadline) throw httpError(403, 'expired');
        if (typeof request.headers?.['content-type'] !== 'string' || request.headers['content-type'].split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(400, 'json_required');
        if (request.headers['content-encoding'] && request.headers['content-encoding'].toLowerCase() !== 'identity') throw httpError(400, 'invalid_body');
        if (request.headers['content-length'] !== undefined && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > bodyLimit)) throw httpError(400, 'body_too_large');
        const payload = await requestBody(request, deadline);
        result = await run(() => submit(payload));
      } catch (error) {
        status = error.httpStatus ?? 500;
        result = { error: error.httpStatus ? error.code : 'console_unavailable' };
        request.resume?.();
      }
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(result.error === 'method_not_allowed' ? { Allow: 'POST' } : {}) });
      response.end(JSON.stringify(result));
    },

    takeMessages() {
      return run(async () => {
        if (deadline !== null && Date.now() >= deadline) return [];
        const messages = [];
        for (let slot = 0; slot < queueLimit; slot++) {
          const claim = join(paths.processing, `${randomUUID()}.json`);
          try { await rename(join(paths.queued, `${slot}.json`), claim); }
          catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          const message = await jsonFile(claim);
          messages.push({ id: message.id, timestamp: message.timestamp, kind: 'user', text: message.text, status: 'processing' });
        }
        await syncDirectory(paths.processing);
        await syncDirectory(paths.queued);
        return messages.sort((first, second) => first.timestamp.localeCompare(second.timestamp) || first.id.localeCompare(second.id));
      });
    },

    finishMessage(id, status) {
      return run(async () => {
        id = messageId(id);
        if (!['consumed', 'failed'].includes(status)) throw new TypeError('Acknowledgment must be consumed or failed');
        const current = await location(id);
        if (current.status === status) return { id, status };
        if (current.status !== 'processing' && !(current.status === 'unknown' && status === 'failed' && await jsonFile(join(paths.messages, `${id}.json`)))) throw new Error('Message is not awaiting acknowledgment');
        try { await writeAtomic(paths.acks, join(paths.acks, `${id}.json`), { id, timestamp: new Date().toISOString(), status }, true); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if ((await jsonFile(join(paths.acks, `${id}.json`))).status !== status) throw new Error('Message already acknowledged differently');
        }
        if (current.path) await unlink(current.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await syncDirectory(paths.processing);
        return { id, status };
      });
    },

    record(event) { return run(() => appendEntry(event)); },

    setStatus(status, detail = '', acceptingMessages = false) {
      return run(async () => {
        if (typeof status !== 'string' || !statuses.has(status) || typeof detail !== 'string' || typeof acceptingMessages !== 'boolean') throw new TypeError('Invalid public worker status');
        const timestamp = new Date().toISOString();
        await writeAtomic(root, join(root, 'heartbeat.json'), { workerId, timestamp });
        await writeAtomic(root, join(root, 'status.json'), { workerId, status, detail: clean(detail), acceptingMessages, timestamp });
        await appendEntry({ kind: 'status', text: detail.trim() || status, status });
        return statusNow();
      });
    },

    touchHeartbeat() {
      return run(async () => {
        if ((await jsonFile(join(root, 'status.json')))?.workerId !== workerId) throw new Error('Call setStatus before touching this worker heartbeat');
        await writeAtomic(root, join(root, 'heartbeat.json'), { workerId, timestamp: new Date().toISOString() });
        return statusNow();
      });
    },
  };
}
