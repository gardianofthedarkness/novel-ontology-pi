import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../', import.meta.url)));

export function authorizePreview(request, { origin, privatePath, expiresAt, upgrade = false }) {
  if (Date.now() >= Date.parse(expiresAt)) return 410;
  if (request.headers.host !== new URL(origin).host) return 403;
  if (!request.url?.startsWith(privatePath) || request.url.startsWith('//')) return 401;
  const url = new URL(request.url, origin);
  if (!url.pathname.startsWith(privatePath)) return 401;
  if (upgrade) return url.pathname === `${privatePath}__hmr` && request.headers.origin === origin ? 200 : 403;
  if (url.pathname === `${privatePath}api/pi/messages`) return request.method === 'POST' && request.headers.origin === origin ? 200 : 403;
  return ['GET', 'HEAD'].includes(request.method) ? 200 : 405;
}

export async function createDevPreview({ backend, frontend = `${repo}/apps/playground`, port = 5175, origin, expiresAt = backend.expiresAt }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port');
  const lifetime = Date.parse(expiresAt) - Date.now();
  if (!(lifetime > 0) || lifetime > 240 * 60000 || Date.parse(expiresAt) > Date.parse(backend.expiresAt)) throw new Error('Preview cannot outlive its backend or four-hour window');
  const backendOrigin = new URL(backend.origin);
  if (backendOrigin.hostname !== '127.0.0.1' || backendOrigin.protocol !== 'http:' || !/^\/view\/[\w-]+\/$/.test(backend.privatePath)) throw new Error('Expected the private loopback backend');
  if (origin && (new URL(origin).origin !== origin || !(origin.startsWith('https://') || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)))) throw new Error('Expected an exact HTTPS or HTTP loopback origin');
  let vite;
  let publicOrigin;
  const nonce = randomBytes(18).toString('base64');
  const sockets = new Set();
  const edge = createServer((request, response) => {
    const status = authorizePreview(request, { origin: publicOrigin, privatePath: backend.privatePath, expiresAt });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    if (status !== 200) { request.resume(); response.writeHead(status).end(); return; }
    const local = new URL(request.url, publicOrigin);
    const route = local.pathname.slice(backend.privatePath.length);
    if (route.startsWith('api/') || route === 'db/novel/view.json') {
      const headers = { ...request.headers, host: backendOrigin.host };
      delete headers.connection;
      delete headers.upgrade;
      if (headers.origin === publicOrigin) headers.origin = backend.origin;
      const upstream = httpRequest(new URL(request.url, backend.origin), { method: request.method, headers }, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
      request.once('aborted', () => upstream.destroy());
      response.once('close', () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    const websocket = publicOrigin.replace(/^http/, 'ws');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${websocket}; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`);
    if (!vite) { response.writeHead(503).end('Preview starting'); return; }
    vite.middlewares(request, response, () => response.writeHead(404).end());
  });
  edge.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  edge.on('upgrade', (request, socket) => {
    if (authorizePreview(request, { origin: publicOrigin, privatePath: backend.privatePath, expiresAt, upgrade: true }) !== 200) socket.destroy();
  });
  await new Promise((ready, reject) => { edge.once('error', reject); edge.listen(port, '127.0.0.1', ready); });
  port = edge.address().port;
  publicOrigin = origin ?? `http://127.0.0.1:${port}`;
  let timer;
  let closed;
  const close = () => closed ??= (async () => {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await vite?.close();
    await new Promise(done => edge.close(done));
  })();
  try {
    const { createServer: createVite } = await import(pathToFileURL(`${repo}/apps/playground/node_modules/vite/dist/node/index.js`));
    const dependencies = await fs.readFile(`${frontend}/package.json`, 'utf8').then(bytes => Object.keys(JSON.parse(bytes).dependencies ?? {}), error => { if (error.code === 'ENOENT') return []; throw error; });
    const include = [...dependencies, ...(dependencies.includes('react') ? ['react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'] : [])];
    vite = await createVite({ root: frontend, configFile: `${frontend}/vite.config.ts`, cacheDir: `${frontend}/node_modules/.vite-private-${port}`, optimizeDeps: { noDiscovery: true, include }, publicDir: false, base: backend.privatePath, html: { cspNonce: nonce }, clearScreen: false, server: { host: '127.0.0.1', port, middlewareMode: true, cors: false, allowedHosts: [new URL(publicOrigin).hostname], hmr: { server: edge, path: '__hmr', protocol: publicOrigin.startsWith('https:') ? 'wss' : 'ws', host: new URL(publicOrigin).hostname, clientPort: new URL(publicOrigin).port ? Number(new URL(publicOrigin).port) : publicOrigin.startsWith('https:') ? 443 : 80 }, fs: { strict: true, allow: [frontend, `${repo}/node_modules`], deny: ['**/.env', '**/.env.*', '**/*.{crt,pem,key}', '**/.git/**', '**/.npmrc', '**/db/**', '**/.pi-review/**'] } } });
    timer = setTimeout(() => void close(), Date.parse(expiresAt) - Date.now());
    const url = `${publicOrigin}${backend.privatePath}?phone=1&source=1`;
    return { close, port, origin: publicOrigin, expiresAt, privatePath: backend.privatePath, readOnlyUrl: url, operatorUrl: `${url}${new URL(backend.operatorUrl).hash}` };
  } catch (error) { await close(); throw error; }
}

export async function previewMain(args = process.argv.slice(2), { state = resolve(process.env.NOVEL_PLAYGROUND_HOME ?? `${repo}/.team-playground`) } = {}) {
  process.umask(0o077);
  const { values } = parseArgs({ args, options: { port: { type: 'string', default: '5175' }, origin: { type: 'string' }, 'print-links': { type: 'boolean' } } });
  if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) throw new Error('Expected port 1–65535');
  const output = `${state}/dev-links-${values.port}.json`;
  if (values['print-links']) { console.log(await fs.readFile(output, 'utf8')); }
  else {
    const backend = JSON.parse(await fs.readFile(`${state}/viewer-links.json`, 'utf8'));
    const preview = await createDevPreview({ backend, port: Number(values.port), origin: values.origin });
    await fs.writeFile(output, JSON.stringify({ ...preview, close: undefined, pid: process.pid }, null, 2), { mode: 0o600 });
    console.log(`Hot frontend ready on loopback port ${preview.port}; attached to the existing idle Pi, no model prompt sent. Private links are in ${output}`);
    process.once('SIGTERM', () => { void preview.close(); });
    process.once('SIGINT', () => { void preview.close(); });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await previewMain();
