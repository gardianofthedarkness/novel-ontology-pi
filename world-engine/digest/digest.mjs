// The summarizer (Track A, docs/v2/next-steps.md A1–A3) and the measurements a passage carries (the user, 2026-11-03:
// "everytime we observe, we actually get multiple state updates, some are subtle and sure, some are confirmed"; a roof
// over someone puts them indoors). The work model reads the text; nothing here is played.
// - The scene digest, once per scene, in reading order: what happens, what the background is doing, each person's routine
//   in it and their state at its start and end (where, holding what), and the memory carried to the next scene.
// - The window digest, once per ~30 sentences of a scene (never cutting a card), with the scene digest and the memory:
//   - moves: each change of position, graded (still, a step, nearby, elsewhere), toward, away from or with someone;
//   - facts: what a line says or implies about where someone is (indoors, a floor, a roof, near someone, by a window),
//     stated or implied, how sure, and the line it rests on;
//   - items: things held, picked up, put down, thrown, given, broken;
//   - talk: how each exchange is spoken (face to face, a group, remote, public); breaks: what is destroyed.
// Every entry names its sentence; entries naming no known person or line are dropped.

export const MOTIONS = ['still', 'step', 'nearby', 'elsewhere'];
export const HOWS = ['step', 'walk', 'run', 'leap', 'flight', 'carried', 'vehicle'];
export const FACT_KINDS = ['indoors', 'outdoors', 'floor', 'roof', 'underground', 'near', 'apart', 'feature', 'vehicle'];
export const FEATURES = ['window', 'door', 'street', 'stairs', 'wall', 'corner', 'edge'];
export const ITEM_EVENTS = ['appears', 'held', 'picked-up', 'put-down', 'thrown', 'given', 'broken', 'used'];
export const TALK = ['live', 'group', 'remote', 'public'];
export const ACTIVITIES = ['standing', 'sitting', 'lying', 'strolling', 'walking', 'running', 'working', 'fighting', 'riding', 'gone'];
const WINDOW = 30, CONTEXT = 3;

export const SCENE_SYSTEM = [
  'You read one scene of a Chinese light novel that is being staged in a 3D city, and summarize it for the people who stage it.',
  'Use only the ids given for people. Keep every text field short (under 30 words), in English.',
  'Reply with JSON only, in the shape asked.',
].join(' ');

export const WINDOW_SYSTEM = [
  'You read a passage of a Chinese light novel that is being staged in a 3D city, sentence by sentence, and say what each sentence does to the people\'s positions, the things they carry, and how they talk.',
  'List only changes of position; leave out anyone who stays where they are. Be thorough: every verb of motion (走, 跑, 跳, 进, 出, 来, 去, 回, 靠近, 退, 跟, 追, 逃, 爬, 飞, 穿过, 冲) is a move, and so is small motion: a dodge, a step back, closing in, pacing, turning to walk off, wandering down a street.',
  'When someone carries, leads or takes another along, give a move for each of them, the one taken along "with" the other. For going elsewhere, say where they end up in "to".',
  'Also give what a sentence implies without saying it: rain drumming on the roof above them means indoors; looking down at the street from a window means upstairs, by a window; a door slammed behind them means they just went through it.',
  'Items are physical objects someone holds, carries, uses, puts down, throws or breaks: not body parts, clothes being worn, or things only mentioned.',
  'Use only the ids given for people and sentences. Reply with JSON only, in the shape asked.',
].join(' ');

