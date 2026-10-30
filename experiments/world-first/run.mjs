// The world-first loop on a book's base layer (base.mjs), v2 (docs/world-first-design.md). Scene by scene in reading order,
// Jev reads each scene in its composed context (compose.mjs) and the world (world.mjs) keeps its laws:
//   1. who is in the scene and where (one call);
//   2. event actors the world does not have there join when Jev thought them likely, else are flagged (laws.mjs);
//   3. when it is against the scene before, among the times the laws allow, and the time its text names (one call; the
//      candidates come from the time lexicon);
//   4. each dialogue node, in narrative order: its kind (live, group, remote, public) and its two parties (one call), and
//      for a remote node which party is here (a second call), settled by the dialogue rules (dialogue.mjs);
//   5. what the 3D stage settles next (the geometry): nominated rooms to bind, people seen for the first time (their
//      starts: height and map box), live meetings and group boxes.
// A fragment scene costs nothing. It stops at the end of the chapters asked for, or before --max-calls would be passed.
// Every answer is cached under <out>/cache, so running it again pays only for what changed. After the book, the laws on
// things and knowledge run over it.
//   JEV_MODEL=jev-1.14.0 node experiments/world-first/run.mjs <out-dir> [--chapters 0-5] [--max-calls 400]
// Writes <out>/world-log.jsonl (a line a scene), <out>/script.json (the world script the 3D stage plays), <out>/world.json,
// <out>/laws.json and <out>/run.json.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compose } from './compose.mjs';
import { KINDS, UNNAMED, settle } from './dialogue.mjs';
import { actors, knowledge, things } from './laws.mjs';
import { allowedTimes, createWorld, elsewhere, enter, inPast, join as joinScene, PAST_TIMES, TIMES, whereabouts } from './world.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

const ELSEWHERE = 'another place the text does not name';
/** A scene this short (in characters) with no events is a fragment: a stray line the scene splitter cut off. */
const FRAGMENT = 20;
/** Present at this probability; below it but above UNSURE, kept in the log as unsure (and an actor that likely joins). */
const PRESENT = 0.5, UNSURE = 0.3;
/** At most this many candidates are asked about in a scene, and this many parties offered for a dialogue. */
const CANDIDATES = 14, PARTIES = 10;
// When the time lexicon finds nothing: dates and parts of the day.
const TIME_WORDS = /(平安夜|圣诞[节夜]?|除夕|元旦|新年|清晨|黎明|早上|上午|中午|午后|下午|傍晚|黄昏|晚上|夜里|深夜|半夜|午夜|凌晨|第二天|翌日|次日|当天|那天|今天|今晚|明天|昨天|昨晚)/g;

const clip = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const order = (id = '') => { const match = /^b(\d+)_s(\d+)$/.exec(id ?? ''); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };
/** The forms a name is found by in the text: its own, the parts of a foreign name, and a Chinese name's family and given halves. */
const formsOf = name => [name, ...(/[·・]/.test(name) ? name.split(/[·・]/) : /^[一-鿿]{3,4}$/.test(name) ? [name.slice(0, 2), name.slice(-2)] : [])].filter(form => form.length >= 2);
const count = (text, form) => text.split(form).length - 1;

