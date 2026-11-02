// The world back into the ontology (docs/v2/world-ontology.md §6, §7b; Track B W6): what a director run settled goes into
// canon's bundle (ontology/*.jsonl, last write wins by id), each kind by its gate. G0 (the laws) applies what is lawful
// and agrees with the reading, or what the review (G1) decided; the rest is held and not written. Every write is logged
// in stage/world/canon.jsonl with what it replaced, so a run's writes can be undone (`undoCanon`). No model calls.
//
//   a scene's presence      who played in it, the review's pins over the script (class S)
//   a scene's place         the place the scene was played at (class S, the world's binding)
//   a scene's speakers      the reading's speaker of each spoken line, written when the laws found them there or the
//                           review said so; a speaker the review rejected, or one the laws held, written as unknown
//   where each person is    at each scene's end, the scene's place, after its last event (class W's summary)
//   a strand                a timeline of the ontology (one per fork of the strands)
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const readJsonl = path => readFile(path, 'utf8').then(text => text.split('\n').filter(Boolean).map(line => JSON.parse(line)), () => []);
const readJson = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse, () => fallback);
const foldById = rows => { const byId = new Map(); for (const row of rows) byId.set(row.id, row); return byId; };

/**
 * The canon records run `run` settles, each with its gate: `{ file, record, gate: 'applied'|'held', why }`. Pure:
 * `record` (stage/director/run.json), `ledger` (the run's), `pins`, `scenes` and `events` (canon's, folded), `script`,
 * `strands`, `reading` (the v2 reading: roles for speakers).
 */
export function canonOf({ run, record, ledger, pins, scenes, events, script, strands, reading }) {
  const out = [], world = { run };
  const scriptOf = new Map(script.scenes.map(scene => [scene.id, scene]));
  const heldFor = new Map();
  for (const entry of ledger.filter(row => row.state === 'held')) { const scene = entry.value?.scene ?? String(entry.value?.what ?? '').split(' · ')[0]; (heldFor.get(scene) ?? heldFor.set(scene, []).get(scene)).push(entry); }
  const sceneOfSentence = new Map([...scenes.values()].flatMap(scene => (scene.sentenceIds ?? []).map(id => [id, scene.id]))), lastEventOf = new Map();
  for (const event of [...events.values()].sort((a, b) => a.chronologicalOrder - b.chronologicalOrder)) for (const id of event.evidence?.sentenceIds ?? []) if (sceneOfSentence.has(id)) lastEventOf.set(sceneOfSentence.get(id), event.id);
  for (const played of record.scenes) {
    const canon = scenes.get(played.scene), own = scriptOf.get(played.scene);
    if (!canon || !played.starts) continue;
    const held = heldFor.get(played.scene) ?? [];
    // Presence: everyone the scene played with a place (the script's, with the review's pins over it).
    const present = Object.keys(played.starts).filter(id => id.startsWith('char_')).sort();
    // Speakers: the reading's, where the laws did not hold them (L6 speaker not present, L9) or the review rejected them.
    const heldSpeaker = new Set(held.filter(entry => (entry.law === 'L6' && /is not present/.test(entry.value?.why ?? '')) || entry.law === 'L9').map(entry => entry.subject));
    const turns = canon.sentenceIds.filter(id => reading.roles?.[id]?.kind === 'spoken').map(id => {
      const who = reading.roles[id].who?.id ?? null, to = reading.roles[id].to?.id ?? null;
      const rejected = pins.notSpeaker?.[id] === who, lawful = who && !heldSpeaker.has(who) && !rejected;
      return { speakerId: lawful ? who : null, addresseeId: to && played.starts[to] ? to : null, sentenceIds: [id] };
    });
    const location = own?.place ?? canon.locationId ?? null;
    out.push({ file: 'scenes.jsonl', record: { ...canon, charactersPresent: present, locationId: location, turns, world }, gate: 'applied', why: `played: ${present.length} present at ${location}; ${turns.filter(turn => turn.speakerId).length} of ${turns.length} spoken lines with a speaker` });
    // Where each person is when the scene ends: its place, after its last event; held where a law held them in it.
    const after = lastEventOf.get(played.scene);
    if (after) for (const who of present) {
      const lawful = !held.some(entry => entry.subject === who);
      out.push({ file: 'state-changes.jsonl', record: { id: `sc_world_${played.scene}_${who}`, characterId: who, afterEventId: after, emotions: {}, knowledgeAdd: [], goalsAdd: [], relationships: {}, location, possessionsAdd: [], possessionsRemove: [], world }, gate: lawful ? 'applied' : 'held', why: lawful ? 'at the scene\'s place at its end' : 'a law held them in this scene' });
    }
  }
  // A timeline per strand (each fork of the strands), its scenes in order.
  for (const fork of [...new Set((strands?.scenes ?? []).map(scene => scene.fork))]) {
    const inIt = strands.scenes.filter(scene => scene.fork === fork).map(scene => scene.id);
    out.push({ file: 'timelines.jsonl', record: { id: `tl_strand_${fork}`, kind: 'Timeline', names: [{ text: `strand ${fork}`, lang: 'und', kind: 'canonical' }], properties: { scenes: inIt, from: 'world' }, confidence: 1, world }, gate: 'applied', why: `${inIt.length} scenes` });
  }
  return out;
}