export const SCENE_SHAPE = {
  summary: 'what happens, in order (2-4 sentences)',
  where: 'where the scene plays: indoors or outdoors, the kind of place',
  continues: 'how it follows the scene before: carries straight on | later the same day | another day | elsewhere at the same time | a flashback',
  background: { doing: 'what the background is doing: one of ' + ACTIVITIES.join('|') + ', or none', crowd: 'none | few | many: people not named who are on stage', crowdDoing: 'what the crowd does, one of ' + ACTIVITIES.join('|') },
  people: [{ who: '<person id>', doing: 'their routine through the scene when not acting: one of ' + ACTIVITIES.join('|'), start: 'where they are at the start (words)', end: 'where they are at the end (words)', holding: ['objects they carry: short names in Chinese as the text calls them; not body parts, clothes worn, or people'] }],
  memory: 'what the next scene needs to know: who is where, with whom, heading where, carrying what, hurt or not, what is going on (under 80 words)',
};
export const WINDOW_SHAPE = {
  moves: [{ sentence: '<sentence id>', who: '<person id>', motion: MOTIONS.filter(motion => motion !== 'still').join('|') + ' (step: within 2 m; nearby: within about 10 m; elsewhere: further, or into another building, floor, roof)', toward: '<person id they approach, or null>', away: '<person id or null>', with: '<person id they go with, or null>', to: 'where they end up, in words, or null', how: HOWS.join('|'), basis: 'stated | implied', sure: '0..1' }],
  facts: [{ sentence: '<sentence id>', who: '<person id>', kind: FACT_KINDS.join('|'), value: 'floor: ground|upper|<number>; near/apart: <person id>; feature: ' + FEATURES.join('|') + '; otherwise null', basis: 'stated | implied', sure: '0..1' }],
  items: [{ sentence: '<sentence id>', item: 'short name in Chinese, as the text calls it', event: ITEM_EVENTS.join('|'), who: '<person id holding or acting on it, or null>', to: '<person id it is given to, or null>', size: 'metres across (a phone 0.15, a bag 0.4, a sword 1, a car 4)' }],
  talk: [{ sentence: '<sentence id of a spoken line>', kind: TALK.join('|') + ' (live: two face to face; group: several together; remote: phone, radio, a message, a voice from afar; public: an address to a crowd)' }],
  breaks: [{ sentence: '<sentence id>', what: 'what is destroyed', sure: '0..1' }],
  background: [{ sentence: '<sentence id>', who: '<person id, or crowd>', doing: ACTIVITIES.join('|') }],
};

// Not things: body parts (the digest named hands and fingertips as items).
const BODY = /^(左|右|双)?(手|手指|指尖|手掌|手臂|胳膊|脚|腿|头|脸|眼睛|嘴|身体|肩膀|腰|拳头?)$/;
/** Whether an item's name is a thing someone can carry: not a body part, not a person (`people`: their names), named in Chinese. */
export const isThing = (name, people = []) => !!name && !BODY.test(name) && !/[A-Za-z]/.test(name) && !people.includes(name);