export async function runWorldFirst(outDir, { chapters = null, maxCalls = 400, decisions = null } = {}) {
  const scenes = JSON.parse(await readFile(join(outDir, 'base', 'scenes.json'), 'utf8')), roster = JSON.parse(await readFile(join(outDir, 'base', 'roster.json'), 'utf8'));
  const states = JSON.parse(await readFile(join(outDir, 'base', 'states.json'), 'utf8').catch(() => '[]'));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const { detectTimeMentions } = await load('dist/src/digger/timeplace/lexicon.js');
  // Real calls are counted below the cache, so a rerun counts only what it pays for.
  let calls = 0;
  const live = decisions ?? jevFromEnv(process.env), counted = { modelId: live.modelId, decide: (...args) => { calls++; return live.decide(...args); } };
  const jev = cachedDecisions(counted, join(outDir, 'cache'));
  const name = new Map(roster.characters.map(entry => [entry.id, entry.names[0]])), forms = new Map(roster.characters.map(entry => [entry.id, [...new Set(entry.names.flatMap(formsOf))]]));
  const byName = new Map([...name].map(([id, label]) => [label, id]));
  const placeName = new Map(roster.places.map(entry => [entry.id, entry.names[0]])), placeForms = new Map(roster.places.map(entry => [entry.id, entry.names])), placeScale = new Map(roster.places.map(entry => [entry.id, entry.scale ?? null]));
  const world = createWorld(), log = [], script = [], summaries = new Map(scenes.map(scene => [scene.id, scene.summary])), number = new Map(scenes.map(scene => [scene.id, scene.index + 1]));
  const labelOf = place => placeName.get(place) ?? world.places[place]?.label ?? place;
  const when = scene => (scene.timeNode ? `, ${scene.timeNode}` : '');
  const names = ids => ids.map(id => name.get(id) ?? id).join('、');
  const worldLines = () => whereabouts(world).map(([id, person]) => `${name.get(id) ?? id} — at ${labelOf(person.place)}${person.spot ? ` (${person.spot})` : ''}, since scene ${number.get(person.since)}${when(world.scenes.find(scene => scene.id === person.since) ?? {})}`);
  const storyLines = () => world.scenes.slice(-8).map(scene => `Scene ${number.get(scene.id)} · ${labelOf(scene.place)} · ${scene.clock ? scene.relation : 'in a flashback'}${when(scene)}${scene.present.length ? ` · with ${names(scene.present)}` : ''}: ${clip(summaries.get(scene.id) ?? '', 160)}`);
  const named = text => [...forms].map(([id, list]) => [id, list.reduce((sum, form) => sum + count(text, form) * (form === name.get(id) ? 3 : 1), 0)]).filter(([, hits]) => hits).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  let stopped = null;
  for (const scene of scenes.filter(entry => !chapters || chapters.includes(entry.chapter))) {
    const previous = world.scenes.at(-1), text = scene.text.trim();
    // Without text, nothing changes: the scene before carries on (its people stay, unseen).
    if (text.length < FRAGMENT && !scene.events.length) {
      const entry = enter(world, { id: scene.id, chapter: scene.chapter, place: previous?.place ?? null, relation: 'after', present: [], fragment: true });
      log.push({ scene: scene.id, chapter: scene.chapter, chars: text.length, fragment: true, place: labelOf(entry.place), relation: 'after', clock: entry.clock, present: [], stayed: entry.stayed.map(id => name.get(id)), calls: 0 });
      script.push({ id: scene.id, chapter: scene.chapter, fragment: true, place: entry.place, relation: 'after', clock: entry.clock, present: [], stayed: entry.stayed, joined: [], firstSeen: [], timeline: [] });
      continue;
    }
    if (calls + 2 + scene.dialogues.length * 2 > maxCalls) { stopped = `--max-calls ${maxCalls} reached before scene ${scene.id}`; break; }
    const before = calls;
    // Candidates: who the text names, who its events have taking part, and who was in the scene before (they may still be there).
    const score = new Map(), add = (id, points) => score.set(id, (score.get(id) ?? 0) + points);
    for (const [id, list] of forms) for (const form of list) { const hits = count(text, form); if (hits) add(id, hits * (form === name.get(id) ? 3 : 1)); }
    for (const event of scene.events) for (const id of event.actors) if (name.has(id)) add(id, 5);
    for (const id of [...(previous?.present ?? []), ...(previous?.stayed ?? [])]) add(id, 4);
    const candidates = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([id]) => id);
    // Where: the place of the scene before, places the text names, places where the candidates are, or a new unnamed one.
    const namedPlaces = [...placeForms].filter(([, list]) => list.some(form => text.includes(form))).map(([id]) => id);
    const near = candidates.map(id => world.people[id]?.place).filter(Boolean);
    const places = [...new Set([...(previous?.place ? [previous.place] : []), ...namedPlaces, ...near])];
    const option = place => (place === previous?.place ? `the same place as the scene before (${labelOf(place)})` : labelOf(place));
    const placeOptions = [...places.map(option), ELSEWHERE];
    const events = scene.events.map(event => `- ${clip(event.summary, 140)}`).join('\n');
    const first = await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus: `What happens in this scene (its events):\n${events || '- (none recorded)'}\nPeople who may be in it: ${names(candidates) || '(nobody named)'}.` }), [
      ...candidates.map((id, index) => ({ key: `present_${index}`, primitive: 'noul', instructions: `Is ${name.get(id)} physically in this scene: at its place, taking part, or within sight or earshot of what happens? Being only mentioned, remembered, thought of, or heard on a phone is not being there.` })),
      { key: 'place', primitive: 'choice', instructions: 'Where does this scene take place?', options: placeOptions },
    ]);
    const answer = key => first.find(entry => entry.key === key);
    const chances = new Map(candidates.map((id, index) => [id, Number(answer(`present_${index}`)?.value ?? 0)]));
    const present = [...chances].filter(([, p]) => p >= PRESENT).map(([id]) => id);
    // Actors are there: an event's actor Jev thought likely joins; the others are flagged.
    const cast = actors({ events: scene.events.map(event => ({ ...event, actors: event.actors.filter(id => name.has(id)) })), inScene: present, chance: id => chances.get(id), elsewhere: () => false, floor: UNSURE });
    present.push(...cast.add);
    const picked = String(answer('place')?.value ?? ELSEWHERE), placeIndex = placeOptions.indexOf(picked);
    let place = placeIndex >= 0 && placeIndex < places.length ? places[placeIndex] : null;
    if (!place) { place = `unnamed:${scene.id}`; world.places[place] = { label: `an unnamed place (scene ${scene.index + 1})` }; }
    // When, by the laws; the time the text names, from the time lexicon (outside quotes first).
    const allowed = allowedTimes(world, present, place), times = inPast(world) ? PAST_TIMES : TIMES;
    const mentions = detectTimeMentions([{ id: scene.id, text }]).sort((a, b) => a.inQuote - b.inQuote).map(mention => mention.text);
    const phrases = [...new Set(mentions.length ? mentions : text.match(TIME_WORDS) ?? [])].slice(0, 8);
    const second = allowed.length > 1 || phrases.length ? await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus: `In this scene, at ${labelOf(place)}: ${names(present) || 'nobody named is there'}.` }), [
      ...(allowed.length > 1 ? [{ key: 'time', primitive: 'choice', instructions: `When does this scene happen, against the scene before${inPast(world) ? ' (which is in a flashback)' : ''}?`, options: allowed.map(relation => times[relation]) }] : []),
      ...(phrases.length ? [{ key: 'time_node', primitive: 'choice', instructions: 'Which time does this scene itself happen at, as its text says? Pick none when the text only mentions a time for something else.', options: [...phrases, 'none'] }] : []),
    ]) : [];
    const reply = key => second.find(entry => entry.key === key);
    const relation = allowed.length > 1 ? allowed.find(key => times[key] === reply('time')?.value) ?? allowed[0] : allowed[0];
    const timeNode = phrases.length && reply('time_node')?.value !== 'none' ? String(reply('time_node')?.value ?? '') || null : null;
    const entry = enter(world, { id: scene.id, chapter: scene.chapter, place, relation, present, timeNode });
    // Dialogue nodes, in narrative order: kind and parties, then (remote) which party is here.
    const nodes = [];
    for (const dialogue of scene.dialogues) {
      const inScene = [...entry.present, ...entry.stayed], offered = [...new Set([...inScene, ...named(dialogue.text)])].slice(0, PARTIES), partyOptions = [...offered.map(id => name.get(id)), UNNAMED];
      const focus = `This dialogue, in the scene:\n${dialogue.text}\nIn the scene: ${names(inScene) || 'nobody named'}.`;
      const asked = await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus }), [
        { key: 'kind', primitive: 'choice', instructions: 'How does this dialogue happen?', options: Object.values(KINDS) },
        { key: 'party_a', primitive: 'choice', instructions: 'Who speaks first in this dialogue?', options: partyOptions },
        { key: 'party_b', primitive: 'choice', instructions: 'Who is the other person in it (who answers, or is spoken to)?', options: partyOptions },
      ]);
      const got = key => asked.find(item => item.key === key)?.value;
      const kind = Object.keys(KINDS).find(key => KINDS[key] === got('kind')) ?? 'live', parties = [byName.get(got('party_a')) ?? null, byName.get(got('party_b')) ?? null];
      let local = null;
      if (kind === 'remote' && parties[0] && parties[1] && parties[0] !== parties[1]) {
        const here = await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus }), [{ key: 'local', primitive: 'choice', instructions: 'Which of the two is here, in this scene (the other is somewhere else)?', options: parties.map(id => name.get(id)) }]);
        local = byName.get(here[0]?.value) ?? null;
      }
      const node = settle({ kind, parties: parties[0] === parties[1] ? [parties[0], null] : parties, local, inScene, elsewhere: id => elsewhere(world, entry, id) });
      for (const id of node.joins) joinScene(world, entry, id, `${kind} dialogue ${dialogue.id}`);
      nodes.push({ id: dialogue.id, first: dialogue.first, ...node });
    }
    // For the 3D stage: a nominated room to bind, and who is seen for the first time (or first since a flashback).
    const firstSeen = entry.clock ? entry.present.filter(id => world.people[id].log.filter(item => !item.past).length === 1) : [];
    const timeline = [...scene.events.map(event => ({ type: 'event', id: event.id, first: event.first, actors: event.actors })), ...nodes.map(node => ({ type: 'dialogue', ...node }))].sort((a, b) => order(a.first) - order(b.first));
    script.push({ id: scene.id, chapter: scene.chapter, place, room: placeScale.get(place) === 'room', relation, clock: entry.clock, timeNode, present: entry.present, stayed: entry.stayed, joined: entry.joined ?? [], firstSeen, timeline, actorFlags: cast.flags });
    log.push({ scene: scene.id, chapter: scene.chapter, chars: text.length, place: labelOf(place), room: placeScale.get(place) === 'room', relation, allowed, clock: entry.clock, timeNode,
      present: entry.present.map(id => ({ name: name.get(id), p: Math.round((chances.get(id) ?? 0) * 100) / 100 })), unsure: [...chances].filter(([, p]) => p >= UNSURE && p < PRESENT).map(([id, p]) => ({ name: name.get(id), p: Math.round(p * 100) / 100 })),
      stayed: entry.stayed.map(id => name.get(id)), joined: (entry.joined ?? []).map(item => `${name.get(item.person)} (${item.why})`), firstSeen: names(firstSeen), travelled: entry.travelled.map(trip => `${name.get(trip.person)}: ${labelOf(trip.from)} → ${labelOf(trip.to)}`),
      dialogues: nodes.map(node => ({ kind: node.kind, parties: names(node.parties), ...(node.public ? { public: true, listeners: node.listeners.length } : {}), ...(node.kind === 'remote' ? { here: name.get(node.local), there: name.get(node.remote) } : {}), ...(node.conflicts.length ? { conflicts: node.conflicts } : {}) })),
      actorFlags: cast.flags.length, calls: calls - before });
  }
  // The laws on things and knowledge, over the book.
  const eventOrder = new Map(script.flatMap(scene => scene.timeline.filter(item => item.type === 'event')).map((item, index) => [item.id, index]));
  const sceneOf = new Map(script.flatMap(scene => scene.timeline.filter(item => item.type === 'event').map(item => [item.id, scene.id])));
  const heard = new Map(script.map(scene => [scene.id, new Set([...scene.present, ...scene.stayed, ...scene.timeline.filter(item => item.type === 'dialogue').flatMap(item => [...item.parties, ...item.listeners])])]));
  const laws = { things: things(states, eventOrder), knowledge: knowledge(states, sceneOf, id => heard.get(id) ?? new Set()), actors: script.flatMap(scene => scene.actorFlags ?? []), dialogue: script.flatMap(scene => scene.timeline.filter(item => item.type === 'dialogue' && item.conflicts.length).map(item => ({ scene: scene.id, dialogue: item.id, conflicts: item.conflicts }))) };
  await writeFile(join(outDir, 'world-log.jsonl'), log.map(line => JSON.stringify(line)).join('\n') + '\n', { mode: 0o600 });
  await writeFile(join(outDir, 'script.json'), JSON.stringify({ version: 2, places: { ...Object.fromEntries([...placeName].map(([id, label]) => [id, { label, scale: placeScale.get(id) }])), ...world.places }, names: Object.fromEntries(name), scenes: script }), { mode: 0o600 });
  await writeFile(join(outDir, 'world.json'), JSON.stringify({ people: Object.fromEntries(Object.entries(world.people).map(([id, person]) => [name.get(id) ?? id, { ...person, place: labelOf(person.place) }])), places: world.places, scenes: world.scenes }, null, 1), { mode: 0o600 });
  await writeFile(join(outDir, 'laws.json'), JSON.stringify(laws, null, 1), { mode: 0o600 });
  const dialogues = script.flatMap(scene => scene.timeline.filter(item => item.type === 'dialogue'));
  const summary = { scenes: log.length, fragments: log.filter(line => line.fragment).length, calls, stopped, model: live.modelId, chapters: [...new Set(log.map(line => line.chapter))],
    dialogues: Object.fromEntries(Object.keys(KINDS).map(kind => [kind, dialogues.filter(item => item.kind === kind).length])), joinedByDialogue: dialogues.reduce((sum, item) => sum + item.joins.length, 0),
    flags: { actors: laws.actors.length, things: laws.things.flags.length, knowledge: laws.knowledge.length, dialogue: laws.dialogue.length } };
  await writeFile(join(outDir, 'run.json'), JSON.stringify(summary, null, 1), { mode: 0o600 });
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { chapters: { type: 'string' }, 'max-calls': { type: 'string' } } });
  const range = values.chapters?.match(/^(\d+)(?:-(\d+))?$/), chapters = range ? Array.from({ length: Number(range[2] ?? range[1]) - Number(range[1]) + 1 }, (_, n) => Number(range[1]) + n) : null;
  if (!positionals[0]) throw new Error('Usage: node experiments/world-first/run.mjs <out-dir> [--chapters 0-5] [--max-calls 400]');
  console.log(JSON.stringify(await runWorldFirst(resolve(positionals[0]), { chapters, maxCalls: Number(values['max-calls'] ?? 400) })));
}
