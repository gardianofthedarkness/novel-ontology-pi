import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevPreview } from './dev-preview.mjs';

for (const externalOrigin of [undefined, 'https://synthetic.trycloudflare.com']) test(`real Vite HMR and API proxy work for ${externalOrigin ? 'phone-origin forwarding' : 'Mac loopback'} without starting an agent`, { timeout: 20000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'series-hmr-')));
  let preview;
  let socket;
  let timeout;
  const observed = [];
  const upstream = createServer((incoming, response) => {
    observed.push({ origin: incoming.headers.origin, control: incoming.headers['x-pi-control'] });
    incoming.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'synthetic-idle' }));
  });
  try {
    await writeFile(join(directory, 'vite.config.ts'), 'export default { optimizeDeps: { noDiscovery: true } };');
    await writeFile(join(directory, 'index.html'), '<html><body><script type="module" src="/main.js"></script></body></html>');
    await writeFile(join(directory, 'main.js'), 'export const revision = 1; if (import.meta.hot) import.meta.hot.accept();');
    await writeFile(join(directory, '.npmrc'), 'synthetic-private-config');
    await new Promise(done => upstream.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${upstream.address().port}`;
    const privatePath = '/view/synthetic-test-only/';
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    preview = await createDevPreview({ backend: { origin, privatePath, expiresAt, operatorUrl: `${origin}${privatePath}#pi=synthetic-control` }, frontend: directory, port: 0, origin: externalOrigin });
    const read = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((done, reject) => {
      const outgoing = request({ hostname: '127.0.0.1', port: preview.port, path, method, headers: { Host: new URL(preview.origin).host, ...headers } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('end', () => done({ status: response.statusCode, headers: response.headers, text: () => Buffer.concat(chunks).toString('utf8') }));
      });
      outgoing.once('error', reject);
      outgoing.end(body);
    });
    const page = await read(privatePath);
    assert.equal(page.status, 200);
    const html = page.text();
    assert.match(html, /@vite\/client/);
    assert.match(html, /nonce=/);
    assert.match(page.headers['content-security-policy'], /script-src 'self' 'nonce-/);
    assert.equal((await read('/')).status, 401);
    assert.equal((await read(`${privatePath}@fs/etc/passwd`)).status, 403);
    assert.equal((await read(`${privatePath}@fs${directory}/.npmrc`)).status, 403);
    assert.equal((await read(`${privatePath}api/pi`)).status, 200);
    const message = await read(`${privatePath}api/pi/messages`, { method: 'POST', headers: { Origin: preview.origin, 'X-Pi-Control': 'synthetic-control' }, body: '{}' });
    assert.equal(message.status, 200);
    assert.deepEqual(observed.at(-1), { origin, control: 'synthetic-control' });
    const before = observed.length;
    assert.equal((await read(`${privatePath}api/pi/messages`, { method: 'POST', headers: { Origin: 'https://unapproved.example' }, body: '{}' })).status, 403);
    assert.equal(observed.length, before);
    await read(`${privatePath}main.js`);
    const client = (await read(`${privatePath}@vite/client`)).text();
    const token = JSON.parse(client.match(/const wsToken = ("[^"]+")/)[1]);
    const connected = new Promise((ready, reject) => {
      timeout = setTimeout(() => reject(new Error('No actual HMR update received within eight seconds')), 8000);
      const upgrade = request({ hostname: '127.0.0.1', port: preview.port, path: `${privatePath}__hmr?token=${token}`, headers: { Host: new URL(preview.origin).host, Origin: preview.origin, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol': 'vite-hmr' } });
      upgrade.once('error', reject);
      upgrade.once('response', response => { response.resume(); reject(new Error(`HMR upgrade rejected: ${response.statusCode}`)); });
      upgrade.once('upgrade', (response, connection, head) => {
        socket = connection;
        assert.equal(response.statusCode, 101);
        let data = Buffer.from(head);
        let started = false;
        const inspect = () => {
          if (!started && data.includes(Buffer.from('connected'))) {
            started = true;
            void writeFile(join(directory, 'main.js'), 'export const revision = 2; if (import.meta.hot) import.meta.hot.accept();').catch(reject);
          }
          if (data.includes(Buffer.from('"type":"update"'))) ready();
        };
        socket.on('data', chunk => { data = Buffer.concat([data, chunk]); inspect(); });
        socket.once('error', reject);
        inspect();
      });
      upgrade.end();
    });
    await connected;
  } finally {
    clearTimeout(timeout);
    socket?.destroy();
    await preview?.close();
    upstream.closeAllConnections();
    await new Promise(done => upstream.close(done));
    await rm(directory, { recursive: true, force: true });
  }
});
