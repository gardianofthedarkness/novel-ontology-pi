// The review-free layer of a book, taken from a workspace: what the Digger's faculties give before any review gate. That is
// the scenes (their sentences, in reading order, by chapter), each scene's own text and summary, the events (summary,
// evidence, who takes part) and the dialogue exchanges (their text), each with its first sentence so they interleave in
// narrative order; the state changes (what each person holds and learns after an event); the roster (every character and
// place the book names, with their name forms, and a place's scale when the stage has asked it). Nothing a
// reviewer or a later faculty decided is taken: no presence, no scene places, no place tree, no times, no strands. The
// world-first loop (run.mjs) decides those itself. Written as JSON into <out>/base/; the book's text stays out of the repo.
//   npm run build && node experiments/world-first/base.mjs <novel-dir> <out-dir>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
    byScene.set(scene, [...(byScene.get(scene) ?? []), { id: event.id, first: event.evidence?.sentenceIds?.[0] ?? null, summary: event.summaryEn ?? event.summary ?? '', evidence: event.evidence?.text ?? '', actors: [...who] }]);
  }
  const textOf = ids => (ids ?? []).map(id => sentences.get(id)?.text ?? '').join('');
  // The exchanges a scene holds (the dialogue faculty's spans; its members are not taken: the world decides who talks).
  const dialoguesOf = scene => (scene.dialogues ?? []).map(dialogue => ({ id: dialogue.id, first: dialogue.sentenceIds?.[0] ?? null, text: textOf(dialogue.sentenceIds) })).filter(dialogue => dialogue.text.trim());
  const states = await bundle.loadFile('state-changes.jsonl').catch(() => []);
  const scale = JSON.parse(await readFile(join(novelDir, 'stage', 'scale.json'), 'utf8').catch(() => 'null'))?.places ?? {};
  const base = {
    scenes: scenes.map((scene, index) => ({ id: scene.id, index, chapter: scene.chapterIndex ?? 0, summary: scene.summary ?? '', text: textOf(scene.sentenceIds), events: byScene.get(scene.id) ?? [], dialogues: dialoguesOf(scene) })),
    states: states.map(state => ({ person: state.characterId, after: state.afterEventId, holds: state.possessionsAdd ?? [], drops: state.possessionsRemove ?? [], learns: state.knowledgeAdd ?? [] })).filter(state => state.holds.length || state.drops.length || state.learns.length),
    roster: {
      characters: entities.filter(entity => entity.kind === 'Character').map(entity => ({ id: entity.id, names: formsOf(entity) })).filter(entry => entry.names.length),
      places: entities.filter(entity => entity.kind === 'Location').map(entity => ({ id: entity.id, names: formsOf(entity), scale: scale[entity.id]?.scale ?? null })).filter(entry => entry.names.length),
    },
  };
  await mkdir(join(outDir, 'base'), { recursive: true, mode: 0o700 });
  await writeFile(join(outDir, 'base', 'scenes.json'), JSON.stringify(base.scenes), { mode: 0o600 });
  await writeFile(join(outDir, 'base', 'roster.json'), JSON.stringify(base.roster, null, 1), { mode: 0o600 });
  await writeFile(join(outDir, 'base', 'states.json'), JSON.stringify(base.states), { mode: 0o600 });
  return { scenes: base.scenes.length, chapters: new Set(base.scenes.map(scene => scene.chapter)).size, events: base.scenes.reduce((sum, scene) => sum + scene.events.length, 0), dialogues: base.scenes.reduce((sum, scene) => sum + scene.dialogues.length, 0), states: base.states.length, characters: base.roster.characters.length, places: base.roster.places.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novelDir, outDir] = process.argv.slice(2);
  if (!novelDir || !outDir) throw new Error('Usage: node experiments/world-first/base.mjs <novel-dir> <out-dir>');
  console.log(JSON.stringify(await takeBase(resolve(novelDir), resolve(outDir))));
}