const parsed = text => { try { return JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };
const sure = value => Math.max(0, Math.min(1, Number(value) || 0));
const oneOf = (value, list, fallback = null) => (list.includes(String(value)) ? String(value) : fallback);

/** A work model that counts what it used (requests, from the cache, prompt and completion tokens). */
export function metered(work) {
  const usage = { requests: 0, cached: 0, prompt: 0, completion: 0, failed: 0 };
  return { modelId: work.modelId, usage, async generate(request) {
    usage.requests++;
    try {
      if (!work.generateWithUsage) return await work.generate(request);
      const result = await work.generateWithUsage(request);
      if (result.cached) usage.cached++;
      usage.prompt += result.usage?.promptTokens ?? 0; usage.completion += result.usage?.completionTokens ?? 0;
      return result.content;
    } catch (error) { usage.failed++; throw error; }
  } };
}

/** The windows of a scene: runs of about `size` sentences, each ending where a card ends. */
export function windowsOf(sentences, cardOf, size = WINDOW) {
  const out = [];
  let start = 0;
  while (start < sentences.length) {
    let end = Math.min(sentences.length, start + size);
    while (end < sentences.length && cardOf.get(sentences[end]) && cardOf.get(sentences[end]) === cardOf.get(sentences[end - 1])) end++;
    out.push(sentences.slice(start, end)); start = end;
  }
  return out;
}

/** Checked window entries: known people and sentences only, values in their lists. */
export function checkWindow(reply, { people, sentences }) {
  const known = new Set(people), lines = new Set(sentences), person = id => (known.has(String(id)) ? String(id) : null);
  const at = entry => (lines.has(String(entry?.sentence)) ? String(entry.sentence) : null);
  const moves = (reply?.moves ?? []).flatMap(entry => {
    const sentence = at(entry), who = person(entry?.who), motion = oneOf(entry?.motion, MOTIONS);
    if (!sentence || !who || !motion) return [];
    return [{ sentence, who, motion, toward: person(entry.toward), away: person(entry.away), with: person(entry.with), to: entry.to ? String(entry.to).slice(0, 120) : null, how: oneOf(entry.how, HOWS, 'walk'), basis: oneOf(entry.basis, ['stated', 'implied'], 'stated'), sure: sure(entry.sure) }];
  });
  const facts = (reply?.facts ?? []).flatMap(entry => {
    const sentence = at(entry), who = person(entry?.who), kind = oneOf(entry?.kind, FACT_KINDS);
    if (!sentence || !who || !kind) return [];
    let value = null;
    if (kind === 'near' || kind === 'apart') { value = person(entry.value); if (!value || value === who) return []; }
    if (kind === 'feature') { value = oneOf(entry.value, FEATURES); if (!value) return []; }
    if (kind === 'floor') { value = /^\d+$/.test(String(entry.value)) ? Number(entry.value) : oneOf(entry.value, ['ground', 'upper']); if (value === null) return []; }
    return [{ sentence, who, kind, value, basis: oneOf(entry.basis, ['stated', 'implied'], 'implied'), sure: sure(entry.sure) }];
  });
  const items = (reply?.items ?? []).flatMap(entry => {
    const sentence = at(entry), event = oneOf(entry?.event, ITEM_EVENTS), item = String(entry?.item ?? '').trim().slice(0, 20);
    if (!sentence || !event || !item) return [];
    return [{ sentence, item, event, who: person(entry.who), to: person(entry.to), size: Math.max(0.1, Math.min(8, Number(entry.size) || 0.5)) }];
  });
  const talk = (reply?.talk ?? []).flatMap(entry => { const sentence = at(entry), kind = oneOf(entry?.kind, TALK); return sentence && kind ? [{ sentence, kind }] : []; });
  const breaks = (reply?.breaks ?? []).flatMap(entry => { const sentence = at(entry); return sentence ? [{ sentence, what: String(entry.what ?? '').slice(0, 80), sure: sure(entry.sure) }] : []; });
  const background = (reply?.background ?? []).flatMap(entry => { const sentence = at(entry), doing = oneOf(entry?.doing, ACTIVITIES), who = entry?.who === 'crowd' ? 'crowd' : person(entry?.who); return sentence && doing && who ? [{ sentence, who, doing }] : []; });
  return { moves, facts, items, talk, breaks, background };
}

/** The scene digest's checked form. */
export function checkScene(reply, { people }) {
  const known = new Set(people);
  const text = (value, n = 240) => (value ? String(value).slice(0, n) : null);
  return {
    summary: text(reply?.summary, 600), where: text(reply?.where), continues: text(reply?.continues, 80),
    background: { doing: oneOf(reply?.background?.doing, ACTIVITIES, 'none') ?? 'none', crowd: oneOf(reply?.background?.crowd, ['none', 'few', 'many'], 'none'), crowdDoing: oneOf(reply?.background?.crowdDoing, ACTIVITIES, 'standing') },
    people: (reply?.people ?? []).filter(entry => known.has(String(entry?.who))).map(entry => ({ who: String(entry.who), doing: oneOf(entry.doing, ACTIVITIES, 'standing'), start: text(entry.start), end: text(entry.end), holding: (Array.isArray(entry.holding) ? entry.holding : []).map(item => String(item).slice(0, 20)).slice(0, 6) })),
    memory: text(reply?.memory, 800),
  };
}

/**
 * One scene digested: `scene` ({ id, sentences }), `line(id)` its text, `kind(id)` its kind, `people` [{ id, name }] on
 * stage or named, `cards` the scene's played cards (sentence → card), `memory` from the scene before. Returns the scene
 * digest, the windows' entries merged, and the memory for the next scene. Failed requests leave their part empty
 * (`failed` names them), and the director plays those cards as before.
 */
export async function digestScene(work, { scene, line, kind, people, place = '', when = null, cardOf = new Map(), memory = null, parallel = 4 }) {
  const ids = people.map(person => person.id), cast = people.map(person => ({ id: person.id, name: person.name }));
  const numbered = list => list.map(id => ({ id, kind: kind(id) ?? null, text: line(id) }));
  const failed = [];
  const sceneReply = await work.generate({ system: SCENE_SYSTEM, maxTokens: 1600, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
    task: 'Summarize this scene for staging. Reply in this JSON shape.', shape: SCENE_SHAPE,
    scene: { id: scene.id, place, when }, before: memory ?? 'nothing yet: the first scene', people: cast, sentences: numbered(scene.sentences),
  }) }).then(parsed).catch(() => null);
  if (!sceneReply) failed.push('scene');
  const digest = checkScene(sceneReply, { people: ids });
  const windows = windowsOf(scene.sentences, cardOf);
  const results = new Array(windows.length);
  let next = 0;
  const one = async n => {
    const own = windows[n], first = scene.sentences.indexOf(own[0]), last = first + own.length;
    const before = scene.sentences.slice(Math.max(0, first - CONTEXT), first), after = scene.sentences.slice(last, last + CONTEXT);
    const reply = await work.generate({ system: WINDOW_SYSTEM, maxTokens: 3000, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'For each sentence of the passage (not the context), list what it does. A sentence may give several entries, or none. Reply in this JSON shape; empty lists where nothing applies.', shape: WINDOW_SHAPE,
      scene: { id: scene.id, place, when, summary: digest.summary, where: digest.where, background: digest.background, people: digest.people },
      before: memory ?? null, people: cast, context: { before: numbered(before), after: numbered(after) }, passage: numbered(own),
    }) }).then(parsed).catch(() => null);
    if (!reply) failed.push(`window ${n + 1}`);
    results[n] = checkWindow(reply, { people: ids, sentences: own });
  };
  await Promise.all(Array.from({ length: Math.min(parallel, windows.length) }, async () => { while (next < windows.length) await one(next++); }));
  const merged = { moves: [], facts: [], items: [], talk: [], breaks: [], background: [] };
  for (const result of results) for (const key of Object.keys(merged)) merged[key].push(...(result?.[key] ?? []));
  return { scene: scene.id, digest, windows: windows.length, covered: windows.filter((_, n) => !failed.includes(`window ${n + 1}`)).flat(), ...merged, failed, memory: digest.memory ?? memory };
}

