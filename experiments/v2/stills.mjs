// The stills cast as a pre-film step (world-engine/digest/stills.mjs; docs/v2/stills.md): each story picture of the book's
// album, prepared locally (faces lettered, text read: tools/album-portraits/stills.py, NOVEL_PORTRAIT_PYTHON), asked of Jev
// with the book's portraits and the text around it, one request a picture (paid, cents; cached). Writes beside the reading:
// pictures.json (the notes: kinds, cards, who, where, when, what each text is; no words of the book) and pictures-text.json
// (the words read in the pictures: the book's, kept with it, never exported). The pre-film notes take pictures.json in
// (prefilm.mjs loadPrefilm).
//
//   node experiments/v2/stills.mjs <novel-dir> <reading>/v2/data.json [--dry] [--pictures ill_0009,ill_0012] [--cache <dir>]
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import * as ST from '../../world-engine/digest/stills.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { dry: { type: 'boolean' }, pictures: { type: 'string' }, cache: { type: 'string' } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/stills.mjs <novel-dir> <data.json> [--dry] [--pictures ill_0009,...] [--cache <dir>]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), album = join(dir, 'album');
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const notes = await (await import('../../world-engine/digest/prefilm.mjs')).loadPrefilm(dir).catch(() => null);
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const sentences = await loadWorkspaceSentences(resolve(novelDir)), text = id => sentences.get(id)?.text ?? '';

// The pictures, prepared locally: faces lettered, text read, the portraits' gallery.
const python = process.env.NOVEL_PORTRAIT_PYTHON;
if (!python) { console.error('NOVEL_PORTRAIT_PYTHON: the Python with the cropper\'s packages (tools/album-portraits/requirements.txt)'); process.exit(2); }
const { stdout } = await promisify(execFile)(python, [join(repository, 'tools', 'album-portraits', 'stills.py'), album, '--sheets', join(album, 'stills')], { maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONUTF8: '1' } });
const prepared = JSON.parse(stdout);
const records = (await readFile(join(album, 'ontology', 'illustrations.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const wanted = values.pictures ? new Set(values.pictures.split(',')) : null;
const pictures = records.filter(record => record.kind === 'story' && (!wanted || wanted.has(record.id)));

// Each introduced person's line (front.json, the introduction), for who they are.
const front = JSON.parse(await readFile(join(dir, 'front.json'), 'utf8').catch(() => 'null'));
let intro = null;
if (front && reading.intro?.cast?.length) {
  const { introParts, introSentences } = await load('dist/src/v2/extraction/front.js'), { sentences: lines } = introSentences(introParts(front));
  intro = { cast: reading.intro.cast.map((entry, k) => ({ entity: entry.entity, line: lines[k]?.text ?? null })) };
}

const unitOfSentence = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
const cardOf = new Map(reading.cards.map(card => [card.id, card])), unitOf = id => unitOfSentence.get(cardOf.get(id)?.first) ?? null, firstOf = id => cardOf.get(id)?.first ?? null;
const png = async path => (await readFile(path)).toString('base64');
const TASK = 'The book\'s illustration of a light novel (`picture`: its faces boxed and lettered A, B, C, its text boxed and numbered t1, t2; each face also alone, `face_A`, `face_B`) and the book\'s character portraits, each its own picture named by the person (`portrait_char_000007`; `people.*.portrait` names it). The illustration stands in the text after the sentence `units` marks; it may show the text before it or after it. `passage` is the text around it, `cards` its parts, `units` what each unit is about, where and when. For telling faces apart: `faces.*.portraitMatch` is an anime character matcher\'s difference between the face and each portrait (same character, close, unlike: it is often unsure of black-and-white drawings against colour portraits); `people.*.looks` how the book describes each person, `people.*.facts` what it says of them, `people.*.introduced` the book\'s introduction of them; `groups` the people who were last seen together in the units before (several faces in one picture are most likely a group seen together).';

let paid = 0, asked = 0;
const jev = values.dry ? null : await (async () => {
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const live = jevFromEnv({ ...process.env, JEV_MODEL: process.env.JEV_MODEL ?? 'jev-1.14.0' });
  return cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-stills')));
})();

const notesOut = [], words = {}, BUDGET = 20_000;
for (const picture of pictures) {
  const prep = prepared.pictures.find(entry => entry.id === picture.id);
  if (!prep) continue;
  // Within Jev's request (its tokens, with the pictures): the passage round the picture shrinks, nearest sentences kept,
  // until the brief is under BUDGET characters (vol 1's ill_0011 at 26,752 was refused: max_tokens_exceeded).
  let brief = null;
  for (let most = 160; most >= 40; most -= 20) {
    brief = ST.stillsBrief({ reading, text, picture, prep, gallery: prepared.gallery ?? [], notes, intro, threshold: prepared.matchThreshold ?? null, most });
    if (JSON.stringify(brief.state).length <= BUDGET) break;
  }
  const questions = ST.stillsQuestions({ prep, cards: brief.cards, people: brief.people, gallery: prepared.gallery ?? [] });
  const state = { task: TASK, ...brief.state };
  console.error(`${picture.id}: ${brief.units.length} units, ${brief.cards.length} cards, ${brief.people.length} people, ${prep.faces.length} faces, ${prep.texts.length} texts; ${questions.length} questions, ${JSON.stringify(state).length} characters`);
  asked++;
  if (values.dry) continue;
  const faceImages = Object.fromEntries(await Promise.all(prep.faces.filter(face => face.crop).map(async face => [`face_${face.letter}`, await png(face.crop)])));
  const portraitImages = Object.fromEntries(await Promise.all((prepared.gallery ?? []).filter(entry => entry.sheet && brief.people.includes(entry.entityId)).map(async entry => [`portrait_${entry.entityId}`, await png(entry.sheet)])));
  const replies = await jev.decide(state, questions, { images: { picture: await png(prep.sheet), ...faceImages, ...portraitImages } });
  const note = ST.stillsNote({ picture, prep, replies, cards: brief.cards, text, unitOf, gallery: prepared.gallery ?? [] });
  note.facts = ST.pictureFacts(note, firstOf, unitOf);
  notesOut.push(note);
  words[picture.id] = Object.fromEntries(prep.texts.map(entry => [entry.ref, entry.text]));
}
if (values.dry) { console.log(JSON.stringify({ dry: true, pictures: asked })); process.exit(0); }
const at = new Date().toISOString();
await writeFile(join(dir, 'pictures.json'), JSON.stringify({ version: 1, at, by: 'the stills cast (world-engine/digest/stills.mjs)', model: jev?.modelId ?? null, gallery: prepared.gallery ?? [], pictures: notesOut }, null, 1), { mode: 0o600 });
await writeFile(join(dir, 'pictures-text.json'), JSON.stringify({ version: 1, at, words }, null, 1), { mode: 0o600 });
console.log(JSON.stringify({ pictures: notesOut.length, paid, facts: notesOut.reduce((n, note) => n + note.facts.length, 0), cards: notesOut.map(note => [note.id, note.kind, note.card, note.cardSure]) }));
