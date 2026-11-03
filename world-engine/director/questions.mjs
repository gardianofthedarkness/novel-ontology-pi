// How each faculty and each director is asked, and what it may answer (the user, 2026-11-03: "per faculty and per
// director, I would like to each get a separate page for how are they asked and what are their options"). Built ones come
// from the code itself: the summarizer's prompts (digest.mjs), and each Jev mode run on a sample whose names are
// placeholders (<the mover>, lettered spots), so a page shows the very task and options Jev is given. Proposed ones are
// written here, in the same form, to be built from.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DG from '../digest/digest.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const letters = (n, said) => Array.from({ length: n }, (_, k) => ({ letter: String.fromCharCode(65 + k), said: said(k) }));

const EMOTIONS = ['joy', 'anger', 'fear', 'sadness', 'surprise', 'disgust', 'embarrassment', 'calm', 'determination', 'affection'];
const CHANNELS = ['face to face', 'a group together', 'phone', 'video call', 'message', 'through a door or wall', 'loudspeaker or broadcast', 'telepathy', 'a voice from afar'];
const FORMATIONS = ['beside', 'facing', 'across a table', 'a ring', 'side by side walking', 'behind', 'two sides of a door', 'apart'];
const MANNERS = ['walk', 'run', 'zigzag through alleys', 'up or along a wall', 'leaps between roofs', 'flight', 'carried', 'a vehicle', 'an underground passage'];
const DISTANCES = ['under 50 m', '50–300 m', '300 m – 2 km', 'over 2 km'];
const ATTACKS = ['hand to hand', 'grapple or throw', 'blade or blunt weapon', 'firearm', 'ranged power', 'beam or laser', 'area blast', 'thrown object', 'the ground or a building itself', 'an ability that cancels'];
const SHAPES = ['point', 'line or beam', 'cone', 'sphere', 'ring', 'wave along the ground', 'rain from above'];
const RANGES = ['touch', 'close (under 3 m)', 'near (under 15 m)', 'far (under 100 m)', 'very far'];
const OUTCOMES = ['hit', 'dodged', 'blocked', 'cancelled', 'missed'];
const ZOOMS = ['a room (~15 m)', 'a street (~80 m)', 'a block (~300 m)', 'a district (~1.5 km)', 'the city'];
const ANGLES = ['eye level', 'over a shoulder', 'high', 'top-down', 'low, looking up', 'aerial'];
const CROWD = ['none', 'few', 'many', 'packed'];
const FLOWS = ['still', 'milling', 'along the street', 'a queue', 'marching as one body', 'fleeing', 'gathering'];
const VEHICLES = ['car', 'motorbike', 'bus or truck', 'train or subway', 'drone', 'aircraft or VTOL', 'boat', 'robot', 'handgun', 'rifle', 'blade', 'blunt weapon', 'explosive', 'tool or device', 'other'];
const USES = ['shops', 'mall', 'cinema', 'restaurants', 'offices', 'flats', 'hotel', 'school', 'hospital', 'station', 'car park', 'plant room', 'rooftop deck'];
const RECORD = '{ sentence, sure (0..1) } on every entry; only the ids given for people, places and sentences';

/**
 * How each faculty is asked of the work model: `unit` (what one request covers), `system`, `task`, `given` (what it
 * reads), `shape` (its JSON answer, each field with its options). The generalist's are digest.mjs's own.
 */
