// The faculties whose answers are picks from fixed lists, asked of Jev (the user, 2026-11-04: "list all faculties that can
// be converted to jev because we could derive a discrete list of possible outputs ... test their performance against a
// work llm"). Each is asked over the same units, with the same lists, beside the work model's answers in faculties.json:
//
//   scale     per unit: its frame and one move's reach (referents), the camera angle, how long it lasts
//   ambience  per unit where ambience fired: the crowd's size and state for most of it
//   channel   per spoken line where conversation fired: what the line goes through (face to face, a phone, a door…)
//
// Jev answers each question with a probability over its options. Paid (Jev), cached under --cache.
//
//   JEV_MODEL=jev-1.14.0 node experiments/v2/faculty-jev.mjs <novel-dir> <reading>/v2/data.json [--to scene_000084] --out <file> [--cache <dir>]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as DG from '../../world-engine/digest/digest.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { to: { type: 'string' }, out: { type: 'string' }, cache: { type: 'string' } } });
if (!novelDir || !readingPath || !values.out) { console.error('usage: node experiments/v2/faculty-jev.mjs <novel-dir> <data.json> [--to <unit>] --out <file> [--cache <dir>]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8')), faculties = JSON.parse(await readFile(join(dirname(resolve(readingPath)), 'faculties.json'), 'utf8'));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/v2/context/engine.js');
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
const last = values.to ? reading.scenes.findIndex(scene => scene.id === values.to) : reading.scenes.length - 1, units = reading.scenes.slice(0, last + 1);

let paid = 0;
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dirname(resolve(values.out)), 'cache-faculty-jev')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const given = (name, collect) => ({ name, key: name, quota: 0, keep: true, collect: focus => collect(focus).map(([id, fields]) => ({ id, score: 1, fields })) });
const modeOf = (name, task, definitions, source) => ({ name, task, definitions: () => definitions, sources: [given(source, focus => focus.items)], cutOrder: [], questions: focus => focus.questions, budget: 120_000 });
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const whereOf = id => faculties.units[id]?.generalist?.digest?.where ?? null;
const unitText = (unit, size = 3000) => clip(unit.sentences.map(line).join(''), size);
const pick = reply => reply ? { value: reply.value, confidence: Math.round((reply.confidence ?? 0) * 1000) / 1000, distribution: reply.distribution ?? null } : null;
const choice = (key, instructions, options, hints) => ({ key, primitive: 'choice', instructions, options: [...options], ...(hints ? { optionHints: hints } : {}) });

// ── Scale ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const REFERENT_HINTS = { 'a person': 'one person or two close together', 'the room': 'one room', 'the building': 'a building, inside or its outside', 'the street': 'a street, as far as one can see along it', 'the block': 'a few streets round', 'a landmark': 'as far as a named landmark', 'the district': 'a district of the city', 'the city': 'the whole city' };
const ANGLE_HINTS = { 'eye level': 'a person\'s height, level', 'over a shoulder': 'behind one person, toward another', high: 'from above, looking down at a slant', 'top-down': 'straight down', 'low, looking up': 'from low, looking up at someone', aerial: 'from high over the city' };
const DURATION_HINTS = { 'a few seconds': 'a blow, a glance, a line or two', 'about a minute': 'a short exchange', 'several minutes': 'a conversation, a walk', 'an hour or more': 'a long stretch of time' };
const scaleMode = modeOf('faculty-scale', 'Segments of a light novel being staged in a 3D city, each given whole with where it plays. For each, recommend to the camera operator how much of the world it takes in, from what angle to look, how far one move in it goes, and how long it lasts in the story; each said by what it spans, never in metres. The scale is often only implied: leaping between towers, crossing districts, a fight in one room.',
  { referents: REFERENT_HINTS, angles: ANGLE_HINTS, durations: DURATION_HINTS }, 'segments');
const out = { model: live.modelId, scale: {}, ambience: {}, channel: {} };
for (let n = 0; n < units.length; n += 6) {
  const batch = units.slice(n, n + 6), key = (unit, k) => `unit_${n + k + 1}`;
  const items = batch.map((unit, k) => [key(unit, k), { where: whereOf(unit.id), text: unitText(unit) }]);
  const questions = batch.flatMap((unit, k) => [
    choice(`frame:${unit.id}`, `How much of the world does segments.${key(unit, k)} take in, for the camera's frame?`, DG.REFERENTS, REFERENT_HINTS),
    choice(`angle:${unit.id}`, `From what angle should the camera look at segments.${key(unit, k)}?`, DG.ANGLES, ANGLE_HINTS),
    choice(`reach:${unit.id}`, `How far does one move in segments.${key(unit, k)} go?`, DG.REFERENTS, REFERENT_HINTS),
    choice(`duration:${unit.id}`, `How long does segments.${key(unit, k)} last in the story?`, Object.keys(DG.DURATIONS), DURATION_HINTS),
  ]);
  const { replies } = await ask(decide, scaleMode, { items, questions }, null);
  for (const unit of batch) out.scale[unit.id] = Object.fromEntries(['frame', 'angle', 'reach', 'duration'].map(field => [field, pick(replies.find(reply => reply.key === `${field}:${unit.id}`))]));
  console.error(`scale: ${Math.min(n + 6, units.length)} of ${units.length}`);
}

