// The v2 reading flow on a workspace's book (docs/v2/world-engine-v2.md §2, the user's sketch of 2026-10-30): the sentences
// go to scene tiling, sentence kinds and listing at once; then EM batch by batch, the card scan, each scene's context, and
// EM² (who says or does each line, who each description of a person means). Writes <out>/v2/ (the data as YAML, by
// docs/v2/schema.yaml: scenes, cards, chart, EM, contexts, roles, references, slots, facts, and log.yaml with every step's
// requests and time) and <out>/base/ (the world loop's input: experiments/world-first/run.mjs runs on it as it is).
// Jev's and the work model's replies are cached under <out>/cache, so a rerun pays only for what changed.
//
//   npm run build
//   JEV_MODEL=jev-1.14.0 WORK_LLM_MODEL=deepseek-chat node experiments/v2/read.mjs <novel-dir> <out-dir> [--blocks 1-2]
//     [--lister model|lexicon] [--lexicon <roster.json>]
// --lister lexicon lists by string match the name forms of a roster (an earlier base layer's roster.json) and the times the
// time lexicon finds: a stand-in for the work model, never finding a name the roster does not have.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

export async function read(novelDir, outDir, { blocks: range = null, lister: listerKind = 'model', lexicon = null, decisions = null, work = null } = {}) {
  const { loadBlocks, worldBase } = await load('dist/src/v2/base.js');
  const { readFlow } = await load('dist/src/v2/flow.js');
  const { modelLister, lexiconLister } = await load('dist/src/v2/listing.js');
  const { yamlDocument } = await load('dist/src/v2/yaml.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions, cachedWork } = await load('dist/src/digger/timeplace/cache.js');
  const all = await loadBlocks(novelDir);
  const blocks = range ? all.filter(block => { const n = Number(block.id.slice(1)); return n >= range[0] && n <= range[1]; }) : all;
  // Real calls are counted below the cache.
  const paid = { jev: 0, work: 0 };
  const live = decisions ?? jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid.jev++; return live.decide(...args); } }, join(outDir, 'cache'));
  let lister;
  if (listerKind === 'lexicon') {
    const roster = JSON.parse(await readFile(lexicon, 'utf8'));
    lister = lexiconLister([...(roster.characters ?? []), ...(roster.places ?? []), ...(roster.things ?? [])].flatMap(entry => entry.names ?? []));
  } else {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js');
    const model = work ?? workModelFromEnv(process.env), cached = cachedWork({ modelId: model.modelId, generate: request => { paid.work++; return model.generate(request); } }, join(outDir, 'cache'));
    lister = modelLister(cached);
  }
  const started = Date.now();
  const result = await readFlow(blocks, (state, questions) => jev.decide(state, questions), lister, { onStep: step => console.error(`${step.step}: ${step.requests} requests, ${step.ms} ms`) });
  const text = new Map(blocks.flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  const base = worldBase(result, id => text.get(id) ?? '');
  const v2 = join(outDir, 'v2'), baseDir = join(outDir, 'base');
  await mkdir(v2, { recursive: true, mode: 0o700 }); await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const write = (folder, name, data) => writeFile(join(folder, name), data, { mode: 0o600 });
  const entities = [...result.chart.entities.values()], times = [...result.chart.times.values()];
  const outcomes = result.em.flatMap(batch => batch.results).reduce((sum, entry) => ({ ...sum, [entry.outcome]: (sum[entry.outcome] ?? 0) + 1 }), {});
  const summary = {
    book: novelDir, blocks: blocks.map(block => block.id), sentences: text.size, lister: listerKind, jev: live.modelId, wallMs: Date.now() - started, paidRequests: paid,
    scenes: result.scenes.length, cards: Object.fromEntries([...new Set(result.cards.map(card => card.kind))].map(kind => [kind, result.cards.filter(card => card.kind === kind).length])),
    detected: result.em.reduce((sum, batch) => sum + batch.results.length, 0), em: outcomes,
    roles: (() => {
      const lines = Object.values(result.roles), spoken = lines.filter(role => role.kind === 'spoken');
      return {
        lines: lines.length, whoSettled: lines.filter(role => role.who.id).length, spoken: spoken.length, toSettled: spoken.filter(role => role.to?.id).length,
        actionsToNarration: Object.values(result.kinds).filter(kind => kind.was === 'action').length, backInTime: lines.filter(role => role.who.answer === 'time').length,
        thingsActing: lines.filter(role => role.who.id && /^(item|loc)_/.test(role.who.id)).length,
        references: result.references.length, referencesToPeople: result.references.filter(entry => entry.entity && !entry.entity.startsWith('slot_')).length,
        slots: result.slots.length, crowds: result.slots.filter(slot => slot.kind === 'crowd').length, habits: result.habits.length,
      };
    })(),
    facts: { facts: result.facts.length, about: result.facts.filter(fact => fact.about.length).length, byDescription: result.facts.filter(fact => fact.about.some(entry => entry.via === 'description')).length, timed: result.facts.filter(fact => fact.time).length },
    chart: { person: entities.filter(entity => entity.category === 'person').length, thing: entities.filter(entity => entity.category === 'thing').length, place: entities.filter(entity => entity.category === 'place').length, time: times.length },
    steps: result.steps,
  };
  await Promise.all([
    write(v2, 'log.yaml', yamlDocument(summary)),
    write(v2, 'scenes.yaml', yamlDocument(result.scenes.map(scene => ({ id: scene.id, block: scene.block, chapter: scene.chapter, first: scene.sentences[0], last: scene.sentences.at(-1), sentences: scene.sentences.length })))),
    write(v2, 'kinds.yaml', yamlDocument(result.kinds)),
    write(v2, 'cards.yaml', yamlDocument(result.cards.map(({ sentences, ...card }) => ({ ...card, size: sentences.length })))),
    write(v2, 'chart.yaml', yamlDocument({ entities, times })),
    write(v2, 'em.yaml', yamlDocument(result.em)),
    write(v2, 'contexts.yaml', yamlDocument(result.contexts)),
    write(v2, 'roles.yaml', yamlDocument(result.roles)),
    write(v2, 'references.yaml', yamlDocument(result.references)),
    write(v2, 'slots.yaml', yamlDocument({ slots: result.slots, habits: result.habits })),
    write(v2, 'facts.yaml', yamlDocument(result.facts.map(({ text: _, ...fact }) => fact))),
    // The same data as JSON, for tools (compare.mjs, inspect.mjs, the world loop).
    write(v2, 'data.json', JSON.stringify({ log: summary, scenes: result.scenes, cards: result.cards, kinds: result.kinds, chart: { entities, times }, em: result.em, contexts: result.contexts, roles: result.roles, references: result.references, slots: result.slots, habits: result.habits, facts: result.facts.map(({ text: _, ...fact }) => fact) })),
    write(baseDir, 'scenes.json', JSON.stringify(base.scenes)),
    write(baseDir, 'roster.json', JSON.stringify(base.roster, null, 1)),
    write(baseDir, 'facts.json', JSON.stringify(base.facts)),
    write(baseDir, 'states.json', JSON.stringify(base.states)),
  ]);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const [novelDir, outDir] = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
  if (!novelDir || !outDir) throw new Error('Usage: node experiments/v2/read.mjs <novel-dir> <out-dir> [--blocks 1-2] [--lister model|lexicon] [--lexicon <roster.json>]');
  const blocks = flag('--blocks')?.split('-').map(Number) ?? null;
  const summary = await read(resolve(novelDir), resolve(outDir), { blocks: blocks ? [blocks[0], blocks[1] ?? blocks[0]] : null, lister: flag('--lister') ?? 'model', lexicon: flag('--lexicon') });
  console.log(JSON.stringify({ ...summary, steps: undefined }, null, 1));
}
