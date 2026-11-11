// The replay io (the user, 2026-11-07: "Can you make this a GitHub io?", of World · Live playing W13's corrected replay):
// a public, static copy of World · Live for a director run as its workspace keeps it. The world plays card by card as
// on the host, each card's Why shows the review (Jev's and Pi's answers, how sure, what was pinned), the laws and the
// smoothing, and the story sky lights it.
//
// No sentence of the book goes in. Every line's and event's text is replaced by a stand-in (its kind, and who says it),
// the reader shows those stand-ins in the book's order, names are all that is kept of the text anywhere else, and a page
// is refused if anything sentence-like is left in it. Left out: the book itself (its text, EPUB and pictures, so the
// portraits too), Jev's prompts and pictures (the Jev debugger), developer mode, the notes and the run report.
//
//   npm run build && node engine/view/replay-io.mjs <workspace> <metadata-dir> <out-dir> [--title "W13 · vol 1"] [--sky <sky.json>]
//
// <metadata-dir>: the volume's text blocks (b0001.txt …), read for each sentence's id and paragraph only.
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A run of CJK: ideographs, kana, CJK marks and full-width forms. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+/g;
/** Anything that reads as a sentence of the book: a long run of CJK, or CJK beside sentence marks or quote brackets. */
const SENTENCE = /[\u4e00-\u9fff]{13,}|[\u4e00-\u9fff][\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u300c\u300d\u300e\u300f\u201c\u201d]|[\uff0c\u3002\uff01\uff1f\u300c\u300d\u300e\u300f\u201c\u201d][\u4e00-\u9fff]/;
const SENTENCE_MARK = /[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u300c\u300d\u300e\u300f\u201c\u201d]/;
/** Keys whose values are free text (what a sentence says, a question, a reason): never taken as a name. */
const FREE = new Set(['text', 'question', 'reason', 'why', 'asked', 'instructions', 'note', 'phase', 'moment', 'document', 'task', 'summary', 'quote', 'evidence', 'said', 'scene', 'lines']);
const NAME_MOST = 12;

const refuse = (name, page) => {
  const hit = page.match(SENTENCE);
  // Where, with the CJK masked (the error itself must not carry the text).
  if (hit) throw new Error(`${name}: something sentence-like would be published (\u2026${page.slice(Math.max(0, hit.index - 60), hit.index + 40).replace(/[\u3400-\u9fff]/g, 'X')}\u2026)`);
};

/** The names in the data: short CJK values of any key but a free-text one, with no sentence mark in them. */
export function namesIn(...values) {
  const names = new Set();
  const walk = (value, key) => {
    if (typeof value === 'string') { if (!FREE.has(key) && value.length <= NAME_MOST && value.match(CJK) && !SENTENCE_MARK.test(value)) names.add(value); return; }
    if (Array.isArray(value)) { for (const entry of value) walk(entry, key); return; }
    if (value && typeof value === 'object') for (const [k, entry] of Object.entries(value)) walk(entry, k);
  };
  for (const value of values) walk(value, null);
  return names;
}

/** A scrubber for strings: a whole name stays, any other CJK run keeps only the names in it ("\u2026" for the rest). */
export function scrubber(names) {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const keepNames = run => {
    const kept = [];
    for (let at = 0; at < run.length; ) {
      const name = sorted.find(candidate => run.startsWith(candidate, at));
      if (name) { kept.push(name); at += name.length; } else { if (kept.at(-1) !== '\u2026') kept.push('\u2026'); at++; }
    }
    return kept.join('');
  };
  // Curly quotes go straight: what is left of a quoted line ("name…") never reads as the line.
  const text = value => (names.has(value) ? value : value.replace(CJK, run => (names.has(run) ? run : keepNames(run))).replace(/[\u201c\u201d]/g, '"'));
  const deep = value => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, entry]) => [k, deep(entry)]));
    return value;
  };
  return { text, deep };
}

/** A line's stand-in: a spoken line is a quote with nothing in it; any other, its kind. */
const lineStandIn = line => (line.kind === 'spoken' ? '\u201c\u2026\u201d' : `(${line.kind ?? 'line'})`);

