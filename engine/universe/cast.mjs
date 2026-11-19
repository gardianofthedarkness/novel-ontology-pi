// The universe cast: one list of people for a whole world library (docs/v3/design.html#universal-em, brought into
// v3; the user, 2026-11-19: "This needs to be unified first"). Each book keeps its own character ids (its reading and
// stage are built on them); who a character IS lives here, as a person (p_0001...) with every name form any book gave
// them and the book records that are them. What crosses books (memory, the bot, strands carried to the next book) goes
// through the person.
//
// Books are added in the job's order. For each character of the book that is in its story (present or named in a scene
// that is not paratext, engine/reading/paratext.mjs):
//   candidates   the people already in the cast who share any run of two or more characters with one of its names
//                (a name and its misprint; a full name and a title with the family name in it): a structural test, no lists of words.
//   decision     Jev, one batch of pair checks (v1's checkPairs): both sides' names, where they are, a few lines where
//                they act. Same at SAME_AT or above, and not shown to be two people: the same person. Between REVIEW_AT
//                and SAME_AT: a new person, with the likely match listed for review. Below: a new person.
//   in a book    the book's own new people are then checked against each other the same way (one person under two
//                records in one book).
// Paid: one Jev call per PAIRS_PER_CALL pairs, cached beside the universe.
//
//   node engine/universe/cast.mjs <library> [--books vol-1,vol-2] [--dry]
//   node engine/universe/cast.mjs <library> --show [<name or id>]
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { storedKeys } from '../volume/credentials.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = (path) => import(pathToFileURL(join(repository, path)).href);
export const SAME_AT = 0.9, REVIEW_AT = 0.6, DISTINCT_BELOW = 0.5, PAIRS_PER_CALL = 8, PASSAGES = 3;
const lines = async (file) => existsSync(file) ? (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** Every run of two or more characters in a name (CJK), or its words (other scripts). */
export function grams(text) {
  const t = String(text).replace(/[\s\u00b7\u30fb\uff0e.,\uff0c\u3001()\uff08\uff09\u300c\u300d\u300e\u300f\-\u2500\uff0d\u2014]+/g, ' ').trim(), out = new Set();
  for (const part of t.split(' ').filter(Boolean)) {
    if (/^[\x00-\x7f]+$/.test(part)) { if (part.length >= 3) out.add(part.toLowerCase()); continue; }
    for (let i = 0; i < part.length - 1; i++) out.add(part.slice(i, i + 2));
  }
  return out;
}
export const overlaps = (formsA, formsB) => { const a = new Set(formsA.flatMap((f) => [...grams(f)])); return formsB.some((f) => [...grams(f)].some((g) => a.has(g))); };
export const labelOf = (forms) => [...forms].sort((x, y) => y.length - x.length || x.localeCompare(y))[0] ?? '?';

/** A book's characters in its story, each with its names and a few lines where it is present and named. */
export async function bookCharacters(library, book) {
  const novel = join(library, book, 'novel'), reading = join(library, book, 'reading');
  const entities = latest(await lines(join(novel, 'ontology', 'entities.jsonl'))).filter((e) => e.kind === 'Character');
  const scenes = latest(await lines(join(novel, 'ontology', 'scenes.jsonl')));
  const paratext = new Set(existsSync(join(reading, 'paratext.json')) ? JSON.parse(await readFile(join(reading, 'paratext.json'), 'utf8')).paratext : []);
  const story = scenes.filter((s) => !paratext.has(s.id));
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const text = await loadWorkspaceSentences(novel), line = (id) => text.get(id)?.text ?? '';
  const out = [];
  for (const e of entities) {
    const forms = [...new Set((e.names ?? []).map((n) => n.text).filter(Boolean))];
    const present = story.filter((s) => (s.charactersPresent ?? []).includes(e.id)), named = story.filter((s) => (s.charactersMentioned ?? []).includes(e.id));
    if (!present.length && !named.length) { out.push({ book, entity: e.id, forms, inStory: false }); continue; }
    const passages = [];
    for (const s of [...present, ...named]) {
      for (const id of s.sentenceIds ?? []) { const l = line(id); if (forms.some((f) => l.includes(f)) && l.length > 6) { passages.push(l.length > 140 ? `${l.slice(0, 139)}…` : l); break; } }
      if (passages.length >= PASSAGES) break;
    }
    out.push({ book, entity: e.id, forms, inStory: true, scenes: present.length, named: named.length, passages });
  }
  return out;
}

const dossier = (side) => ({ label: labelOf(side.forms), forms: side.forms, where: side.where, passages: side.passages ?? [] });
const sideOfCharacter = (c) => ({ forms: c.forms, where: `${c.book}: present in ${c.scenes} scenes, named in ${c.named}`, passages: c.passages });
const sideOfPerson = (p) => { const last = p.members.at(-1); return { forms: p.forms, where: `${p.members.map((m) => m.book).join(', ')} (last: ${last.book})`, passages: p.passages ?? [] }; };

/** Pairs to Jev in batches; each verdict { same, distinct }. */
async function judge(jev, pairs) {
  const { checkPairs } = await load('dist/src/universe/identity/em.js');
  const out = [];
  for (let n = 0; n < pairs.length; n += PAIRS_PER_CALL) out.push(...await checkPairs(jev, pairs.slice(n, n + PAIRS_PER_CALL).map(({ a, b }) => ({ a: dossier(a), b: dossier(b) }))));
  return out;
}
// One side's full name (its longest form) being exactly a name of the other is evidence of its own (v1's rule: a full name
// is the person); then REVIEW_AT is enough. A short shared form (a family name, which a person's relatives and look-alikes
// share too) is not: it needs SAME_AT. Measured on volumes 1-6: Jev gave identical full names 0.77-0.89, never 0.9.
export const fullNameShared = (a, b) => b.forms.includes(labelOf(a.forms)) || a.forms.includes(labelOf(b.forms));
const verdictOf = (v, full = false) => (v.distinct < DISTINCT_BELOW && v.same >= (full ? REVIEW_AT : SAME_AT) ? 'same' : v.same >= REVIEW_AT ? 'review' : 'different');

export async function addBooks(libraryDir, { books: only = null, dry = false, jev = null } = {}) {
  const library = resolve(libraryDir), file = join(library, 'universe', 'cast.json');
  const cast = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { version: 1, by: 'engine/universe/cast.mjs', books: [], persons: [], decisions: [], review: [], outside: [] };
  const job = JSON.parse(await readFile(join(library, 'job.json'), 'utf8'));
  const order = job.volumes.map((v) => dirname(resolve(v.workspace)).split(/[\\/]/).at(-1));
  const todo = order.filter((b) => !cast.books.includes(b) && (!only || only.includes(b)) && existsSync(join(library, b, 'novel', 'ontology', 'entities.jsonl')));
  const report = [];
  let nextId = Math.max(0, ...cast.persons.map((p) => Number(p.id.slice(2)))) + 1;
  const newPerson = (c) => { const p = { id: `p_${String(nextId++).padStart(4, '0')}`, label: labelOf(c.forms), forms: [...c.forms], members: [{ book: c.book, entity: c.entity }], passages: c.passages }; cast.persons.push(p); return p; };
  const join2 = (p, c) => { p.members.push({ book: c.book, entity: c.entity }); p.forms = [...new Set([...p.forms, ...c.forms])]; p.label = labelOf(p.forms); if (c.passages?.length) p.passages = c.passages; };

  for (const book of todo) {
    const chars = await bookCharacters(library, book), inStory = chars.filter((c) => c.inStory);
    for (const c of chars.filter((c) => !c.inStory)) cast.outside.push({ book, entity: c.entity, label: labelOf(c.forms), why: 'not in any story scene (paratext only, or nowhere)' });
    // 1. Against the people of the books before.
    const before = [...cast.persons], pairs = [];
    for (const c of inStory) for (const p of before) if (overlaps(c.forms, p.forms)) pairs.push({ c, p, a: sideOfCharacter(c), b: sideOfPerson(p) });
    if (dry) { report.push({ book, characters: inStory.length, outside: chars.length - inStory.length, pairs: pairs.length }); continue; }
    const verdicts = await judge(jev, pairs);
    const best = new Map();
    pairs.forEach((pair, i) => {
      const full = fullNameShared(pair.c, pair.p), v = verdicts[i], kind = verdictOf(v, full);
      cast.decisions.push({ book, entity: pair.c.entity, label: labelOf(pair.c.forms), person: pair.p.id, personLabel: pair.p.label, same: v.same, distinct: v.distinct, fullName: full, verdict: kind });
      if (kind === 'same' && (!best.has(pair.c) || best.get(pair.c).v.same < v.same)) best.set(pair.c, { p: pair.p, v });
      if (kind === 'review') cast.review.push({ book, entity: pair.c.entity, label: labelOf(pair.c.forms), likely: pair.p.id, likelyLabel: pair.p.label, same: v.same, distinct: v.distinct });
    });
    const fresh = [];
    for (const c of inStory) { const b = best.get(c); if (b) join2(b.p, c); else fresh.push({ c, p: newPerson(c) }); }
    // 2. The book's new people against each other.
    const inner = [];
    for (let i = 0; i < fresh.length; i++) for (let j = i + 1; j < fresh.length; j++) if (overlaps(fresh[i].c.forms, fresh[j].c.forms)) inner.push({ x: fresh[i], y: fresh[j], a: sideOfCharacter(fresh[i].c), b: sideOfCharacter(fresh[j].c) });
    const innerVerdicts = await judge(jev, inner), gone = new Set();
    inner.forEach((pair, i) => {
      const full = fullNameShared(pair.x.c, pair.y.c), v = innerVerdicts[i], kind = verdictOf(v, full);
      cast.decisions.push({ book, entity: pair.y.c.entity, label: labelOf(pair.y.c.forms), person: pair.x.p.id, personLabel: pair.x.p.label, same: v.same, distinct: v.distinct, fullName: full, verdict: kind, within: true });
      if (kind === 'same' && !gone.has(pair.x.p.id) && !gone.has(pair.y.p.id)) { join2(pair.x.p, pair.y.c); gone.add(pair.y.p.id); }
      if (kind === 'review') cast.review.push({ book, entity: pair.y.c.entity, label: labelOf(pair.y.c.forms), likely: pair.x.p.id, likelyLabel: pair.x.p.label, same: v.same, distinct: v.distinct, within: true });
    });
    cast.persons = cast.persons.filter((p) => !gone.has(p.id));
    cast.books.push(book);
    report.push({ book, characters: inStory.length, outside: chars.length - inStory.length, pairs: pairs.length, joined: best.size, inner: inner.length, mergedInBook: gone.size, persons: cast.persons.length });
    await writeFile(file, JSON.stringify(cast, null, 1));
  }
  return report;
}

/** Person id of a book's character, or null. */
export const personOf = (cast, book, entity) => cast.persons.find((p) => p.members.some((m) => m.book === book && m.entity === entity))?.id ?? null;

async function main() {
  const { values, positionals: [library, query] } = parseArgs({ allowPositionals: true, options: { books: { type: 'string' }, dry: { type: 'boolean' }, show: { type: 'boolean' } } });
  if (!library) { console.error('usage: node engine/universe/cast.mjs <library> [--books vol-1,vol-2] [--dry] | --show [<name or id>]'); process.exit(2); }
  if (values.show) {
    const cast = JSON.parse(await readFile(join(resolve(library), 'universe', 'cast.json'), 'utf8'));
    const rows = cast.persons.filter((p) => !query || p.id === query || p.forms.some((f) => f.includes(query)));
    for (const p of rows) console.log(`${p.id} ${p.label} | ${p.members.map((m) => `${m.book}:${m.entity}`).join(' ')}`);
    console.log(JSON.stringify({ persons: cast.persons.length, books: cast.books, review: cast.review.length, outside: cast.outside.length }));
    return;
  }
  let jev = null, paid = 0;
  if (!values.dry) {
    const env = { JEV_MODEL: 'jev-1.14.0', ...process.env, ...storedKeys(process.env) };
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
    const live = jevFromEnv(env);
    jev = cachedDecisions({ modelId: live.modelId, decide: (...a) => { paid++; return live.decide(...a); } }, join(resolve(library), 'universe', 'cache-cast'));
  }
  const report = await addBooks(library, { books: values.books?.split(','), dry: values.dry, jev });
  for (const r of report) console.log(JSON.stringify(r));
  if (!values.dry) console.log(JSON.stringify({ paid }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
