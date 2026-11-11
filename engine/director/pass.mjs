// The director's pass (src/context/directorModes.ts directorPassMode; the user, 2026-11-02): for each narration and
// description sentence of a scene, whether the animation shows it (someone moves, someone acts in place, nothing) and who,
// asked of Jev with only the line either side and the people present, twenty sentences a request. The reading is not
// changed; the director plays the sentences that move someone as action cards.
//   npm run build && node engine/director/pass.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--cache <dir>] [--out <file>]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const M = await load('dist/src/context/directorModes.js'), { ask } = await load('dist/src/context/engine.js');
const BATCH = 20, KINDS = new Set(['narration', 'environment']);

/**
 * The pass over one scene: `people` (id → name) present; returns sentence → { show, who, confidence } for its narration and
 * description sentences.
 */
export async function passScene({ reading, text, decide, scene, place, people }) {
  const ids = scene.sentences, out = {};
  const asked = ids.map((id, n) => ({ id, n })).filter(({ id }) => KINDS.has(reading.kinds[id]?.kind) && (text.get(id)?.text ?? '').trim());
  const line = n => (n >= 0 && n < ids.length ? text.get(ids[n])?.text ?? '' : '');
  for (let start = 0; start < asked.length; start += BATCH) {
    const batch = asked.slice(start, start + BATCH).map(({ id, n }) => ({ id, before: line(n - 1).slice(0, 160), text: line(n), after: line(n + 1).slice(0, 160) }));
    const { replies } = await ask(decide, M.directorPassMode, { scene: { id: scene.id, place }, people: Object.entries(people).map(([id, name]) => ({ id, name })), batch }, null);
    for (const entry of batch) {
      const show = replies.find(reply => reply.key === `${entry.id}|show`), who = replies.find(reply => reply.key === `${entry.id}|who`);
      out[entry.id] = { show: String(show?.value ?? 'none'), who: who?.value === 'all' ? Object.keys(people) : who?.value && people[who.value] ? [String(who.value)] : [], confidence: show?.confidence ?? null };
    }
  }
  return out;
}

/** The pass over a line's scenes (from…to in reading order), each scene's people as the world script has them present. */
export async function directorPass(novelDir, { reading, from, to, decide, log = console.error }) {
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const text = await loadWorkspaceSentences(novelDir), script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
  const names = new Map(reading.chart.entities.map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  const order = reading.scenes.map(scene => scene.id), lo = order.indexOf(from), hi = order.indexOf(to), result = {};
  for (const scene of reading.scenes.slice(lo, hi + 1)) {
    const own = script.scenes.find(entry => entry.id === scene.id), people = Object.fromEntries((own?.present ?? []).map(id => [id, names.get(id) ?? id]));
    result[scene.id] = await passScene({ reading, text, decide, scene, place: names.get(own?.place) ?? script.places?.[own?.place]?.label ?? own?.place ?? '', people });
    const shown = Object.values(result[scene.id]);
    log(`${scene.id}: ${shown.length} sentences, ${shown.filter(entry => entry.show === 'moves').length} move someone, ${shown.filter(entry => entry.show === 'acts').length} act in place`);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, cache: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node engine/director/pass.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--cache <dir>] [--out <file>]'); process.exit(2); }
  const reading = JSON.parse(await readFile(values.reading, 'utf8'));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js'), { PICKER_MODEL } = await import('../live/sim-jev.mjs');
  const jev = cachedDecisions(jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), resolve(values.cache ?? join(novelDir, 'stage', 'director', 'cache')));
  let calls = 0;
  const decide = async (state, questions, options) => { calls++; return jev.decide(state, questions, options); };
  const result = await directorPass(resolve(novelDir), { reading, from: values.from, to: values.to, decide });
  await writeFile(resolve(values.out ?? join(novelDir, 'stage', 'director', 'pass.json')), JSON.stringify({ version: 1, model: jev.modelId, scenes: result }, null, 1));
  const all = Object.values(result).flatMap(scene => Object.values(scene));
  console.log(JSON.stringify({ requests: calls, sentences: all.length, moves: all.filter(entry => entry.show === 'moves').length, acts: all.filter(entry => entry.show === 'acts').length, none: all.filter(entry => entry.show === 'none').length }));
}
