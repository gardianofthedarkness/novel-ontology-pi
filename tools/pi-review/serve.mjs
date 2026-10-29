import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { root, repo, agentEvents } from './config.mjs';
import { streamSnapshots } from './live-stream.mjs';
import { createPiConsole } from './pi-console.mjs';
import { bookCatalog } from './book-catalog.mjs';
import { resolveAlbumAsset } from './album.mjs';
import { configuredLibraryBindings, readLibraryLive, withLibraryLive } from './library-live.mjs';
import { readUniverseTimePlace } from './universe-time-place.mjs';
import { simulationPage, simulationVendor } from './sim-play.mjs';

const requestLimit = 15000;
const maximumLifetime = 240 * 60 * 1000;
const assetPattern = /^\/assets\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(js|css|svg|png|jpg|jpeg|webp|avif|gif|ico|woff2?|ttf)$/;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

export function validateOrigin(value, port) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('Expected an exact HTTPS origin or the loopback HTTP origin'); }
  if (parsed.origin !== value || parsed.username || parsed.password || (parsed.protocol !== 'https:' && value !== `http://127.0.0.1:${port}`)) {
    throw new TypeError('Expected an exact HTTPS origin or the loopback HTTP origin');
  }
  return value;
}

export function relativeHTML(html) {
  return html.replace(/\b(src|href)=(['"])\/?(?:\.\/)?assets\//gi, '$1=$2./assets/');
}

async function resource(directory, pathname) {
  if (pathname !== '/' && !assetPattern.test(pathname)) throw new Error('Resource is not a built asset');
  const filename = await realpath(resolve(directory, pathname === '/' ? 'index.html' : `.${pathname}`));
  if (!filename.startsWith(`${directory}${sep}`) || filename !== resolve(directory, pathname === '/' ? 'index.html' : `.${pathname}`) || !(await stat(filename)).isFile()) throw new Error('Resource is outside the build');
  return filename;
}

export async function validateResources(dist) {
  const directory = await realpath(dist);
  const html = relativeHTML(await readFile(await resource(directory, '/'), 'utf8'));
  const resources = [...html.matchAll(/\b(?:src|href)=(['"])\.\/assets\/([^'"?#]+)\1/gi)].map(match => `/assets/${match[2]}`);
  await Promise.all(resources.map(pathname => resource(directory, pathname)));
  const clientBundle = resources.find(pathname => pathname.endsWith('.js'))?.slice('/assets/'.length);
  if (!clientBundle) throw new Error('Build the playground before starting the viewer');
  return { directory, html, clientBundle };
}

function deadline(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now() || timestamp - Date.now() > maximumLifetime) throw new TypeError('Expected a future expiry within 240 minutes');
  return timestamp;
}

async function bounded(read) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Read timed out')), requestLimit); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function liveConfiguration() {
  const volumes = JSON.parse(await readFile(`${root}runtime/live-volumes.json`, 'utf8'));
  const active = JSON.parse(await readFile(`${root}runtime/active-volume.json`, 'utf8'));
  if (!Array.isArray(volumes) || !volumes.length || !Number.isSafeInteger(active?.volume) || volumes.some(volume => !Number.isSafeInteger(volume?.id) || volume.id < 1 || typeof volume.workspace !== 'string' || !volume.workspace || typeof volume.metadataDirectory !== 'string' || !volume.metadataDirectory)) {
    throw new Error('Invalid live volume configuration');
  }
  return { volumes, active };
}

async function configuredLive({ volume, activityAfter }) {
  const { volumes, active } = await liveConfiguration();
  let selected = volumes.find(entry => entry.id === (volume === 'active' ? active.volume : Number(volume)));
  if (!selected) throw new Error('Unknown volume');
  if (volume === 'active' && selected.id > volumes[0].id) {
    const started = await readFile(resolve(root, selected.workspace, 'events.jsonl'), 'utf8').then(contents => contents.split('\n').some(line => {
      try { return JSON.parse(line)?.event?.type === 'block.started'; } catch { return false; }
    }), error => { if (error.code === 'ENOENT') return false; throw error; });
    if (!started) selected = volumes[0];
  }
  const { snapshot } = await import('./snapshot.mjs');
  const data = await snapshot(resolve(root, selected.workspace), resolve(root, selected.metadataDirectory), {
    volume: selected.id, agentEvents, jobStatus: true, jobLabel: selected.label, activeVolume: active.volume, activityAfter,
  });
  return { ...data, availableVolumes: volumes.map(entry => entry.id), books: bookCatalog(volumes), activeVolume: active.volume };
}

async function configuredWorkspace(volume) {
  const { volumes, active } = await liveConfiguration();
  const selected = volumes.find(entry => entry.id === (volume === 'active' ? active.volume : Number(volume)));
  if (!selected) throw new Error('Unknown volume');
  return resolve(root, selected.workspace);
}

async function configuredSource(volume) {
  const { volumes, active } = await liveConfiguration();
  const selected = volumes.find(entry => entry.id === (volume === 'active' ? active.volume : Number(volume)));
  if (!selected) throw new Error('Unknown volume');
  return { workspace: resolve(root, selected.workspace), metadataDirectory: resolve(root, selected.metadataDirectory) };
}

/**
 * Read mode's text: one block of the book's source, cut into the sentences
 * every record cites (b0003_s0012), each marked when a paragraph starts.
 * Read-only, on the private link like the rest of the viewer.
 */
export async function bookText(metadataDirectory, block) {
  // Blocks by their file name (b0001.txt is block 0), so a missing one is a 404, never another block's text under this block's ids.
  const files = (await readdir(metadataDirectory)).filter(name => /^b\d{4}\.txt$/.test(name)).sort();
  const name = `b${String(block + 1).padStart(4, '0')}.txt`;
  if (!files.includes(name)) return null;
  const { sectionBlock } = await import('../../dist/src/digger/intake/sectioning.js');
  const text = await readFile(resolve(metadataDirectory, name), 'utf8');
  let cursor = 0;
  const sentences = sectionBlock(text, block).sentences.map((sentence) => {
    const start = text.indexOf(sentence.text, cursor);
    const paragraph = start < 0 || cursor === 0 || text.slice(cursor, start).includes('\n');
    if (start >= 0) cursor = start + sentence.text.length;
    return { id: sentence.id, text: sentence.text, ...(paragraph ? { paragraph: true } : {}) };
  });
  return { block, blocks: Number(files.at(-1).slice(1, 5)), sentences };
}

/** Read mode's prepared animation (novel stage prep): one movement plan per place, or null until the book's analysis is complete. */
export async function stagePlan(workspace) {
  return readFile(resolve(workspace, 'stage', 'plan.json'), 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });
}

export async function createViewer({ port = 4324, origin, expiresAt, readLive = configuredLive, resolveWorkspace = readLive === configuredLive ? configuredWorkspace : undefined, resolveSource = readLive === configuredLive ? configuredSource : undefined, watchPaths, console: consoleOptions, dist = `${repo}/apps/playground/dist`, libraryDirectory = process.env.NOVEL_LIBRARY_DIR, libraryBindings, libraryReader = readLibraryLive } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid loopback port');
  const expiry = deadline(expiresAt);
  if (origin !== undefined) validateOrigin(origin, port);
  const resources = await validateResources(dist);
  const paths = [...(watchPaths ?? (readLive === configuredLive ? [`${root}runtime`, ...(await liveConfiguration()).volumes.map(volume => resolve(root, volume.workspace))] : [])), ...(libraryDirectory ? [resolve(libraryDirectory)] : [])];
  const readSnapshot = async options => {
    const data = await readLive(options);
    if (!libraryDirectory) return data;
    const bindings = libraryBindings ?? (readLive === configuredLive ? await configuredLibraryBindings((await liveConfiguration()).volumes, root) : []);
    const live = withLibraryLive(data, await libraryReader(libraryDirectory, bindings, undefined, resolveWorkspace));
    // Story time and places belong to the universe: every hosted book of the reader's universe, joined by the reviewed atlas.
    const universeTimePlace = resolveWorkspace ? await readUniverseTimePlace(libraryDirectory, bindings, resolveWorkspace, data.volume ?? 1).catch(() => null) : null;
    return universeTimePlace ? { ...live, universeTimePlace } : live;
  };
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) throw new TypeError('Invalid watch paths');
  const access = randomBytes(32).toString('base64url');
  const privatePath = `/view/${access}/`;
  let publicOrigin;
  let piConsole;
  let expiryTimer;
  let closing;
  const streams = new Set();
  const server = createServer((request, response) => {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    const timer = setTimeout(() => response.destroy(), requestLimit);
    response.once('close', () => clearTimeout(timer));
    const send = (status, body, headers = {}) => {
      if (!response.destroyed) response.writeHead(status, headers).end(request.method === 'HEAD' ? undefined : body);
    };
    const handle = async () => {
      if (Date.now() >= expiry) { send(410, 'Live viewer expired.'); return; }
      if (request.headers.host !== new URL(publicOrigin).host) { send(403); request.resume(); return; }
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) { send(400); return; }
      const url = new URL(request.url, publicOrigin);
      const route = url.pathname.match(/^\/view\/([a-zA-Z0-9_-]+)(\/.*)$/);
      if (!route || Buffer.byteLength(route[1]) !== Buffer.byteLength(access) || !timingSafeEqual(Buffer.from(route[1]), Buffer.from(access))) { send(401); return; }
      const scopedPath = route[2];
      const allowed = scopedPath === '/api/pi/messages' ? 'POST' : scopedPath === '/api/live/stream' ? 'GET' : 'GET, HEAD';
      if (!allowed.split(', ').includes(request.method)) { send(405, undefined, { Allow: allowed }); request.resume(); return; }
      if (scopedPath === '/api/pi/messages') {
        if (!piConsole) { send(404); request.resume(); return; }
        await piConsole.handleMessage(request, response);
        return;
      }
      if (scopedPath === '/api/pi') {
        if (!piConsole) { send(404); return; }
        send(200, JSON.stringify(await bounded(() => piConsole.read())), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }
      if (scopedPath === '/api/album-asset') {
        // Read-only album images (EPUB pictures and bound portraits) for the
        // selected book; only files listed in its album records under assets/.
        const volume = url.searchParams.get('volume') ?? 'active';
        if (!resolveWorkspace || volume !== 'active' && (!/^[1-9]\d*$/.test(volume) || !Number.isSafeInteger(Number(volume)))) { send(404); return; }
        const asset = await bounded(async () => resolveAlbumAsset(await resolveWorkspace(volume), url.searchParams.get('id')));
        if (!asset) { send(404); return; }
        send(200, await readFile(asset.filename), { 'Content-Type': asset.type });
        return;
      }
      if (scopedPath === '/play/') {
        // The stage simulation player: the selected book's accepted runs (novel sim run), in the engine's own page.
        const volume = url.searchParams.get('volume') ?? 'active';
        if (!resolveWorkspace || volume !== 'active' && (!/^[1-9]\d*$/.test(volume) || !Number.isSafeInteger(Number(volume)))) { send(404); return; }
        const page = await bounded(async () => simulationPage(await resolveWorkspace(volume)));
        if (!page) { send(404, 'No simulation runs for this book yet (novel sim run).', { 'Content-Type': 'text/plain; charset=utf-8' }); return; }
        send(200, page.html, { 'Content-Type': types['.html'], 'Content-Security-Policy': page.policy });
        return;
      }
      if (scopedPath.startsWith('/play/vendor/')) {
        const body = await simulationVendor(scopedPath.slice('/play/vendor/'.length));
        if (!body) { send(404); return; }
        send(200, body, { 'Content-Type': types['.js'] });
        return;
      }
      if (scopedPath === '/api/book-text' || scopedPath === '/api/stage') {
        // Read mode: the selected book's text, one block at a time, and its prepared animation.
        const volume = url.searchParams.get('volume') ?? 'active';
        if (!resolveSource || volume !== 'active' && (!/^[1-9]\d*$/.test(volume) || !Number.isSafeInteger(Number(volume)))) { send(404); return; }
        const block = url.searchParams.get('block') ?? '0';
        if (scopedPath === '/api/book-text' && (!/^\d{1,4}$/.test(block))) { send(400); return; }
        const data = await bounded(async () => {
          const source = await resolveSource(volume);
          return scopedPath === '/api/stage' ? stagePlan(source.workspace) : bookText(source.metadataDirectory, Number(block));
        });
        if (!data) { send(404); return; }
        send(200, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }
      if (['/api/live', '/db/novel/view.json', '/api/live/stream'].includes(scopedPath)) {
        const volume = url.searchParams.get('volume') ?? 'active';
        if (volume !== 'active' && (!/^[1-9]\d*$/.test(volume) || !Number.isSafeInteger(Number(volume)))) { send(400); return; }
        let activityAfter;
        let lastBatch;
        const read = async () => {
          const data = await bounded(() => readSnapshot({ volume, activityAfter }));
          if (response.destroyed || Date.now() >= expiry) throw new Error('Viewer closed');
          if (data.activity) {
            activityAfter = data.activity.cursor;
            if (data.activity.batch) lastBatch = data.activity.batch;
          }
          return { ...data, ...(data.activity ? { activity: { ...data.activity, ...(lastBatch ? { batch: lastBatch } : {}) } } : {}), clientBundle: resources.clientBundle };
        };
        if (scopedPath === '/api/live/stream') {
          request.socket.setTimeout(0);
          streams.add(response);
          response.once('close', () => streams.delete(response));
          await streamSnapshots(request, response, { read, watchPaths: paths, expiresAt: expiry });
        } else {
          const data = await read();
          send(200, JSON.stringify(scopedPath === '/api/live' ? data : data.world), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        return;
      }
      const pathname = decodeURIComponent(scopedPath);
      const filename = await resource(resources.directory, pathname);
      send(200, pathname === '/' ? resources.html : await readFile(filename), { 'Content-Type': types[extname(filename)] });
    };
    void handle().catch(() => {
      if (response.headersSent) response.destroy();
      else send(404);
    }).finally(() => clearTimeout(timer));
  });
  server.requestTimeout = requestLimit;
  server.headersTimeout = 10000;
  server.setTimeout(requestLimit, socket => socket.destroy());
  const close = () => closing ??= new Promise(resolveClose => {
    clearTimeout(expiryTimer);
    for (const response of streams) response.destroy();
    server.close(resolveClose);
    server.closeAllConnections();
  });
  server.once('close', () => clearTimeout(expiryTimer));
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
  });
  try {
    port = server.address().port;
    publicOrigin = validateOrigin(origin ?? `http://127.0.0.1:${port}`, port);
    if (consoleOptions) {
      piConsole = createPiConsole({ directory: consoleOptions.directory, agentEvents: consoleOptions.agentEvents, controlToken: consoleOptions.controlToken, origin: publicOrigin, expiresAt: expiry });
    }
    if (Date.now() >= expiry) throw new Error('Viewer expired before startup');
    expiryTimer = setTimeout(() => void close(), expiry - Date.now());
    const url = `${publicOrigin}${privatePath}?phone=1`;
    return { server, port, origin: publicOrigin, expiresAt: expiry, privatePath, url, close };
  } catch (error) { await close(); throw error; }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { port: { type: 'string', default: '4324' }, minutes: { type: 'string', default: '90' }, origin: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node tools/pi-review/serve.mjs [--port 4324] [--minutes 90] [--origin https://viewer.example]\nLoopback only; minutes must be 1–240. NOVEL_REVIEW_HOME selects configuration (default: repo/.pi-review).\nRequires a built apps/playground/dist and runtime/live-volumes.json + active-volume.json.\nOptional runtime/pi-control.json: {token, expiresAt}; its expiry caps this session.\nRead-only link has no fragment; operator link uses #pi=<token> and POST requires exact Origin + X-Pi-Control.\nSession replay is optional and returns 404. No tunnel is created or previous session extended.');
    return;
  }
  if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) throw new TypeError('Port must be 1–65535');
  if (!/^\d+$/.test(values.minutes) || Number(values.minutes) < 1 || Number(values.minutes) > 240) throw new TypeError('Minutes must be 1–240');
  const port = Number(values.port);
  const origin = validateOrigin(values.origin ?? `http://127.0.0.1:${port}`, port);
  let control;
  try { control = JSON.parse(await readFile(`${root}runtime/pi-control.json`, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid Pi control configuration'); }
  let expiresAt = Date.now() + Number(values.minutes) * 60000;
  if (control !== undefined) {
    if (!control || typeof control.token !== 'string' || !control.token || Buffer.byteLength(control.token) > 4096 || typeof control.expiresAt !== 'string' || !Number.isFinite(Date.parse(control.expiresAt))) throw new Error('Invalid Pi control configuration');
    expiresAt = Math.min(expiresAt, Date.parse(control.expiresAt));
  }
  const viewer = await createViewer({ port, origin, expiresAt, console: control ? { directory: `${root}runtime/pi-console`, agentEvents, controlToken: control.token } : undefined });
  console.log(`Read-only link: ${viewer.url}`);
  if (control) console.log(`Operator link: ${viewer.url}#pi=${encodeURIComponent(control.token)}`);
  console.log(`Viewer expires: ${new Date(viewer.expiresAt).toISOString()}`);
  const close = () => {
    process.off('SIGTERM', close);
    process.off('SIGINT', close);
    void viewer.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  viewer.server.once('close', () => { process.off('SIGTERM', close); process.off('SIGINT', close); });
  return viewer;
}

const entry = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => undefined) : undefined;
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch(() => { console.error('Viewer could not start. Check CLI arguments, build resources, runtime configuration, and unexpired Pi control.'); process.exitCode = 1; });
}
