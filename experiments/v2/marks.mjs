// Where each name, description and time stands in each sentence of a v2 reading (data.json), longest first as the card scan
// reads: [at, length, type, ref] with type char|loc|item|concept|… (an entity's id prefix), d (a description, ref the one
// it means there), time, r (an everyday thing). The reading's page (inspect.mjs) and World · Live's reader both mark them.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `text`: sentence id → its text. */
export async function sentenceMarks(data, text) {
  const { mentions } = await import(pathToFileURL(`${repository}/dist/src/v2/extraction/em.js`).href);
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
  return spans;
}
