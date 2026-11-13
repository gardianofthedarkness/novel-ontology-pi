// The stills cast as a pre-film step (engine/casts/stills.mjs; docs/v3/design.html#stills): each story picture of the book's
// album, prepared locally (faces lettered, text read: tools/album-portraits/stills.py, NOVEL_PORTRAIT_PYTHON), asked of Jev
// with the book's portraits and the text around it, one request a picture (paid, cents; cached). Writes beside the reading:
// pictures.json (the notes: kinds, cards, who, where, when, what each text is; no words of the book) and pictures-text.json
// (the words read in the pictures: the book's, kept with it, never exported). The pre-film notes take pictures.json in
// (prefilm.mjs loadPrefilm).
//
//   node engine/casts/run/stills.mjs <novel-dir> <reading>/v2/data.json [--dry] [--pictures ill_0009,ill_0012] [--cache <dir>]
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import * as ST from '../stills.mjs';

// What a child process needs on Windows besides PATH (its system folder, profile and temporary folders), when its environment is made anew.
const windowsEnvironment = () => process.platform !== 'win32' ? {} : Object.fromEntries(['SystemRoot', 'SystemDrive', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'PROGRAMFILES'].map(name => [name, process.env[name]]).filter(([, value]) => value !== undefined));

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { dry: { type: 'boolean' }, pictures: { type: 'string' }, cache: { type: 'string' } } });
if (!novelDir || !readingPath) { console.error('usage: node engine/casts/run/stills.mjs <novel-dir> <data.json> [--dry] [--pictures ill_0009,...] [--cache <dir>]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), album = join(dir, 'album');
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const notes = await (await import('../prefilm.mjs')).loadPrefilm(dir).catch(() => null);
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const sentences = await loadWorkspaceSentences(resolve(novelDir)), text = id => sentences.get(id)?.text ?? '';

// The pictures, prepared locally: faces lettered, text read, the portraits' gallery, each face matched against the
// references (the plates' portraits, and the faces confirmed before, from the universe's face store).
const python = process.env.NOVEL_PORTRAIT_PYTHON;
if (!python) { console.error('NOVEL_PORTRAIT_PYTHON: the Python with the cropper\'s packages (tools/album-portraits/requirements.txt)'); process.exit(2); }
const prepare = async references => {
  const list = join(album, 'stills', 'references.json');
  await mkdir(join(album, 'stills'), { recursive: true });
  await writeFile(list, JSON.stringify(references));
  const { stdout } = await promisify(execFile)(python, [join(repository, 'tools', 'album-portraits', 'stills.py'), album, '--sheets', join(album, 'stills'), '--references', list], { maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...windowsEnvironment(), PYTHONUTF8: '1' } });
  return JSON.parse(stdout);
};

// The universe's face store (the user, 2026-11-05: portraits "sampling from ground truth"): each face named surely in a
// story picture (Jev sure and the matcher agreeing, stills.mjs confirmedFaces), kept as a black-and-white reference for the
// next picture and the next book. The book's own art: kept with the library, never exported (universe.ts).
const library = (await load('dist/src/ground/workspace/universe.js')).libraryOf(dir);
const storeDir = library ? join(library.root, 'universe', 'faces') : join(dir, 'faces'), book = library?.book ?? 'book';
const store = JSON.parse(await readFile(join(storeDir, 'faces.json'), 'utf8').catch(() => '{"version":1,"faces":[]}'));
const storedReferences = () => store.faces.map(face => ({ id: `face:${face.id}`, entityId: face.entityId, path: join(storeDir, face.file), picture: face.book === book ? face.picture : null }));
const records = (await readFile(join(album, 'ontology', 'illustrations.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const wanted = values.pictures ? new Set(values.pictures.split(',')) : null;
const pictures = records.filter(record => record.kind === 'story' && (!wanted || wanted.has(record.id)));

// Each introduced person's line (front.json, the introduction), for who they are.
const front = JSON.parse(await readFile(join(dir, 'front.json'), 'utf8').catch(() => 'null'));
let intro = null;
if (front && reading.intro?.cast?.length) {
  const { introParts, introSentences } = await load('dist/src/reading/front.js'), { sentences: lines } = introSentences(introParts(front));
  intro = { cast: reading.intro.cast.map((entry, k) => ({ entity: entry.entity, line: lines[k]?.text ?? null })) };
}

const unitOfSentence = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
const cardOf = new Map(reading.cards.map(card => [card.id, card])), unitOf = id => unitOfSentence.get(cardOf.get(id)?.first) ?? null, firstOf = id => cardOf.get(id)?.first ?? null;
const png = async path => (await readFile(path)).toString('base64');
const TASK = 'The book\'s illustration of a light novel (`picture`: its faces boxed and lettered A, B, C, its text boxed and numbered t1, t2; each face also alone, `face_A`, `face_B`) and the book\'s character portraits, each its own picture named by the person (`portrait_char_000007`; `people.*.portrait` names it), and for some a face of theirs confirmed in another of the book\'s pictures, black and white as this one (`reference_char_000007`; `people.*.reference`). The illustration stands in the text after the sentence `units` marks; it may show the text before it or after it. `passage` is the text around it, `cards` its parts, `units` what each unit is about, where and when. For telling faces apart: `faces.*.portraitMatch` is an anime character matcher\'s difference between the face and each person\'s nearest reference (their portrait, or a face of theirs confirmed in another picture; same character, close, unlike: against colour portraits it is often unsure of black-and-white drawings); `people.*.looks` how the book describes each person, `people.*.facts` what it says of them, `people.*.introduced` the book\'s introduction of them; `groups` the people who were last seen together in the units before (several faces in one picture are most likely a group seen together; one person is in one moment only once: two faces in one moment are two people).';

let paid = 0, asked = 0;
const jev = values.dry ? null : await (async () => {
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
  const live = jevFromEnv({ ...process.env, JEV_MODEL: process.env.JEV_MODEL ?? 'jev-1.14.0' });
  return cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-stills')));
})();

const BUDGET = 20_000;
/** One pass over the pictures: each brief, asked of Jev with its pictures; the notes, the words read, and the faces confirmed. */
const pass = async prepared => {
  const notesOut = [], words = {}, confirmed = [];
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
    const questions = ST.stillsQuestions({ prep, cards: brief.cards, people: brief.people });
    const state = { task: TASK, ...brief.state };
    console.error(`${picture.id}: ${brief.units.length} units, ${brief.cards.length} cards, ${brief.people.length} people, ${prep.faces.length} faces, ${prep.texts.length} texts; ${questions.length} questions, ${JSON.stringify(state).length} characters`);
    asked++;
    if (values.dry) continue;
    const references = new Map((prepared.references ?? []).map(entry => [entry.id, entry]));
    const faceImages = Object.fromEntries(await Promise.all(prep.faces.filter(face => face.crop).map(async face => [`face_${face.letter}`, await png(face.crop)])));
    const portraitImages = Object.fromEntries(await Promise.all((prepared.gallery ?? []).filter(entry => entry.sheet && brief.people.includes(entry.entityId)).map(async entry => [`portrait_${entry.entityId}`, await png(entry.sheet)])));
    const nearest = ST.nearestReferences(prep);
    const referenceImages = Object.fromEntries(await Promise.all([...nearest].filter(([id, entry]) => brief.people.includes(id) && references.has(entry.ref)).map(async ([id, entry]) => [`reference_${id}`, await png(references.get(entry.ref).path.replace(/\.png$/, '-square.png'))])));
    const replies = await jev.decide(state, questions, { images: { picture: await png(prep.sheet), ...faceImages, ...portraitImages, ...referenceImages } });
    const note = ST.stillsNote({ picture, prep, replies, cards: brief.cards, text, unitOf });
    note.facts = ST.pictureFacts(note, firstOf, unitOf);
    notesOut.push(note);
    words[picture.id] = Object.fromEntries(prep.texts.map(entry => [entry.ref, entry.text]));
    for (const face of ST.confirmedFaces(note, prep, { threshold: prepared.matchThreshold ?? 0.178 })) { const own = prep.faces.find(entry => entry.letter === face.letter); confirmed.push({ ...face, crop: own?.matchCrop ?? null, square: own?.crop ?? null }); }
  }
  return { notesOut, words, confirmed };
};

// Pass 1 with the references the universe has; the faces it confirms join the store; pass 2 (when it gained any) asks
// again with each candidate's nearest confirmed face beside their portrait. A face is never matched against itself.
let prepared = await prepare(storedReferences()), result = await pass(prepared);
if (values.dry) { console.log(JSON.stringify({ dry: true, pictures: asked })); process.exit(0); }
const keep = async confirmed => {
  let added = 0;
  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  for (const face of confirmed) {
    if (!face.crop) continue;
    // The crop the matcher compares, and a square copy of it for Jev (it takes square pictures only).
    const id = `${book}/${face.picture}/${face.letter}`, file = `${book}-${face.picture}-${face.letter}.png`;
    await copyFile(face.crop, join(storeDir, file));
    if (face.square) await copyFile(face.square, join(storeDir, file.replace(/\.png$/, '-square.png')));
    const entry = { id, entityId: face.entityId, book, picture: face.picture, letter: face.letter, file, sure: face.sure, difference: face.difference, at: new Date().toISOString() };
    const at = store.faces.findIndex(existing => existing.id === id);
    if (at >= 0) { if (store.faces[at].entityId !== entry.entityId) store.faces[at] = entry; } else { store.faces.push(entry); added++; }
  }
  await writeFile(join(storeDir, 'faces.json'), JSON.stringify(store, null, 1), { mode: 0o600 });
  return added;
};
const firstAdded = await keep(result.confirmed);
console.error(`pass 1: ${result.confirmed.length} faces confirmed, ${firstAdded} new references (${store.faces.length} in the store)`);
let passes = 1;
if (firstAdded) { prepared = await prepare(storedReferences()); result = await pass(prepared); passes = 2; await keep(result.confirmed); }
const at = new Date().toISOString();
await writeFile(join(dir, 'pictures.json'), JSON.stringify({ version: 1, at, by: 'the stills cast (engine/casts/stills.mjs)', model: jev?.modelId ?? null, passes, gallery: prepared.gallery ?? [], references: store.faces.length, pictures: result.notesOut }, null, 1), { mode: 0o600 });
await writeFile(join(dir, 'pictures-text.json'), JSON.stringify({ version: 1, at, words: result.words }, null, 1), { mode: 0o600 });
console.log(JSON.stringify({ pictures: result.notesOut.length, passes, paid, references: store.faces.length, facts: result.notesOut.reduce((n, note) => n + note.facts.length, 0) }));
