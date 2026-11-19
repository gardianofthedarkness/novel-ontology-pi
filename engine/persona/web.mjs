// The phone from a parallel universe (docs/v3/design.html §10.2) as a web console: the same call as phone.mjs, in a page
// made to look like the handset itself (web-page.html: a phone lit by a rift to another world). Listens on this computer
// only; reach it from outside through a tunnel. Every turn spends money (Jev and the work model), so the page lives under
// a secret path and everything else is 404.
//
// Usage: node engine/persona/web.mjs <library> --person <person id or a name> --at <book>[:<scene>] [--port 8795]
//          [--secret <hex>] [--mock]
//   Prints the local address with its secret path; put the tunnel's host in front of the same path. --secret keeps a link
//   working across a restart (otherwise a new random one).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPhone, phoneArgs } from './session.mjs';

const options = phoneArgs(process.argv.slice(2));
const port = Number(options.opt('port') ?? 8795);
const secret = /^[0-9a-f]{16,64}$/.test(options.opt('secret') ?? '') ? options.opt('secret') : randomBytes(12).toString('hex');
const base = `/c/${secret}/`;
const template = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'web-page.html'), 'utf8');
const phone = await openPhone(options);
// What the page is told: who answers, from which point of their story, and whether the link is live. "<" is escaped so
// nothing in a name can close the script.
const boot = JSON.stringify({ name: phone.self.name, worldLine: options.at, mode: phone.mock ? 'mock' : 'live' }).replace(/</g, '\\u003c');
const page = template.replace('/*BOOT*/{}', boot);

const server = createServer(async (req, res) => {
  const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(body); };
  try {
    if (req.method === 'GET' && req.url === base) return send(200, 'text/html; charset=utf-8', page);
    if (req.method === 'POST' && req.url === `${base}turn`) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4000) return send(413, 'application/json', '{"error":"too long"}'); }
      const text = JSON.parse(body || '{}').text;
      const input = typeof text === 'string' && text.trim() ? { from: 'stranger', text: text.trim().slice(0, 1000) } : null;
      const out = await phone.send(input);
      return send(200, 'application/json', JSON.stringify(out));
    }
    send(404, 'text/plain', 'not found');
  } catch (error) {
    console.error(error);
    send(500, 'application/json', JSON.stringify({ error: String(error.message ?? error).slice(0, 200) }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`${phone.self.id} ready (${phone.mock ? 'mock' : 'live'}): http://127.0.0.1:${port}${base}`));
const stop = async () => { server.close(); await phone.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
