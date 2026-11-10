// What a book carries into the next, per strand (docs/v2/borrow-and-spawn.md §4.5; milestones M16; the user, 2026-11-09:
// "The reason we do strands is because we need to determine when to preserve destruction of non nominated buildings and
// when not to. At the reading stage of each book, we need to determine if we are inheriting any strands from last book or
// not. If inherit, we preserve the destructions. If not, we close the strand, and destruction is recovered for the new
// book").
//
//   - register (M16a): a book's strands at its end, in the universe's registry (`universe/strands.json`): the run's own
//     strands when the book has a run re-stranded (stage/world/restrand/<run>.json), else the text's; each with its
//     scenes, its people and its last group by name, and whether it is open at the end;
//   - inherit (M16b): at the next book's reading, each strand the last book left open is inherited by a strand of the new
//     book whose first group has someone of its last group (by name), the work model checking the two passages when one
//     is given; otherwise closed. `set` is the main agent's override;
//   - keep (M16c): a run's damage, building by building as it broke (the parts of each blast: units blasted, fallen,
//     destroyed, fallen cells), into `universe/damage.json`, each with the strand it happened in and whether the building
//     is nominated (its slot owned by a named place);
//   - in force (M16d): for a book, every nominated building's damage of earlier books, and a building's that is not
//     nominated only when the strand it happened in reached this book through inherited strands, book after book.
//     The export replays them (export-strand-demo.mjs, beside applyEarlier); a building whose lot has changed since
//     (another fingerprint) stands whole, counted stale.
//
//   npm run build && node world-engine/world/carry.mjs register <novel-dir> [--run <id>]
//   node world-engine/world/carry.mjs inherit <novel-dir> [--reading <data.json>] [--work] [--dry]
//   node world-engine/world/carry.mjs set <novel-dir> <strand key> inherited|closed --why <text>
//   node world-engine/world/carry.mjs keep <novel-dir> --run <id>
//   node world-engine/world/carry.mjs show <novel-dir>
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const bookOf = novelDir => basename(dirname(resolve(novelDir)));
const universeOf = novelDir => join(resolve(novelDir), '..', '..', 'universe');
/** A book's place in the series: vol-2 is 2. */
export const bookNumber = book => Number(String(book).match(/(\d+)\s*$/)?.[1] ?? NaN);
/** How many segments with someone acting make a strand's first or last group. */
export const EDGE = 3;

// ---- The registry (M16a) -------------------------------------------------------------------------------------------

/**
 * A book's strands for the registry. `forks`: the strands file's forks (text or run); `script`: the units (who acts in
 * each: `evidence`); `names`: person id → their names. The last group is who acts in the strand's last EDGE segments with
 * anyone acting; a strand closed into another inside the book keeps `into`; open is not closed and not the past.
 */
export function bookEntry({ book, from, run = null, forks, script, names }) {
  const scene = new Map(script.scenes.map(entry => [entry.id, entry]));
  const acting = id => scene.get(id)?.evidence ?? scene.get(id)?.present ?? [];
  const group = ids => [...new Set(ids.filter(id => acting(id).length).slice(0, EDGE).flatMap(acting))];
  const person = id => ({ id, names: names(id) });
  return {
    book, from, run, at: new Date().toISOString(),
    strands: forks.filter(fork => !fork.past).map(fork => ({
      key: `${book}:${fork.id}`, id: fork.id, scenes: fork.scenes, people: fork.people.map(person),
      first: group(fork.scenes).map(person), last: group([...fork.scenes].reverse()).map(person),
      lastScene: fork.scenes.at(-1), place: fork.envelope ?? null, open: !fork.into,
      ...(fork.into ? { into: `${book}:${fork.into}`, intoAt: fork.intoAt } : {}),
    })),
  };
}

