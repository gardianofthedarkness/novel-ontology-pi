// Every law over a director run (Track B W2: logged only, no model call): the run's record (stage/director/run.json) and
// its page (where everyone stood at each scene's start and after each card), with the strands, the script, the reading's
// speakers and the universe's abilities config. Writes stage/director/laws.json and prints each law's count.
//   npm run build && node world-engine/laws/check-run.mjs <novel-dir> --reading <reading>/v2/data.json [--run <id>]
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkAll } from './laws.mjs';

/**
 * The line as played, for the laws: scenes in the order played (who was present, who was carried, where each started),
 * each arrival from another scene (from where, how far), and each card (its kind, lines, moves, actors, where everyone
 * stood once it was played).
 */
export function playedLine({ record, page, reading }) {
  const g = page.world, decode = node => { const i = node % g.NX - g.oi, j = Math.floor(node / g.NX) % g.NZ - g.oj, k = Math.floor(node / (g.NX * g.NZ)) - g.ok; return { x: (i + 0.5) * 2, z: (j + 0.5) * 2, y: k * 3 }; };
  const pageScene = new Map(page.scenes.map(scene => [scene.id, scene])), readingCard = new Map(reading.cards.map(card => [card.id, card]));
  const scenes = [], cards = [], arrivals = [], lastEnd = new Map(), lastScene = new Map();
  for (const entry of record.scenes) {
    const own = pageScene.get(entry.scene);
    if (!own) continue;
    const startAt = Object.fromEntries(Object.entries(own.starts).filter(([, node]) => node != null).map(([who, node]) => [who, decode(node)]));
    const present = Object.keys(startAt), now = { ...startAt }, firstMove = new Map();
    const after = own.events.map(event => { for (const move of event.moves) { const end = decode(move.path.at(-1)); if (!firstMove.has(move.person)) firstMove.set(move.person, end); now[move.person] = end; } return { ...now }; });
    for (const who of present) {
      if (entry.carried.includes(who) || entry.spawned.includes(who) || !lastEnd.has(who)) continue;
      const to = entry.offPage.includes(who) ? startAt[who] : firstMove.get(who) ?? startAt[who], from = lastEnd.get(who);
      arrivals.push({ scene: entry.scene, who, fromScene: lastScene.get(who), metres: Math.hypot(to.x - from.x, to.z - from.z), offPage: entry.offPage.includes(who) });
    }
    scenes.push({ id: entry.scene, present, carried: entry.carried, spawned: entry.spawned, startAt });
    for (const card of entry.cards) {
      const read = readingCard.get(card.card), actors = (read?.people ?? []).filter(person => person.how.some(how => how === 'acts' || how === 'speaks')).map(person => person.id);
      cards.push({ scene: entry.scene, card: card.card, kind: card.kind, lines: card.lines, moves: card.moves, breaks: card.breaks ?? null, hit: card.hit ?? null, talk: card.talk?.kind ?? null, actors, positions: after[card.event] ?? now });
    }
    for (const [who, p] of Object.entries(now)) { lastEnd.set(who, p); lastScene.set(who, entry.scene); }
  }
  return { scenes, cards, arrivals };
}

/** The reading's speakers: each spoken line's speaker and whom it is said to (EM²), and how sure. */
export const speakersOf = reading => Object.fromEntries(Object.entries(reading.roles ?? {}).filter(([, role]) => role.kind === 'spoken' && role.who?.id).map(([id, role]) => [id, { who: role.who.id, to: role.to?.id ?? null, sure: role.who.confidence ?? null }]));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, run: { type: 'string' } } });
  if (!novelDir || !values.reading) { console.error('usage: node world-engine/laws/check-run.mjs <novel-dir> --reading <data.json> [--run <id>]'); process.exit(2); }
  const dir = resolve(novelDir), read = async (...path) => JSON.parse(await readFile(join(dir, ...path), 'utf8'));
  const index = await read('stage', 'simulation', 'index.json'), id = values.run ?? index.strands.director.accepted;
  const record = await read('stage', 'director', 'run.json'), world = record.bySegment ? ['stage', 'world', 'segments'] : ['stage', 'world'];
  const [page, strands, script, whole] = await Promise.all([read('stage', 'simulation', 'runs', 'director', `${id}.page.json`), read(...world, 'strands.json'), read(...world, 'script.json'), readFile(resolve(values.reading), 'utf8').then(JSON.parse)]);
  // A run by segment (M14) played the reading's segment view (segments.mjs), built the same way here.
  const reading = record.bySegment ? (await import('../director/segments.mjs')).segmentWorld({ reading: whole, script, spawn: null })?.reading ?? whole : whole;
  const abilities = await readFile(join(dir, '..', '..', 'universe', 'abilities.json'), 'utf8').then(JSON.parse, () => ({ version: 1, people: {} }));
  const played = playedLine({ record, page, reading });
  const laws = checkAll({ played, strands, script, speakers: speakersOf(reading), abilities });
  await writeFile(join(dir, 'stage', 'director', 'laws.json'), JSON.stringify({ version: 1, run: id, at: new Date().toISOString(), abilities: Object.keys(abilities.people ?? {}).length, laws }, null, 1));
  for (const law of laws) console.log(`${law.law.padEnd(4)} checked ${String(law.checked).padStart(5)}  broken ${String(law.violations.length).padStart(4)}${law.violations[0] ? `   e.g. ${law.violations[0].what}: ${law.violations[0].why}` : ''}`);
}