/**
 * The scenes of a run digested in reading order, the memory carried from one to the next; `peopleOf(scene)` the people
 * for each, `onScene(result)` called as each is done. Scenes in `done` (a scene id → its digest) are kept, not asked again.
 */
export async function digestScenes(work, { scenes, line, kind, peopleOf, placeOf = () => '', whenOf = () => null, cardOf = new Map(), done = {}, onScene = () => {} }) {
  const out = {};
  let memory = null;
  for (const scene of scenes) {
    const result = done[scene.id] ?? await digestScene(work, { scene, line, kind, people: peopleOf(scene), place: placeOf(scene), when: whenOf(scene), cardOf, memory });
    out[scene.id] = result; memory = result.memory ?? memory;
    await onScene(result);
  }
  return out;
}

// ── Scale and view (M5; the user, 2026-11-03: "an implicit or scale faculty of summarization pass the zoom and view angle
// recommendation to it's associated directors and the directors camera man") ─────────────────────────────────────────
// Referential distance (the user, 2026-11-03: "proportional or referential semantic distance description dynamically
// adjusted might work better" than metres in semantic space): the reader names a referent and how many of it; the director
// measures that referent in the world (director.mjs `measure`). A beat's duration gives its moves their time (L17).
export const REFERENTS = ['a person', 'the room', 'the building', 'the street', 'the block', 'a landmark', 'the district', 'the city'];
export const DURATIONS = { 'a few seconds': 5, 'about a minute': 60, 'several minutes': 300, 'an hour or more': 3600 };
export const ANGLES = ['eye level', 'over a shoulder', 'high', 'top-down', 'low, looking up', 'aerial'];
const REFERENT_SHAPE = { referent: REFERENTS.join(' | '), of: 'which one, in words as the text names it (a landmark), or null', times: 'how many of it (0.5, 1, 2, 3…)' };
export const SCALE_SYSTEM = 'You read one beat of a light novel being staged in a 3D city, and recommend to its camera operator how much of the world the beat takes in and from where to look, and how far its moves go, each said by what it spans (a room, the street, a building, the block, as far as a landmark), never in metres. The scale is often only implied: leaping between towers, crossing districts, a fight in one room. Reply with JSON only.';
export const SCALE_SHAPE = { frame: REFERENT_SHAPE, angle: ANGLES.join(' | '), from: '<person id> | <place> | none: whose eyes or which landmark it is seen from', reach: { ...REFERENT_SHAPE, referent: REFERENTS.join(' | ') + ': how far one move goes' }, duration: Object.keys(DURATIONS).join(' | ') + ': how long the beat lasts in the story', sure: '0..1' };

