// A world-first workspace whose canon is the v2 reading (src/v2/canon.ts), so the stage steps and the engine run on it as
// they are: the source workspace's manifest and stored source are copied (the sentence ids are the same), its canon is not.
// The new workspace must not exist yet; nothing in the source workspace is changed.
//
//   node experiments/v2/workspace.mjs <source-novel-dir> <v2-out-dir> <new-novel-dir>
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

export async function v2Workspace(sourceDir, outDir, novelDir) {
  if (await stat(novelDir).then(() => true, () => false)) throw new Error(`${novelDir} exists: a v2 workspace is made new, never over another`);
  const { canonRecords } = await load('dist/src/v2/canon.js'), { loadBlocks } = await load('dist/src/v2/base.js');
  const data = JSON.parse(await readFile(join(outDir, 'v2', 'data.json'), 'utf8'));
  const text = new Map((await loadBlocks(sourceDir)).flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  // The flow's result as canonRecords reads it (the chart as maps).
  const result = { ...data, chart: { entities: new Map(data.chart.entities.map(entity => [entity.id, entity])), times: new Map(data.chart.times.map(node => [node.text, node])) } };
  const canon = canonRecords(result, id => text.get(id) ?? '');
  await mkdir(join(novelDir, 'ontology'), { recursive: true, mode: 0o700 });
  await cp(join(sourceDir, 'source'), join(novelDir, 'source'), { recursive: true });
  for (const name of ['manifest.json', 'source.json']) await cp(join(sourceDir, 'ontology', name), join(novelDir, 'ontology', name));
  const lines = records => records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  await Promise.all([
    writeFile(join(novelDir, 'ontology', 'scenes.jsonl'), lines(canon.scenes), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'entities.jsonl'), lines(canon.entities), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'events.jsonl'), lines(canon.events), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'relations.jsonl'), lines(canon.relations), { mode: 0o600 }),
    ...['state-changes.jsonl', 'timelines.jsonl', 'branches.jsonl'].map(name => writeFile(join(novelDir, 'ontology', name), '', { mode: 0o600 })),
  ]);
  return { novelDir, scenes: canon.scenes.length, entities: canon.entities.length, events: canon.events.length, relations: canon.relations.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourceDir, outDir, novelDir] = process.argv.slice(2);
  if (!novelDir) throw new Error('Usage: node experiments/v2/workspace.mjs <source-novel-dir> <v2-out-dir> <new-novel-dir>');
  console.log(JSON.stringify(await v2Workspace(resolve(sourceDir), resolve(outDir), resolve(novelDir))));
}