/** The static copy of World · Live, written to outDir. */
export async function replayIo(workspace, metadataDirectory, outDir, { title = 'Replay', skyFile = null } = {}) {
  const play = await import(pathToFileURL(join(repository, 'tools', 'pi-review', 'sim-play.mjs')).href);
  const json = path => readFile(path, 'utf8').then(JSON.parse);
  const page = await json(join(workspace, 'stage', 'simulation', 'live', 'page.json'));
  const live = await json(join(workspace, 'stage', 'simulation', 'live.json'));
  // The sky beside the reading the run played, or a sky.json named (W13: the run's restore took the reading's away).
  const [review, reading, sky] = await Promise.all([play.directorReview(workspace), play.directorReading(workspace), skyFile ? json(skyFile).then(play.skyView) : play.directorSky(workspace)]);
  if (!review || !live.world?.notes?.director) throw new Error('No director run to copy');

  // Who is who: a description too long for a name stands as someone unnamed.
  const people = page.people ?? {};
  for (const [id, person] of Object.entries(people)) if (typeof person.name === 'string' && (person.name.length > NAME_MOST || SENTENCE_MARK.test(person.name))) person.name = `someone (${id})`;
  const nameOf = id => people[id]?.name ?? reading?.names?.[id]?.[0] ?? (String(id).startsWith('crowd:') ? 'the crowd' : id);

  // The text out: each line and event by its stand-in.
  for (const card of [...(page.director?.cards ?? []), ...live.world.notes.director.cards]) for (const line of card.lines ?? []) line.text = lineStandIn(line);
  for (const scene of page.scenes ?? []) for (const event of scene.events ?? []) {
    const kind = String(event.id ?? '').split(':')[0] || 'event', who = [...new Set((event.actors ?? []).map(nameOf))];
    event.text = `${kind}${who.length ? ` · ${who.join(', ')}` : ''}`;
  }
  // The live state: only what the page reads (the run is over: no pieces to extend, no question being asked).
  const { director, chunks, lots, nodes, applied, ground } = live.world.notes;
  const state = { version: live.version, engine: live.engine, command: live.command, status: live.status, startedAt: live.startedAt, updatedAt: live.updatedAt, calls: live.calls, world: { run: live.world.run, moment: live.world.moment, final: live.world.final, focus: live.world.focus, page: live.world.page, notes: { chunks, lots, nodes, applied, ground, director } } };
  // The reading: each sentence's kind and what the names mean; where they stand in the text is left out with the text.
  const readingOut = reading ? { kinds: reading.kinds ?? {}, marks: {}, names: reading.names ?? {} } : null;

  const names = namesIn(page.people, page.places, page.macro, page.things, page.rooms, readingOut?.names, director.units);
  const scrub = scrubber(names);
  const pageOut = scrub.deep(page), stateOut = scrub.deep(state), reviewOut = scrub.deep(review), readingDone = scrub.deep(readingOut);

  // The reader's book: every sentence of the volume in order, by its stand-in (who says it, when the reading knows).
  const whoSays = new Map(director.cards.flatMap(card => (card.lines ?? []).map(line => [line.id, line.who ?? null])));
  const { sectionBlock } = await import(pathToFileURL(join(repository, 'dist', 'src', 'reading', 'text', 'sectioning.js')).href);
  const blocks = (await readdir(metadataDirectory)).filter(name => /^b\d{4}\.txt$/.test(name)).sort();
  const book = [];
  for (const [block, name] of blocks.entries()) {
    const text = await readFile(join(metadataDirectory, name), 'utf8');
    let cursor = 0;
    const sentences = sectionBlock(text, block).sentences.map(sentence => {
      const start = text.indexOf(sentence.text, cursor), paragraph = start < 0 || cursor === 0 || text.slice(cursor, start).includes('\n');
      if (start >= 0) cursor = start + sentence.text.length;
      const kind = reading?.kinds?.[sentence.id] ?? null, who = whoSays.get(sentence.id);
      const standIn = kind === 'spoken' ? `${who ? `${nameOf(who)}: ` : ''}\u201c\u2026\u201d` : `(${kind ?? 'sentence'})`;
      return { id: sentence.id, text: scrub.text(standIn), ...(paragraph ? { paragraph: true } : {}) };
    });
    book.push({ block, blocks: blocks.length, sentences });
  }

  // The world's frame: the engine's own page with the run inlined, three.js beside it.
  const { inlineStrand } = await import(pathToFileURL(join(repository, 'engine', 'world', 'export-strand-demo.mjs')).href);
  const { VENDOR_FILES } = await import(pathToFileURL(join(repository, 'engine', 'live', 'sim-jev.mjs')).href);
  const now = inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), pageOut, { name: title, vendor: true });

  // World · Live itself, made static: its data from the files beside it, the book from the stand-ins, what needs the host hidden.
  let world = await readFile(join(repository, 'tools', 'pi-review', 'sim-world.html'), 'utf8');
  const swap = (from, to, times = 1) => {
    const found = world.split(from).length - 1;
    if (found !== times) throw new Error(`sim-world.html: expected ${times} of ${JSON.stringify(from)}, found ${found}`);
    world = world.split(from).join(to);
  };
  swap('<title>World · Live</title>', `<title>${title.replace(/[<&]/g, '')} · World · Live</title>`);
  swap('`now${query}', '`now.html${query}', 2);
  swap('`../api/book-text?volume=${encodeURIComponent(volume)}&block=${nextBlock}`', '`book/${nextBlock}.json`');
  swap('`../api/book-epub?volume=${encodeURIComponent(volume)}&item=${item}`', '`book/epub.json`');
  // The run is over: its state is read until it has come, then no more.
  swap('} finally { setTimeout(poll, 1000); }', '} finally { if (epoch === null) setTimeout(poll, 3000); }');
  swap('`The whole text; ${cards.length} cards played', '`The book in stand-ins (its words left out); ${cards.length} cards played');
  swap('</style>', `  #live, #asks, #dopen, #dlist, #sopen, #bopen, #next, #runOn, #creportgo, #cnote, #csend, #call, #way a, #cmeta a { display: none !important; }
  .public { font-size: 11px; color: var(--dim); line-height: 1.4; }
</style>`);
  swap('<div class="row" id="where"></div>', `<div class="public">Public copy of ${title.replace(/[<&]/g, '')}: the book's words, its pictures and Jev's prompts are left out.</div>\n  <div class="row" id="where"></div>`);

  const files = {
    'index.html': world, 'now.html': now,
    'live.json': JSON.stringify(stateOut), 'review.json': JSON.stringify(reviewOut), 'reading.json': JSON.stringify(readingDone ?? {}),
    'sky.json': JSON.stringify(scrub.deep(sky ?? {})), 'album.json': JSON.stringify({ pictures: [], portraits: [] }), 'notes.json': '[]', 'live/frames.jsonl': '',
    ...Object.fromEntries(book.map(entry => [`book/${entry.block}.json`, JSON.stringify(entry)])),
  };
  for (const [name, body] of Object.entries(files)) {
    refuse(name, body);
    // Nothing of the book's longer than a name.
    const long = (body.match(CJK) ?? []).find(run => run.length > NAME_MOST && !names.has(run));
    if (long) throw new Error(`${name}: a run of ${long.length} CJK characters would be published`);
    await mkdir(dirname(join(outDir, name)), { recursive: true });
    await writeFile(join(outDir, name), body);
  }
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(outDir, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(outDir, 'vendor', path)); }
  return { cards: director.cards.length, scenes: pageOut.scenes?.length ?? 0, reviewed: Object.values(reviewOut.cards).reduce((sum, card) => sum + card.review.filter(item => item.answer).length, 0), sentences: book.reduce((sum, entry) => sum + entry.sentences.length, 0), names: names.size, megabytes: +(Object.values(files).reduce((sum, body) => sum + Buffer.byteLength(body), 0) / 1e6).toFixed(1) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { title: { type: 'string' }, sky: { type: 'string' } } });
  const [workspace, metadataDirectory, outDir] = positionals;
  if (!workspace || !metadataDirectory || !outDir) throw new Error('Usage: node engine/view/replay-io.mjs <workspace> <metadata-dir> <out-dir> [--title "W13 · vol 1"] [--sky <sky.json>]');
  console.log(JSON.stringify(await replayIo(resolve(workspace), resolve(metadataDirectory), resolve(outDir), { title: values.title, skyFile: values.sky ? resolve(values.sky) : null })));
}