/** Run `run`'s canon records written (what passed its gate), each logged with what it replaced. Returns counts. */
export async function toCanon(novelDir, { run, reading }) {
  const ontology = join(novelDir, 'ontology');
  const [record, ledger, pins, scenes, events, script, strands] = await Promise.all([
    readJson(join(novelDir, 'stage', 'director', 'run.json')), readJsonl(join(novelDir, 'stage', 'world', 'ledger', `${run}.jsonl`)), readJson(join(novelDir, 'stage', 'world', 'pins.json'), {}),
    readJsonl(join(ontology, 'scenes.jsonl')).then(foldById), readJsonl(join(ontology, 'events.jsonl')).then(foldById), readJson(join(novelDir, 'stage', 'world', 'script.json'), { scenes: [] }), readJson(join(novelDir, 'stage', 'world', 'strands.json')),
  ]);
  const records = canonOf({ run, record, ledger, pins: { notSpeaker: {}, ...pins }, scenes, events, script, strands, reading });
  const before = new Map();
  for (const file of new Set(records.map(entry => entry.file))) before.set(file, foldById(await readJsonl(join(ontology, file))));
  const written = records.filter(entry => entry.gate === 'applied'), at = new Date().toISOString();
  for (const file of new Set(written.map(entry => entry.file))) await appendFile(join(ontology, file), written.filter(entry => entry.file === file).map(entry => JSON.stringify(entry.record)).join('\n') + '\n');
  await appendFile(join(novelDir, 'stage', 'world', 'canon.jsonl'), written.map(entry => JSON.stringify({ run, at, file: entry.file, id: entry.record.id, why: entry.why, previous: before.get(entry.file)?.get(entry.record.id) ?? null })).join('\n') + (written.length ? '\n' : ''), { mode: 0o644 });
  const count = gate => Object.fromEntries([...new Set(records.map(entry => entry.file))].map(file => [file, records.filter(entry => entry.file === file && entry.gate === gate).length]));
  return { applied: count('applied'), held: count('held') };
}

/**
 * Undo run `run`'s writes to canon: each record written goes back to what it replaced (written again, last write wins),
 * or, new, is taken out of its file. The log keeps the undo.
 */
export async function undoCanon(novelDir, { run }) {
  const ontology = join(novelDir, 'ontology'), log = await readJsonl(join(novelDir, 'stage', 'world', 'canon.jsonl'));
  const undone = new Set(log.filter(entry => entry.undo).map(entry => entry.undo));
  const mine = log.filter(entry => entry.run === run && !entry.undo && !undone.has(`${entry.run}|${entry.file}|${entry.id}|${entry.at}`));
  if (!mine.length) return { undone: 0 };
  for (const file of new Set(mine.map(entry => entry.file))) {
    const entries = mine.filter(entry => entry.file === file), fresh = new Set(entries.filter(entry => !entry.previous).map(entry => entry.id));
    const kept = (await readJsonl(join(ontology, file))).filter(row => !fresh.has(row.id) || row.world?.run !== run);
    const restored = [...new Map(entries.filter(entry => entry.previous).map(entry => [entry.id, entry.previous])).values()];
    await writeFile(join(ontology, file), [...kept, ...restored].map(row => JSON.stringify(row)).join('\n') + (kept.length + restored.length ? '\n' : ''));
  }
  const at = new Date().toISOString();
  await appendFile(join(novelDir, 'stage', 'world', 'canon.jsonl'), mine.map(entry => JSON.stringify({ at, undo: `${entry.run}|${entry.file}|${entry.id}|${entry.at}` })).join('\n') + '\n', { mode: 0o644 });
  return { undone: mine.length };
}
