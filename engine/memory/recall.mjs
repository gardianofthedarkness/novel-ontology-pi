// Recall from a book's memories (docs/v3/design.html §10.1): builds a memory graph from novel/ontology/memories.jsonl in a
// new folder (the graph is a cache, rebuilt from the bundle) and runs the recall query.
// Usage: node engine/memory/recall.mjs <volume folder> <graph folder> --holder <id> --at <scene order> [--cues id,id] [--mood -1..1] [--k 8]
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const args = process.argv.slice(2), [volume, graphDir] = args.filter((a) => !a.startsWith('--')).map((p) => resolve(p));
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const ontology = join(volume, 'novel', 'ontology');
const lines = async (f) => (await readFile(f, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

const { LadybugStore } = await load('dist/src/ground/connectors/ladybug.js');
const { indexMemories, recall } = await load('dist/src/ground/ontology/memory.js');
const file = join(graphDir, 'memory.lbug'), fresh = !existsSync(file);
await mkdir(graphDir, { recursive: true });
const store = new LadybugStore(file), run = (c, p) => store.run(c, p);
try {
  await store.initSchema();
  if (fresh) {
    const tables = { Character: 'Character', Location: 'Location', Item: 'Item', Concept: 'Concept', Organization: 'Organization' };
    for (const e of latest(await lines(join(ontology, 'entities.jsonl')))) {
      if (!tables[e.kind]) continue;
      await run(`CREATE (:${tables[e.kind]} {id: $id, canonical_name: $name})`, { id: e.id, name: e.names?.[0]?.text ?? e.id });
    }
    const t = Date.now(), memories = await lines(join(ontology, 'memories.jsonl'));
    await indexMemories(run, memories);
    console.log(JSON.stringify({ indexed: memories.length, ms: Date.now() - t }));
  }
  if (opt('holder')) {
    const t = Date.now(), at = Number(opt('at'));
    const rows = await recall(run, { holderId: opt('holder'), lineage: [['canon', at]], cues: (opt('cues') ?? '').split(',').filter(Boolean), mood: Number(opt('mood') ?? 0), k: Number(opt('k') ?? 8) });
    console.log(JSON.stringify({ ms: Date.now() - t }));
    for (const r of rows) console.log(`${r.score.toFixed(3)} at ${r.at} ${r.source} ret ${r.retention.toFixed(2)} imp ${r.importance.toFixed(2)} cue ${r.cue} tag ${r.tag.toFixed(2)} | ${r.summary}`);
  }
} finally { await store.close(); }
