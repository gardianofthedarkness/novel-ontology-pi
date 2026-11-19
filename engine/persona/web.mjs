// The phone from a parallel universe (docs/v3/design.html §10.2) as a web console: the same call as phone.mjs, in a page
// made to look like the handset itself (web-page.html: a phone lit by a rift to another world). Listens on this computer
// only; reach it from outside through a tunnel. Every turn spends money (Jev and the work model), so the pages live under
// a secret path and everything else is 404.
//
// Usage: node engine/persona/web.mjs <library> --person <id or name>[@<book>[:<scene>]],... --at <book>[:<scene>] [--port 8795]
//          [--secret <hex>] [--mock]
//   Several people share the world (its graph is opened once): the first answers at /c/<secret>/, each one at
//   /c/<secret>/p/<person id>/. Prints the local addresses; put the tunnel's host in front of the same paths. --secret
//   keeps the links working across a restart (otherwise a new random one).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUniverse, openWorld, phoneArgs } from './session.mjs';

const options = phoneArgs(process.argv.slice(2));
const port = Number(options.opt('port') ?? 8795);
const secret = /^[0-9a-f]{16,64}$/.test(options.opt('secret') ?? '') ? options.opt('secret') : randomBytes(12).toString('hex');
const base = `/c/${secret}/`;
const template = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'web-page.html'), 'utf8');
const shared = await openUniverse(options), people = [];
// Each person at their own point when given (p_0002@vol-2), else at --at.
for (const entry of options.person.split(',').map((s) => s.trim()).filter(Boolean)) { const [person, at] = entry.split('@'); people.push(await openWorld({ ...options, person, at: at || options.at }, shared)); }

// One call per visitor and person: the page makes a call id when it loads and sends it with each turn; a new load is a
// new call.
const calls = new Map(), CALLS_KEPT = 100;
const callOf = (phone, id) => {
  const key = `${phone.self.id}:${id}`;
  if (!calls.has(key)) { calls.set(key, phone.newCall()); if (calls.size > CALLS_KEPT) calls.delete(calls.keys().next().value); }
  return calls.get(key);
};
// What a page is told: who answers, from which point of their story, and whether the link is live. "<" is escaped so
// nothing in a name can close the script.
const pageOf = (phone) => template.replace('/*BOOT*/{}', JSON.stringify({ name: phone.self.name, worldLine: phone.at, mode: phone.mock ? 'mock' : 'live' }).replace(/</g, '\\u003c'));
const pages = new Map(people.map((p) => [p.self.id, pageOf(p)]));
/** The person a path is for: /c/<secret>/ (the first) or /c/<secret>/p/<id>/, and what follows ('' or 'turn'). */
function route(url) {
  if (!url.startsWith(base)) return null;
  const rest = url.slice(base.length), own = rest.match(/^p\/(p_\d+)\/(.*)$/);
  const phone = own ? people.find((p) => p.self.id === own[1]) : people[0];
  return phone ? { phone, rest: own ? own[2] : rest } : null;
}

const server = createServer(async (req, res) => {
  const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(body); };
  try {
    const r = route(req.url ?? '');
    if (r && req.method === 'GET' && r.rest === '') return send(200, 'text/html; charset=utf-8', pages.get(r.phone.self.id));
    if (r && req.method === 'POST' && r.rest === 'turn') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4000) return send(413, 'application/json', '{"error":"too long"}'); }
      const { text, call } = JSON.parse(body || '{}');
      if (typeof call !== 'string' || !/^[0-9a-f]{16,40}$/.test(call)) return send(400, 'application/json', '{"error":"no call"}');
      const input = typeof text === 'string' && text.trim() ? { from: 'stranger', text: text.trim().slice(0, 1000) } : null;
      const out = await callOf(r.phone, call).send(input);
      return send(200, 'application/json', JSON.stringify(out));
    }
    // The world agent: the visitor asks it (it knows the call's now and the books' future); or what the world shows now.
    if (r && req.method === 'POST' && (r.rest === 'ask' || r.rest === 'glimpse')) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4000) return send(413, 'application/json', '{"error":"too long"}'); }
      const { question, call } = JSON.parse(body || '{}');
      if (typeof call !== 'string' || !/^[0-9a-f]{16,40}$/.test(call)) return send(400, 'application/json', '{"error":"no call"}');
      const c = callOf(r.phone, call);
      if (r.rest === 'glimpse') return send(200, 'application/json', JSON.stringify({ world: c.glimpse() }));
      if (typeof question !== 'string' || !question.trim()) return send(400, 'application/json', '{"error":"no question"}');
      return send(200, 'application/json', JSON.stringify(await c.ask(question.trim().slice(0, 600))));
    }
    send(404, 'text/plain', 'not found');
  } catch (error) {
    console.error(error);
    send(500, 'application/json', JSON.stringify({ error: String(error.message ?? error).slice(0, 200) }));
  }
});
server.listen(port, '127.0.0.1', () => { for (const [i, p] of people.entries()) console.log(`${p.self.id} ready (${p.mock ? 'mock' : 'live'}): http://127.0.0.1:${port}${base}${i ? `p/${p.self.id}/` : ''}`); });
const stop = async () => { server.close(); await shared.u.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