/** A person's names from a book's ontology (entities.jsonl): the canonical name and the aliases. */
export async function namesOfBook(novelDir) {
  const text = await readFile(join(resolve(novelDir), 'ontology', 'entities.jsonl'), 'utf8').catch(() => '');
  const names = new Map();
  for (const line of text.split('\n')) { if (!line.trim()) continue; const entity = JSON.parse(line); names.set(entity.id, (entity.names ?? []).map(name => (typeof name === 'string' ? name : name.text)).filter(Boolean)); }
  return id => names.get(id) ?? [];
}

/** The book's strands as the registry takes them: a run's re-strand when there is one, else the text's (the units the director plays). */
export async function bookStrands(novelDir, { run = null, reading = null } = {}) {
  const dir = resolve(novelDir), world = join(dir, 'stage', 'world');
  const restranded = run ? await json(join(world, 'restrand', `${run}.json`)) : null;
  if (restranded?.forks) return { from: `run:${run}`, run, forks: restranded.forks, script: { scenes: restranded.units?.length ? scriptOfUnits(restranded) : (await json(join(world, 'segments', 'script.json')))?.scenes ?? [] } };
  const { segmentWorld, strandsFile } = await import('../director/segments.mjs'), { strandBuilder } = await import('../director/strand-builder.mjs');
  const given = reading ?? (await json(join(dir, '..', 'reading', 'data.json')));
  const book = await json(join(world, 'script.json'));
  if (!given?.scenes || !book?.scenes) throw new Error(`${dir}: no reading or no world script to build the book's strands from`);
  const seg = segmentWorld({ reading: given, script: book }), { strands, ...file } = strandsFile(seg.script, await strandBuilder(dir), { reading: seg.reading });
  return { from: 'text', run: null, forks: file.forks, script: seg.script };
}
/** A run's re-strand as units (who acted in each, from its document). */
const scriptOfUnits = document => document.units.map(unit => ({ id: unit.id, evidence: unit.people ?? [] }));

/** Writes a book's strands into the universe's registry. */
export async function register(novelDir, { run = null, reading = null, write = true } = {}) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir), file = join(universe, 'strands.json');
  const { from, forks, script } = await bookStrands(dir, { run, reading });
  const entry = bookEntry({ book, from, run, forks, script, names: await namesOfBook(dir) });
  const registry = (await json(file)) ?? { version: 1, books: {}, decisions: {} };
  registry.books[book] = entry;
  if (write) { await mkdir(universe, { recursive: true }); await writeFile(file, JSON.stringify(registry, null, 1)); }
  return { book, file: write ? file : null, from, strands: entry.strands.length, open: entry.strands.filter(strand => strand.open).map(strand => strand.key) };
}

// ---- Inherit or close (M16b) ---------------------------------------------------------------------------------------

/** The book registered last before `book` (vol-1 before vol-2), and its open strands: the candidates. */
export function candidatesFor(registry, book) {
  const n = bookNumber(book), earlier = Object.keys(registry?.books ?? {}).filter(other => bookNumber(other) < n).sort((a, b) => bookNumber(b) - bookNumber(a));
  const last = earlier[0] ?? null;
  return { last, candidates: last ? registry.books[last].strands.filter(strand => strand.open) : [] };
}

/**
 * Each candidate inherited or closed (pure). `strands`: the new book's strands (registry entries: `first` group by name).
 * A candidate is inherited by the new strand whose first group shares the most names with the candidate's last group
 * (the earliest on a tie); none shared: closed. `checked(candidate, strand)`: the work model's answer when one is given
 * ({ inherits, reason }), which may refuse a match.
 */
