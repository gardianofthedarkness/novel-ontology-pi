// Who says the lines the reading was unsure of, by their voices (engine/review/voices.mjs decodeLines): the whole
// volume decoded conversation by conversation, every line the reading is sure of clamped and teaching the voices, with the
// weights and the window voices-eval.mjs measured best. Free (local embeddings). Writes <reading>/v2/voices.json; the
// world's speaker settling (speakers.mjs) reads it.
//
//   node engine/review/run/voices.mjs <novel-dir> <reading>/v2/data.json [--embed http://127.0.0.1:8194/v1] [--window 1|3] [--recency]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as V from '../voices.mjs';

/** The weights voices-eval.mjs tuned on volume 1 (fold 0), and the window it measured best. */
export const WEIGHTS = { tv: 1, tl: 2, wv: 0.5, wp: 0, stay: 0.3, k: 20, recency: Math.log(2) };

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { embed: { type: 'string', default: 'http://127.0.0.1:8194/v1' }, window: { type: 'string', default: '1' }, recency: { type: 'boolean' }, cache: { type: 'string' } } });
if (!novelDir || !readingPath) { console.error('usage: node engine/review/run/voices.mjs <novel-dir> <data.json> [--embed <url>] [--window 1|3] [--recency]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8')), dir = dirname(resolve(readingPath)), cacheDir = resolve(values.cache ?? join(dir, '..', 'cache-voices'));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), order = [...text.keys()], at = new Map(order.map((id, n) => [id, n]));
const person = id => /^(char_|slot_)/.test(id);

// The lines, as voices-eval.mjs builds them: each spoken line's words, its sure speaker, whom it is said to, its
// conversation (its dialogue card) and candidates (the card's people).
const peopleOf = card => [...new Set((card.people ?? []).map(entry => entry?.id ?? entry).filter(person))];
const cardOf = new Map(), exchangeOf = new Map();
for (const card of [...reading.cards].sort((a, b) => a.sentences.length - b.sentences.length)) { if (!peopleOf(card).length) continue; for (const id of card.sentences) if (!cardOf.has(id)) cardOf.set(id, { id: card.id, people: peopleOf(card) }); }
for (const card of [...reading.cards].filter(card => card.kind === 'dialogue').sort((a, b) => b.sentences.length - a.sentences.length)) for (const id of card.sentences) if (!exchangeOf.has(id)) exchangeOf.set(id, { id: card.id, people: peopleOf(card) });
const lines = Object.entries(reading.roles).filter(([, role]) => role.kind === 'spoken').map(([id, role]) => {
  const exchange = exchangeOf.get(id) ?? cardOf.get(id) ?? { id: `alone:${id}`, people: [] };
  return { id, quote: V.quoteOf(text.get(id)?.text ?? ''), who: role.who?.id ?? null, guess: role.who?.id ? null : role.who?.answer ?? null, guessSure: role.who?.confidence ?? 0, to: role.to?.id ?? (role.to?.answer && person(role.to.answer) ? role.to.answer : null), exchange: exchange.id, candidates: exchange.people };
}).sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));

// The embeddings (local), cached by line as voices-eval.mjs caches them.
await mkdir(cacheDir, { recursive: true });
const vectorsPath = join(cacheDir, 'vectors.json'), vectors = JSON.parse(await readFile(vectorsPath, 'utf8').catch(() => '{}'));
const missing = lines.filter(line => !vectors[line.id]);
for (let n = 0; n < missing.length; n += 64) {
  const batch = missing.slice(n, n + 64), body = await (await fetch(`${values.embed}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'BAAI/bge-small-zh-v1.5', input: batch.map(line => line.quote || '…') }) })).json();
  body.data.forEach((entry, k) => { const v = entry.embedding, norm = Math.hypot(...v) || 1; vectors[batch[k].id] = v.map(x => x / norm); });
}
if (missing.length) await writeFile(vectorsPath, JSON.stringify(vectors));

const window = Number(values.window) === 3 ? 3 : 1, picks = V.decodeLines({ lines, vectorOf: id => vectors[id], w: WEIGHTS, window, recency: !!values.recency });
const byLine = new Map(lines.map(line => [line.id, line])), out = {};
let agree = 0, differ = 0, noGuess = 0;
for (const [id, entry] of picks) {
  const line = byLine.get(id), guess = line.guess && line.guess !== 'none' ? line.guess : null;
  if (!guess) noGuess++; else if (guess === entry.who) agree++; else differ++;
  out[id] = { ...entry, guess, guessSure: line.guessSure };
}
const file = { version: 1, at: new Date().toISOString(), by: 'exchange decoding (engine/review/voices.mjs)', weights: WEIGHTS, window, recency: !!values.recency, measured: 'voices-eval.mjs on the sure lines', lines: out };
await writeFile(join(dir, 'voices.json'), JSON.stringify(file, null, 1));
console.log(JSON.stringify({ decided: picks.size, agreesWithJevGuess: agree, differs: differ, jevGuessedNone: noGuess }));