/** A referent, checked: one of the list, its multiple bounded. */
export function checkReferent(value, fallback = 'the street') {
  return { referent: oneOf(value?.referent, REFERENTS, fallback), of: value?.of ? String(value.of).slice(0, 40) : null, times: Math.max(0.25, Math.min(20, Number(value?.times) || 1)) };
}
/** A beat's scale, checked: the frame and reach as referents, the angle, the duration in seconds. */
export function checkScale(reply) {
  const duration = oneOf(reply?.duration, Object.keys(DURATIONS), null);
  return { frame: checkReferent(reply?.frame), angle: oneOf(reply?.angle, ANGLES, 'high'), from: reply?.from ? String(reply.from).slice(0, 60) : null, reach: checkReferent(reply?.reach, 'the room'), duration: duration ? DURATIONS[duration] : null, durationSaid: duration, sure: sure(reply?.sure) };
}

/**
 * Each beat of a scene given its scale: `beats` [{ n, type, lead, sentences }]; one request a beat, `parallel` at once.
 * A failed request leaves the beat framed as the street, marked unsure.
 */
export async function scaleBeats(work, { scene, beats, line, kind, people, digest = null, parallel = 4 }) {
  const out = new Array(beats.length);
  let next = 0;
  const one = async n => {
    const beat = beats[n];
    const reply = await work.generate({ system: SCALE_SYSTEM, maxTokens: 300, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'What does this beat take in (a referent and how many of it), from what angle and whose view, how far do its moves go (a referent), and how long does it last? Reply in this JSON shape.', shape: SCALE_SHAPE,
      scene: { id: scene.id, where: digest?.where ?? null, summary: digest?.summary ?? null }, beat: { type: beat.type, lead: beat.lead }, people: people.map(person => ({ id: person.id, name: person.name })),
      lines: beat.sentences.map(id => ({ id, kind: kind(id) ?? null, text: line(id) })),
    }) }).then(parsed).catch(() => null);
    out[n] = { n: beat.n, ...(reply ? checkScale(reply) : { ...checkScale(null), sure: 0, failed: true }) };
  };
  await Promise.all(Array.from({ length: Math.min(parallel, beats.length) }, async () => { while (next < beats.length) await one(next++); }));
  return out;
}

// ── Journeys (M6): read where the journeys faculty fires (gate.mjs), one request a span ─────────────────────────────
export const MANNERS = ['walk', 'run', 'zigzag through alleys', 'up or along a wall', 'leaps between roofs', 'flight', 'carried', 'a vehicle', 'an underground passage'];
export const JOURNEY_SYSTEM = 'You read a passage of a light novel being staged in a 3D city and trace each journey in it across the city\'s places: who goes, from where, through which places, to where, how. Use the place ids given where a place is one of them; else say the place in words as the text names it (a tower, a bridge, a station). Reply with JSON only.';
export const JOURNEY_SHAPE = { journeys: [{ sentence: '<sentence id where the journey ends or is told>', who: '<person id>', from: '<place id or words>', via: ['<place id or words>'], to: '<place id or words>', manner: MANNERS.join(' | '), distance: { ...REFERENT_SHAPE, referent: REFERENTS.join(' | ') + ': how far, said by what it spans' }, duration: 'words', sure: '0..1' }] };

