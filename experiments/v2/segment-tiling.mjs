// M14's test (the user, 2026-11-03): scenes tiled further where the kind of action changes, as often as Jev judges the
// text needs and no more: no fixed block size, no "split in two". Two structured calls:
//   1. the cut: for every sentence of a scene, one yes/no question in the scene's request windows (Jev's request size,
//      a hundred sentences with the eight before as context): does a stretch of another kind begin here? A segment
//      begins where Jev holds it more likely than not.
//   2. the type: every segment of a scene in one document, one choice of the nine block types each, its whole
//      distribution kept with its confidence.
// Compared with the beats the 12-sentence blocks give (the reading's gate.json). Cached as the reading's own decisions
// are. Paid: Jev requests only.
//   node experiments/v2/segment-tiling.mjs <novel-dir> <reading>/v2/data.json --scenes scene_000021,scene_000040 [--out file]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
/** Jev's request window (the kinds pass's): sentences asked a request, and those before shown as context. */
const REQUEST = 100, CONTEXT = 8;

export const CUT = {
  true: 'what the passage is doing changes kind here: talk turns into a fight, a fight into a chase or an escape, action into someone\'s inner thought, the present into a memory, background narration into people acting, a scene-setting description into events, or back',
  false: 'the same kind of stretch goes on: the talk continues even as speakers alternate, blows keep being exchanged, the thought or memory continues, the description continues',
};

/** Segments from the cut probabilities: a scene's first sentence begins one, and every sentence Jev holds more likely than not to begin another. */
export function segmentsOf(ids, cut) {
  const out = [];
  ids.forEach((id, n) => { if (!n || (cut[id] ?? 0) > 0.5) out.push({ first: id, sentences: [id], cut: n ? cut[id] : null }); else out.at(-1).sentences.push(id); });
  return out.map(segment => ({ ...segment, last: segment.sentences.at(-1), n: segment.sentences.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { scenes: { type: 'string' }, out: { type: 'string' } } });
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
    // 1. The cut, every sentence after the scene's first.
    for (let from = 0; from < ids.length; from += REQUEST) {
      const asked = ids.slice(from, from + REQUEST), start = position.get(asked[0]), before = order.slice(Math.max(0, start - CONTEXT), start);
      const state = { task: 'A scene of a novel, sentence by sentence. Mark where a stretch of another kind begins (the kinds of stretch are defined in stretches).', stretches: { ...S.BLOCK_TYPES },
        ...(before.length ? { before: Object.fromEntries(before.map(id => [id, said(id)])) } : {}), passage: Object.fromEntries(asked.map(id => [id, said(id)])) };
      const questions = asked.filter(id => id !== ids[0]).map(id => ({ key: `seg_cut:${id}`, primitive: 'noul', instructions: `Does a stretch of another kind begin at passage.${id}?`, noulCriteria: CUT }));
      if (!questions.length) continue;
      for (const answer of await jev.decide(state, questions)) cut[answer.key.slice('seg_cut:'.length)] = Math.round(Number(answer.value) * 1000) / 1000;
    }
    const segments = segmentsOf(ids, cut);
    // 2. The type of each segment, the scene's segments in one document.
    const state = { task: 'A scene of a novel cut into stretches. Say what each stretch is mostly about (the kinds are defined in stretches).', stretches: { ...S.BLOCK_TYPES },
      segments: Object.fromEntries(segments.map((segment, k) => [`segment_${k + 1}`, segment.sentences.map(said).join('')])) };
    const questions = segments.map((segment, k) => ({ key: `seg_type:${k + 1}`, primitive: 'choice', instructions: `What is segments.segment_${k + 1} mostly about?`, options: Object.keys(S.BLOCK_TYPES), optionHints: { ...S.BLOCK_TYPES } }));
    const answers = await jev.decide(state, questions);
    segments.forEach((segment, k) => {
      const answer = answers.find(entry => entry.key === `seg_type:${k + 1}`), distribution = answer?.distribution ?? {};
      Object.assign(segment, { type: answer?.value ?? null, confidence: Math.round((answer?.confidence ?? 0) * 100) / 100, top: Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, p]) => [type, Math.round(p * 100) / 100]) });
    });
    const beats = (gate?.beats ?? []).filter(beat => beat.scene === sceneId).map(beat => ({ type: beat.type, first: beat.first, last: beat.last, n: position.get(beat.last) - position.get(beat.first) + 1 }));
    out.push({ scene: sceneId, sentences: ids.length, segments: segments.map(({ sentences, ...rest }) => rest), beats, cutsAbove: { half: Object.values(cut).filter(p => p > 0.5).length, near: Object.values(cut).filter(p => p > 0.3 && p <= 0.5).length } });
    console.error(`${sceneId}: ${ids.length} sentences, ${segments.length} segments (beats from blocks: ${beats.length})`);
  }
  await writeFile(resolve(values.out ?? 'segments-trial.json'), JSON.stringify({ model: live.modelId, usage, scenes: out }, null, 1));
  console.log(JSON.stringify({ model: live.modelId, usage, scenes: out.map(scene => ({ scene: scene.scene, sentences: scene.sentences, segments: scene.segments.length, beats: scene.beats.length })) }));
}
