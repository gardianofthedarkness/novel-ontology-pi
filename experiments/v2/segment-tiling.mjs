// M14's test (the user, 2026-11-03): scenes tiled further where the kind of action changes, as often as Jev judges the
// text needs and no more: no fixed block size, no "split in two". Two structured calls:
//   1. the cut: for every sentence of a scene, one yes/no question in the scene's request windows (Jev's request size,
//      a hundred sentences with the eight before as context): does a stretch of another kind begin here? A segment
//      begins where Jev holds it more likely than not.
//   2. the type: every segment of a scene in one document, one choice of the nine block types each, its whole
//      distribution kept with its confidence.
// Asked so, Jev over-cuts (every one-line shift; the first test, docs/v2/directing/Decisions.md M14). Two tunings, neither
// with a length rule:
//   --mode starts   the scene tiler's way (segmentation.ts tileScenes: Jev finds a boundary choosing where the next one
//                   begins): from where a stretch begins, which sentence begins the next stretch of another kind, or
//                   none in this window; asked again from there until none is left in the scene;
//   --mode smoothed the per-sentence cuts and the segments' type distributions (from the cache), smoothed forward and
//                   backward over the scene's sentences with Jev's own cut probability as the chance the type changes
//                   there: a one-line island survives only where its type's evidence outweighs the stretch round it.
// Compared with the beats the 12-sentence blocks give (the reading's gate.json). Cached as the reading's own decisions
// are. Paid: Jev requests only.
//   node experiments/v2/segment-tiling.mjs <novel-dir> <reading>/v2/data.json --scenes scene_000021,scene_000040 [--mode cuts|starts|smoothed] [--purpose no] [--out file]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
/** Jev's request window (the kinds pass's): sentences asked a request, and those before shown as context. */
const REQUEST = 100, CONTEXT = 8;
/**
 * What the stretches are for, told to Jev with the cut (the user, 2026-11-03: it needs to know what the following
 * questions will ask to tile the right way): each stretch is typed next with one of the nine kinds, and each kind wakes
 * its own specialist. `--purpose no` asks as the first test did.
 */
export const PURPOSE = 'This scene will be cut into stretches, and each stretch then typed with exactly one of the kinds in stretches: a different specialist of a film crew takes over for each kind (a fight choreographer, a chase unit, someone for inner voices, for phone calls, for scenery). Mark a new stretch only where the kind in stretches would change and a different specialist would take over; not where a speaker, a sentence, a blow or a moment changes within the same kind.';

export const CUT = {
  true: 'what the passage is doing changes kind here: talk turns into a fight, a fight into a chase or an escape, action into someone\'s inner thought, the present into a memory, background narration into people acting, a scene-setting description into events, or back',
  false: 'the same kind of stretch goes on: the talk continues even as speakers alternate, blows keep being exchanged, the thought or memory continues, the description continues',
};

const TYPES = ['routine', 'confrontation', 'traversal', 'mediated', 'interior', 'exposition', 'establishing', 'memory', 'catastrophe'];

/**
 * Each sentence's type, smoothed: forward-backward over the scene's sentences, each sentence observing its segment's
 * type distribution (mixed toward even as Jev was less sure of it), the type changing at a sentence as likely as Jev held
 * a stretch of another kind to begin there. Returns the runs of one most likely type.
 */
export function smoothedRuns(ids, cut, observed) {
  const T = TYPES.length, normal = row => { const sum = row.reduce((a, b) => a + b, 0) || 1; return row.map(v => v / sum); };
  const emit = id => { const { distribution = {}, confidence = 0 } = observed[id] ?? {}; return TYPES.map(type => Math.max(1e-3, confidence * (distribution[type] ?? 0) + (1 - confidence) / T)); };
  const move = k => (k ? cut[ids[k]] ?? 0 : 0), step = (from, t, k) => from.reduce((sum, p, s) => sum + p * (s === t ? 1 - move(k) : move(k) / (T - 1)), 0);
  const forward = [normal(emit(ids[0]))];
  for (let k = 1; k < ids.length; k++) { const e = emit(ids[k]); forward.push(normal(TYPES.map((_, t) => e[t] * step(forward[k - 1], t, k)))); }
  const backward = new Array(ids.length); backward[ids.length - 1] = TYPES.map(() => 1 / T);
  for (let k = ids.length - 2; k >= 0; k--) { const e = emit(ids[k + 1]); backward[k] = normal(TYPES.map((_, s) => TYPES.reduce((sum, __, t) => sum + (s === t ? 1 - move(k + 1) : move(k + 1) / (T - 1)) * e[t] * backward[k + 1][t], 0))); }
  const runs = [], posterior = {};
  ids.forEach((id, k) => { const post = normal(forward[k].map((p, t) => p * backward[k][t])), best = post.indexOf(Math.max(...post)), type = TYPES[best];
    posterior[id] = Object.fromEntries(TYPES.map((name, t) => [name, Math.round(post[t] * 1000) / 1000]));
    if (runs.at(-1)?.type === type) { runs.at(-1).last = id; runs.at(-1).n++; } else runs.push({ first: id, last: id, n: 1, type, confidence: Math.round(post[best] * 100) / 100 }); });
  return Object.assign(runs, { posterior });
}

