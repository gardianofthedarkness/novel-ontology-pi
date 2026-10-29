// The world-first run (run.mjs) against the book's old extraction, scene by scene in reading order: who is in each scene
// (the old reviewed presence against the world's present and stayed), how often someone vanishes and comes back within
// three scenes, which scenes have a place, which are flashbacks, and how many times the two-places law ruled a time out.
// Also the world's evidence for EM: two identities never in a scene together, whose names overlap and who share
// companions, may be one person (candidates to put to EM, never merged here).
//   node experiments/world-first/compare.mjs <out-dir> <old-novel-dir>
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Times someone in a scene is missing from the next one and back within three scenes, while the story carries straight
 * on in the same place (`carried[i]`): someone vanishing there is a gap in the data, not a cut to elsewhere.
 */
const flickers = (sets, carried) => { let count = 0; for (let i = 1; i < sets.length - 1; i++) if (carried[i]) for (const person of sets[i - 1]) if (!sets[i].has(person) && sets.slice(i + 1, i + 4).some(set => set.has(person))) count++; return count; };

export async function compare(outDir, oldNovel) {
  const scenes = JSON.parse(await readFile(join(outDir, 'base', 'scenes.json'), 'utf8')), roster = JSON.parse(await readFile(join(outDir, 'base', 'roster.json'), 'utf8'));
  const log = (await readFile(join(outDir, 'world-log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)), byScene = new Map(log.map(line => [line.scene, line]));
  const old = new Map((await readFile(join(oldNovel, 'ontology', 'scenes.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).map(scene => [scene.id, scene]));
  const name = new Map(roster.characters.map(entry => [entry.id, entry.names[0]]));
  const order = scenes.filter(scene => byScene.has(scene.id));
  const oldSets = order.map(scene => new Set((old.get(scene.id)?.charactersPresent ?? []).map(id => name.get(id) ?? id)));
  const newSets = order.map(scene => { const line = byScene.get(scene.id); return new Set([...line.present.map(entry => entry.name), ...line.stayed]); });
  const seenSets = order.map(scene => new Set(byScene.get(scene.id).present.map(entry => entry.name)));
  const carried = order.map((scene, i) => i > 0 && byScene.get(scene.id).relation === 'after' && byScene.get(scene.id).place === byScene.get(order[i - 1].id).place);
  // The two-places law at work: a scene out of the past, past the first, offered fewer than the four times (no "same").
  const ruledOut = log.filter((line, i) => i > 0 && !line.fragment && line.allowed && !line.allowed.includes('back') && !line.allowed.includes('same') && log[i - 1].clock !== null).length;
  const { stageInputs } = await import(pathToFileURL(resolve(import.meta.dirname, '..', '..', 'dist/src/cli/commands/extract/stageCommands.js')).href);
  const oldFlashbacks = (await stageInputs(oldNovel)).data.scenes.filter(scene => scene.flashback).length;
  // EM evidence: never together, names overlapping, companions shared.
  const together = new Map(), scenesOf = new Map();
  for (const set of seenSets) for (const a of set) { scenesOf.set(a, (scenesOf.get(a) ?? 0) + 1); for (const b of set) if (a !== b) together.set(`${a}|${b}`, (together.get(`${a}|${b}`) ?? 0) + 1); }
  const people = [...scenesOf.keys()], companions = person => new Set(seenSets.filter(set => set.has(person)).flatMap(set => [...set]).filter(other => other !== person));
  const overlap = (a, b) => a.length >= 2 && b.length >= 2 && (a.includes(b.slice(0, 2)) || b.includes(a.slice(0, 2)));
  const emCandidates = people.flatMap((a, i) => people.slice(i + 1).filter(b => !together.has(`${a}|${b}`) && overlap(a, b) && [...companions(a)].filter(other => companions(b).has(other)).length >= 1).map(b => [a, b]));
  const report = {
    scenes: order.length,
    nobodyPresent: { old: oldSets.filter(set => !set.size).length, worldFirst: newSets.filter(set => !set.size).length, worldFirstSeen: seenSets.filter(set => !set.size).length },
    carriedOnScenes: carried.filter(Boolean).length,
    vanishAndReturn: { old: flickers(oldSets, carried), worldFirst: flickers(newSets, carried), worldFirstSeen: flickers(seenSets, carried) },
    withPlace: { old: order.filter(scene => old.get(scene.id)?.locationId).length, worldFirst: log.filter(line => line.place && !/^an unnamed place/.test(line.place)).length, unnamed: log.filter(line => /^an unnamed place/.test(line.place ?? '')).length },
    flashbacks: { old: oldFlashbacks, worldFirst: log.filter(line => line.relation === 'flashback').length, scenesInPast: log.filter(line => line.clock === null).length },
    times: Object.fromEntries(['after', 'later', 'same', 'flashback', 'back'].map(key => [key, log.filter(line => line.relation === key).length])),
    timeNodes: log.filter(line => line.timeNode).length,
    sameTimeRuledOut: ruledOut,
    stayedUnseen: log.reduce((sum, line) => sum + line.stayed.length, 0),
    trips: log.reduce((sum, line) => sum + (line.travelled?.length ?? 0), 0),
    unsure: log.reduce((sum, line) => sum + (line.unsure?.length ?? 0), 0),
    emCandidates,
  };
  await writeFile(join(outDir, 'compare.json'), JSON.stringify(report, null, 1), { mode: 0o600 });
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outDir, oldNovel] = process.argv.slice(2);
  if (!outDir || !oldNovel) throw new Error('Usage: node experiments/world-first/compare.mjs <out-dir> <old-novel-dir>');
  console.log(JSON.stringify(await compare(resolve(outDir), resolve(oldNovel)), null, 1));
}