/** A span's journeys, checked: known people and sentences, a manner from the list. */
export function checkJourneys(reply, { people, sentences }) {
  const known = new Set(people), lines = new Set(sentences);
  return (reply?.journeys ?? []).flatMap(entry => {
    const who = String(entry?.who ?? ''), sentence = String(entry?.sentence ?? '');
    if (!known.has(who) || !lines.has(sentence) || !entry?.to) return [];
    return [{ sentence, who, from: entry.from ? String(entry.from).slice(0, 60) : null, via: (Array.isArray(entry.via) ? entry.via : []).map(place => String(place).slice(0, 60)).slice(0, 6), to: String(entry.to).slice(0, 60), manner: oneOf(entry.manner, MANNERS, 'walk'), distance: checkReferent(entry.distance, 'the block'), duration: entry.duration ? String(entry.duration).slice(0, 40) : null, sure: sure(entry.sure) }];
  });
}

/** The journeys in each span (`spans`: [[sentence ids]]) of a scene; `places` [{ id, label, scale }] round its place. */
export async function journeysOf(work, { scene, spans, line, kind, people, places = [], digest = null, parallel = 4 }) {
  const ids = people.map(person => person.id), out = [];
  let next = 0;
  const one = async span => {
    const reply = await work.generate({ system: JOURNEY_SYSTEM, maxTokens: 1500, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'Trace each journey in this passage. Reply in this JSON shape; an empty list where nobody goes anywhere.', shape: JOURNEY_SHAPE,
      scene: { id: scene.id, where: digest?.where ?? null, summary: digest?.summary ?? null }, places, people: people.map(person => ({ id: person.id, name: person.name })),
      passage: span.map(id => ({ id, kind: kind(id) ?? null, text: line(id) })),
    }) }).then(parsed).catch(() => null);
    out.push(...checkJourneys(reply, { people: ids, sentences: span }));
  };
  await Promise.all(Array.from({ length: Math.min(parallel, spans.length) }, async () => { while (next < spans.length) await one(spans[next++]); }));
  return out;
}

// ── Ambience (M9): the crowd of a place, read where the ambience faculty fires, one request a span ─────────────────────
// The crowd is a field of the place (world-engine/crowd/field.mjs); the director gives it a state, never destinations.
export const CROWD_SIZES = ['none', 'few', 'some', 'many', 'packed'];
export const CROWD_STATES = ['milling', 'flowing', 'gathering', 'alarmed', 'gone'];
export const CROWD_SYSTEM = 'You read a passage of a light novel being staged in a 3D city, for the crowd of the place: the people not named who fill it. Say how many there are and what state the crowd is in as the passage goes on, each time it changes: milling (strolling, shopping, standing about), flowing (going somewhere, commuting, passing through), gathering (watching or drawn to something or someone), alarmed (scared, fleeing, scattering), gone (the place emptied). Name what a gathering crowd watches, and what alarms an alarmed one, by the person it centres on where there is one. Say how sure you are of each. Reply in JSON only.';
export const CROWD_SHAPE = { crowd: [{ sentence: '<sentence id where this holds from>', size: CROWD_SIZES.join(' | '), state: CROWD_STATES.join(' | '), focus: '<person id the crowd watches or flees, or null>', sure: '0..1' }] };

/** A span's crowd, checked: its lines, sizes and states from their lists, a known person as focus or none. */
export function checkCrowd(reply, { people, sentences }) {
  const known = new Set(people), lines = new Set(sentences);
  return (reply?.crowd ?? []).flatMap(entry => {
    const sentence = String(entry?.sentence ?? ''), state = oneOf(entry?.state, CROWD_STATES), size = oneOf(entry?.size, CROWD_SIZES);
    if (!lines.has(sentence) || !state || !size) return [];
    return [{ sentence, size, state, focus: entry?.focus && known.has(String(entry.focus)) ? String(entry.focus) : null, sure: sure(entry?.sure) }];
  });
}

