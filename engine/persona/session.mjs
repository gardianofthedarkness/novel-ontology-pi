// One phone call with a character (docs/v3/design.html §10.2), shared by the terminal (phone.mjs) and the web console
// (web.mjs): the book's memory graph, the character at a point in the story, the models, and the mind. Each turn is
// logged and what was said is remembered on the call's own branch, never in the book's canon.
// The graph (a cache, rebuilt from the bundle when missing) and the call log stay beside the volume, private.
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storedKeys } from '../volume/credentials.mjs';
import { createMind } from './mind.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const lines = async (f) => (await readFile(f, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** Command-line options shared by the channels: <volume> --holder <id> --at <scene order> [--graph <folder>] [--mock]. */
export function phoneArgs(argv) {
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const volume = resolve(argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))) ?? '.');
  const holderId = opt('holder'), at = Number(opt('at'));
  if (!holderId || !Number.isFinite(at)) throw new Error('Needs <volume> --holder <id> --at <scene order> [--graph <folder>] [--mock]');
  return { volume, holderId, at, graphDir: resolve(opt('graph') ?? join(volume, 'memory-graph')), mock: argv.includes('--mock'), opt };
}

export async function openPhone({ volume, holderId, at, graphDir, mock }) {
  const ontology = join(volume, 'novel', 'ontology');
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

  const spend = { jev: 0, text: 0 };
  let decide, speak;
  if (mock) {
    decide = async (_s, qs) => qs.map((q) => ({ key: q.key, value: q.primitive === 'noul' ? 0.6 : q.options[0], confidence: 0.7 }));
    speak = async ({ prompt }) => `(mock) ${prompt.split('\n')[0]}`;
  } else {
    const env = { ...process.env, ...storedKeys(process.env) };
    if (!env.WORK_LLM_API_KEY || !env.TYPESAFE_API_KEY) throw new Error('Needs the deepseek and jev keys (stored credentials or environment).');
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { HttpWorkModel } = await load('dist/src/ground/connectors/workModel.js');
    const jev = jevFromEnv(env);
    decide = (state, questions) => { spend.jev++; return jev.decide(state, questions); };
    const http = new HttpWorkModel({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.WORK_LLM_API_KEY.trim(), model: 'deepseek-chat', timeoutMs: 60_000 });
    speak = ({ system, prompt }) => { spend.text++; return http.generate({ system, prompt, maxTokens: 200 }); };
  }
  const mind = createMind(self, {
    decide, speak, cuesOf,
    recall: async ({ cues, mood }) => (await recall(run, { holderId, lineage: lineage(), cues, mood, k: 8 })).map((r) => ({ id: r.id, summary: r.summary, score: r.score })),
  });

  const log = join(graphDir, `${branch}.jsonl`);
  let queue = Promise.resolve();
  /** One turn: input { from, text } or null (time passes). Turns run one at a time, in the order they come. */
  const send = (input) => (queue = queue.then(() => turn(input), () => turn(input)));
  async function turn(input) {
    now++;
    const t = Date.now(), out = await mind.turn(input);
    const result = { ...out, ms: Date.now() - t, spend: { ...spend } };
    await appendFile(log, JSON.stringify({ input, ...result }) + '\n');
    if (input || out.said) {
      await indexMemories(run, [{
        id: `${branch}-${out.turn}`, holderId, branchId: branch, kind: 'episode', source: 'did', atOrder: at + now, learnedOrder: at + now,
        summaryEn: `On the phone: ${input ? `the stranger said "${input.text}"` : 'a silence'}${out.said ? `; I said "${out.said}"` : '; I said nothing'}`,
        arousal: out.mood.arousal, valence: out.mood.valence, relevance: 0.3, central: 1, confidence: 1, cues: input ? cuesOf(input.text) : [], evidence: [],
      }]);
    }
    return result;
  }
  return { self, branch, mock, send, close: () => store.close() };
}
