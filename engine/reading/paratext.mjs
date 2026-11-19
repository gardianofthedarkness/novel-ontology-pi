// Paratext: which of a book's scenes are not the story (docs/v3/design.html#paratext; the user, 2026-11-19: "we can add a
// paratext detection using jev"). The reading's own front/back matter finder looks for heading words and found none in
// volumes 1-3, so an afterword, the author and the editor came in as scenes and people. Here Jev reads the opening and
// closing lines of every scene and says what it is: the story, an afterword or author's note, a translator's or editor's
// note, or front matter (title, contents, credits, a synopsis).
//
// Only a run of such scenes at the book's start or end is taken as paratext: a book's front and back matter are at its
// edges, and a scene in the middle that reads like a note (a letter, a report) is the story's. Middle ones are listed as
// doubtful, not dropped. Nothing is rewritten: reading/paratext.json lists the scenes, and what crosses books (the
// universe cast, strands, memory) skips them.
//
//   node engine/reading/paratext.mjs <novel-dir> [--reading <data.json>] [--cache <dir>] [--dry]
// Paid: one Jev call per 25 scenes (cached beside the reading).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { storedKeys } from '../volume/credentials.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = (path) => import(pathToFileURL(join(repository, path)).href);
export const KINDS = { story: 'the story itself: narration, dialogue or thought of its people', afterword: "an afterword or the author's own note to readers", note: "a translator's, editor's or publisher's note", front: 'front matter: title page, contents, credits, a synopsis or a character list' };
const OPTIONS = Object.keys(KINDS);
export const BATCH = 25, STORY_BELOW = 0.5;

/** Scenes as Jev sees them: the first four and last two lines, each cut short. */
export function sceneView(scene, line) {
  const ids = scene.sentences ?? [], clip = (s) => (s.length > 120 ? `${s.slice(0, 119)}…` : s);
  const pick = ids.length <= 6 ? ids : [...ids.slice(0, 4), ...ids.slice(-2)];
  return { lines: pick.map((id) => clip(line(id))).filter(Boolean), sentences: ids.length };
}

/**
 * From each scene's chance of being story, the paratext: everything before the story starts and after it ends. The story
 * starts with its first solid stretch: story scenes adding up to SOLID sentences, which a bare heading (a scene of a line
 * or two) does not break and anything longer that is not story does. One scene misjudged at the edge (a two-line blurb
 * taken for story, a one-line teaser after the afterword) cannot hold the edge open. Middle scenes that are not story are
 * listed as doubtful, not dropped.
 */
export const SOLID = 20, HEADING = 2;
export function edges(scenes, verdicts) {
  const notStory = (s) => (verdicts[s.id]?.story ?? 1) < STORY_BELOW, size = (s) => (s.sentences ?? []).length;
  const storyStart = (list) => {
    let start = null, run = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!notStory(s)) { if (start === null) start = i; run += size(s); if (run >= SOLID) return start; }
      else if (size(s) > HEADING) { start = null; run = 0; }
    }
    return list.length;
  };
  const head = storyStart(scenes), tail = scenes.length - storyStart([...scenes].reverse());
  const out = new Set([...scenes.slice(0, head), ...scenes.slice(Math.max(head, tail))].map((s) => s.id));
  return { paratext: scenes.filter((s) => out.has(s.id)).map((s) => s.id), doubtful: scenes.filter((s) => !out.has(s.id) && notStory(s)).map((s) => s.id) };
}

async function main() {
  const { values, positionals: [novelArg] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' } } });
  if (!novelArg) { console.error('usage: node engine/reading/paratext.mjs <novel-dir> [--reading <data.json>] [--cache <dir>] [--dry]'); process.exit(2); }
  const novel = resolve(novelArg), dataFile = resolve(values.reading ?? join(dirname(novel), 'reading', 'data.json'));
  const data = JSON.parse(await readFile(dataFile, 'utf8')), scenes = data.scenes;
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const text = await loadWorkspaceSentences(novel), line = (id) => text.get(id)?.text ?? '';
  const calls = Math.ceil(scenes.length / BATCH);
  if (values.dry) { console.log(JSON.stringify({ scenes: scenes.length, calls })); return; }

  const env = { JEV_MODEL: 'jev-1.14.0', ...process.env, ...storedKeys(process.env) };
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
  let paid = 0;
  const live = jevFromEnv(env), jev = cachedDecisions({ modelId: live.modelId, decide: (...a) => { paid++; return live.decide(...a); } }, resolve(values.cache ?? join(dirname(dataFile), '..', 'cache-paratext')));

  const verdicts = {};
  for (let n = 0; n < scenes.length; n += BATCH) {
    const batch = scenes.slice(n, n + BATCH);
    const state = {
      book: 'A published novel, read scene by scene in order. Some parts of a printed book are not its story: the afterword, notes, the front matter.',
      kinds: KINDS,
      scenes: Object.fromEntries(batch.map((s) => [s.id, { position: `scene ${s.index + 1} of ${scenes.length}`, ...sceneView(s, line) }])),
    };
    const questions = batch.map((s) => ({ key: s.id, primitive: 'choice', instructions: `What is scenes.${s.id}?`, options: OPTIONS, optionHints: KINDS }));
    const answers = await jev.decide(state, questions);
    for (const a of answers) {
      const d = a.distribution ?? { [a.value]: a.confidence ?? 1 };
      verdicts[a.key] = { kind: String(a.value), story: Number(d.story ?? (a.value === 'story' ? a.confidence ?? 1 : 0)), distribution: d };
    }
  }
  const { paratext, doubtful } = edges(scenes, verdicts);
  const out = { version: 1, model: live.modelId, by: 'engine/reading/paratext.mjs', storyBelow: STORY_BELOW, paratext, doubtful, scenes: verdicts };
  await writeFile(join(dirname(dataFile), 'paratext.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ scenes: scenes.length, paratext: paratext.length, doubtful: doubtful.length, calls, paid, first: paratext.filter((id) => scenes.findIndex((s) => s.id === id) < scenes.length / 2), last: paratext.filter((id) => scenes.findIndex((s) => s.id === id) >= scenes.length / 2) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
