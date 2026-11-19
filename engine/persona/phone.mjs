// The phone from a parallel universe (docs/v3/design.html §10.2), in a terminal: a character of a book, at a point in its
// story, holds a phone that strangers from another world can message. Each message is a turn of the mind (mind.mjs);
// the call itself (graph, models, memory of what was said) is session.mjs, shared with the web console (web.mjs).
//
// Usage: node engine/persona/phone.mjs <volume folder> --holder <id> --at <scene order> [--graph <folder>] [--mock]
//   Paid: one Jev call per department and one for the brain stem a turn, and one text call when they speak.
//   --mock: no models, no spend (fixed answers), to check the wiring.
//   Type a message; /wait lets time pass with no message (an urge that sank may come out); /quit ends.
import { createInterface } from 'node:readline';
import { openPhone, phoneArgs } from './session.mjs';

const phone = await openPhone(phoneArgs(process.argv.slice(2)));
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`${phone.self.name} picks up the phone (${phone.mock ? 'mock, no spend' : 'live: Jev and the work model, paid'}). /wait lets time pass, /quit ends.`);
try {
  rl.setPrompt('you> '); rl.prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (line === '/quit') break;
    if (line) {
      const out = await phone.send(line === '/wait' ? null : { from: 'stranger', text: line });
      if (out.said) console.log(`${phone.self.name}> ${out.said}`);
      if (out.moved) console.log(`  [${out.moved}]`);
      console.log(`  surfaced: ${out.surfaced.map((u) => u.kind).join(', ') || 'nothing'} | sank: ${out.sank.map((u) => `${u.kind} ${u.salience.toFixed(2)}`).join(', ') || 'nothing'} | mood ${out.mood.valence.toFixed(2)}/${out.mood.arousal.toFixed(2)} | ${out.ms} ms`);
    }
    if (!rl.closed) rl.prompt();
  }
} finally { rl.close(); await phone.close(); }