export const FACULTY_ASKS = {
  frame: { unit: 'one request a scene, in reading order', system: 'You read one scene of a light novel being staged in a 3D city, and frame it for the stage manager.', task: 'Say where the scene is set (a path down the place tree), who is on stage and when they come and go, how it follows the scene before, and where its beats begin.',
    given: ['the scene\'s sentences, numbered', 'the place tree round the scene\'s place', 'the memory from the scene before', 'who the script has present'],
    shape: { set: 'place ids, from the widest to the narrowest', onStage: '[{ who, from: start | enters at <sentence>, until: end | leaves at <sentence> }]', continues: ['carries straight on', 'later the same day', 'another day', 'elsewhere at the same time', 'a flashback', 'a montage'], beats: '[{ first: <sentence>, what: words }]' } },
  scale: { unit: 'one request a beat', system: 'You read one beat of a light novel being staged in a 3D city, and recommend to its camera operator how far out to stand and from where to look.', task: 'Say how many metres across this beat plays, the angle to see it from, whose eyes or which landmark it is seen from, and how far its moves reach.',
    given: ['the beat\'s lines', 'the scene frame (the set, who is on stage)', 'which action director leads it', 'the place tree round the set'],
    shape: { zoom: ZOOMS, metres: 'a number', angle: ANGLES, from: '<person id> | <place id> | none', reach: DISTANCES } },
  generalist: { derived: 'world-engine/digest/digest.mjs' },
  conversation: { unit: 'one request a fired span', system: 'You read a passage of a light novel and say who talks with whom, through what, and how they stand.', task: 'For each exchange, its people and channel; for each group, its formation; who looks at whom.',
    given: ['the span\'s lines, numbered', 'the people present with their ids', 'the scene frame'],
    shape: { exchanges: { who: '<person id>', with: '[<person id>]', channel: CHANNELS }, formations: { who: '[<person id>]', formation: FORMATIONS }, attention: { who: '<person id>', looksAt: '<person id> | <thing>' } } },
  feeling: { unit: 'one request a fired span', system: 'You read a passage of a light novel and say how each person\'s feelings, wishes and bonds change in it.', task: 'Each change of feeling (which, how much up or down), each wish that forms, each bond that moves.',
    given: ['the span\'s lines', 'the people present', 'their feelings and bonds so far (the ontology\'s fold)'],
    shape: { feelings: { who: '<person id>', emotion: EMOTIONS, change: '-1..1' }, intent: { who: '<person id>', wants: 'words', toward: '<person id> | null' }, bonds: { who: '<person id>', to: '<person id>', change: '-1..1', firstMeeting: 'true | false' } } },
  journeys: { unit: 'one request a fired span', system: 'You read a passage of a light novel being staged in a 3D city and trace each journey in it across the city\'s places.', task: 'For each journey: who, from where, through which places, to where, how, how far and how long.',
    given: ['the span\'s lines', 'the place tree round the set, with named buildings, streets, bridges and stations', 'where each person is now'],
    shape: { journeys: { who: '<person id>', from: '<place id>', via: '[<place id>]', to: '<place id> | words', manner: MANNERS, distance: DISTANCES, duration: 'words' } } },
  choreography: { unit: 'one request a fired span', system: 'You read a fight in a light novel, exchange by exchange, for those staging it.', task: 'For each exchange: who attacks whom, with what kind of attack, of what shape and range, what happens, how far anyone is thrown, what breaks.',
    given: ['the span\'s lines', 'the fighters and their known abilities', 'the scene frame'],
    shape: { exchanges: { attacker: '<person id>', target: '<person id> | <place> | <thing>', attack: ATTACKS, shape: SHAPES, range: RANGES, outcome: OUTCOMES, knockback: 'metres', breaks: 'words | null' } } },
  ambience: { unit: 'one request a fired span', system: 'You read the setting of a scene of a light novel and describe its crowd and atmosphere for the stage.', task: 'The crowd (how many, who, how it moves, whether it is a named group), the weather, the light, the mood.',
    given: ['the span\'s lines', 'the reading\'s crowd slots in the scene', 'the set'],
    shape: { crowd: { present: CROWD, makeup: '[couples, shoppers, students, workers, security, onlookers, …]', flow: FLOWS, named: '<crowd slot id> | null' }, weather: 'words', light: 'words', mood: 'words' } },
  props: { unit: 'one request a fired span', system: 'You read a passage of a light novel and list the vehicles, weapons and things handled in it.', task: 'Each vehicle, weapon or thing: what kind, what happens to it, who has it.',
    given: ['the span\'s lines', 'the reading\'s vehicle and weapon slots', 'the things already known and who holds them'],
    shape: { things: { name: 'as the text calls it', kind: VEHICLES, event: DG.ITEM_EVENTS, who: '<person id> | null', to: '<person id> | null', size: 'metres' } } },
  setting: { unit: 'one request a fired span', system: 'You read the description of buildings and rooms in a light novel for the architect who builds them.', task: 'Each building: its look, its floors and what each holds, its features; each room: where it is and what is in it.',
    given: ['the span\'s lines', 'the building the world borrowed for it (floors, size, kind)', 'the place tree'],
    shape: { buildings: { place: '<place id> | name', look: 'words', floors: 'a number', uses: { floors: 'from–to', use: USES }, features: '[helipad, sky garden, atrium, elevator shaft, …]' }, rooms: { name: 'words', in: '<place id>', floor: 'a number', makeup: 'words', size: 'm²' } } },
};

/** The generalist's own prompts and answer shapes, as digest.mjs sends them. */
export const generalistAsks = () => ({ unit: 'a scene request, then one request a window of about 30 sentences', parts: [
  { name: 'The scene digest', system: DG.SCENE_SYSTEM, task: 'Summarize this scene for staging.', given: ['the scene\'s sentences, numbered, with their kinds', 'the people with ids', 'the memory from the scene before'], shape: DG.SCENE_SHAPE },
  { name: 'The window digest', system: DG.WINDOW_SYSTEM, task: 'For each sentence of the passage (not the context), list what it does.', given: ['the passage and three lines of context either side', 'the scene digest', 'the people with ids', 'the memory'], shape: DG.WINDOW_SHAPE },
] });

