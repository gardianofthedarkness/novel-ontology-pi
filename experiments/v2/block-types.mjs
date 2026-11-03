// M2 for a reading made before blocks (docs/v2/next-steps.md A6): what each block of twelve sentences is about, asked of
// Jev on the same windows the kinds pass reads (a hundred sentences of a book block, the eight before as context), only
// the block questions. Each block keeps its top three, its whole distribution and its confidence. Cached as the reading's
// own decisions are, so a rerun pays only for what changed. Paid: one Jev request a window.
//   JEV_MODEL=jev-1.14.0 node experiments/v2/block-types.mjs <novel-dir> <reading>/v2/data.json [--scenes scene_000001,scene_000021] [--out file]
// With --scenes, only the windows holding those scenes' sentences are asked and the blocks are written to --out (a trial);
// without, every window is, and the reading takes them as `blocks` (its former self kept as data.before-blocks.json).
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const CLASSIFY = 100, CONTEXT = 8, AT_ONCE = 4;

/** The book's windows as the kinds pass cuts them: per book block, a hundred sentences at a time, with eight before. */
export function windowsOf(order, blockOf) {
  const byBlock = new Map();
  for (const id of order) (byBlock.get(blockOf(id)) ?? byBlock.set(blockOf(id), []).get(blockOf(id))).push(id);
  return [...byBlock].flatMap(([block, ids]) => Array.from({ length: Math.ceil(ids.length / CLASSIFY) }, (_, w) => ({ block, before: ids.slice(Math.max(0, w * CLASSIFY - CONTEXT), w * CLASSIFY), asked: ids.slice(w * CLASSIFY, (w + 1) * CLASSIFY) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { scenes: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/block-types.mjs <novel-dir> <reading>/v2/data.json [--scenes a,b] [--out file]'); process.exit(2); }
  const S = await load('dist/src/digger/autostep/segmentation.js'), { kindsMode } = await load('dist/src/v2/context/readingModes.js'), { ask } = await load('dist/src/v2/context/engine.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const reading = JSON.parse(await readFile(readingPath, 'utf8')), text = await loadWorkspaceSentences(resolve(novelDir));
  const order = reading.scenes.flatMap(scene => scene.sentences), blockOf = id => `b${id.slice(1, 5)}`, sentence = id => ({ id, text: text.get(id)?.text ?? '' });
  const chosen = values.scenes ? new Set(reading.scenes.filter(scene => values.scenes.split(',').includes(scene.id)).flatMap(scene => scene.sentences)) : null;
  const windows = windowsOf(order, blockOf).filter(window => !chosen || window.asked.some(id => chosen.has(id)));
  const usage = { requests: 0, chars: 0, cjk: 0 };
  const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (state, questions, ...rest) => {
    const sent = JSON.stringify({ state, questions });
    usage.requests++; usage.chars += sent.length; usage.cjk += (sent.match(/[　-鿿＀-￯]/g) ?? []).length;
    return live.decide(state, questions, ...rest);
  } }, join(dirname(dirname(resolve(readingPath))), 'cache'));
  const blocks = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, windows.length) }, async () => {
    while (next < windows.length) {
      const window = windows[next++], asked = window.asked.map(sentence), questions = S.blockQuestions(asked);
      const { replies } = await ask(jev.decide.bind(jev), kindsMode, { summary: `Processing block ${window.block}.`, before: window.before.map(sentence), asked, questions }, null);
      blocks.push(...S.blockAnswers(asked, replies).map(answer => ({ ...answer, block: window.block })));
    }
  }));
  const position = new Map(order.map((id, n) => [id, n]));
  blocks.sort((a, b) => position.get(a.first) - position.get(b.first));
  const types = blocks.reduce((sum, block) => ({ ...sum, [block.type ?? 'none']: (sum[block.type ?? 'none'] ?? 0) + 1 }), {});
  if (chosen) await writeFile(resolve(values.out ?? 'blocks-trial.json'), JSON.stringify({ model: live.modelId, blocks }, null, 1));
  else { await copyFile(readingPath, readingPath.replace(/\.json$/, '.before-blocks.json')); await writeFile(readingPath, JSON.stringify({ ...reading, blocks })); }
  console.log(JSON.stringify({ model: live.modelId, windows: windows.length, blocks: blocks.length, types, paid: usage }));
}
