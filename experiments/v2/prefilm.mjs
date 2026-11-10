// The pre-film casts as a reading step (world-engine/digest/prefilm.mjs): run after the reading and the world script, before
// terrain and any play. Paid: work-model requests, cached beside the reading, so a rerun pays only for what changed (the
// review's pins, a reading made again). Writes <reading>/v2/prefilm.json (the casts' notes by unit); the director reads it (or an older casts.json).
//
//   WORK_LLM_API_KEY=… WORK_LLM_MODEL=deepseek-chat node experiments/v2/prefilm.mjs <novel-dir> <reading>/v2/data.json [--from scene_000001 --to scene_000026] [--stand-in]
//
// <novel-dir>: the workspace made from this reading (its world script and the review's pins). --stand-in: a rule-made work
// model (nothing paid), to try the step itself.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readPrefilm } from '../../world-engine/digest/prefilm.mjs';
import { prefilmOf } from '../../world-engine/director/specialists.mjs';
import * as SG from '../../world-engine/director/segments.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, 'stand-in': { type: 'boolean' } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/prefilm.mjs <novel-dir> <reading>/v2/data.json [--from <unit> --to <unit>] [--stand-in]'); process.exit(2); }
const dir = resolve(novelDir), reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const script = JSON.parse(await readFile(join(dir, 'stage', 'world', 'script.json'), 'utf8'));
const pins = (await (await import('../../world-engine/review/review.mjs')).loadPins(dir)).present ?? {};
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const text = new Map([...(await loadWorkspaceSentences(dir))].map(([id, entry]) => [id, entry.text]));
const strandsWith = await (await import('../../world-engine/director/strand-builder.mjs')).strandBuilder(dir);
let work;
if (values['stand-in']) {
  const { ruledWork } = await import('../../world-engine/director/rehearsal.mjs');
  work = ruledWork();
} else {
  const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
  // The cache keeps its old folder name: the answers already paid for stay found.
  work = cachedWork(workModelFromEnv(process.env), join(dirname(resolve(readingPath)), '..', 'cache-faculties'));
}
const started = Date.now();
const { units, usage } = await readPrefilm({ reading, script, text, work, strandsOf: (segmentScript, segmentReading) => SG.strandsFile(segmentScript, strandsWith, { reading: segmentReading }), pins, from: values.from ?? null, to: values.to ?? null, log: message => console.error(message) });
const out = join(dirname(resolve(readingPath)), 'prefilm.json'), older = join(dirname(resolve(readingPath)), 'faculties.json');
// A partial run (--from/--to) adds to what is there.
const kept = values.from || values.to ? prefilmOf(JSON.parse(await readFile(out, 'utf8').catch(() => readFile(older, 'utf8')).catch(() => 'null')))?.units ?? {} : {};
await writeFile(out, JSON.stringify({ version: 1, model: work.modelId ?? null, standIn: !!values['stand-in'], madeAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), usage, units: { ...kept, ...units } }));
console.log(JSON.stringify({ units: Object.keys(units).length, seconds: Math.round((Date.now() - started) / 1000), usage }));
