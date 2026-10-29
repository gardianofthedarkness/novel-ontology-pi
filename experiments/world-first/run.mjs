// The world-first loop on a book's review-free layer (base.mjs). It goes scene by scene in reading order, and Jev reads
// each scene in its composed context (compose.mjs) and says who is there, where, and when it is against the scene before,
// while the world (world.mjs) keeps its laws. Two calls a scene: first who and where; then when (only the times the laws
// allow), the time the text names, and each present person's spot. A fragment scene (a stray line) costs nothing. It stops
// at the end of the chapters asked for, or before --max-calls would be passed (the guard). Every answer is cached under
// <out>/cache, so running it again goes on from where it stopped without paying twice.
//   JEV_MODEL=jev-1.14.0 node experiments/world-first/run.mjs <out-dir> [--chapters 0-5] [--max-calls 200]
// Writes <out>/world-log.jsonl (a line a scene), <out>/world.json (the world at the end) and <out>/run.json (the counts).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compose } from './compose.mjs';
import { allowedTimes, createWorld, enter, inPast, PAST_TIMES, TIMES, whereabouts } from './world.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

/** Where in a place a person is: coarse spots, the same for every place until the place has a building of its own. */
export const SPOTS = ['at the door or entrance', 'inside, on the ground floor', 'inside, on an upper floor', 'on the roof', 'outside, in the street or open ground', 'somewhere the text does not say'];
const ELSEWHERE = 'another place the text does not name';
/** A scene this short (in characters) with no events is a fragment: a stray line the scene splitter cut off. */
const FRAGMENT = 20;
/** Present at this probability; below it but above UNSURE, kept in the log as unsure. */
const PRESENT = 0.5, UNSURE = 0.3;
/** At most this many candidates are asked about in a scene (the likeliest first). */
const CANDIDATES = 14;
// Times the text may name: dates, parts of the day, hours, and how long has passed.
const TIME_WORDS = /(平安夜|圣诞[节夜]?|除夕|元旦|新年|清晨|黎明|早上|上午|中午|午后|下午|傍晚|黄昏|晚上|夜里|深夜|半夜|午夜|凌晨|第二天|翌日|次日|当天|那天|今天|今晚|明天|昨天|昨晚|[零一二三四五六七八九十两\d]+[点時时](?:[零一二三四五六七八九十\d]+分)?|[零一二三四五六七八九十两\d]+(?:天|日|小时|分钟|周|星期|个月|年)(?:后|前|之后|以后|过后)|[0-9０-９一二三四五六七八九十]+月[0-9０-９一二三四五六七八九十]+[日号])/g;

const clip = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
/** The forms a name is found by in the text: its own, the parts of a foreign name, and a Chinese name's family and given halves. */
const formsOf = name => [name, ...(/[·・]/.test(name) ? name.split(/[·・]/) : /^[一-鿿]{3,4}$/.test(name) ? [name.slice(0, 2), name.slice(-2)] : [])].filter(form => form.length >= 2);
const count = (text, form) => text.split(form).length - 1;