export function decide({ candidates, strands, checked = null }) {
  const shared = (a, b) => { const names = new Set(a.flatMap(person => person.names)); return b.filter(person => person.names.some(name => names.has(name))); };
  return candidates.map(candidate => {
    const ranked = strands.map((strand, n) => ({ strand, n, with: shared(candidate.last, strand.first) })).filter(entry => entry.with.length).sort((a, b) => b.with.length - a.with.length || a.n - b.n);
    const best = ranked[0];
    if (!best) return { candidate: candidate.key, inherited: false, into: null, by: 'names', reason: 'no one of its last group acts in the new book\'s strands as they begin' };
    const answer = checked?.(candidate, best.strand) ?? null;
    if (answer && answer.inherits === false) return { candidate: candidate.key, inherited: false, into: null, by: 'work', reason: answer.reason ?? 'the work model reads the new strand as not going on from it' };
    return { candidate: candidate.key, inherited: true, into: best.strand.key, by: answer ? 'work' : 'names', reason: `${best.with.map(person => person.names[0] ?? person.id).join(', ')} go on in it${answer?.reason ? `; ${answer.reason}` : ''}` };
  });
}

/** The work model's check of a match: the candidate's last lines against the new strand's first. */
export async function workCheck(work, { lastLines, firstLines }) {
  const system = 'You compare the end of one book\'s story line with the start of a story line in the next book of the series. Answer only as JSON {"inherits": true|false, "reason": "<one short sentence>"}.';
  const prompt = JSON.stringify({ task: 'strand-inherit', question: 'Does the second passage go on from the first one: the same story line, carried on (true), or another one (false)?', first: lastLines, second: firstLines });
  const request = { system, prompt, jsonSchema: { type: 'object' }, maxTokens: 200 };
  // A metered client (cachedWork) answers generateWithUsage; the plain one (workModelFromEnv) generate.
  let content = null;
  try { content = work.generateWithUsage ? (await work.generateWithUsage(request)).content : await work.generate(request); } catch { return null; }
  try { const body = JSON.parse(content ?? 'null'); return typeof body?.inherits === 'boolean' ? body : null; } catch { return null; }
}

/** Decides the new book's inheritance from the last book's open strands, at its reading. */
export async function inherit(novelDir, { reading = null, work = null, write = true } = {}) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir), file = join(universe, 'strands.json');
  const registry = await json(file);
  const { last, candidates } = candidatesFor(registry, book);
  if (!last) return { book, last: null, decisions: [], note: 'no earlier book registered: nothing to inherit' };
  const { from, forks, script } = await bookStrands(dir, { reading });
  const entry = bookEntry({ book, from, run: null, forks, script, names: await namesOfBook(dir) });
  let checked = null;
  if (work) {
    const lines = async (novel, ids) => { const { loadWorkspaceSentences } = await import('../../dist/src/cli/commands/extract/timeplaceCommands.js'), text = await loadWorkspaceSentences(novel), data = await json(join(novel, '..', 'reading', 'data.json')); const sentences = new Map((data?.scenes ?? []).map(scene => [scene.id, scene.sentences])); return ids.flatMap(id => sentences.get(id) ?? []).map(id => text.get(id)?.text ?? '').filter(Boolean); };
    const answers = new Map(), lastDir = join(universe, '..', last, 'novel');
    for (const candidate of candidates) for (const strand of entry.strands) {
      const lastLines = (await lines(lastDir, [candidate.lastScene])).slice(-12), firstLines = (await lines(dir, [strand.scenes[0]])).slice(0, 12);
      answers.set(`${candidate.key}|${strand.key}`, await workCheck(work, { lastLines, firstLines }));
    }
    checked = (candidate, strand) => answers.get(`${candidate.key}|${strand.key}`) ?? null;
  }
  const decisions = decide({ candidates, strands: entry.strands, checked }).map(decision => ({ ...decision, at: new Date().toISOString() }));
  if (write) { registry.decisions = { ...(registry.decisions ?? {}), [book]: decisions }; await writeFile(file, JSON.stringify(registry, null, 1)); }
  return { book, last, decisions };
}

