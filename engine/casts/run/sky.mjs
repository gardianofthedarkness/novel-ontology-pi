// The story sky as a pre-film step (engine/casts/sky.mjs; docs/v3/design.html#sky): Jev reads each sequence's surroundings
// for what they imply of the time of day and the weather (four sequences a request, cents, cached), and the rules join it
// with the time tree, the headings, the weather words and the pictures, carried on and smoothed. Writes <reading>/v2/sky.json
// (each unit's time of day, hour, weather, lying snow, and where each came from); the world's look reads it.
//
//   node engine/casts/run/sky.mjs <novel-dir> <reading>/v2/data.json [--cache <dir>] [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as SKY from '../sky.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath) { console.error('usage: node engine/casts/run/sky.mjs <novel-dir> <data.json> [--cache <dir>] [--dry]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8')), dir = dirname(resolve(readingPath));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
const sentences = await loadWorkspaceSentences(resolve(novelDir)), text = id => sentences.get(id)?.text ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);

// Each sequence's surroundings: its environment and narration lines first (where the sky and the light are told), then its
// actions, at most 36, each clipped; and its heading.
const kindOf = id => reading.kinds?.[id]?.kind ?? 'narration';
const sequences = (reading.sequences ?? []).map(sequence => {
  const ids = sequence.sentences ?? [], told = ids.filter(id => ['environment', 'narration'].includes(kindOf(id))), acts = ids.filter(id => kindOf(id) === 'action');
  return { id: sequence.id, heading: sequence.heading ?? null, lines: [...told, ...acts].slice(0, 36).sort((a, b) => ids.indexOf(a) - ids.indexOf(b)) };
}).filter(sequence => sequence.lines.length);
console.error(`to ask: ${sequences.length} sequences, ${Math.ceil(sequences.length / 4)} requests`);

const jev = {};
let paid = 0;
if (!values.dry) {
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
  const live = jevFromEnv(process.env), cached = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-sky')));
  const decide = Object.assign((state, questions) => cached.decide(state, questions), { record: () => {} });
  const given = name => ({ name, key: name, quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) });
  const mode = { name: 'story-sky', task: 'Sequences of a light novel being staged in a 3D city, each by its lines that tell its surroundings and what happens. For each, say the time of day, the weather (its kind, how strong, the wind) its lines say or imply (the light, the sky, the sun or the moon, streetlights, a meal, snow on shoulders, an umbrella, white breath), and whether snow lies on the ground. unclear or unknown when they neither say nor imply it.', definitions: () => ({ dayparts: SKY.DAYPART_HINTS, weathers: SKY.WEATHERS }), sources: [given('sequences')], cutOrder: [], questions: focus => focus.questions, budget: 60_000 };
  for (let n = 0; n < sequences.length; n += 4) {
    const batch = sequences.slice(n, n + 4), key = k => `sequence_${n + k + 1}`;
    const items = batch.map((sequence, k) => [key(k), { ...(sequence.heading?.daytime ? { heading: `${sequence.heading.setting ?? ''}, ${sequence.heading.daytime}` } : {}), lines: sequence.lines.map(id => clip(text(id), 110)) }]);
    const questions = batch.flatMap((sequence, k) => [
      { key: `daypart:${sequence.id}`, primitive: 'choice', instructions: `What time of day is it in sequences.${key(k)}?`, options: Object.keys(SKY.DAYPART_HINTS), optionHints: SKY.DAYPART_HINTS },
      { key: `weather:${sequence.id}`, primitive: 'choice', instructions: `What is the weather in sequences.${key(k)}?`, options: Object.keys(SKY.WEATHERS), optionHints: SKY.WEATHERS },
      { key: `strength:${sequence.id}`, primitive: 'choice', instructions: `How strong is that weather in sequences.${key(k)}?`, options: Object.keys(SKY.STRENGTHS), optionHints: SKY.STRENGTHS },
      { key: `wind:${sequence.id}`, primitive: 'choice', instructions: `What wind is there in sequences.${key(k)}?`, options: Object.keys(SKY.WINDS), optionHints: SKY.WINDS },
      { key: `lying:${sequence.id}`, primitive: 'noul', instructions: `Does snow lie on the ground or the roofs in sequences.${key(k)}?`, noulCriteria: { true: 'the lines say or imply snow on the ground, roofs or streets', false: 'they do not' } },
    ]);
    const { replies } = await ask(decide, mode, { items, questions }, null);
    const get = k => replies.find(reply => reply.key === k);
    for (const sequence of batch) {
      const d = get(`daypart:${sequence.id}`), w = get(`weather:${sequence.id}`), l = get(`lying:${sequence.id}`), st = get(`strength:${sequence.id}`), wi = get(`wind:${sequence.id}`);
      jev[sequence.id] = { daypart: d?.value ?? null, daypartSure: d?.confidence ?? 0, weather: w?.value ?? null, weatherSure: w?.confidence ?? 0, strength: (st?.confidence ?? 0) >= 0.6 ? st.value : null, wind: (wi?.confidence ?? 0) >= 0.6 ? wi.value : null, lying: Number(l?.value ?? 0) >= 0.6 };
    }
    console.error(`sky: ${Math.min(n + 4, sequences.length)} of ${sequences.length}`);
  }
}
const pictures = JSON.parse(await readFile(join(dir, 'pictures.json'), 'utf8').catch(() => '{"pictures":[]}')).pictures ?? [];
const units = SKY.storySky({ reading, text, jev, pictures });
if (!values.dry) await writeFile(join(dir, 'sky.json'), JSON.stringify({ version: 1, at: new Date().toISOString(), by: 'the story sky (engine/casts/sky.mjs)', sequences: jev, units }, null, 1));
console.log(JSON.stringify({ paid, ...SKY.skySummary(units) }));