// ── Ambience (where the work model's ambience fired) ─────────────────────────────────────────────────────────────
const SIZE_HINTS = { none: 'nobody but the people named', few: 'a handful of passers-by', some: 'a street\'s ordinary traffic', many: 'a busy street or a full room', packed: 'shoulder to shoulder' };
const STATE_HINTS = { milling: 'strolling, shopping, standing about', flowing: 'going somewhere, commuting, passing through', gathering: 'watching or drawn to something or someone', alarmed: 'scared, fleeing, scattering', gone: 'the place emptied' };
const ambienceMode = modeOf('faculty-ambience', 'Segments of a light novel being staged in a 3D city, each given whole with where it plays. For each, say the crowd of its place for most of the segment: the people not named who fill it, how many and what they are doing.', { sizes: SIZE_HINTS, states: STATE_HINTS }, 'segments');
const crowded = units.filter(unit => faculties.units[unit.id]?.ambience?.length);
for (let n = 0; n < crowded.length; n += 8) {
  const batch = crowded.slice(n, n + 8), key = k => `unit_${n + k + 1}`;
  const items = batch.map((unit, k) => [key(k), { where: whereOf(unit.id), text: unitText(unit) }]);
  const questions = batch.flatMap((unit, k) => [
    choice(`size:${unit.id}`, `How many people not named fill the place of segments.${key(k)} for most of it?`, DG.CROWD_SIZES, SIZE_HINTS),
    choice(`state:${unit.id}`, `What is that crowd doing for most of segments.${key(k)}?`, DG.CROWD_STATES, STATE_HINTS),
  ]);
  const { replies } = await ask(decide, ambienceMode, { items, questions }, null);
  for (const unit of batch) out.ambience[unit.id] = { size: pick(replies.find(reply => reply.key === `size:${unit.id}`)), state: pick(replies.find(reply => reply.key === `state:${unit.id}`)) };
  console.error(`ambience: ${Math.min(n + 8, crowded.length)} of ${crowded.length}`);
}

// ── Channel (each spoken line where the work model's conversation fired) ─────────────────────────────────────────
const CHANNEL_HINTS = { 'face to face': 'in person, within earshot', 'a group together': 'several people together in person', phone: 'a phone call', 'video call': 'a video call', message: 'a text or written message', 'through a door or wall': 'heard through a door or wall', 'loudspeaker or broadcast': 'a loudspeaker, radio or broadcast', telepathy: 'mind to mind', 'a voice from afar': 'called out from a distance' };
const channelMode = modeOf('faculty-channel', 'A passage of a light novel being staged in a 3D city, with where it plays. For each spoken line asked about, say what the voice goes through to reach those it speaks to.', { channels: CHANNEL_HINTS }, 'passage');
for (const unit of units.filter(unit => faculties.units[unit.id]?.conversation?.exchanges?.length)) {
  const spoken = unit.sentences.filter(id => reading.kinds?.[id]?.kind === 'spoken');
  for (let n = 0; n < spoken.length; n += 30) {
    const asked = spoken.slice(n, n + 30), first = unit.sentences.indexOf(asked[0]), lastAt = unit.sentences.indexOf(asked.at(-1));
    const passage = unit.sentences.slice(Math.max(0, first - 4), lastAt + 5);
    const items = [['where', whereOf(unit.id)], ...passage.map(id => [id, clip(line(id), 300)])];
    const questions = asked.map(id => choice(`channel:${id}`, `What does the spoken line passage.${id} go through to reach those it speaks to?`, Object.keys(DG.CHANNELS), CHANNEL_HINTS));
    const { replies } = await ask(decide, channelMode, { items, questions }, null);
    for (const id of asked) out.channel[id] = { unit: unit.id, ...pick(replies.find(reply => reply.key === `channel:${id}`)) };
  }
  console.error(`channel: ${unit.id}`);
}

out.paid = paid;
await writeFile(resolve(values.out), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ scale: Object.keys(out.scale).length, ambience: Object.keys(out.ambience).length, channel: Object.keys(out.channel).length, paid }));