/** The main agent's override of one candidate's decision for the book in `novelDir`. */
export async function setDecision(novelDir, key, inherited, why, { into = null } = {}) {
  const dir = resolve(novelDir), book = bookOf(dir), file = join(universeOf(dir), 'strands.json'), registry = await json(file);
  if (!registry) throw new Error(`no strand registry at ${file}`);
  const list = registry.decisions?.[book] ?? [], at = list.findIndex(decision => decision.candidate === key);
  if (!candidatesFor(registry, book).candidates.some(candidate => candidate.key === key)) throw new Error(`${key} is not an open strand of the book before ${book}`);
  const decision = { candidate: key, inherited, into: inherited ? into ?? list[at]?.into ?? null : null, by: 'agent', reason: why, at: new Date().toISOString() };
  if (at < 0) list.push(decision); else list[at] = decision;
  registry.decisions = { ...(registry.decisions ?? {}), [book]: list };
  await writeFile(file, JSON.stringify(registry, null, 1));
  return decision;
}

// ---- Damage into the universe (M16c) -------------------------------------------------------------------------------

/** The slot a lot stands on, from its source (`<city>:slot:...`, the city's prefix off), and whether it is nominated. */
export function slotOfSource(source, slots) {
  const at = String(source ?? '').indexOf('slot:');
  if (at < 0) return { slot: null, nominated: false };
  let id = source.slice(at);
  while (id && !slots?.[id]) id = id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : '';
  const slot = id ? slots[id] : null;
  return { slot: id || null, nominated: !!slot?.owner, owner: slot?.owner ?? null };
}

/**
 * A run's damage, building by building (pure): each blast's parts (the lot struck and those it reached: `hit` and
 * `hit.more`) on the run's world lots, with the strand of the registry's book entry its scene is on.
 */
export function damageOf({ book, run, page, entry, slots }) {
  const strandOf = new Map(entry.strands.flatMap(strand => strand.scenes.map(scene => [scene, strand.key])));
  const out = [];
  page.scenes.forEach((scene, story) => {
    for (const event of scene.events ?? []) {
      if (!event.hit) continue;
      for (const part of [event.hit, ...(event.hit.more ?? [])]) {
        const lot = page.world?.lots?.[part.lot];
        if (!lot?.source) continue;
        const { slot, nominated, owner } = slotOfSource(lot.source, slots);
        out.push({ book, run, scene: scene.id, story, strand: strandOf.get(scene.id) ?? null, building: lot.source, manifold: lot.manifold ?? '', slot, nominated, ...(owner ? { owner } : {}), blasted: part.blasted ?? [], fallen: part.fallen ?? [], destroyed: part.destroyed ?? [], fell: part.fell ?? [] });
      }
    }
  });
  return out;
}

