// The phone from a parallel universe (docs/v3/design.html §10.2) as a web console: the same call as phone.mjs, in a page
// for a phone's browser. Listens on this computer only; reach it from outside through a tunnel. Every turn spends money
// (Jev and the work model), so the page lives under a random secret path and everything else is 404.
//
// Usage: node engine/persona/web.mjs <volume folder> --holder <id> --at <scene order> [--graph <folder>] [--port 8795] [--mock]
//   Prints the local address with its secret path; put the tunnel's host in front of the same path.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openPhone, phoneArgs } from './session.mjs';

const options = phoneArgs(process.argv.slice(2));
const port = Number(options.opt('port') ?? 8795), secret = randomBytes(12).toString('hex'), base = `/c/${secret}/`;
const phone = await openPhone(options);

const page = (name, mode) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1d1b;--muted:#6b6a66;--me:#2f6fde;--me-fg:#fff;--them:#e7e5df;--line:#d9d6ce;--code:#efede7}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--muted:#9a9891;--me:#3d7bea;--me-fg:#fff;--them:#2a2a27;--line:#353531;--code:#22221f}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
header{padding:12px 16px;border-bottom:1px solid var(--line)}header b{font-size:17px}header small{color:var(--muted);display:block}
#log{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:85%;padding:8px 12px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.me{align-self:flex-end;background:var(--me);color:var(--me-fg);border-bottom-right-radius:4px}
.them{align-self:flex-start;background:var(--them);border-bottom-left-radius:4px}
.note{align-self:center;color:var(--muted);font-size:13px;text-align:center}
details{align-self:flex-start;max-width:95%;font-size:12px;color:var(--muted)}details pre{background:var(--code);padding:8px;border-radius:8px;white-space:pre-wrap;margin:4px 0 0}
form{display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
input{flex:1;min-width:0;font:inherit;padding:10px 12px;border-radius:20px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button{font:inherit;padding:10px 14px;border-radius:20px;border:0;background:var(--me);color:var(--me-fg)}
button.alt{background:var(--them);color:var(--fg)}button:disabled{opacity:.5}
</style></head><body>
<header><b id="name"></b><small id="mode"></small></header>
<main id="log"></main>
<form id="f"><input id="t" autocomplete="off" placeholder="Message"><button id="send">Send</button><button type="button" class="alt" id="wait" title="Let time pass">Wait</button></form>
<script>
const NAME=${JSON.stringify(name)}, MODE=${JSON.stringify(mode)};
document.getElementById('name').textContent=NAME;
document.getElementById('mode').textContent=MODE+' · Wait lets time pass: something held back may come out';
const log=document.getElementById('log'),t=document.getElementById('t'),buttons=[...document.querySelectorAll('button')];
function add(cls,text){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;log.append(d);log.scrollTop=log.scrollHeight;return d}
function note(text){const d=document.createElement('div');d.className='note';d.textContent=text;log.append(d);log.scrollTop=log.scrollHeight}
function inside(o){const det=document.createElement('details'),s=document.createElement('summary'),p=document.createElement('pre');
 s.textContent='inside: '+(o.surfaced.map(u=>u.kind).join(', ')||'nothing surfaced')+' · '+o.ms+' ms';
 p.textContent=['mood: valence '+o.mood.valence.toFixed(2)+', arousal '+o.mood.arousal.toFixed(2),
  'surfaced:',...o.surfaced.map(u=>'  '+u.kind+' ('+u.dept+'): '+u.content),
  'sank to next turn:',...(o.sank.length?o.sank.map(u=>'  '+u.kind+' '+u.salience.toFixed(2)+': '+u.content):['  nothing']),
  'calls so far: Jev '+o.spend.jev+', text '+o.spend.text].join('\\n');
 det.append(s,p);log.append(det);log.scrollTop=log.scrollHeight}
async function turn(text){buttons.forEach(b=>b.disabled=true);const typing=note(NAME+' …');
 try{const r=await fetch('turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
  const o=await r.json();log.lastChild.remove();if(!r.ok)throw new Error(o.error||r.status);
  if(o.said)add('them',o.said);if(o.moved)note('['+o.moved+']');if(!o.said&&!o.moved)note('(no reply)');inside(o)}
 catch(e){log.lastChild?.remove?.();note('failed: '+e.message)}finally{buttons.forEach(b=>b.disabled=false);t.focus()}}
document.getElementById('f').onsubmit=e=>{e.preventDefault();const v=t.value.trim();if(!v)return;t.value='';add('me',v);turn(v)};
document.getElementById('wait').onclick=()=>{note('time passes');turn(null)};
</script></body></html>`;

const server = createServer(async (req, res) => {
  const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(body); };
  try {
    if (req.method === 'GET' && req.url === base) return send(200, 'text/html; charset=utf-8', page(phone.self.name, phone.mock ? 'mock, no spend' : 'live'));
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
