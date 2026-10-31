// A world-first workspace whose canon is the v2 reading (src/v2/canon.ts), so the stage steps and the engine run on it as
// they are: the source workspace's manifest and stored source are copied (the sentence ids are the same), its canon is not.
// Its world script (stage/world/script.json: each scene's place, who is present, the past, its events) is read off the
// reading too (src/v2/script.ts), so no v1 world loop runs before terrain and the world engine.
// The new workspace must not exist yet; nothing in the source workspace is changed. `--script` writes the world script
// alone again, into a workspace made from that reading (after the script's rules change; the canon stays as it is).
// The script's sampling pools (src/v2/pools.ts) are the universe's: its registry (<library>/universe/pools.json) is read,
// this book's pools and members written into it, and kept for the other books.
//
//   node experiments/v2/workspace.mjs <source-novel-dir> <v2-out-dir> <new-novel-dir>
//   node experiments/v2/workspace.mjs --script <v2-out-dir> <novel-dir>
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

/** The reading's result as canonRecords and readingScript read it (the chart as maps), and its sentences' text. */
async function reading(outDir, textDir) {
  const { loadBlocks } = await load('dist/src/v2/base.js');
  const data = JSON.parse(await readFile(join(outDir, 'v2', 'data.json'), 'utf8'));
  const text = new Map((await loadBlocks(textDir)).flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  const result = { ...data, chart: { entities: new Map(data.chart.entities.map(entity => [entity.id, entity])), times: new Map(data.chart.times.map(node => [node.text, node])) } };
  return { result, text: id => text.get(id) ?? '' };
}

/** The world script read off the reading, written into the workspace (stage/world/script.json), with what it came to. */
export async function writeScript(outDir, novelDir, given = null) {
  const { readingScript } = await load('dist/src/v2/script.js'), { emptyRegistry, universeOf, withPools } = await load('dist/src/v2/pools.js');
  const { result, text } = given ?? await reading(outDir, novelDir);
  const universe = universeOf(resolve(novelDir)), registryFile = join(universe.dir, 'pools.json');
  const registry = JSON.parse(await readFile(registryFile, 'utf8').catch(() => 'null')) ?? emptyRegistry();
  const { script, registry: kept, pools, pooled, picked } = withPools(readingScript(result, text), registry, universe.book);
  await mkdir(join(novelDir, 'stage', 'world'), { recursive: true, mode: 0o700 });
  await writeFile(join(novelDir, 'stage', 'world', 'script.json'), JSON.stringify(script), { mode: 0o600 });
  await mkdir(universe.dir, { recursive: true, mode: 0o700 });
  await writeFile(registryFile, JSON.stringify(kept, null, 1), { mode: 0o600 });
  return { pools: { made: pools, pooled, picked, registry: registryFile }, placed: script.scenes.filter(scene => scene.place).length, by: Object.fromEntries(['environment', 'action', 'named', 'unnamed', 'carried', 'none'].map(by => [by, script.scenes.filter(scene => scene.placeBy === by).length])), past: script.scenes.filter(scene => !scene.clock).length, unnamedPlaces: Object.values(script.places).filter(place => place.unnamed).length };
}

export async function v2Workspace(sourceDir, outDir, novelDir) {
  if (await stat(novelDir).then(() => true, () => false)) throw new Error(`${novelDir} exists: a v2 workspace is made new, never over another`);
  const { canonRecords } = await load('dist/src/v2/canon.js');
  const read = await reading(outDir, sourceDir), canon = canonRecords(read.result, read.text);
  await mkdir(join(novelDir, 'ontology'), { recursive: true, mode: 0o700 });
  await cp(join(sourceDir, 'source'), join(novelDir, 'source'), { recursive: true });
  await cp(join(sourceDir, 'ontology', 'source.json'), join(novelDir, 'ontology', 'source.json'));
  // A world-first workspace whose canon is a v2 reading: `novel checklist` takes the reading as its blocks and identities.
  const manifest = JSON.parse(await readFile(join(sourceDir, 'ontology', 'manifest.json'), 'utf8'));
  await writeFile(join(novelDir, 'ontology', 'manifest.json'), JSON.stringify({ ...manifest, worldFirst: true, blocksProcessed: 0, v2Reading: { at: new Date().toISOString(), out: outDir } }, null, 2), { mode: 0o600 });
  const lines = records => records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  await Promise.all([
    writeFile(join(novelDir, 'ontology', 'scenes.jsonl'), lines(canon.scenes), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'entities.jsonl'), lines(canon.entities), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'events.jsonl'), lines(canon.events), { mode: 0o600 }),
    writeFile(join(novelDir, 'ontology', 'relations.jsonl'), lines(canon.relations), { mode: 0o600 }),
    ...['state-changes.jsonl', 'timelines.jsonl', 'branches.jsonl'].map(name => writeFile(join(novelDir, 'ontology', name), '', { mode: 0o600 })),
  ]);
  return { novelDir, scenes: canon.scenes.length, entities: canon.entities.length, events: canon.events.length, relations: canon.relations.length, script: await writeScript(outDir, novelDir, read) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--script') {
    const [, outDir, novelDir] = args;
    if (!novelDir) throw new Error('Usage: node experiments/v2/workspace.mjs --script <v2-out-dir> <novel-dir>');
    console.log(JSON.stringify(await writeScript(resolve(outDir), resolve(novelDir))));
  } else {
    const [sourceDir, outDir, novelDir] = args;
    if (!novelDir) throw new Error('Usage: node experiments/v2/workspace.mjs <source-novel-dir> <v2-out-dir> <new-novel-dir> | --script <v2-out-dir> <novel-dir>');
    console.log(JSON.stringify(await v2Workspace(resolve(sourceDir), resolve(outDir), resolve(novelDir))));
  }
}