/** Keeps a book's run's damage in the universe (replacing what that book kept before). */
export async function keep(novelDir, { run, write = true } = {}) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir);
  const page = await json(join(dir, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`));
  if (!page?.scenes) throw new Error(`no page for run ${run}`);
  const registry = await json(join(universe, 'strands.json')), entry = registry?.books?.[book];
  if (!entry) throw new Error(`${book} is not registered: run "carry.mjs register" first`);
  const terrain = (await json(join(universe, 'terrain.json'))) ?? {};
  const entries = damageOf({ book, run, page, entry, slots: terrain.slots ?? {} });
  const file = join(universe, 'damage.json'), before = (await json(file)) ?? { version: 1, entries: [] };
  const kept = { version: 1, updatedAt: new Date().toISOString(), entries: [...before.entries.filter(other => other.book !== book), ...entries] };
  if (write) await writeFile(file, JSON.stringify(kept, null, 1));
  return { book, run, file: write ? file : null, buildings: entries.length, nominated: entries.filter(other => other.nominated).length, strands: [...new Set(entries.map(other => other.strand))] };
}

// ---- In force (M16d) -----------------------------------------------------------------------------------------------

/**
 * Whether a strand of one book reaches `book` (pure): it goes on in the strand it closed into at its own book's end,
 * then each next book must have inherited that one, into a strand that goes on in turn.
 */
export function reaches(registry, key, book) {
  const target = bookNumber(book);
  for (let at = key, guard = 0; at && guard < 200; guard++) {
    const [own] = at.split(':'), entry = registry.books?.[own];
    let strand = entry?.strands.find(other => other.key === at);
    while (strand?.into) strand = entry.strands.find(other => other.key === strand.into);
    if (!strand) return false;
    const next = Object.keys(registry.books ?? {}).concat(Object.keys(registry.decisions ?? {})).filter(other => bookNumber(other) > bookNumber(own)).sort((a, b) => bookNumber(a) - bookNumber(b))[0];
    if (!next || bookNumber(next) > target) return false;
    const decision = (registry.decisions?.[next] ?? []).find(other => other.candidate === strand.key);
    if (!decision?.inherited) return false;
    if (bookNumber(next) === target) return true;
    at = decision.into;
  }
  return false;
}

/** The damage of earlier books in force in `book` (pure): every nominated building's; another's if its strand reaches the book. */
export function inForce(registry, damage, book) {
  const n = bookNumber(book), memo = new Map();
  const live = key => { if (!memo.has(key)) memo.set(key, !!key && reaches(registry ?? {}, key, book)); return memo.get(key); };
  return (damage?.entries ?? []).filter(entry => bookNumber(entry.book) < n && (entry.nominated || live(entry.strand)));
}

/** For the export: the damage in force in the book of `novelDir` (or `as`: another book's view, for proofs). */
export async function damageInForce(novelDir, { as = null } = {}) {
  const dir = resolve(novelDir), universe = universeOf(dir), book = as ?? bookOf(dir);
  const [registry, damage] = await Promise.all([json(join(universe, 'strands.json')), json(join(universe, 'damage.json'))]);
  return { book, entries: inForce(registry, damage, book), kept: damage?.entries?.length ?? 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [command, novelDir, ...rest] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, reading: { type: 'string' }, work: { type: 'boolean' }, dry: { type: 'boolean' }, why: { type: 'string' }, into: { type: 'string' } } });
  const usage = 'usage: node world-engine/world/carry.mjs register|inherit|set|keep|show <novel-dir> [...] (see the header)';
  if (!novelDir || !['register', 'inherit', 'set', 'keep', 'show'].includes(command)) { console.error(usage); process.exit(2); }
  const reading = values.reading ? JSON.parse(await readFile(resolve(values.reading), 'utf8')) : null;
  let out;
  if (command === 'register') out = await register(novelDir, { run: values.run ?? null, reading, write: !values.dry });
  else if (command === 'inherit') {
    let work = null;
    if (values.work) { const { workModelFromEnv } = await import('../../dist/src/ground/connectors/workModel.js'); work = workModelFromEnv(process.env); }
    out = await inherit(novelDir, { reading, work, write: !values.dry });
  } else if (command === 'set') {
    const [key, state] = rest;
    if (!key || !['inherited', 'closed'].includes(state) || !values.why) { console.error('usage: carry.mjs set <novel-dir> <strand key> inherited|closed --why <text> [--into <key>]'); process.exit(2); }
    out = await setDecision(novelDir, key, state === 'inherited', values.why, { into: values.into ?? null });
  } else if (command === 'keep') {
    if (!values.run) { console.error('usage: carry.mjs keep <novel-dir> --run <id>'); process.exit(2); }
    out = await keep(novelDir, { run: values.run, write: !values.dry });
  } else {
    const universe = universeOf(novelDir), registry = await json(join(universe, 'strands.json')), forced = await damageInForce(novelDir);
    out = { books: Object.fromEntries(Object.entries(registry?.books ?? {}).map(([book, entry]) => [book, { from: entry.from, strands: entry.strands.map(strand => ({ key: strand.key, scenes: strand.scenes.length, open: strand.open, ...(strand.into ? { into: strand.into } : {}) })) }])), decisions: registry?.decisions ?? {}, inForce: { book: forced.book, buildings: forced.entries.length, of: forced.kept } };
  }
  console.log(JSON.stringify(out, null, 1).replace(/[^\x00-\x7e]/g, '?'));
}