/** The crowd in each span of a scene where ambience fires. */
export async function crowdOf(work, { scene, spans, line, kind, people, digest = null, parallel = 4 }) {
  const ids = people.map(person => person.id), out = [];
  let next = 0;
  const one = async span => {
    const reply = await work.generate({ system: CROWD_SYSTEM, maxTokens: 800, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'The crowd of this passage\'s place, each time it changes. Reply in this JSON shape; an empty list where there is no crowd.', shape: CROWD_SHAPE,
      scene: { id: scene.id, where: digest?.where ?? null, background: digest?.background ?? null }, people: people.map(person => ({ id: person.id, name: person.name })),
      passage: span.map(id => ({ id, kind: kind(id) ?? null, text: line(id) })),
    }) }).then(parsed).catch(() => null);
    out.push(...checkCrowd(reply, { people: ids, sentences: span }));
  };
  await Promise.all(Array.from({ length: Math.min(parallel, spans.length) }, async () => { while (next < spans.length) await one(spans[next++]); }));
  return out;
}

// ── Choreography (M7): read where the choreography faculty fires (fights, catastrophes), one request a span ───────────
export const ATTACKS = ['hand to hand', 'grapple or throw', 'blade or blunt weapon', 'firearm', 'ranged power', 'beam or laser', 'area blast', 'thrown object', 'the ground or a building itself', 'an ability that cancels'];
export const SHAPES = ['point', 'line or beam', 'cone', 'sphere', 'ring', 'wave along the ground', 'rain from above'];
export const RANGES = ['touch', 'close (under 3 m)', 'near (under 15 m)', 'far (under 100 m)', 'very far'];
export const OUTCOMES = ['hit', 'dodged', 'blocked', 'cancelled', 'missed'];
export const CONDITIONS = ['hurt', 'badly hurt', 'unconscious', 'bound', 'freed', 'recovered'];
export const FIGHT_SYSTEM = 'You read a fight or a catastrophe in a light novel, exchange by exchange, for those staging it in a 3D city: who attacks whom, with what kind of attack, of what shape in space and from how far, what happens to the target, how far anyone is thrown, what breaks, and what state anyone is left in. Reply with JSON only.';
export const FIGHT_SHAPE = { exchanges: [{ sentence: '<sentence id>', attacker: '<person id, or null for the world itself>', target: '<person id, or null when a place or thing>', attack: ATTACKS.join(' | '), shape: SHAPES.join(' | '), range: RANGES.join(' | '), outcome: OUTCOMES.join(' | '), knockback: { ...REFERENT_SHAPE, referent: REFERENTS.join(' | ') + ': how far the target is thrown, said by what it spans (a person: body lengths), or null' }, breaks: 'what is destroyed, or null', condition: CONDITIONS.join(' | ') + ' | null: the target\'s state after it', sure: '0..1' }] };

/** A span's exchanges, checked: known people (or none), lines, values from their lists. */
export function checkExchanges(reply, { people, sentences }) {
  const known = new Set(people), lines = new Set(sentences), person = id => (id && known.has(String(id)) ? String(id) : null);
  return (reply?.exchanges ?? []).flatMap(entry => {
    const sentence = String(entry?.sentence ?? ''), attacker = person(entry?.attacker), target = person(entry?.target);
    if (!lines.has(sentence) || (!attacker && !target)) return [];
    return [{ sentence, attacker, target, attack: oneOf(entry.attack, ATTACKS, 'hand to hand'), shape: oneOf(entry.shape, SHAPES, 'point'), range: oneOf(entry.range, RANGES, 'close (under 3 m)'), outcome: oneOf(entry.outcome, OUTCOMES, 'hit'),
      knockback: entry.knockback && typeof entry.knockback === 'object' ? checkReferent(entry.knockback, 'a person') : null, breaks: entry.breaks ? String(entry.breaks).slice(0, 80) : null, condition: oneOf(entry.condition, CONDITIONS, null), sure: sure(entry.sure) }];
  });
}

/** The exchanges in each span of a scene where choreography fires. */
export async function exchangesOf(work, { scene, spans, line, kind, people, digest = null, parallel = 4 }) {
  const ids = people.map(person => person.id), out = [];
  let next = 0;
  const one = async span => {
    const reply = await work.generate({ system: FIGHT_SYSTEM, maxTokens: 2000, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'List each exchange of this passage in order. Reply in this JSON shape; an empty list where nobody attacks.', shape: FIGHT_SHAPE,
      scene: { id: scene.id, where: digest?.where ?? null, summary: digest?.summary ?? null }, people: people.map(person => ({ id: person.id, name: person.name })),
      passage: span.map(id => ({ id, kind: kind(id) ?? null, text: line(id) })),
    }) }).then(parsed).catch(() => null);
    out.push(...checkExchanges(reply, { people: ids, sentences: span }));
  };
  await Promise.all(Array.from({ length: Math.min(parallel, spans.length) }, async () => { while (next < spans.length) await one(spans[next++]); }));
  return out;
}

