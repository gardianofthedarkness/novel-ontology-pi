// The review-free layer of a book, taken from a workspace: what the Digger's faculties give before any review gate. That is
// the scenes (their sentences, in reading order, by chapter), each scene's own text and summary, the events (summary,
// evidence, who takes part), and the roster (every character and place the book names, with their name forms). Nothing a
// reviewer or a later faculty decided is taken: no presence, no scene places, no place tree, no times, no strands. The
// world-first loop (run.mjs) decides those itself. Written as JSON into <out>/base/; the book's text stays out of the repo.
//   npm run build && node experiments/world-first/base.mjs <novel-dir> <out-dir>
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

const order = (id = '') => { const match = /^b(\d+)_s(\d+)$/.exec(id); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };
const fold = records => [...new Map(records.map(record => [record.id, record])).values()];
const formsOf = entity => [...new Set((entity.names ?? []).map(name => name.text).filter(text => text && text.trim().length >= 2))];

export async function takeBase(novelDir, outDir) {
  const { BundleStore } = await load('dist/src/ground/connectors/bundle.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const bundle = new BundleStore(join(novelDir, 'ontology'));
  const scenes = fold(await bundle.loadFile('scenes.jsonl')).sort((a, b) => order(a.sentenceIds?.[0]) - order(b.sentenceIds?.[0]));
  const events = fold(await bundle.loadFile('events.jsonl')), entities = fold(await bundle.loadFile('entities.jsonl')), relations = await bundle.loadFile('relations.jsonl');
  const sentences = await loadWorkspaceSentences(novelDir);
  const kind = new Map(entities.map(entity => [entity.id, entity.kind]));
  // Who takes part in an event: the extraction's participants and primary actors (characters only).
  const actors = new Map();
  for (const relation of relations) if (relation.type === 'PARTICIPATES_IN' && kind.get(relation.fromId) === 'Character') actors.set(relation.toId, (actors.get(relation.toId) ?? new Set()).add(relation.fromId));
  const sceneOf = new Map(scenes.flatMap(scene => (scene.sentenceIds ?? []).map(id => [id, scene.id])));
  const byScene = new Map();
  for (const event of events.sort((a, b) => order(a.evidence?.sentenceIds?.[0]) - order(b.evidence?.sentenceIds?.[0]))) {
    const scene = sceneOf.get(event.evidence?.sentenceIds?.[0] ?? '');
    if (!scene) continue;
    const who = new Set([...(actors.get(event.id) ?? []), ...(event.primaryActors ?? []).filter(id => kind.get(id) === 'Character')]);
    byScene.set(scene, [...(byScene.get(scene) ?? []), { id: event.id, summary: event.summaryEn ?? event.summary ?? '', evidence: event.evidence?.text ?? '', actors: [...who] }]);
  }
  const base = {
    scenes: scenes.map((scene, index) => ({ id: scene.id, index, chapter: scene.chapterIndex ?? 0, summary: scene.summary ?? '', text: (scene.sentenceIds ?? []).map(id => sentences.get(id)?.text ?? '').join(''), events: byScene.get(scene.id) ?? [] })),
    roster: {
      characters: entities.filter(entity => entity.kind === 'Character').map(entity => ({ id: entity.id, names: formsOf(entity) })).filter(entry => entry.names.length),
      places: entities.filter(entity => entity.kind === 'Location').map(entity => ({ id: entity.id, names: formsOf(entity) })).filter(entry => entry.names.length),
    },
  };
  await mkdir(join(outDir, 'base'), { recursive: true, mode: 0o700 });
  await writeFile(join(outDir, 'base', 'scenes.json'), JSON.stringify(base.scenes), { mode: 0o600 });
  await writeFile(join(outDir, 'base', 'roster.json'), JSON.stringify(base.roster, null, 1), { mode: 0o600 });
  return { scenes: base.scenes.length, chapters: new Set(base.scenes.map(scene => scene.chapter)).size, events: base.scenes.reduce((sum, scene) => sum + scene.events.length, 0), characters: base.roster.characters.length, places: base.roster.places.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novelDir, outDir] = process.argv.slice(2);
  if (!novelDir || !outDir) throw new Error('Usage: node experiments/world-first/base.mjs <novel-dir> <out-dir>');
  console.log(JSON.stringify(await takeBase(resolve(novelDir), resolve(outDir))));
}
