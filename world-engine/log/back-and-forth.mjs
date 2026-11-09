// Back and forth (the user, 2026-11-07, watching W13: "a character walk to a place for some reason but quickly went back
// because of conversation"; and one who went to another for a conversation, then back to the bigger group): from a run's
// world log, the conversation pulls (talk moves) and how far they walked, and the round trips: a move out of at least
// `out` m, then within `window` cards of the same scene moves that end back within max(3 m, 35% of the way out) of where it
// began, with what moved each leg (the log's source: talk, answer, digest, background, with …).
//   node world-engine/log/back-and-forth.mjs <novel-dir> [run] [--json]
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** The run's talk pulls and round trips, from its world log (rows) and its record (for the cards' order). */
export function backAndForth({ log, record, out = 5, window = 4, far = 20 }) {
  const order = new Map();
  let n = 0;
  for (const scene of record.scenes) { order.set(`${scene.scene}|start`, n++); for (const card of scene.cards) order.set(`${scene.scene}|${card.card}`, n++); }
  const byId = new Map(log.map(row => [row.id, row])), moves = new Map();
  for (const row of log) {
    if (row.kind !== 'position' || !row.at || !row.who) continue;
    const start = byId.get(row.from)?.at ?? null, o = order.get(`${row.scene}|${row.card && !String(row.card).startsWith('arrive:') ? row.card : 'start'}`);
    (moves.get(row.who) ?? moves.set(row.who, []).get(row.who)).push({ ...row, start, o: o ?? null });
  }
  const talk = log.filter(row => row.kind === 'position' && row.source === 'talk'), farTalk = talk.filter(row => (row.metres ?? 0) > far);
  const trips = [];
  for (const [who, list] of moves) for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.start || a.o === null) continue;
    const away = flat(a.start, a.at);
    if (away < out) continue;
    for (let k = i + 1; k < list.length && list[k].scene === a.scene && list[k].o !== null && list[k].o - a.o <= window; k++) {
      const c = list[k];
      if (flat(c.at, a.start) <= Math.max(3, 0.35 * away) && flat(a.at, c.at) >= 0.6 * away) {
        trips.push({ who, scene: a.scene, out: Math.round(away), cards: c.o - a.o, legs: [a, ...list.slice(i + 1, k + 1)].map(leg => ({ card: leg.card, source: leg.source ?? null, metres: Math.round(leg.metres ?? 0) })) });
        i = k;
        break;
      }
    }
  }
  const kinds = {};
  for (const trip of trips) { const key = `${trip.legs[0].source} -> ${[...new Set(trip.legs.slice(1).map(leg => leg.source))].join('+')}`; kinds[key] = (kinds[key] ?? 0) + 1; }
  return {
    talk: { moves: talk.length, metres: Math.round(talk.reduce((sum, row) => sum + (row.metres ?? 0), 0)), far: farTalk.length, farMetres: Math.round(farTalk.reduce((sum, row) => sum + (row.metres ?? 0), 0)) },
    roundTrips: { count: trips.length, throughTalk: trips.filter(trip => trip.legs.some(leg => leg.source === 'talk')).length, kinds, list: trips.slice(0, 40) },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [novelDir, given] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!novelDir) { console.error('usage: node world-engine/log/back-and-forth.mjs <novel-dir> [run] [--json]'); process.exit(2); }
  const dir = resolve(novelDir), run = given ?? JSON.parse(await readFile(join(dir, 'stage', 'simulation', 'index.json'), 'utf8')).strands?.director?.accepted;
  const log = (await readFile(join(dir, 'stage', 'world', 'log', `${run}.jsonl`), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const record = JSON.parse(await readFile(join(dir, 'stage', 'director', 'runs', run, 'run.json'), 'utf8'));
  const result = backAndForth({ log, record });
  if (process.argv.includes('--json')) console.log(JSON.stringify({ run, ...result }, null, 1));
  else console.log(JSON.stringify({ run, talk: result.talk, roundTrips: { count: result.roundTrips.count, throughTalk: result.roundTrips.throughTalk, kinds: result.roundTrips.kinds } }));
}