/**
 * Each director's Jev questions. A built one names its mode and a sample focus (placeholders), and is run through the
 * mode itself; or names the code it is asked from. A proposed one is written out: `primitive` (choice, score, box, noul),
 * `instructions`, `options` with `hints`, the `picture` it is asked on.
 */
export const DIRECTOR_QUESTIONS = {
  stage: [
    { mode: 'spawnModes.spawnSpotMode', sample: { scene: { label: '<the scene>', when: null }, place: { name: '<the place>', kind: '<its kind>', floors: null }, subjects: [{ id: '<a person>', name: '<a person>' }], spots: letters(4, k => `<spot ${k + 1}: what it is>`) } },
    { mode: 'directorModes.sceneGoesOnMode', sample: { before: { id: '<scene before>', place: '<its place>', lines: [], people: [] }, now: { id: '<this scene>', place: '<its place>', lines: [], people: [] } } },
    { key: 'set', status: 'proposed', primitive: 'choice', instructions: 'Which lettered place on picture "map" is where this scene plays?', options: ['A', 'B', 'C', '…', 'none'], hints: { A: '<a place of the tree, with its scale>', none: 'none of these' }, picture: 'the place tree round the scene\'s place, as a map with its places lettered' },
  ],
  routine: [
    { mode: 'directorModes.dialogueKindMode', sample: { scene: { id: '<scene>', place: '<the place>' }, lines: [], speaker: '<the speaker>', people: [] } },
    { mode: 'directorModes.moveSpotMode', sample: { scene: { id: 'scene_000001', place: '<the place>', when: null }, card: { id: '<card>', lines: [{ id: '<a line of the card>', text: '' }] }, mover: { id: '<the mover>', name: '<the mover>' }, lines: [{ id: '<a line near it>', text: '' }], now: {}, pictures: {}, direction: '<toward what>', spots: letters(3, k => `<spot ${k + 1}>`) } },
    { key: 'formation', status: 'proposed', primitive: 'choice', instructions: 'Where in the room is <a person> during this beat?', options: ['A', 'B', 'C', '…'], hints: { A: '<a seat or spot on the plan>' }, picture: 'the room\'s plan from above at the beat\'s zoom, its furniture and free spots lettered, everyone placed so far' },
    { key: 'facing', status: 'proposed', primitive: 'choice', instructions: 'Whom or what does <a person> face?', options: ['<each person present>', 'the door', 'the window', 'away'] },
    { key: 'addressed', status: 'proposed', primitive: 'choice', instructions: 'To whom is this line said, judging by the faces turned?', options: ['<each person present>', 'everyone', 'no one present'], picture: 'the beat at its recommended angle, faces turned' },
  ],
  mega: [
    { mode: 'directorModes.moveDirectionMode', sample: { scene: { id: 'scene_000001', place: '<the place>', when: null }, card: { id: '<card>', lines: [{ id: '<a line of the card>', text: '' }] }, mover: { id: '<the mover>', name: '<the mover>' }, lines: [{ id: '<a line near it>', text: '' }], now: {}, pictures: {}, arrows: letters(14, k => `<arrow ${String.fromCharCode(65 + k)}: what it meets>`), others: [{ id: '<another>', name: '<another>' }] }, note: 'today framed 16 m across; at the beat\'s zoom once the scale faculty is in' },
    { code: 'world-engine/director/director.mjs (megaMove, M6)', key: 'landmark', status: 'built', primitive: 'choice', instructions: 'Which lettered landmark does <the mover> reach?', options: ['A', 'B', '…', 'none'], hints: { A: '<a building: its name, floors, distance>', none: 'none of these' }, picture: 'top-down map at the journey\'s reach, north up, the mover at its middle, the twelve tallest buildings within reach lettered on red spheres' },
    { key: 'route', status: 'proposed', primitive: 'choice', instructions: 'Which route is it?', options: ['A', 'B', 'C', 'none'], hints: { A: '<a route of the place graph: its places and length>' }, picture: 'the same map with up to three routes drawn' },
    { key: 'extent', status: 'proposed', primitive: 'box', instructions: 'Box the area the catastrophe reaches.', picture: 'top-down map at the beat\'s zoom' },
    { key: 'flow', status: 'proposed', primitive: 'choice', instructions: 'Which way does the crowd flow?', options: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'still', 'toward the marked point', 'away from it'], picture: 'the street from high, the crowd field drawn' },
  ],
  combat: [
    { code: 'world-engine/director/director.mjs (destruction)', key: 'where', status: 'built', primitive: 'choice', instructions: 'Which lettered red sphere in picture "where" is where this card breaks something? Answer none if it breaks nothing.', options: ['A', 'B', '…', 'none'], hints: { A: '<a spot on a building>', none: 'it breaks nothing' }, picture: 'the place at this moment, red spheres where it might break' },
    { code: 'world-engine/director/director.mjs (destruction)', key: 'size', status: 'built', primitive: 'choice', instructions: 'Which labelled sphere is the size of what this card breaks?', options: ['1', '2', '3', '4'], hints: { 1: '4 m across', 2: '8 m', 3: '16 m', 4: '32 m' }, picture: 'where it hits, close up from two sides, four spheres round the point' },
    { key: 'attack', status: 'proposed', primitive: 'choice', instructions: 'What kind of attack is this exchange?', options: ATTACKS, picture: 'the fighters at the beat\'s zoom and angle' },
    { key: 'shape', status: 'proposed', primitive: 'choice', instructions: 'What shape does it take in space?', options: SHAPES, picture: 'the same, with the attacker and target marked' },
    { key: 'outcome', status: 'proposed', primitive: 'choice', instructions: 'What happens to the target?', options: OUTCOMES },
    { key: 'knockback', status: 'proposed', primitive: 'score', instructions: 'How far is the target thrown?', options: ['0 m', '1 m', '3 m', '10 m', '30 m'] },
  ],
  character: [
    { key: 'feeling', status: 'proposed', primitive: 'choice', instructions: 'What does <a person> feel most strongly now?', options: EMOTIONS, picture: 'none: the text and their feelings so far' },
    { key: 'strength', status: 'proposed', primitive: 'score', instructions: 'How strongly?', options: ['faint', 'clear', 'strong', 'overwhelming'] },
    { key: 'bond', status: 'proposed', primitive: 'choice', instructions: 'How does <a person> stand with <another> after this?', options: ['closer', 'colder', 'unchanged', 'a first meeting'] },
    { key: 'intent', status: 'proposed', primitive: 'choice', instructions: 'What does <a person> want next?', options: ['<each wish the inner-state faculty found>', 'none of these'] },
  ],
  transport: [
    { key: 'model', status: 'proposed', primitive: 'choice', instructions: 'Which lettered model is this <vehicle or weapon>?', options: ['A', 'B', '…', 'none'], hints: { A: '<a model of the packs: its kind and size>' }, picture: 'a model sheet: the candidate models side by side, lettered' },
    { key: 'holder', status: 'proposed', primitive: 'choice', instructions: 'Who drives, rides or holds it now?', options: ['<each person present>', 'no one'] },
    { key: 'owner', status: 'proposed', primitive: 'choice', instructions: 'Whose is it?', options: ['<each person>', '<an organization>', 'unknown'] },
  ],
  architect: [
    { mode: 'terrainModes.terrainPartMode', sample: { part: { label: '<a part>' }, kind: '<its kind>', host: { label: '<the building>', type: '<its type>', floors: 70, area: 2000 }, floors: letters(4, k => `<floor ${k + 1}>`), sizes: letters(3, k => `<size ${k + 1}>`) } },
    { key: 'look', status: 'proposed', primitive: 'choice', instructions: 'Which lettered look fits <the building> as the text describes it?', options: ['A', 'B', '…'], hints: { A: '<a model or theme>' }, picture: 'the building\'s elevation in each candidate look, side by side' },
    { key: 'uses', status: 'proposed', primitive: 'choice', instructions: 'What is on floors <from–to>?', options: USES, picture: 'the building\'s section, the floors asked about marked' },
    { key: 'room', status: 'proposed', primitive: 'choice', instructions: 'Which lettered layout is <the room>?', options: ['A', 'B', '…'], picture: 'the floor\'s plan with candidate layouts' },
  ],
};

