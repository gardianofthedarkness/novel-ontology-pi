// How well each way of telling a speaker by their voice does (world-engine/review/voices.mjs), measured on the lines the
// reading is sure of: five folds, each hiding a fifth's speakers and teaching the voices on the rest; fold 0 tunes the
// weights, folds 1–4 report. The candidates of a line are the people of its card (the reading's, whatever it says they do).
//
//   baselines  prior (the candidate who speaks most), alternation (the speaker two lines back in the card, else prior)
//   1 voice    character n-gram log-odds          2 lookup   nearest known lines (local embeddings)
//   1+2        both weighed                        3 exchange 1+2 decoded over each dialogue (Viterbi), known lines clamped
//   4 Jev      Jev given the line, the lines round it (quotes only, with their speakers where known) and three lines each
//              candidate said most like it (`--jev N`: N hidden lines from folds 1–4; paid, cached)
//
//   node experiments/v2/voices-eval.mjs <novel-dir> <reading>/v2/data.json [--embed http://127.0.0.1:8194/v1] [--jev 120] [--out report.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import * as V from '../../world-engine/review/voices.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { embed: { type: 'string', default: 'http://127.0.0.1:8194/v1' }, jev: { type: 'string' }, profiles: { type: 'boolean' }, out: { type: 'string' }, cache: { type: 'string' } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/voices-eval.mjs <novel-dir> <data.json> [--embed <url>] [--jev N] [--out report.json]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8')), dir = dirname(resolve(readingPath)), cacheDir = resolve(values.cache ?? join(dir, '..', 'cache-voices'));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), order = [...text.keys()], at = new Map(order.map((id, n) => [id, n]));
const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
const person = id => /^(char_|slot_)/.test(id);

// The lines: every spoken line, its words, its speaker where the reading is sure, whom it is said to; its card and candidates.
const cardOf = new Map();
for (const card of [...reading.cards].sort((a, b) => a.sentences.length - b.sentences.length)) {
  const people = (card.people ?? []).map(entry => entry?.id ?? entry).filter(person);
  if (!people.length) continue;
  for (const id of card.sentences) if (!cardOf.has(id)) cardOf.set(id, { id: card.id, people });
}
// A line's exchange is its dialogue card (the largest card holding it that has people), else its own.
const exchangeOf = new Map();
for (const card of [...reading.cards].filter(card => card.kind === 'dialogue').sort((a, b) => b.sentences.length - a.sentences.length)) for (const id of card.sentences) if (!exchangeOf.has(id)) exchangeOf.set(id, { id: card.id, people: (card.people ?? []).map(entry => entry?.id ?? entry).filter(person) });
const lines = Object.entries(reading.roles).filter(([, role]) => role.kind === 'spoken').map(([id, role]) => {
  const exchange = exchangeOf.get(id) ?? cardOf.get(id) ?? { id: `alone:${id}`, people: [] };
  return { id, quote: V.quoteOf(text.get(id)?.text ?? ''), who: role.who?.id ?? null, sure: role.who?.confidence ?? 0, guess: role.who?.id ? null : role.who?.answer ?? null, to: role.to?.id ?? (role.to?.answer && person(role.to.answer) ? role.to.answer : null), exchange: exchange.id, candidates: [...new Set(exchange.people)] };
}).sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
const known = lines.filter(line => line.who), fold = line => parseInt(createHash('sha1').update(line.id).digest('hex').slice(0, 8), 16) % 5;
console.error(`${lines.length} spoken lines, ${known.length} with a sure speaker; candidates cover the speaker in ${known.filter(line => line.candidates.includes(line.who)).length}`);

