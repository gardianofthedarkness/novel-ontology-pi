// Story time alone, again, on a finished v2 reading (the user asked, 2026-10-31: fix the calendar and rerun it on its own):
// the reading's scenes, sentence kinds and listed time words go through src/v2/time.ts as it is now; the facts get their
// periods again. Nothing else is asked again (EM² keeps the facts' ranking it had). The reading's time.yaml is kept as
// time.previous.yaml; data.json gets the new story time, and the base layer (<out>/base: the world loop's input, each
// scene's time with it) is written again from it; prints what changed.
//
//   npm run build
//   JEV_MODEL=jev-1.14.0 node experiments/v2/time.mjs <novel-dir> <out-dir>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

export async function rerunTime(novelDir, outDir, { decisions = null } = {}) {
  const { loadBlocks, worldBase } = await load('dist/src/v2/base.js');
  const { readStoryTime, timeWords } = await load('dist/src/v2/time.js');
  const { FactLedger } = await load('dist/src/v2/facts.js');
  const { yamlDocument } = await load('dist/src/v2/yaml.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const v2 = join(outDir, 'v2'), data = JSON.parse(await readFile(join(v2, 'data.json'), 'utf8'));
  const blocks = (await loadBlocks(novelDir)).filter(block => data.scenes.some(scene => scene.block === block.id));
  const all = blocks.flatMap(block => block.sentences), position = new Map(all.map((sentence, index) => [sentence.id, index])), textOf = new Map(all.map(sentence => [sentence.id, sentence.text]));
  const live = decisions ?? jevFromEnv(process.env), usage = { requests: 0, cached: 0 };
  const jev = cachedDecisions({ modelId: live.modelId, decide: (state, questions) => { usage.requests++; return live.decide(state, questions); } }, join(outDir, 'cache'));
  const listed = data.em.flatMap(batch => batch.results).filter(entry => entry.outcome === 'time').map(entry => entry.text);
  const started = Date.now(), before = (live.usage ?? []).length;
  const time = await readStoryTime((state, questions) => jev.decide(state, questions), {
    scenes: data.scenes.map(scene => ({ id: scene.id, chapter: scene.chapter, sentences: scene.sentences })),
    words: blocks.flatMap(block => timeWords(block.sentences, listed)),
    text: id => textOf.get(id) ?? '', position: id => position.get(id) ?? -1, kind: id => data.kinds[id]?.kind,
  });
  // The facts' periods again, from the new story time.
  const ledger = new FactLedger(data.facts.map(fact => ({ id: fact.card, first: fact.first, last: fact.last, sentences: fact.sentences })), id => textOf.get(id) ?? '', id => position.get(id) ?? -1);
  ledger.byStory(time.periodOf);
  const periodOf = new Map(ledger.facts.map(fact => [fact.id, { period: fact.period, story: fact.story }]));
  const { periodOf: _, ...stored } = time;
  const previous = data.time;
  data.time = stored;
  data.facts = data.facts.map(fact => ({ ...fact, ...periodOf.get(fact.id) }));
  const reported = (live.usage ?? []).slice(before), tokens = reported.reduce((sum, entry) => sum + (entry.input_tokens ?? 0), 0);
  const summary = {
    wallMs: Date.now() - started, paidRequests: usage.requests, inputTokens: tokens,
    words: time.words.length, roles: Object.fromEntries(['ADVANCE', 'FLASHBACK', 'RETURN', 'REFERENCE'].map(role => [role, time.words.filter(word => word.role === role).length])),
    notAsked: Object.fromEntries(['quote', 'kind', 'question', 'deep'].map(why => [why, time.words.filter(word => word.why === why).length])),
    periods: time.periods.length, flashbackPeriods: time.periods.filter(period => period.flashback).length, treeNodes: time.tree.length,
    treeConflicts: time.treeConflicts.length, calendarConflicts: time.calendar.conflicts.length,
    captions: [...new Set(time.scenes.map(scene => scene.when))],
  };
  await copyFile(join(v2, 'time.yaml'), join(v2, 'time.previous.yaml')).catch(() => {});
  // The base layer again, from the reading with its new story time (the flow's result as worldBase reads it: the chart as maps).
  const base = worldBase({ ...data, chart: { entities: new Map(data.chart.entities.map(entity => [entity.id, entity])), times: new Map(data.chart.times.map(node => [node.text, node])) } }, id => textOf.get(id) ?? '');
  const baseDir = join(outDir, 'base');
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  await Promise.all([['scenes.json', JSON.stringify(base.scenes)], ['roster.json', JSON.stringify(base.roster, null, 1)], ['facts.json', JSON.stringify(base.facts)], ['states.json', JSON.stringify(base.states)]].map(([name, body]) => writeFile(join(baseDir, name), body, { mode: 0o600 })));
  await Promise.all([
    writeFile(join(v2, 'time.yaml'), yamlDocument(stored), { mode: 0o600 }),
    writeFile(join(v2, 'data.json'), JSON.stringify(data), { mode: 0o600 }),
    writeFile(join(v2, 'time-rerun.yaml'), yamlDocument({ ...summary, before: previous ? { periods: previous.periods.length, captions: [...new Set(previous.scenes.map(scene => scene.when))], conflicts: previous.calendar.conflicts.length } : null, changed: previous ? data.scenes.map((scene, index) => ({ scene: index + 1, before: previous.scenes[index]?.when, now: time.scenes[index]?.when })).filter(entry => entry.before !== entry.now) : [] }), { mode: 0o600 }),
  ]);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novel, out] = process.argv.slice(2);
  if (!novel || !out) { console.error('usage: node experiments/v2/time.mjs <novel-dir> <out-dir>'); process.exit(2); }
  console.log(JSON.stringify(await rerunTime(resolve(novel), resolve(out)), null, 1));
}