/** A built question run through its mode: the task and questions the mode makes of the sample. */
async function fromMode(entry) {
  const [file, name] = entry.mode.split('.'), modes = await import(pathToFileURL(join(repository, 'dist', 'src', 'v2', 'context', `${file}.js`)).href), mode = modes[name];
  if (!mode) throw new Error(`no mode ${entry.mode}`);
  return { mode: name, code: `src/v2/context/${file}.ts`, status: 'built', task: typeof mode.task === 'function' ? mode.task(entry.sample) : mode.task, given: (mode.sources ?? []).map(source => source.name),
    questions: mode.questions(entry.sample).map(question => ({ key: question.key, primitive: question.primitive, instructions: question.instructions, options: question.options ?? question.levels ?? [], hints: question.optionHints ?? {}, criteria: question.criteria ?? null })), ...(entry.note ? { note: entry.note } : {}) };
}

/** Every director's questions, built ones as their modes make them. */
export async function directorQuestions() {
  const out = {};
  for (const [id, entries] of Object.entries(DIRECTOR_QUESTIONS)) out[id] = await Promise.all(entries.map(entry => (entry.mode ? fromMode(entry) : { ...entry, questions: [{ key: entry.key, primitive: entry.primitive, instructions: entry.instructions, options: entry.options ?? [], hints: entry.hints ?? {} }] })));
  return out;
}
