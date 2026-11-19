// A character on the phone (docs/v3/design.html §10.2), shared by the terminal (phone.mjs) and the web console (web.mjs).
// The world is opened once: a person of the world's one cast at a point of its story, the world's memory graph
// (engine/memory/universe.mjs: every book's memories, by person, one story clock), the person's two cards (cards.mjs: who
// they are; where they are now) and the models. Each call is its own (one per visitor of the web page): its own mind
// and conversation, and what is said is remembered on the call's own branch, never in the books' canon. The graph, the
// cards and the call logs stay in the library, private.
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { storedKeys } from '../volume/credentials.mjs';
import { universeGraph, storyPoint, storyDay, findPerson, TIME_WEIGHTS } from '../memory/universe.mjs';
import { characterCard, presentCard, cardText, presentText } from './cards.mjs';
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

/** The models: Jev for the faculties and the stem, the work model for the cards and the action faculty's steps. */
async function modelsOf(mock) {
  const spend = { jev: 0, text: 0 };
  if (mock) {
    let n = 0;
    return {
      spend,
      decide: async (_s, qs) => qs.map((q) => ({ key: q.key, value: q.primitive === 'noul' ? 0.6 : q.options[0], confidence: 0.7 })),
      // A mock that looks, then sends what it wanted to do.
      act: async ({ prompt }) => JSON.stringify(/No steps yet/.test(prompt) ? { tool: 'look', args: {} } : { tool: 'send', args: { text: `(mock ${++n}) ${prompt.split('\n')[0]}` } }),
      generate: async () => JSON.stringify({ name: 'mock', who: 'a mock person', where: 'somewhere', when: 'now', justHappened: 'nothing' }),
    };
  }
  const env = { JEV_MODEL: 'jev-1.14.0', ...process.env, ...storedKeys(process.env) };
  if (!env.WORK_LLM_API_KEY || !env.TYPESAFE_API_KEY) throw new Error('Needs the deepseek and jev keys (stored credentials or environment).');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { HttpWorkModel } = await load('dist/src/ground/connectors/workModel.js');
  const jev = jevFromEnv(env);
  const http = new HttpWorkModel({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.WORK_LLM_API_KEY.trim(), model: 'deepseek-chat', timeoutMs: 90_000 });
  return {
    spend,
    decide: (state, questions) => { spend.jev++; return jev.decide(state, questions); },
    act: ({ system, prompt }) => { spend.text++; return http.generate({ system, prompt, jsonSchema: { type: 'object' }, maxTokens: 400 }); },
    generate: ({ system, prompt }) => { spend.text++; return http.generate({ system, prompt, jsonSchema: { type: 'object' }, maxTokens: 2000 }); },
  };
}

export async function openWorld({ library, person, at: point, mock }) {
  const { recall, indexMemories, DEFAULT_RECALL_WEIGHTS } = await load('dist/src/ground/ontology/memory.js');
  const u = await universeGraph(library), run = u.run, models = await modelsOf(mock);
  const who = findPerson(u, person), holderId = who.id, at = storyPoint(u.books, point), day = storyDay(u.books, at);
  const weights = { ...DEFAULT_RECALL_WEIGHTS, ...TIME_WEIGHTS };
  const card = await characterCard(u, holderId, at, point, models.generate), present = await presentCard(u, holderId, at, point, models.generate);
  const self = { id: holderId, name: who.name, card: cardText({ name: who.name, ...card }), present: presentText(present) };
  const bookAt = (order) => u.books.findLast((b) => order > b.offset)?.book ?? null;
  const logs = join(u.library, 'universe', 'phone');
  await mkdir(logs, { recursive: true });

  /** A call of its own: its own mind, conversation and branch. */
  function newCall() {
    const branch = `phone-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    let now = 0;
    const lineage = () => [['canon', at], [branch, at + now]];
    const time = () => day + now / 1440; // a call's turns are a minute apart in story time
    const mind = createMind(self, {
      decide: models.decide, act: models.act, cuesOf: u.cuesOf, nameOf: u.nameOf,
      // Every part of the score comes along, for the trace: when, how known, retention, importance, cue, tag, the book.
      recall: async ({ cues, mood }) => (await recall(run, { holderId, lineage: lineage(), cues, mood, k: 8, weights, nowTime: time() })).map((r) => ({ ...r, book: bookAt(r.at) })),
    });
    const log = join(logs, `${branch}.jsonl`);
    let queue = Promise.resolve();
    async function turn(input) {
      now++;
      const t = Date.now(), out = await mind.turn(input);
      const result = { ...out, ms: Date.now() - t, spend: { ...models.spend } };
      await appendFile(log, JSON.stringify({ person: holderId, at: point, input, ...result }) + '\n');
      if (input || out.said) {
        await indexMemories(run, [{
          id: `${branch}-${out.turn}`, holderId, branchId: branch, kind: 'episode', source: 'did', atOrder: at + now, learnedOrder: at + now, learnedTime: time(),
          summaryEn: `On the phone: ${input ? `the stranger said "${input.text}"` : 'a silence'}${out.said ? `; I said "${out.said}"` : '; I said nothing'}`,
          arousal: out.mood.arousal, valence: out.mood.valence, relevance: 0.3, central: 1, confidence: 1, cues: input ? u.cuesOf(input.text) : [], evidence: [],
        }]);
      }
      return result;
    }
    /** One turn: input { from, text } or null (time passes). Turns run one at a time, in the order they come. */
    const send = (input) => (queue = queue.then(() => turn(input), () => turn(input)));
    return { branch, send };
  }
  return { self, mock, at: point, cards: { character: card, present }, newCall, close: () => u.close() };
}

/** One world and one call (the terminal). */
export async function openPhone(options) {
  const world = await openWorld(options), call = world.newCall();
  return { ...world, branch: call.branch, send: call.send };
}
