import { watch } from 'node:fs';
import { createGzip, constants } from 'node:zlib';
import { snapshotChanges } from './snapshot-delta.mjs';

export async function streamSnapshots(request, response, { read, watchPaths, expiresAt, interval = 100 }) {
  const initial = await read();
  const compressed = /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Vary: 'Accept-Encoding', ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
  response.flushHeaders();
  const output = compressed ? createGzip() : response;
  if (compressed) output.pipe(response);
  let closed = false;
  let previous = initial;
  let pending = false;
  let busy = false;
  let timer;
  const watchers = [];
  const send = async (event, data) => {
    if (closed) return;
    if (response.writableLength > 262144) { response.destroy(); return; }
    await new Promise((resolve, reject) => output.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, error => error ? reject(error) : resolve()));
    if (compressed && !closed) await new Promise((resolve, reject) => output.flush(constants.Z_SYNC_FLUSH, error => error ? reject(error) : resolve()));
  };
  const flush = async () => {
    timer = undefined;
    if (closed || busy) return;
    busy = true;
    pending = false;
    try {
      const current = await read();
      const changes = snapshotChanges(previous, current);
      if (changes.length) await send('patch', changes);
      previous = current;
    } catch {
      if (!closed) response.destroy();
    } finally {
      busy = false;
      if (pending && !closed) timer = setTimeout(flush, interval);
    }
  };
  const invalidate = () => {
    pending = true;
    if (!closed && !busy && !timer) timer = setTimeout(flush, interval);
  };
  for (const path of watchPaths) {
    try {
      const watcher = watch(path, { recursive: true }, (_, filename) => { if (!filename || !String(filename).includes('graph.lbug')) invalidate(); });
      watcher.on('error', () => watcher.close());
      watchers.push(watcher);
    } catch {}
  }
  const fallback = setInterval(invalidate, 2000);
  const heartbeat = setInterval(() => { if (!busy && !closed) void send('heartbeat', null).catch(() => response.destroy()); }, 15000);
  const expiry = setTimeout(() => output.end(), Math.max(1, expiresAt - Date.now()));
  response.once('close', () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(expiry);
    clearInterval(fallback);
    clearInterval(heartbeat);
    for (const watcher of watchers) watcher.close();
    if (compressed) output.destroy();
  });
  output.on('error', () => response.destroy());
  busy = true;
  try { await send('snapshot', initial); }
  catch { response.destroy(); }
  finally { busy = false; invalidate(); }
}
