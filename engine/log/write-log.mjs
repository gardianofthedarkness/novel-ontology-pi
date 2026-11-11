// A director run's world log, the laws over it and the ledger's proposals, written into the workspace (Track B W1, W2):
//   stage/world/log/<run>.jsonl     the world log (world-log.mjs)
//   stage/world/ledger/<run>.jsonl  the proposals to the ontology and what the laws hold for review
//   stage/director/laws.json        each law's checks and breaks
// No model call. The director writes them after every run; for an earlier run:
//   npm run build && node engine/log/write-log.mjs <novel-dir> --reading <reading>/v2/data.json [--run <id>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkAll } from '../laws/laws.mjs';
import { playedLine, speakersOf } from '../laws/check-run.mjs';
import { proposalsOf, worldLog } from './world-log.mjs';

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');

/** Writes run `run`'s world log, laws and ledger; returns their counts. `reading`: the reading's data.json, parsed. */
export async function writeWorldLog(novelDir, { run, reading }) {
  const dir = resolve(novelDir), read = (...path) => readFile(join(dir, ...path), 'utf8').then(JSON.parse);
  // The views the run played from (stage/world/segments/, written as it began: presence by physics), else the world files.
  const record = await read('stage', 'director', 'run.json'), world = await read('stage', 'world', 'segments', 'script.json').then(() => ['stage', 'world', 'segments'], () => ['stage', 'world']);
  const [page, spawn, strands, script] = await Promise.all([read('stage', 'simulation', 'runs', 'director', `${run}.page.json`), read(...world, 'spawn.json').catch(() => null), read(...world, 'strands.json'), read(...world, 'script.json')]);
  const events = (await readFile(join(dir, 'ontology', 'events.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const eventBySentence = new Map(events.flatMap(event => (event.evidence?.sentenceIds ?? []).map(id => [id, event.id])));
  const eventOf = card => eventBySentence.get(String(card).slice(String(card).indexOf(':') + 1)) ?? null;
  const log = worldLog({ run, record, page, spawn, strands });
  const laws = checkAll({ played: playedLine({ record, page, reading }), strands, script, speakers: speakersOf(reading) });
  const ledger = proposalsOf({ run, log, laws, eventOf, record });
  await mkdir(join(dir, 'stage', 'world', 'log'), { recursive: true }); await mkdir(join(dir, 'stage', 'world', 'ledger'), { recursive: true });
  await writeFile(join(dir, 'stage', 'world', 'log', `${run}.jsonl`), jsonl(log), { mode: 0o644 });
  await writeFile(join(dir, 'stage', 'world', 'ledger', `${run}.jsonl`), jsonl(ledger), { mode: 0o644 });
  await writeFile(join(dir, 'stage', 'director', 'laws.json'), JSON.stringify({ version: 1, run, at: new Date().toISOString(), laws }, null, 1), { mode: 0o644 });
  const count = (rows, key) => rows.reduce((sum, row) => ({ ...sum, [row[key]]: (sum[row[key]] ?? 0) + 1 }), {});
  return { log: count(log, 'kind'), ranks: count(log.filter(row => row.rank && row.who), 'rank'), ledger: count(ledger, 'kind'), laws: Object.fromEntries(laws.map(law => [law.law, { checked: law.checked, broken: law.violations.length }])) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, run: { type: 'string' } } });
  if (!novelDir || !values.reading) { console.error('usage: node engine/log/write-log.mjs <novel-dir> --reading <data.json> [--run <id>]'); process.exit(2); }
  const index = JSON.parse(await readFile(join(resolve(novelDir), 'stage', 'simulation', 'index.json'), 'utf8'));
  const reading = JSON.parse(await readFile(resolve(values.reading), 'utf8'));
  console.log(JSON.stringify(await writeWorldLog(novelDir, { run: values.run ?? index.strands.director.accepted, reading }), null, 1));
}
