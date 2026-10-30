// Building EM in a world-first book (docs/underground-design.md §9, the user's rules, 2026-10-30). The same building was
// placed several times: 飞镖酒吧 stood as its nominated place's real building and again as a box wherever a scene mentioned
// it, because the objects step finds buildings in each scene apart. Here, for every building the objects step found in a
// scene, Jev answers one choice in the scene's composed context: which building is it — the building this scene happens
// in, one of the book's named buildings so far, the subway, another building of its own, or not a building here. Answers
// join mentions, scene spots and named places into one building each (a name answered "another building of its own" is
// one building for the whole book). The engine then gives each building one real lot (never a box), keeps the one with the
// least travel when it has several, and moves every scene at the others onto it (export-strand-demo.mjs).
//   node experiments/world-first/buildings.mjs <novel-dir>    (Jev's answers cached under stage/world/cache)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const HERE = 'the building this scene happens in', SUBWAY = 'the subway (a station, a platform, a tunnel)', OWN = 'another building of its own, not one of these', NONE = 'not a building here (a part of one, a description, something seen far off)';
const NAMED = 10;

/**
 * The identities of a book's buildings from Jev's answers: union by answer (each with its `members`: place ids and name
 * keys, which `memberOf` gives for an answer). `answers`: { scene, place, name, to, key? } with
 * `to` a place id, a name's key, 'here', 'own', 'subway' or 'none'. A mention's key is `name:<name>` for a proper name (one
 * building for the whole book) and `name:<scene>:<name>` for a description (a building of its scene only).
 */
export const memberOf = answer => (answer.to === 'none' || answer.to === 'subway' ? null : answer.to === 'here' ? answer.place : answer.to === 'own' ? answer.key ?? `name:${answer.name}` : answer.to);
export function identitiesOf(answers, labels) {
  const parent = new Map(), find = id => { let at = id; while (parent.has(at)) at = parent.get(at); return at; }, join = (a, b) => { const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(y, x); };
  const members = new Set();
  for (const answer of answers) {
    if (answer.to === 'none' || answer.to === 'subway') continue;
    const name = answer.key ?? `name:${answer.name}`;
    members.add(name);
    if (answer.to === 'own') continue;
    const other = answer.to === 'here' ? answer.place : answer.to;
    members.add(other);
    join(other, name);
  }
  const groups = new Map();
  for (const member of members) { const root = find(member); (groups.get(root) ?? groups.set(root, []).get(root)).push(member); }
  return [...groups.values()].map(list => {
    const places = list.filter(member => !member.startsWith('name:')), names = list.filter(member => member.startsWith('name:')).map(member => member.replace(/^name:(?:scene_\d+:)?/, ''));
    // Its label: a named place's name, else a proper name the text gives it, else its place's, else the description.
    const proper = list.filter(member => /^name:(?!scene_\d+:)/.test(member)).map(member => member.slice(5));
    const label = places.map(id => labels[id]).find(text => text && !/^a (building|street)/.test(text)) ?? proper[0] ?? labels[places[0]] ?? names[0] ?? places[0];
    return { id: `bld:${places[0] ?? list[0].slice(5)}`, label, places, names, members: list };
  });
}

export async function settleBuildings(novelDir, { decisions = null } = {}) {
  const script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
  const objects = JSON.parse(await readFile(join(novelDir, 'stage', 'objects.json'), 'utf8').catch(() => 'null'));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  let calls = 0;
  const live = decisions ?? jevFromEnv(process.env), counted = { modelId: live.modelId, decide: (...args) => { calls++; return live.decide(...args); } };
  const jev = cachedDecisions(counted, join(novelDir, 'stage', 'world', 'cache'));
  const labels = Object.fromEntries(Object.entries(script.places).map(([id, place]) => [id, place.label]));
  const building = id => script.places[id]?.scale === 'building';
  // The book's named buildings so far, in story order: the nominated ones, and names answered as buildings of their own.
  const named = Object.entries(script.places).filter(([id, place]) => building(id) && !place.spot).map(([id, place]) => ({ id, label: place.label }));
  // A city's, district's or street's own name the objects step listed as a building is no building.
  const areas = new Set(Object.entries(script.places).filter(([id, place]) => !building(id) && !place.spot).map(([, place]) => place.label));
  const answers = [];
  for (const scene of script.scenes) {
    for (const object of objects?.scenes?.[scene.id]?.objects ?? []) {
      if (object.kind !== 'building' || object.room) continue;
      if (answers.some(answer => answer.scene === scene.id && answer.name === object.name)) continue;
      if (areas.has(object.name)) { answers.push({ scene: scene.id, place: scene.place, name: object.name, to: 'none', why: 'an area' }); continue; }
      // Which building it is, and whether its name is one building's own (a proper name) or a description that fits many.
      const here = building(scene.place), options = [...(here ? [HERE] : []), ...named.slice(-NAMED).map(entry => entry.label).filter(label => label !== object.name), SUBWAY, OWN, NONE];
      const replies = await jev.decide(`${scene.context ?? ''}\n\nThe text mentions a building, “${object.name}”, in this scene${here ? ` (which happens in ${labels[scene.place]})` : ''}.`, [{ key: 'which', primitive: 'choice', instructions: `Which building is “${object.name}”?`, options }, { key: 'proper', primitive: 'noul', instructions: `Is “${object.name}” the name of one particular building (a proper name), rather than a description that could fit many buildings ("a building", "a café", "the tower opposite")?` }]);
      const reply = replies.find(entry => entry.key === 'which'), proper = Number(replies.find(entry => entry.key === 'proper')?.value ?? 0) >= 0.5;
      const value = String(reply?.value ?? OWN), pick = named.find(entry => entry.label === value), sure = reply?.distribution?.[value] ?? reply?.confidence ?? null;
      // A named building only at 60% or more, so weak answers never chain buildings together.
      const to = value === HERE ? 'here' : value === SUBWAY ? 'subway' : value === NONE ? 'none' : pick && (sure ?? 1) >= 0.6 ? pick.id : 'own';
      const key = proper ? `name:${object.name}` : `name:${scene.id}:${object.name}`;
      answers.push({ scene: scene.id, place: scene.place, name: object.name, to, key, proper, sure });
      if (to === 'own' && proper && !named.some(entry => entry.id === key)) named.push({ id: key, label: object.name });
    }
  }
  const identities = identitiesOf(answers, labels);
  const report = { version: 1, model: live.modelId, calls, answers, identities };
  await writeFile(join(novelDir, 'stage', 'world', 'buildings.json'), JSON.stringify(report, null, 1), { mode: 0o600 });
  return { mentions: answers.length, calls, identities: identities.length, merged: identities.filter(identity => identity.places.length + identity.names.length > 1).map(identity => `${identity.label}: ${[...identity.places.map(id => labels[id] ?? id), ...identity.names].join(' = ')}`), none: answers.filter(answer => answer.to === 'none').length, subway: answers.filter(answer => answer.to === 'subway').length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novelDir] = process.argv.slice(2);
  if (!novelDir) throw new Error('Usage: node experiments/world-first/buildings.mjs <novel-dir>');
  console.log(JSON.stringify(await settleBuildings(resolve(novelDir)), null, 1));
}