export async function runWorldFirst(outDir, { chapters = null, maxCalls = 200, decisions = null } = {}) {
  const scenes = JSON.parse(await readFile(join(outDir, 'base', 'scenes.json'), 'utf8')), roster = JSON.parse(await readFile(join(outDir, 'base', 'roster.json'), 'utf8'));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  // Real calls are counted below the cache, so a rerun counts only what it pays for.
  let calls = 0;
  const live = decisions ?? jevFromEnv(process.env), counted = { modelId: live.modelId, decide: (...args) => { calls++; return live.decide(...args); } };
  const jev = cachedDecisions(counted, join(outDir, 'cache'));
  const name = new Map(roster.characters.map(entry => [entry.id, entry.names[0]])), forms = new Map(roster.characters.map(entry => [entry.id, [...new Set(entry.names.flatMap(formsOf))]]));
  const placeName = new Map(roster.places.map(entry => [entry.id, entry.names[0]])), placeForms = new Map(roster.places.map(entry => [entry.id, entry.names]));
  const world = createWorld(), log = [], summaries = new Map(scenes.map(scene => [scene.id, scene.summary])), number = new Map(scenes.map(scene => [scene.id, scene.index + 1]));
  const labelOf = place => placeName.get(place) ?? world.places[place]?.label ?? place;
  const when = scene => (scene.timeNode ? `, ${scene.timeNode}` : '');
  const worldLines = () => whereabouts(world).map(([id, person]) => `${name.get(id) ?? id} — at ${labelOf(person.place)}${person.spot ? ` (${person.spot})` : ''}, since scene ${number.get(person.since)}${when(world.scenes.find(scene => scene.id === person.since) ?? {})}`);
  const storyLines = () => world.scenes.slice(-8).map(scene => `Scene ${number.get(scene.id)} · ${labelOf(scene.place)} · ${scene.clock ? scene.relation : 'in a flashback'}${when(scene)}${scene.present.length ? ` · with ${scene.present.map(id => name.get(id)).join('、')}` : ''}: ${clip(summaries.get(scene.id) ?? '', 160)}`);
  let stopped = null;
  for (const scene of scenes.filter(entry => !chapters || chapters.includes(entry.chapter))) {
    const previous = world.scenes.at(-1), text = scene.text.trim();
    // Without text, nothing changes: the scene before carries on (its people stay, unseen).
    if (text.length < FRAGMENT && !scene.events.length) {
      const entry = enter(world, { id: scene.id, chapter: scene.chapter, place: previous?.place ?? null, relation: 'after', present: [], fragment: true });
      log.push({ scene: scene.id, chapter: scene.chapter, chars: text.length, fragment: true, place: labelOf(entry.place), relation: 'after', clock: entry.clock, present: [], stayed: entry.stayed.map(id => name.get(id)), calls: 0 });
      continue;
    }
    if (calls + 2 > maxCalls) { stopped = `--max-calls ${maxCalls} reached before scene ${scene.id}`; break; }
    const before = calls;
    // Candidates: who the text names, who its events have taking part, and who was in the scene before (they may still be there).
    const score = new Map(), add = (id, points) => score.set(id, (score.get(id) ?? 0) + points);
    for (const [id, list] of forms) for (const form of list) { const hits = count(text, form); if (hits) add(id, hits * (form === name.get(id) ? 3 : 1)); }
    for (const event of scene.events) for (const id of event.actors) if (name.has(id)) add(id, 5);
    for (const id of [...(previous?.present ?? []), ...(previous?.stayed ?? [])]) add(id, 4);
    const candidates = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([id]) => id);
    // Where: the place of the scene before, places the text names, places where the candidates are, or a new unnamed one.
    const named = [...placeForms].filter(([, list]) => list.some(form => text.includes(form))).map(([id]) => id);
    const near = candidates.map(id => world.people[id]?.place).filter(Boolean);
    const places = [...new Set([...(previous?.place ? [previous.place] : []), ...named, ...near])];
    const option = place => (place === previous?.place ? `the same place as the scene before (${labelOf(place)})` : labelOf(place));
    const placeOptions = [...places.map(option), ELSEWHERE];
    const events = scene.events.map(event => `- ${clip(event.summary, 140)}`).join('\n');
    const first = await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus: `What happens in this scene (its events):\n${events || '- (none recorded)'}\nPeople who may be in it: ${candidates.map(id => name.get(id)).join('、') || '(nobody named)'}.` }), [
      ...candidates.map((id, index) => ({ key: `present_${index}`, primitive: 'noul', instructions: `Is ${name.get(id)} physically in this scene: at its place, taking part, or within sight or earshot of what happens? Being only mentioned, remembered, thought of, or heard on a phone is not being there.` })),
      { key: 'place', primitive: 'choice', instructions: 'Where does this scene take place?', options: placeOptions },
    ]);
    const answer = key => first.find(entry => entry.key === key);
    const chances = candidates.map((id, index) => [id, Number(answer(`present_${index}`)?.value ?? 0)]);
    const present = chances.filter(([, p]) => p >= PRESENT).map(([id]) => id);
    const picked = String(answer('place')?.value ?? ELSEWHERE), placeIndex = placeOptions.indexOf(picked);
    let place = placeIndex >= 0 && placeIndex < places.length ? places[placeIndex] : null;
    if (!place) { place = `unnamed:${scene.id}`; world.places[place] = { label: `an unnamed place (scene ${scene.index + 1})` }; }
    // When, by the laws: a scene sharing someone with a scene on the same stretch of the clock elsewhere cannot be at the same time.
    const allowed = allowedTimes(world, present, place), phrases = [...new Set(text.match(TIME_WORDS) ?? [])].slice(0, 8), times = inPast(world) ? PAST_TIMES : TIMES;
    const second = allowed.length > 1 || phrases.length || present.length ? await jev.decide(compose({ world: worldLines(), story: storyLines(), text, focus: `In this scene, at ${labelOf(place)}: ${present.map(id => name.get(id)).join('、') || 'nobody named is there'}.` }), [
      ...(allowed.length > 1 ? [{ key: 'time', primitive: 'choice', instructions: `When does this scene happen, against the scene before${inPast(world) ? ' (which is in a flashback)' : ''}?`, options: allowed.map(relation => times[relation]) }] : []),
      ...(phrases.length ? [{ key: 'time_node', primitive: 'choice', instructions: 'Which time does this scene itself happen at, as its text says? Pick none when the text only mentions a time for something else.', options: [...phrases, 'none'] }] : []),
      ...present.map((id, index) => ({ key: `spot_${index}`, primitive: 'choice', instructions: `Where in ${labelOf(place)} is ${name.get(id)} when this scene begins?`, options: SPOTS })),
    ]) : [];
    const reply = key => second.find(entry => entry.key === key);
    const relation = allowed.length > 1 ? allowed.find(key => times[key] === reply('time')?.value) ?? allowed[0] : allowed[0];
    const timeNode = phrases.length && reply('time_node')?.value !== 'none' ? String(reply('time_node')?.value ?? '') || null : null;
    const spots = Object.fromEntries(present.map((id, index) => [id, String(reply(`spot_${index}`)?.value ?? SPOTS.at(-1))]));
    const entry = enter(world, { id: scene.id, chapter: scene.chapter, place, relation, present, spots, timeNode });
    log.push({ scene: scene.id, chapter: scene.chapter, chars: text.length, place: labelOf(place), placeChance: Math.round((answer('place')?.distribution?.[picked] ?? answer('place')?.confidence ?? 0) * 100) / 100, relation, allowed, clock: entry.clock, timeNode,
      present: present.map(id => ({ name: name.get(id), p: Math.round(chances.find(([other]) => other === id)[1] * 100) / 100, spot: spots[id] })),
      unsure: chances.filter(([, p]) => p >= UNSURE && p < PRESENT).map(([id, p]) => ({ name: name.get(id), p: Math.round(p * 100) / 100 })),
      stayed: entry.stayed.map(id => name.get(id)), travelled: entry.travelled.map(trip => `${name.get(trip.person)}: ${labelOf(trip.from)} → ${labelOf(trip.to)}`), calls: calls - before });
  }
  await writeFile(join(outDir, 'world-log.jsonl'), log.map(line => JSON.stringify(line)).join('\n') + '\n', { mode: 0o600 });
  await writeFile(join(outDir, 'world.json'), JSON.stringify({ people: Object.fromEntries(Object.entries(world.people).map(([id, person]) => [name.get(id) ?? id, { ...person, place: labelOf(person.place) }])), places: world.places, scenes: world.scenes }, null, 1), { mode: 0o600 });
  const summary = { scenes: log.length, fragments: log.filter(line => line.fragment).length, calls, stopped, model: live.modelId, chapters: [...new Set(log.map(line => line.chapter))] };
  await writeFile(join(outDir, 'run.json'), JSON.stringify(summary, null, 1), { mode: 0o600 });
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { chapters: { type: 'string' }, 'max-calls': { type: 'string' } } });
  const range = values.chapters?.match(/^(\d+)(?:-(\d+))?$/), chapters = range ? Array.from({ length: Number(range[2] ?? range[1]) - Number(range[1]) + 1 }, (_, n) => Number(range[1]) + n) : null;
  if (!positionals[0]) throw new Error('Usage: node experiments/world-first/run.mjs <out-dir> [--chapters 0-5] [--max-calls 200]');
  console.log(JSON.stringify(await runWorldFirst(resolve(positionals[0]), { chapters, maxCalls: Number(values['max-calls'] ?? 200) })));
}
