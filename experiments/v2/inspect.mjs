// The v2 reading's output as one page (the user asked, 2026-10-30): each scene's text tiled into its cards and coloured by
// kind, the names, descriptions and times marked where they stand, each line's people (EM²), and under any sentence the
// records it is part of, as the YAML files hold them. Reads <out>/v2/data.json (experiments/v2/read.mjs) and the book's
// sentences; writes <out>/v2/inspect.html, one file with no outside requests. It holds the book's text: keep it private.
//
//   npm run build
//   node experiments/v2/inspect.mjs <novel-dir> <out-dir>
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

export async function inspect(novelDir, outDir) {
  const { loadBlocks } = await load('dist/src/v2/base.js');
  const { mentions } = await load('dist/src/v2/em.js');
  const data = JSON.parse(await readFile(join(outDir, 'v2', 'data.json'), 'utf8'));
  const blocks = await loadBlocks(novelDir);
  const text = new Map(blocks.flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  const order = new Map([...text.keys()].map((id, index) => [id, index]));

  // Where each name, description and time stands in each sentence (longest first, as the card scan reads).
  const lexicon = [
    ...data.chart.entities.flatMap(entity => entity.proper.map(name => [name, entity.id])),
    ...[...new Set(data.em.flatMap(batch => batch.results).filter(entry => entry.outcome === 'description').map(entry => entry.text))].map(name => [name, `desc:${name}`]),
    // Time words come from story time where the reading has it (each where it stands, with its role).
    ...(data.time ? [] : data.chart.times.map(node => [node.text, node.id])),
  ].sort((a, b) => b[0].length - a[0].length);
  // Everyday things (EM's routine outcome: no entity), marked only where no name, description or time stands.
  const routine = [...new Set(data.em.flatMap(batch => batch.results).filter(entry => entry.outcome === 'routine').map(entry => entry.text))].map(name => [name, 'routine']).sort((a, b) => b[0].length - a[0].length);
  const meant = new Map();
  for (const reference of data.references) for (const id of reference.sentences) meant.set(`${id}\u0000${reference.text}`, reference.entity ?? '');
  const spans = {};
  for (const [id, sentence] of text) {
    const found = mentions(sentence, lexicon).map(hit => hit.id.startsWith('desc:') ? [hit.at, hit.name.length, 'd', meant.get(`${id}\u0000${hit.name}`) ?? null] : [hit.at, hit.name.length, hit.id.slice(0, hit.id.indexOf('_')), hit.id]);
    for (const word of data.time?.words ?? []) if (word.sentence === id && !found.some(([at, length]) => word.start < at + length && at < word.end)) found.push([word.start, word.end - word.start, 'time', `time:${word.role}:${word.gloss}`]);
    const taken = found.map(([at, length]) => [at, at + length]);
    for (const hit of mentions(sentence, routine)) if (!taken.some(([from, to]) => hit.at < to && hit.at + hit.name.length > from)) found.push([hit.at, hit.name.length, 'r', 'routine']);
    if (found.length) spans[id] = found;
  }
  // EM's results for the strings a sentence holds (its listing batch: the latest batch starting at or before it).
  const batches = data.em.map(batch => ({ ...batch, at: order.get(batch.batch) ?? -1 })).sort((a, b) => a.at - b.at);
  const emOf = {};
  for (const [id, sentence] of text) {
    const at = order.get(id); let batch = null;
    for (const entry of batches) { if (entry.at <= at) batch = entry; else break; }
    const results = (batch?.results ?? []).filter(result => sentence.includes(result.text));
    if (results.length) emOf[id] = { batch: batch.batch, results };
  }
  const page = {
    log: data.log ?? null,
    sentences: [...text].map(([id, sentence]) => [id, sentence]),
    kinds: data.kinds, spans, emOf,
    scenes: data.scenes, cards: data.cards, contexts: data.contexts,
    entities: data.chart.entities.map(({ seen, ...entity }) => ({ ...entity, seenCount: seen.length, seen: seen.slice(0, 6) })),
    times: data.chart.times.map(({ seen, ...node }) => ({ ...node, seenCount: seen.length })),
    roles: data.roles ?? {}, references: data.references ?? [], slots: data.slots ?? [], habits: data.habits ?? [],
    facts: (data.facts ?? []).map(fact => ({ ...fact, text: fact.sentences.map(id => text.get(id) ?? '').join('') })),
    time: data.time ? { words: data.time.words, periods: data.time.periods, scenes: data.time.scenes, conflicts: data.time.calendar.conflicts } : null,
  };
  const html = (await readFile(join(repository, 'experiments', 'v2', 'inspect.html'), 'utf8')).replace('/*DATA*/null', JSON.stringify(page).replace(/</g, '\\u003c'));
  const file = join(outDir, 'v2', 'inspect.html');
  await writeFile(file, html, { mode: 0o600 });
  return { file, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novel, out] = process.argv.slice(2);
  if (!novel || !out) { console.error('usage: node experiments/v2/inspect.mjs <novel-dir> <out-dir>'); process.exit(2); }
  const { file, bytes } = await inspect(resolve(novel), resolve(out));
  console.log(`${file} (${(bytes / 1048576).toFixed(1)} MB)`);
}
