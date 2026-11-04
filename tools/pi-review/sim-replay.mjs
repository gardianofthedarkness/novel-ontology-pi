// The objective replay (docs/v2/directing/Forks-M15.md §4; the user, 2026-11-03: "our frontend should give an objective
// replay mode that replays the whole view of the world with rough strand character activity paths highlighted and names
// selectable from top view. Shrink the places tabs but keep the building list for that book"; 2026-11-04: "build the
// objective timeline view mode in the design"). Not one strand's camera: the whole world from above, in story time.
//
// replayData(workspace) reads the director's newest run kept for the book (its page: the world, every unit's starts and
// every card's moves) and the strands it played (stage/world/segments/strands.json, else stage/world/strands.json), and
// gives the page what it draws: the buildings, the book's named buildings and places, the people, the strands with their
// units, the moments in story time, and each person's track. Rough by design: a path keeps a point every few metres.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { playableRuns, pagePolicy } from './sim-play.mjs';

const CELL = 2, FLOOR = 3, EVERY = 4;
const round = value => Math.round(value * 10) / 10;

/** A path kept rough: a point every EVERY metres or where it turns, the ends always (metres: x and z, then anything after them, the height). */
export function roughPath(points) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let k = 1; k < points.length - 1; k++) {
    const last = out.at(-1), here = points[k], next = points[k + 1];
    const turn = Math.abs(Math.atan2(next[1] - here[1], next[0] - here[0]) - Math.atan2(here[1] - last[1], here[0] - last[0]));
    if (Math.hypot(here[0] - last[0], here[1] - last[1]) >= EVERY || (turn > 0.6 && turn < 5.7)) out.push(here);
  }
  out.push(points.at(-1));
  return out;
}

/**
 * What the replay draws, from a run's page and the strands it played. Pure. `story`: the units in story order (the
 * strands' layers, then reading order). Each moment is one card's event of a unit; a person's track is where they stand at
 * each unit's start and the way they took in each event (crowds are a field, not people: left out).
 */
/** A time-tree node as words: t:y1:12-24:late-night is "12-24 · late night". */
export const whenOf = node => (node ? String(node).split(':').slice(2).map(part => part.replace(/-/g, part.includes('-') && /^\d/.test(part) ? '-' : ' ')).join(' · ') || 'the story' : null);

