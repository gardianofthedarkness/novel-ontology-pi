// The Solidifier, world first (docs/world-first-design.md §10–11), over a world script (run.mjs):
// - Lineage instead of in-book causality: what led up to an event, from the world alone, with no calls. That means the
//   events before it on the clock that share its actors, the events at its place, and the dialogues its actors heard
//   (as parties, or listeners of a group or public node). Newest first. A flashback's events lead only within the past.
// - EM from world evidence: two identities never in a scene together, whose names overlap and who share a companion, may
//   be one person. Merged automatically when nothing conflicts (being one person would not put them in two places at
//   once), with a flag that says why; otherwise left for review. Only in a world-first workspace, and only with --apply.
//   node experiments/world-first/solidify.mjs <out-dir> [<novel-dir> --apply]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Two-character stretches common to many people's descriptions, which say nothing of who they are. */
const GENERIC = /^(少女|少年|女孩|男孩|小姐|先生|女士|修女|老师|男人|女人|孩子|女性|男性|姑娘|大叔|大姐|学生|同学|医生|护士|警察|士兵|神父|女仆|店员|客人|的少|的女|的男|小小|色的|的修|圣诞|红色|白色|金发|黑色)$/;

/** Every timeline item of the script with where and when it is: scene, place, clock start, past or not. */
function items(script) {
  return script.scenes.flatMap((scene, index) => scene.timeline.map((item, at) => ({ ...item, scene: scene.id, place: scene.place, past: !scene.clock, tick: (scene.clock?.[0] ?? index) + at / 1000, order: index * 1000 + at, inScene: [...scene.present, ...scene.stayed] })));
}

/** What led up to an event: earlier items sharing its people, at its place, or heard by its actors; `limit` newest first. */
export function lineage(script, eventId, limit = 12) {
  const all = items(script), target = all.find(item => item.id === eventId);
  if (!target) return null;
  const who = new Set(target.type === 'event' ? target.actors : [...target.parties, ...(target.listeners ?? [])]);
  const before = all.filter(item => item !== target && item.past === target.past && (item.tick < target.tick || (item.tick === target.tick && item.order < target.order)));
  const why = item => {
    const people = item.type === 'event' ? item.actors : [...item.parties, ...(item.listeners ?? [])];
    const shared = people.filter(id => who.has(id));
    return [shared.length ? `shares ${shared.length} ${shared.length === 1 ? 'person' : 'people'}` : null, item.place === target.place ? 'same place' : null, item.type === 'dialogue' && [...who].some(id => people.includes(id)) ? 'heard by its people' : null].filter(Boolean);
  };
  return before.map(item => ({ id: item.id, type: item.type, scene: item.scene, why: why(item) })).filter(item => item.why.length).sort((a, b) => b.why.length - a.why.length || 0).slice(0, limit);
}

/** Pairs of identities the world says may be one person, each with whether merging them breaks a law. */
export function sameness(script, names) {
  const scenesOf = new Map(), together = new Set();
  for (const scene of script.scenes) {
    const here = [...new Set([...scene.present, ...scene.stayed])];
    for (const id of here) scenesOf.set(id, [...(scenesOf.get(id) ?? []), scene]);
    for (const a of here) for (const b of here) if (a < b) together.add(`${a}|${b}`);
  }
  const companions = id => new Set((scenesOf.get(id) ?? []).flatMap(scene => [...scene.present, ...scene.stayed]).filter(other => other !== id));
  // Names overlap on a part of their own: a shared two-character stretch that is not a common word for a person.
  const pairsOf = text => new Set([...text].slice(0, -1).map((char, index) => text.slice(index, index + 2)));
  const overlap = (a, b) => [...pairsOf(a)].some(part => pairsOf(b).has(part) && !GENERIC.test(part));
  const people = [...scenesOf.keys()].filter(id => names[id]), pairs = [];
  for (const [i, a] of people.entries()) for (const b of people.slice(i + 1)) {
    if (together.has(a < b ? `${a}|${b}` : `${b}|${a}`) || !overlap(names[a], names[b])) continue;
    const shared = [...companions(a)].filter(other => companions(b).has(other));
    if (!shared.length) continue;
    // One person cannot be in two places at once: their scenes may not overlap on the clock at different places.
    const clash = (scenesOf.get(a) ?? []).some(x => x.clock && (scenesOf.get(b) ?? []).some(y => y.clock && x.place !== y.place && x.clock[0] < y.clock[1] && y.clock[0] < x.clock[1]));
    pairs.push({ keep: (scenesOf.get(a)?.length ?? 0) >= (scenesOf.get(b)?.length ?? 0) ? a : b, drop: (scenesOf.get(a)?.length ?? 0) >= (scenesOf.get(b)?.length ?? 0) ? b : a, names: [names[a], names[b]], companions: shared.map(id => names[id] ?? id).slice(0, 4), conflict: clash });
  }
  return pairs;
}

export async function solidify(outDir, { novelDir = null, apply = false } = {}) {
  const script = JSON.parse(await readFile(join(outDir, 'script.json'), 'utf8'));
  const pairs = sameness(script, script.names), merged = [];
  if (apply) {
    const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
    if (!manifest.worldFirst) throw new Error('--apply merges without review: only in a world-first workspace (novel init --world-first).');
    const { mergeEntities } = await import(pathToFileURL(`${repository}/dist/src/solidifier/maintenance/fixes.js`).href);
    for (const pair of pairs.filter(entry => !entry.conflict)) {
      await mergeEntities(novelDir, pair.keep, pair.drop, `emFromWorld: never in a scene together, names overlap (${pair.names.join(' / ')}), companions shared (${pair.companions.join('、')}); merged with no conflict`);
      merged.push(pair);
    }
  }
  const events = script.scenes.flatMap(scene => scene.timeline.filter(item => item.type === 'event').map(item => item.id));
  const sample = events.slice(-3).map(id => ({ event: id, lineage: lineage(script, id, 5) }));
  const report = { em: { candidates: pairs.length, merged: merged.map(pair => pair.names), review: pairs.filter(pair => pair.conflict).map(pair => pair.names) }, lineage: { events: events.length, sample } };
  await writeFile(join(outDir, 'solidify.json'), JSON.stringify({ ...report, pairs }, null, 1), { mode: 0o600 });
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outDir, novelDir] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!outDir) throw new Error('Usage: node experiments/world-first/solidify.mjs <out-dir> [<novel-dir> --apply]');
  console.log(JSON.stringify(await solidify(resolve(outDir), { novelDir: novelDir ? resolve(novelDir) : null, apply: process.argv.includes('--apply') }), null, 1));
}