// ── Conversation and blocking (M8): read where the conversation faculty fires, one request a span ─────────────────────
export const CHANNELS = { 'face to face': 'live', 'a group together': 'group', phone: 'remote', 'video call': 'remote', message: 'remote', 'through a door or wall': 'remote', 'loudspeaker or broadcast': 'public', telepathy: 'remote', 'a voice from afar': 'remote' };
export const FORMATIONS = ['beside', 'facing', 'across a table', 'a ring', 'side by side walking', 'behind', 'two sides of a door', 'apart'];
export const TALK_SYSTEM = 'You read a conversation in a light novel for those staging it: who talks with whom and through what (face to face, a phone, a door), how the people stand (beside each other, facing, across a table, in a ring, walking side by side, two sides of a door), and who looks at whom. Reply with JSON only.';
export const TALK_SHAPE = { exchanges: [{ sentence: '<sentence id>', who: '<person id>', with: ['<person id>'], channel: Object.keys(CHANNELS).join(' | '), sure: '0..1' }], formations: [{ sentence: '<sentence id where it holds from>', who: ['<person id>'], formation: FORMATIONS.join(' | '), sure: '0..1' }], attention: [{ sentence: '<sentence id>', who: '<person id>', looksAt: '<person id>' }] };

/** A span's talk, checked. */
export function checkTalk(reply, { people, sentences }) {
  const known = new Set(people), lines = new Set(sentences), person = id => (known.has(String(id)) ? String(id) : null);
  const exchanges = (reply?.exchanges ?? []).flatMap(entry => { const who = person(entry?.who), sentence = String(entry?.sentence ?? ''), channel = oneOf(entry?.channel, Object.keys(CHANNELS)); return who && lines.has(sentence) && channel ? [{ sentence, who, with: (Array.isArray(entry.with) ? entry.with : []).map(person).filter(Boolean), channel, sure: sure(entry.sure) }] : []; });
  const formations = (reply?.formations ?? []).flatMap(entry => { const who = (Array.isArray(entry?.who) ? entry.who : []).map(person).filter(Boolean), sentence = String(entry?.sentence ?? ''), formation = oneOf(entry?.formation, FORMATIONS); return who.length >= 2 && lines.has(sentence) && formation ? [{ sentence, who: [...new Set(who)], formation, sure: sure(entry.sure) }] : []; });
  const attention = (reply?.attention ?? []).flatMap(entry => { const who = person(entry?.who), at = person(entry?.looksAt), sentence = String(entry?.sentence ?? ''); return who && at && who !== at && lines.has(sentence) ? [{ sentence, who, looksAt: at }] : []; });
  return { exchanges, formations, attention };
}

/** The talk in each span of a scene where conversation fires. */
export async function talkOf(work, { scene, spans, line, kind, people, digest = null, parallel = 4 }) {
  const ids = people.map(person => person.id), out = { exchanges: [], formations: [], attention: [] };
  let next = 0;
  const one = async span => {
    const reply = await work.generate({ system: TALK_SYSTEM, maxTokens: 2000, jsonSchema: { type: 'object' }, prompt: JSON.stringify({
      task: 'For this passage: each exchange and its channel, each group\'s formation, who looks at whom. Reply in this JSON shape.', shape: TALK_SHAPE,
      scene: { id: scene.id, where: digest?.where ?? null }, people: people.map(person => ({ id: person.id, name: person.name })),
      passage: span.map(id => ({ id, kind: kind(id) ?? null, text: line(id) })),
    }) }).then(parsed).catch(() => null);
    const checked = checkTalk(reply, { people: ids, sentences: span });
    for (const key of Object.keys(out)) out[key].push(...checked[key]);
  };
  await Promise.all(Array.from({ length: Math.min(parallel, spans.length) }, async () => { while (next < spans.length) await one(spans[next++]); }));
  return out;
}