export function replayOf(page, strands, terrain = null, script = null) {
  const g = page.world, decode = node => { const i = node % g.NX - g.oi, j = Math.floor(node / g.NX) % g.NZ - g.oj, k = Math.floor(node / (g.NX * g.NZ)) - g.ok; return [round((i + 0.5) * CELL), round((j + 0.5) * CELL), k * FLOOR]; };
  const index = new Map(page.scenes.map((scene, n) => [scene.id, n])), layer = new Map((strands?.scenes ?? []).map(entry => [entry.id, entry.layer ?? 0]));
  const forkOf = new Map((strands?.scenes ?? []).map(entry => [entry.id, entry.fork ?? entry.id]));
  // Calendar order (the user, 2026-11-04: "replay should happen in calendar order"): each unit at its place on the story's
  // clock (the world script's clock, the time tree's order), then the strands' layers, then reading order.
  const timed = new Map((script?.scenes ?? []).map(entry => [entry.id, { clock: Array.isArray(entry.clock) ? entry.clock : null, node: entry.at?.node ?? null }]));
  const clockOf = id => timed.get(id)?.clock ?? null;
  const story = [...page.scenes].sort((a, b) => (clockOf(a.id)?.[0] ?? Infinity) - (clockOf(b.id)?.[0] ?? Infinity) || (clockOf(a.id)?.[1] ?? Infinity) - (clockOf(b.id)?.[1] ?? Infinity) || (layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0) || index.get(a.id) - index.get(b.id));
  const forks = [...new Set(story.map(scene => forkOf.get(scene.id) ?? scene.id))];
  const person = who => !String(who).startsWith('crowd:');
  const moments = [], tracks = {};
  const push = (who, entry) => (tracks[who] ??= []).push(entry);
  for (const scene of story) {
    const fork = forks.indexOf(forkOf.get(scene.id) ?? scene.id);
    // The unit's start: everyone where the line has them as it begins.
    const first = moments.length;
    const clock = clockOf(scene.id), when = whenOf(timed.get(scene.id)?.node);
    moments.push({ unit: scene.id, card: null, fork, place: scene.place ?? null, text: '', clock, when });
    for (const [who, node] of Object.entries(scene.starts ?? {})) if (person(who) && node !== null && node !== undefined) push(who, { m: first, at: decode(node) });
    for (const event of scene.events ?? []) {
      const m = moments.length;
      const focus = event.camera?.focus, actors = (event.actors ?? []).filter(person);
      moments.push({ unit: scene.id, card: event.id, fork, place: scene.place ?? null, text: String(event.text ?? '').slice(0, 160), clock, when, actors, at: focus ? [round(focus.x), round(focus.z), round(focus.y0 ?? 0)] : null });
      for (const move of event.moves ?? []) if (person(move.person) && move.path?.length) {
        const points = move.path.map(decode), rough = roughPath(points);
        push(move.person, { m, at: points.at(-1), path: rough, how: move.how ?? 'walk' });
      }
    }
  }
  // Buildings as footprints (metres), the book's named ones listed with where they stand; the places the book names.
  const lots = (g.lots ?? []).map(lot => [lot.i0 * CELL, lot.j0 * CELL, lot.nx * CELL, lot.nz * CELL, lot.floors ?? lot.height ?? 1]);
  // The book's buildings: the terrain's building sites (each with its name and box), else the lots the run named.
  const sites = Object.entries(terrain?.sites ?? {}).filter(([, site]) => Array.isArray(site.box) && site.box.length >= 4);
  const boxed = (id, site) => { const [x0, z0, x1, z1] = site.box; return { id, name: String(site.label ?? id).replace(/ \(scene \d+\)$/, ''), scale: site.scale ?? null, kind: site.kind ?? null, x: round((x0 + x1) / 2), z: round((z0 + z1) / 2), w: round(Math.abs(x1 - x0)), d: round(Math.abs(z1 - z0)) }; };
  const buildings = sites.length ? sites.filter(([, site]) => site.scale === 'building' || site.scale === 'room').map(([id, site]) => boxed(id, site))
    : (g.lots ?? []).map((lot, n) => ({ id: `lot:${n}`, name: lot.detected?.name ?? lot.label ?? null, scale: 'building', kind: lot.role ?? null, x: round((lot.i0 + lot.nx / 2) * CELL), z: round((lot.j0 + lot.nz / 2) * CELL), w: lot.nx * CELL, d: lot.nz * CELL })).filter(entry => entry.name);
  const places = sites.filter(([, site]) => ['district', 'street', 'city'].includes(site.scale)).map(([id, site]) => boxed(id, site));
  const people = Object.entries(page.people ?? {}).filter(([id]) => person(id) && tracks[id]).map(([id, entry]) => ({ id, name: entry.name ?? id, color: entry.color ?? null }));
  const xs = lots.flatMap(([x, , w]) => [x, x + w]), zs = lots.flatMap(([, z, , d]) => [z, z + d]);
  return { version: 2, order: 'calendar', title: page.title ?? null, bounds: xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } : null, forks: forks.map((id, n) => ({ n, id, units: story.filter(scene => (forkOf.get(scene.id) ?? scene.id) === id).map(scene => ({ id: scene.id, clock: clockOf(scene.id), when: whenOf(timed.get(scene.id)?.node) })) })), moments, people, tracks, lots, buildings, places };
}

/** The replay of a book's newest kept run, or null when it has none. */
export async function replayData(workspace) {
  const [run] = await playableRuns(workspace, { newest: true });
  if (!run) return null;
  const read = path => readFile(resolve(workspace, ...path), 'utf8').then(JSON.parse, () => null);
  const strands = (await read(['stage', 'world', 'segments', 'strands.json'])) ?? (await read(['stage', 'world', 'strands.json']));
  const script = (await read(['stage', 'world', 'segments', 'script.json'])) ?? (await read(['stage', 'world', 'script.json']));
  return { run: run.run ?? run.id, ...replayOf(run.data, strands, await read(['stage', 'terrain.json']), script) };
}

/** The replay page: static, it reads replay.json. */
export async function simulationReplayPage() {
  const html = await readFile(new URL('./sim-replay.html', import.meta.url), 'utf8');
  return { html, policy: pagePolicy(html) };
}
