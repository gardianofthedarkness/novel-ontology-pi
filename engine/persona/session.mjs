// One phone call with a character (docs/v3/design.html §10.2), shared by the terminal (phone.mjs) and the web console
// (web.mjs): a person of the world's one cast at a point in its story, the world's memory graph (engine/memory/
// universe.mjs: every book's memories, by person, on one story order), the models, and the mind. Each turn is logged
// and what was said is remembered on the call's own branch, never in the books' canon. The graph and the call logs stay
// in the library, private.
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storedKeys } from '../volume/credentials.mjs';
import { universeGraph, storyPoint, findPerson } from '../memory/universe.mjs';
import { createMind } from './mind.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const USAGE = 'Needs <library> --person <person id or a name> --at <book>[:<scene>] [--mock]';

/** Command-line options shared by the channels. --at vol-6 is the end of volume 6; vol-6:120 its 120th scene. */
export function phoneArgs(argv) {
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const library = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  if (!library || !opt('person') || !opt('at')) throw new Error(USAGE);
  return { library: resolve(library), person: opt('person'), at: opt('at'), mock: argv.includes('--mock'), opt };
}

export async function openPhone({ library, person, at: point, mock }) {
  const { recall, indexMemories } = await load('dist/src/ground/ontology/memory.js');
  const u = await universeGraph(library), run = u.run;
  const who = findPerson(u, person), holderId = who.id, at = storyPoint(u.books, point);

  // Who they are: their name, and what weighs most in their memories by this point (recalled with no cue).
  const branch = `phone-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  let now = 0;
  const lineage = () => [['canon', at], [branch, at + now]];
  const core = await recall(run, { holderId, lineage: [['canon', at]], cues: [], k: 6 });
  const self = { id: holderId, name: who.name, about: `What weighs most in your life so far: ${core.map((r) => r.summary).join('; ') || 'nothing you can name'}.` };

  const spend = { jev: 0, text: 0 };
  let decide, speak;
  if (mock) {
    decide = async (_s, qs) => qs.map((q) => ({ key: q.key, value: q.primitive === 'noul' ? 0.6 : q.options[0], confidence: 0.7 }));
    speak = async ({ prompt }) => `(mock) ${prompt.split('\n')[0]}`;
  } else {
    const env = { JEV_MODEL: 'jev-1.14.0', ...process.env, ...storedKeys(process.env) };
    if (!env.WORK_LLM_API_KEY || !env.TYPESAFE_API_KEY) throw new Error('Needs the deepseek and jev keys (stored credentials or environment).');
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { HttpWorkModel } = await load('dist/src/ground/connectors/workModel.js');
    const jev = jevFromEnv(env);
    decide = (state, questions) => { spend.jev++; return jev.decide(state, questions); };
    const http = new HttpWorkModel({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.WORK_LLM_API_KEY.trim(), model: 'deepseek-chat', timeoutMs: 60_000 });
    speak = ({ system, prompt }) => { spend.text++; return http.generate({ system, prompt, maxTokens: 200 }); };
  }
  const mind = createMind(self, {
    decide, speak, cuesOf: u.cuesOf, nameOf: u.nameOf,
    // Every part of the score comes along, for the trace: when, how known, retention, importance, cue, tag, the book.
    recall: async ({ cues, mood }) => (await recall(run, { holderId, lineage: lineage(), cues, mood, k: 8 })).map((r) => ({ ...r, book: bookAt(r.at) })),
  });
  const bookAt = (order) => u.books.findLast((b) => order > b.offset)?.book ?? null;

  const logs = join(u.library, 'universe', 'phone');
  await mkdir(logs, { recursive: true });
  const log = join(logs, `${branch}.jsonl`);
  let queue = Promise.resolve();
  /** One turn: input { from, text } or null (time passes). Turns run one at a time, in the order they come. */
  const send = (input) => (queue = queue.then(() => turn(input), () => turn(input)));
  async function turn(input) {
    now++;
    const t = Date.now(), out = await mind.turn(input);
    const result = { ...out, ms: Date.now() - t, spend: { ...spend } };
    await appendFile(log, JSON.stringify({ person: holderId, at: point, input, ...result }) + '\n');
    if (input || out.said) {
      await indexMemories(run, [{
        id: `${branch}-${out.turn}`, holderId, branchId: branch, kind: 'episode', source: 'did', atOrder: at + now, learnedOrder: at + now,
        summaryEn: `On the phone: ${input ? `the stranger said "${input.text}"` : 'a silence'}${out.said ? `; I said "${out.said}"` : '; I said nothing'}`,
        arousal: out.mood.arousal, valence: out.mood.valence, relevance: 0.3, central: 1, confidence: 1, cues: input ? u.cuesOf(input.text) : [], evidence: [],
      }]);
    }
    return result;
  }
  return { self, branch, mock, at: point, memories: u.memories.filter((m) => m.holderId === holderId && m.learnedOrder <= at).length, send, close: () => u.close() };
}
