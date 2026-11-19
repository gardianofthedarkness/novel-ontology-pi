// The phone from a parallel universe (docs/v3/design.html §10.2): a character of a book, at a point in its story, holds a
// phone that strangers from another world can message. Each message is a turn of the mind (mind.mjs): memory, emotion,
// subjectivity and action at once, then the brain stem. Recall is the Cypher query over the book's memories (§10.1); what
// is said on the phone is remembered on its own branch, so the book's canon is never touched.
// Channels: this terminal now; QQ or Discord later behind the same two calls (a message comes in, a reply goes out).
//
// Usage: node engine/persona/phone.mjs <volume folder> --holder <id> --at <scene order> [--graph <folder>] [--mock]
//   Paid: one Jev call per department and one for the brain stem a turn, and one text call when they speak.
//   --mock: no models, no spend (fixed answers), to check the wiring.
//   Type a message; /wait lets time pass with no message (an urge that sank may come out); /quit ends.
//   The graph (a cache, rebuilt from the bundle when missing) and the call log stay beside the volume, private.
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storedKeys } from '../volume/credentials.mjs';
import { createMind } from './mind.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const args = process.argv.slice(2), volume = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const mock = args.includes('--mock'), holderId = opt('holder'), at = Number(opt('at'));
if (!holderId || !Number.isFinite(at)) throw new Error('Usage: phone.mjs <volume> --holder <id> --at <scene order> [--graph <folder>] [--mock]');
const ontology = join(volume, 'novel', 'ontology'), graphDir = resolve(opt('graph') ?? join(volume, 'memory-graph'));
const lines = async (f) => (await readFile(f, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

const { LadybugStore } = await load('dist/src/ground/connectors/ladybug.js');
const { indexMemories, recall } = await load('dist/src/ground/ontology/memory.js');
const entities = latest(await lines(join(ontology, 'entities.jsonl')));
const file = join(graphDir, 'memory.lbug'), fresh = !existsSync(file);
await mkdir(graphDir, { recursive: true });
const store = new LadybugStore(file), run = (c, p) => store.run(c, p);
await store.initSchema();
if (fresh) {
  const kinds = new Set(['Character', 'Location', 'Item', 'Concept', 'Organization']);
  for (const e of entities) if (kinds.has(e.kind)) await run(`CREATE (:${e.kind} {id: $id, canonical_name: $name})`, { id: e.id, name: e.names?.[0]?.text ?? e.id });
  await indexMemories(run, await lines(join(ontology, 'memories.jsonl')));
}

// Who they are: their name, and what weighs most in their memories by this point (recalled with no cue).
const holder = entities.find((e) => e.id === holderId);
if (!holder) throw new Error(`No entity ${holderId}`);
const branch = `phone-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
let now = 0;
const lineage = () => [['canon', at], [branch, at + now]];
const core = await recall(run, { holderId, lineage: [['canon', at]], cues: [], k: 6 });
const self = { id: holderId, name: holder.names?.[0]?.text ?? holderId, about: `What weighs most in your life so far: ${core.map((r) => r.summary).join('; ')}.` };

// A cue is any person, place or thing of the book named in the message.
const named = entities.flatMap((e) => (e.names ?? []).map((n) => [n.text, e.id])).filter(([t]) => t && t.length >= 2);
const cuesOf = (text) => [...new Set(named.filter(([t]) => text.includes(t)).map(([, id]) => id))];

let decide, speak;
if (mock) {
  decide = async (_s, qs) => qs.map((q) => ({ key: q.key, value: q.primitive === 'noul' ? 0.6 : q.options[0], confidence: 0.7 }));
  speak = async ({ prompt }) => `(mock) ${prompt.split('\n')[0]}`;
} else {
  const env = { ...process.env, ...storedKeys(process.env) };
  if (!env.WORK_LLM_API_KEY || !env.TYPESAFE_API_KEY) throw new Error('Needs the deepseek and jev keys (stored credentials or environment).');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { HttpWorkModel } = await load('dist/src/ground/connectors/workModel.js');
  const jev = jevFromEnv(env);
  decide = (state, questions) => jev.decide(state, questions);
  const http = new HttpWorkModel({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.WORK_LLM_API_KEY.trim(), model: 'deepseek-chat', timeoutMs: 60_000 });
  speak = ({ system, prompt }) => http.generate({ system, prompt, maxTokens: 200 });
}
const mind = createMind(self, {
  decide, speak, cuesOf,
  recall: async ({ cues, mood }) => (await recall(run, { holderId, lineage: lineage(), cues, mood, k: 8 })).map((r) => ({ id: r.id, summary: r.summary, score: r.score })),
});

const log = join(graphDir, `${branch}.jsonl`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`${self.name} picks up the phone (${mock ? 'mock, no spend' : 'live: Jev and the work model, paid'}). /wait lets time pass, /quit ends.`);
try {
  rl.setPrompt('you> '); rl.prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (line === '/quit') break;
    if (!line) { if (!rl.closed) rl.prompt(); continue; }
    const input = line === '/wait' ? null : { from: 'stranger', text: line };
    now++;
    const t = Date.now(), out = await mind.turn(input);
    if (out.said) console.log(`${self.name}> ${out.said}`);
    if (out.moved) console.log(`  [${out.moved}]`);
    console.log(`  surfaced: ${out.surfaced.map((u) => u.kind).join(', ') || 'nothing'} | sank: ${out.sank.map((u) => `${u.kind} ${u.salience.toFixed(2)}`).join(', ') || 'nothing'} | mood ${out.mood.valence.toFixed(2)}/${out.mood.arousal.toFixed(2)} | ${Date.now() - t} ms`);
    await appendFile(log, JSON.stringify({ turn: out.turn, input, ...out, ms: Date.now() - t }) + '\n');
    // What was said is remembered on the phone's branch, so later turns can recall it.
    if (input || out.said) {
      await indexMemories(run, [{
        id: `${branch}-${out.turn}`, holderId, branchId: branch, kind: 'episode', source: 'did', atOrder: at + now, learnedOrder: at + now,
        summaryEn: `On the phone: ${input ? `the stranger said "${input.text}"` : 'a silence'}${out.said ? `; I said "${out.said}"` : '; I said nothing'}`,
        arousal: out.mood.arousal, valence: out.mood.valence, relevance: 0.3, central: 1, confidence: 1, cues: input ? cuesOf(input.text) : [], evidence: [],
      }]);
    }
    if (!rl.closed) rl.prompt();
  }
} finally { rl.close(); await store.close(); }