// The embeddings (local, free), cached by line.
await mkdir(cacheDir, { recursive: true });
const vectorsPath = join(cacheDir, 'vectors.json'), vectors = JSON.parse(await readFile(vectorsPath, 'utf8').catch(() => '{}'));
const missing = lines.filter(line => !vectors[line.id]);
for (let n = 0; n < missing.length; n += 64) {
  const batch = missing.slice(n, n + 64), response = await fetch(`${values.embed}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'BAAI/bge-small-zh-v1.5', input: batch.map(line => line.quote || '…') }) });
  const body = await response.json();
  body.data.forEach((entry, k) => { const v = entry.embedding, norm = Math.hypot(...v) || 1; vectors[batch[k].id] = v.map(x => x / norm); });
}
if (missing.length) await writeFile(vectorsPath, JSON.stringify(vectors));

// One fold's scores for each hidden line, by every way, with the given weights.
function runFold(f, w) {
  const train = known.filter(line => fold(line) !== f), hidden = new Set(known.filter(line => fold(line) === f).map(line => line.id));
  const voices = V.trainVoices(train), index = train.map(line => ({ who: line.who, vector: vectors[line.id] })), count = new Map();
  for (const line of train) count.set(line.who, (count.get(line.who) ?? 0) + 1);
  const knownOf = line => (hidden.has(line.id) ? null : line.who);
  const out = new Map();
  const byExchange = new Map(); for (const line of lines) (byExchange.get(line.exchange) ?? byExchange.set(line.exchange, []).get(line.exchange)).push(line);
  const scoreLine = (line, candidates) => {
    const voice = V.normalised(V.voiceScores(voices, line.quote, candidates), w.tv), lookup = V.normalised(V.lookupScores(index, vectors[line.id], candidates, { k: w.k }), w.tl);
    const both = V.combined([{ scores: voice, weight: w.wv }, { scores: lookup, weight: 1 }, { scores: V.priorScores(voices, candidates), weight: w.wp }]);
    return { line, candidates, voice, lookup, both };
  };
  const groups = [...byExchange.values()], scoredOf = groups.map(group => group.map(line => scoreLine(line, line.candidates.length ? line.candidates : [...count.keys()])));
  const decode = (rows, { to = true, bonus = null } = {}) => V.decodeExchange(rows.map(({ line, both }) => ({ scores: V.normalised(bonus ? V.combined([{ scores: both }, { scores: Object.fromEntries(Object.keys(both).map(who => [who, bonus.has(who) ? w.recency : 0])) }]) : both), known: knownOf(line), ...(to ? { to: line.to } : {}) })), { stay: Math.log(w.stay) });
  groups.forEach((group, g) => {
    const scored = scoredOf[g], decoded = decode(scored), decodedBare = decode(scored, { to: false });
    // The two neighbouring conversations (the one before, the one after, in reading order).
    const before = scoredOf[g - 1] ?? [], after = scoredOf[g + 1] ?? [];
    const window = decode([...before, ...scored, ...after]).slice(before.length, before.length + scored.length);
    const union = [...new Set([...before, ...scored, ...after].flatMap(row => row.candidates))];
    const unionRows = [...before, ...scored, ...after].map(row => scoreLine(row.line, union)), windowUnion = decode(unionRows).slice(before.length, before.length + scored.length);
    const recent = new Set([...before, ...after].map(row => knownOf(row.line)).filter(Boolean)), recency = decode(scored, { bonus: recent });
    scored.forEach(({ line, candidates, voice, lookup, both }, n) => {
      if (!hidden.has(line.id)) return;
      const prior = candidates.reduce((best, who) => ((count.get(who) ?? 0) > (count.get(best) ?? -1) ? who : best), candidates[0]);
      const twoBack = group.slice(0, n).filter(other => knownOf(other)).at(-2), alternation = twoBack && candidates.includes(twoBack.who) ? twoBack.who : prior;
      out.set(line.id, { prior, alternation, voice: V.pick(voice).who, lookup: V.pick(lookup).who, both: V.pick(both).who, margin: V.pick(both).margin, exchange: decoded[n], exchangeNoAddressee: decodedBare[n], window3: window[n], window3Union: windowUnion[n], recency: recency[n], candidates, voices, index, lookupScores: lookup });
    });
  });
  return out;
}
const WAYS = ['prior', 'alternation', 'voice', 'lookup', 'both', 'exchange', 'exchangeNoAddressee', 'window3', 'window3Union', 'recency'];
const score = (results, filter = () => true) => { const rows = known.filter(line => results.has(line.id) && filter(line)); return { n: rows.length, ...Object.fromEntries(WAYS.map(way => [way, Math.round(1000 * rows.filter(line => results.get(line.id)[way] === line.who).length / Math.max(1, rows.length)) / 10])) }; };

// Tuning on fold 0.
let best = null;
for (const tv of [0.5, 1, 2]) for (const tl of [0.5, 1, 2]) for (const wv of [0.5, 1, 2]) for (const wp of [0, 0.5, 1]) for (const stay of [0.15, 0.3]) for (const k of [8, 20]) {
  const w = { tv, tl, wv, wp, stay, k, recency: Math.log(2) }, s = score(runFold(0, w)), value = s.exchange + s.both;
  if (!best || value > best.value) best = { w, value, s };
}
// The neighbours' boost tuned after, on fold 0 too.
for (const recency of [Math.log(1.5), Math.log(3), Math.log(5)]) { const w = { ...best.w, recency }, s = score(runFold(0, w)); if (s.recency > best.s.recency) best = { ...best, w, s }; }
console.error('tuned on fold 0:', JSON.stringify(best.w), JSON.stringify(best.s));
const results = new Map(); for (const f of [1, 2, 3, 4]) for (const [id, entry] of runFold(f, best.w)) results.set(id, entry);
const report = { lines: lines.length, known: known.length, weights: best.w, covered: Math.round(1000 * known.filter(line => line.candidates.includes(line.who)).length / known.length) / 10,
  all: score(results), covered_only: score(results, line => line.candidates.includes(line.who)), surest: score(results, line => line.sure >= 0.8), twoOrMore: score(results, line => line.candidates.length >= 2 && line.candidates.includes(line.who)) };

// 4 · Jev with exemplars, on a sample of the hidden lines of folds 1–4 that have two or more candidates.
if (values.jev) {
  const want = Number(values.jev), sample = known.filter(line => results.has(line.id) && line.candidates.length >= 2).sort((a, b) => createHash('sha1').update(a.id).digest('hex').localeCompare(createHash('sha1').update(b.id).digest('hex'))).slice(0, want);
  const { ask } = await load('dist/src/v2/context/engine.js'), { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  let paid = 0;
  const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, join(cacheDir, 'jev'));
  const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
  const mode = { name: 'voices', task: 'Lines of dialogue from a light novel. For each line, say which of the candidates says it, judging by how each of them talks: the three lines of each candidate most like it are given, and the quoted lines round it (with their speaker where known). The narration is left out on purpose.', definitions: () => ({}), sources: [{ name: 'lines', key: 'lines', quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) }], cutOrder: [], questions: focus => focus.questions, budget: 120_000 };
  const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
  const exemplars = (line, who) => { const entry = results.get(line.id), v = vectors[line.id]; return entry.index.filter(item => item.who === who).map(item => ({ item, sim: item.vector.reduce((s, x, k) => s + x * v[k], 0) })).sort((a, b) => b.sim - a.sim).slice(0, 3).map(({ item }) => item); };
  const quoteById = new Map(lines.map(line => [line.id, line])), vectorKey = new Map(lines.map(line => [vectors[line.id], line.id]));
  // Voice profiles (the user, 2026-11-05: "ask a llm to summarize each characters profile and add that into the context"):
  // the work model writes how each candidate talks from their known lines of that fold only (never the hidden ones).
  const variants = values.profiles ? ['jev', 'jevProfiles', 'jevProfilesOnly'] : ['jev'], profiles = new Map();
  if (values.profiles) {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    const work = cachedWork(workModelFromEnv(process.env), join(cacheDir, 'profiles'));
    let tokens = { prompt: 0, completion: 0, requests: 0 };
    const wanted = new Set(sample.flatMap(line => line.candidates.map(who => `${fold(line)}|${who}`)));
    for (const entry of wanted) {
      const [f, who] = [Number(entry.split('|')[0]), entry.split('|')[1]], own = known.filter(line => fold(line) !== f && line.who === who);
      if (own.length < 3) { profiles.set(entry, `few lines known (${own.length})`); continue; }
      // Up to 80 of their lines, spread over the volume.
      const step = Math.max(1, Math.floor(own.length / 80)), picked = own.filter((_, k) => k % step === 0).slice(0, 80);
      const prompt = `Character: ${names.get(who) ?? who}\nTheir lines of dialogue (one per line):\n${picked.map(line => line.quote).join('\n')}\n\nDescribe how this character talks, so that a reader could tell a new line of theirs from other characters' lines: how they refer to themselves, how they address each other person (names, titles, nicknames), how their sentences end (particles, tone), their register and politeness, verbal tics and catchphrases, what they typically talk about. Quote short examples in the original language. At most 150 words.`;
      const result = await work.generateWithUsage({ system: 'You are a careful literary analyst of character voice.', prompt, maxTokens: 400 });
      profiles.set(entry, result.content.trim());
      if (!result.cached) { tokens.requests++; tokens.prompt += result.usage?.promptTokens ?? 0; tokens.completion += result.usage?.completionTokens ?? 0; }
    }
    report.profiles = { written: profiles.size, ...tokens, usd: Math.round(((tokens.prompt * 0.27 + tokens.completion * 1.1) / 1e6) * 10000) / 10000 };
    console.error(`profiles: ${profiles.size} (${tokens.requests} requests)`);
  }
  const profileOf = (f, who) => profiles.get(`${f}|${who}`) ?? 'no profile';
  const profileMode = { ...mode, name: 'voices-profiles', task: 'Lines of dialogue from a light novel. For each line, say which of the candidates says it, judging by how each of them talks: a profile of each candidate\'s voice is given (written from their other lines), and, where given, the three lines of each candidate most like it, and the quoted lines round it (with their speaker where known). The narration is left out on purpose.' };
  for (const variant of variants) for (let n = 0; n < sample.length; n += 6) {
    const batch = sample.slice(n, n + 6), key = k => `line_${n + k + 1}`;
    const items = batch.map((line, k) => {
      const group = lines.filter(other => other.exchange === line.exchange), i = group.indexOf(line), round = [...group.slice(Math.max(0, i - 2), i), ...group.slice(i + 1, i + 3)];
      const said = { line: clip(line.quote, 200), round: round.map(other => `${results.has(other.id) || !other.who ? '?' : names.get(other.who) ?? other.who}: ${clip(other.quote, 120)}`), candidates: Object.fromEntries(line.candidates.map(who => [names.get(who) ?? who, exemplars(line, who).map(item => clip(quoteById.get(vectorKey.get(item.vector))?.quote ?? '', 100))])) };
      if (variant === 'jevProfilesOnly') delete said.candidates;
      if (variant !== 'jev') said.profiles = Object.fromEntries(line.candidates.map(who => [names.get(who) ?? who, profileOf(fold(line), who)]));
      return [key(k), said];
    });
    const questions = batch.map((line, k) => ({ key: `who:${n + k}`, primitive: 'choice', instructions: `Who says lines.${key(k)}?`, options: line.candidates, optionHints: Object.fromEntries(line.candidates.map(who => [who, names.get(who) ?? who])) }));
    const { replies } = await ask(decide, variant === 'jev' ? mode : profileMode, { items, questions }, null);
    batch.forEach((line, k) => { const reply = replies.find(entry => entry.key === `who:${n + k}`); results.get(line.id)[variant] = reply?.value ?? null; });
    console.error(`${variant}: ${Math.min(n + 6, sample.length)} of ${sample.length}`);
  }
  const ids = new Set(sample.map(line => line.id));
  WAYS.push(...variants);
  report.jevSample = { paid, ...score(results, line => ids.has(line.id)) };
  // Hybrids: the exchange's pick, with Jev's where the exchange is unsure (it and the line's own scores disagree, or the
  // line's own margin is small), or the majority of the three.
  const rows = sample.map(line => { const entry = results.get(line.id); return { id: line.id, who: line.who, exchange: entry.exchange, jev: entry.jev, jevProfiles: entry.jevProfiles, jevProfilesOnly: entry.jevProfilesOnly, both: entry.both, margin: Math.round(entry.margin * 100) / 100 }; });
  const rate = choose => Math.round(1000 * rows.filter(row => choose(row) === row.who).length / rows.length) / 10;
  report.hybrids = {
    exchangeElseJevWhereDisagree: rate(row => (row.exchange === row.both ? row.exchange : row.jev ?? row.exchange)),
    ...Object.fromEntries([0.5, 1, 2].map(m => [`exchangeElseJevUnderMargin${m}`, rate(row => (row.margin >= m ? row.exchange : row.jev ?? row.exchange))])),
    majority: rate(row => ([row.jev, row.both].filter(other => other === row.exchange).length >= 1 ? row.exchange : row.jev === row.both ? row.jev : row.exchange)),
    ...(values.profiles ? { exchangeElseProfilesWhereDisagree: rate(row => (row.exchange === row.both ? row.exchange : row.jevProfiles ?? row.exchange)), exchangeElseProfilesUnderMargin1: rate(row => (row.margin >= 1 ? row.exchange : row.jevProfiles ?? row.exchange)), majorityOfExchangeJevProfiles: rate(row => (row.exchange === row.jev || row.exchange === row.jevProfiles ? row.exchange : row.jev === row.jevProfiles ? row.jev : row.exchange)) } : {}),
    sentToJev: { disagree: rows.filter(row => row.exchange !== row.both).length, under1: rows.filter(row => row.margin < 1).length, of: rows.length },
  };
  report.jevRows = rows;
}

// What the best free way would settle among the lines the reading was unsure of (no answer to check: its margin, and how
// often it agrees with Jev's own unsure guess).
console.log(JSON.stringify(report, null, 1));
if (values.out) await writeFile(resolve(values.out), JSON.stringify(report, null, 1));