/** Segments from the cut probabilities: a scene's first sentence begins one, and every sentence Jev holds more likely than not to begin another. */
export function segmentsOf(ids, cut) {
  const out = [];
  ids.forEach((id, n) => { if (!n || (cut[id] ?? 0) > 0.5) out.push({ first: id, sentences: [id], cut: n ? cut[id] : null }); else out.at(-1).sentences.push(id); });
  return out.map(segment => ({ ...segment, last: segment.sentences.at(-1), n: segment.sentences.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { scenes: { type: 'string' }, mode: { type: 'string' }, purpose: { type: 'string' }, out: { type: 'string' } } });
  const mode = values.mode ?? 'cuts', purpose = values.purpose !== 'no';
  if (!novelDir || !readingPath || !values.scenes) { console.error('usage: node experiments/v2/segment-tiling.mjs <novel-dir> <reading>/v2/data.json --scenes a,b [--out file]'); process.exit(2); }
  const S = await load('dist/src/digger/autostep/segmentation.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const reading = JSON.parse(await readFile(readingPath, 'utf8')), text = await loadWorkspaceSentences(resolve(novelDir));
  const gate = JSON.parse(await readFile(join(dirname(resolve(readingPath)), 'gate.json'), 'utf8').catch(() => 'null'));
  const order = reading.scenes.flatMap(scene => scene.sentences), position = new Map(order.map((id, n) => [id, n]));
  const said = id => text.get(id)?.text ?? '';
  const usage = { requests: 0, questions: 0 };
  const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (state, questions, ...rest) => { usage.requests++; usage.questions += questions.length; return live.decide(state, questions, ...rest); } }, join(dirname(dirname(resolve(readingPath))), 'cache'));
  const out = [];
  for (const sceneId of values.scenes.split(',')) {
    const scene = reading.scenes.find(entry => entry.id === sceneId), ids = scene.sentences, cut = {};
    const windowState = (asked, task) => { const start = position.get(asked[0]), before = order.slice(Math.max(0, start - CONTEXT), start);
      return { task, stretches: { ...S.BLOCK_TYPES }, ...(before.length ? { before: Object.fromEntries(before.map(id => [id, said(id)])) } : {}), passage: Object.fromEntries(asked.map(id => [id, said(id)])) }; };
    let starts = null;
    if (mode === 'starts') {
      // 1'. Starts: from where the open stretch begins, the next start of another kind in the window, or none (then the
      // stretch runs on into the next window, its start shown as context).
      starts = [0];
      let open = 0, from = 0;
      while (from < ids.length) {
        const asked = ids.slice(from, from + REQUEST), options = asked.filter(id => position.get(id) > position.get(ids[open]));
        if (!options.length) { from += REQUEST; continue; }
        const key = `seg_start:${ids[open]}|${asked[0]}`;
        const [answer] = await jev.decide(windowState(ids.slice(Math.max(open, from - CONTEXT), from + REQUEST), `A scene of a novel. A stretch of one kind (the kinds are defined in stretches) begins at passage.${ids[open]}${open < from ? ' (before this window)' : ''}. Find where the next stretch of another kind begins.`), [
          { key, primitive: 'choice', instructions: `Which sentence id begins the next stretch whose kind differs from the stretch that begins at ${ids[open]}? Pick the first sentence of that next stretch, or NONE if this stretch runs past the last sentence of the passage.`, options: [...options, 'NONE'] }]);
        const at = answer?.value && answer.value !== 'NONE' ? ids.indexOf(String(answer.value)) : -1;
        if (at > open) { starts.push(at); cut[ids[at]] = Math.round((answer.confidence ?? 0) * 1000) / 1000; open = at; from = at; } else from += REQUEST;
      }
    }
    // 1. The cut, every sentence after the scene's first.
    for (let from = 0; mode !== 'starts' && from < ids.length; from += REQUEST) {
      const asked = ids.slice(from, from + REQUEST), start = position.get(asked[0]), before = order.slice(Math.max(0, start - CONTEXT), start);
      const state = { task: purpose ? `A scene of a novel, sentence by sentence. ${PURPOSE}` : 'A scene of a novel, sentence by sentence. Mark where a stretch of another kind begins (the kinds of stretch are defined in stretches).', stretches: { ...S.BLOCK_TYPES },
        ...(before.length ? { before: Object.fromEntries(before.map(id => [id, said(id)])) } : {}), passage: Object.fromEntries(asked.map(id => [id, said(id)])) };
      const questions = asked.filter(id => id !== ids[0]).map(id => ({ key: `seg_cut:${id}`, primitive: 'noul', instructions: purpose ? `Does a stretch of another kind (one of stretches, a different specialist) begin at passage.${id}?` : `Does a stretch of another kind begin at passage.${id}?`, noulCriteria: CUT }));
      if (!questions.length) continue;
      for (const answer of await jev.decide(state, questions)) cut[answer.key.slice('seg_cut:'.length)] = Math.round(Number(answer.value) * 1000) / 1000;
    }
    const segments = starts ? starts.map((at, k) => { const sentences = ids.slice(at, starts[k + 1] ?? ids.length); return { first: sentences[0], last: sentences.at(-1), n: sentences.length, sentences, cut: k ? cut[ids[at]] : null }; }) : segmentsOf(ids, cut);
    // 2. The type of each segment, the scene's segments in one document.
    const state = { task: 'A scene of a novel cut into stretches. Say what each stretch is mostly about (the kinds are defined in stretches).', stretches: { ...S.BLOCK_TYPES },
      segments: Object.fromEntries(segments.map((segment, k) => [`segment_${k + 1}`, segment.sentences.map(said).join('')])) };
    const questions = segments.map((segment, k) => ({ key: `seg_type:${k + 1}`, primitive: 'choice', instructions: `What is segments.segment_${k + 1} mostly about?`, options: Object.keys(S.BLOCK_TYPES), optionHints: { ...S.BLOCK_TYPES } }));
    const answers = await jev.decide(state, questions);
    segments.forEach((segment, k) => {
      const answer = answers.find(entry => entry.key === `seg_type:${k + 1}`), distribution = answer?.distribution ?? {};
      Object.assign(segment, { distribution, type: answer?.value ?? null, confidence: Math.round((answer?.confidence ?? 0) * 100) / 100, top: Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, p]) => [type, Math.round(p * 100) / 100]) });
    });
    const beats = (gate?.beats ?? []).filter(beat => beat.scene === sceneId).map(beat => ({ type: beat.type, first: beat.first, last: beat.last, n: position.get(beat.last) - position.get(beat.first) + 1 }));
    const observed = Object.fromEntries(segments.flatMap(segment => segment.sentences.map(id => [id, { distribution: segment.distribution, confidence: segment.confidence }])));
    const runs = mode === 'smoothed' ? smoothedRuns(ids, cut, observed) : null;
    // Each sentence's type distribution as asked (its segment's) and, smoothed, as the forward-backward has it.
    const distributions = Object.fromEntries(ids.map(id => [id, { asked: observed[id]?.distribution ?? {}, ...(runs ? { smoothed: runs.posterior[id] } : {}) }]));
    out.push({ scene: sceneId, sentences: ids.length, mode, distributions, segments: (runs ?? segments).map(({ sentences, distribution, ...rest }) => rest), beats, cutsAbove: { half: Object.values(cut).filter(p => p > 0.5).length, near: Object.values(cut).filter(p => p > 0.3 && p <= 0.5).length } });
    console.error(`${sceneId}: ${ids.length} sentences, ${(runs ?? segments).length} segments (beats from blocks: ${beats.length})`);
  }
  await writeFile(resolve(values.out ?? 'segments-trial.json'), JSON.stringify({ model: live.modelId, usage, scenes: out }, null, 1));
  console.log(JSON.stringify({ model: live.modelId, usage, scenes: out.map(scene => ({ scene: scene.scene, sentences: scene.sentences, segments: scene.segments.length, beats: scene.beats.length })) }));
}
