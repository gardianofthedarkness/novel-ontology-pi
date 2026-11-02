// The world back into the ontology (docs/v2/world-ontology.md §6, §7b; Track B W6): what a director run settled goes into
// canon's bundle (ontology/*.jsonl, last write wins by id), each kind by its gate. G0 (the laws) applies what is lawful
// and agrees with the reading, or what the review (G1) decided; the rest is held and not written. Every write is logged
// in stage/world/canon.jsonl with what it replaced, so a run's writes can be undone (`undoCanon`). No model calls.
//
//   a scene's presence      who played in it, the review's pins over the script (class S)
//   a scene's place         the place the scene was played at, or its nearest named one (an unnamed room's parent)
//   a scene's speakers      each spoken line's, settled by the review, the reading or the world (speakers.mjs); what
//                           none settles is written as unknown and held for the review (as `speaker` in the ledger),
//                           and a share of what the world settled is audited by the review
//   where each person is    at each scene's end, the scene's place, after its last event (class W's summary)
//   a strand                a timeline of the ontology (one per fork of the strands)
//   an identity             a description the review answered is a named person: its words an alias of theirs (class I)
//   a building's identity   a named building is the lot its scenes play in (the same lot each time; else the review)
//   a room's floor          a named room is on the floor its people stood on, in its building's lot
//   a place's container     a named place whose scenes play inside a named building's lot is PART_OF it
//   a time relation         someone who walks from one scene to the next puts the second at least that walk later
//                           (PRECEDES between the scenes' events, the minutes kept), where the reading gave no clock
//   damage                  a blast on a named building's lot, on its record (the cells it took)
//   a split                 someone the two-places law puts in two places more than once: a question for the review
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { playedLine } from '../laws/check-run.mjs';
import { settleSpeakers } from './speakers.mjs';

/** The share of what the world settles on its own that the review audits (§7b), and the error rate that routes a class to the review. */
export const AUDIT = 0.02, AUDIT_LIMIT = 0.2, AUDIT_MIN = 5;
const audited = id => parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16) / 0xffffffff < AUDIT;

const readJsonl = path => readFile(path, 'utf8').then(text => text.split('\n').filter(Boolean).map(line => JSON.parse(line)), () => []);
const readJson = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse, () => fallback);
const foldById = rows => { const byId = new Map(); for (const row of rows) byId.set(row.id, row); return byId; };

/**
 * The canon records run `run` settles, each with its gate: `{ file, record, gate: 'applied'|'held', why }`. Pure:
 * `record` (stage/director/run.json), `ledger` (the run's), `pins`, `scenes` and `events` (canon's, folded), `script`,
 * `strands`, `reading` (the v2 reading: roles for speakers).
 */
export function canonOf({ run, record, ledger, pins, scenes, events, script, strands, reading, settled = [], entities = new Map(), world: placed = null, relations = [] }) {
  const out = [], world = { run };
  const settledOf = new Map(settled.map(entry => [entry.line, entry]));
  // A scene's place in canon: its own if named, else the nearest named one up the script's place tree.
  const named = id => { for (let at = id, n = 0; at && n < 12; at = script.places?.[at]?.parent, n++) if (/^loc_/.test(at)) return at; return null; };
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
    // Speakers as settled (speakers.mjs): the review's, the reading's or the world's; unknown where held. A line the run did
    // not play keeps the reading's sure speaker.
    const turns = canon.sentenceIds.filter(id => reading.roles?.[id]?.kind === 'spoken').map(id => {
      const settledLine = settledOf.get(id), who = settledLine ? (settledLine.gate === 'applied' ? settledLine.who : null) : reading.roles[id].who?.id ?? null;
      const to = settledLine?.to ?? reading.roles[id].to?.id ?? null;
      return { speakerId: who && /^char_/.test(who) ? who : null, addresseeId: to && /^char_/.test(to) && played.starts[to] ? to : null, sentenceIds: [id], ...(settledLine ? { by: settledLine.by } : {}) };
    });
    const location = named(own?.place) ?? canon.locationId ?? null;
    out.push({ file: 'scenes.jsonl', record: { ...canon, charactersPresent: present, locationId: location, turns, world }, gate: 'applied', why: `played: ${present.length} present at ${location}; ${turns.filter(turn => turn.speakerId).length} of ${turns.length} spoken lines with a speaker` });
    // Where each person is when the scene ends: its place, after its last event; held where a law held them in it.
    const after = lastEventOf.get(played.scene);
    if (after) for (const who of present) {
      const lawful = !held.some(entry => entry.subject === who);
      out.push({ file: 'state-changes.jsonl', record: { id: `sc_world_${played.scene}_${who}`, characterId: who, afterEventId: after, emotions: {}, knowledgeAdd: [], goalsAdd: [], relationships: {}, location, possessionsAdd: [], possessionsRemove: [], world }, gate: lawful ? 'applied' : 'held', why: lawful ? 'at the scene\'s place at its end' : 'a law held them in this scene' });
    }
  }
  // Identities the review settled (pins.same): a description that is a named person becomes an alias of theirs.
  const slotOf = new Map((reading.slots ?? []).map(slot => [slot.id, slot])), aliased = new Map();
  const patch = (id, change) => { const current = aliased.get(id) ?? entities.get(id); if (!current) return; aliased.set(id, { ...current, properties: { ...current.properties, world: { ...(current.properties?.world ?? {}), ...change } }, world }); };
  for (const pair of pins.same ?? []) {
    const person = pair.find(id => /^char_/.test(id)), slot = pair.find(id => slotOf.has(id)), entity = person && entities.get(person);
    if (!entity || !slot) continue;
    const current = aliased.get(person) ?? entity, words = [...new Set([slotOf.get(slot).label, ...(slotOf.get(slot).names ?? [])])].filter(word => word && !current.names.some(name => name.text === word));
    if (words.length) aliased.set(person, { ...current, names: [...current.names, ...words.map(text => ({ text, lang: current.names[0]?.lang ?? 'und', kind: 'alias' }))], world });
  }
  // Places from the world (worldPlaces): a named building's lot, a named room's floor, what contains what, blasts.
  if (placed) {
    const lotOfPlace = new Map();
    for (const [place, scenesAt] of Object.entries(placed.places)) {
      const scale = script.places?.[place]?.scale, lots = [...new Set(scenesAt.map(entry => entry.lot?.source).filter(Boolean))];
      // Only what a lot can be: a building, or a floor or room in one (a city or district spans many).
      if (!/^loc_/.test(place) || !entities.has(place) || !lots.length || !['building', 'floor', 'room'].includes(scale)) continue;
      // Several lots: one building only if the review said so (then the one most of its scenes played in).
      if (lots.length > 1 && pins.places?.[place] !== 'one building') { if (!pins.places?.[place]) out.push({ file: 'held', record: { kind: 'building', place, lots, scenes: scenesAt.map(entry => entry.scene) }, gate: 'held', why: `${place} plays in ${lots.length} buildings` }); continue; }
      const most = lots.map(source => [source, scenesAt.filter(entry => entry.lot?.source === source).length]).sort((a, b) => b[1] - a[1])[0][0];
      const lot = scenesAt.find(entry => entry.lot?.source === most).lot;
      lotOfPlace.set(place, lot.source);
      if (scale === 'building') { if (entities.get(place).properties?.world?.lot !== lot.source) patch(place, { lot: lot.source, floors: lot.floors, role: lot.role ?? null }); }
      else if (scale === 'room' || scale === 'floor') {
        const floors = pins.floor?.[place] ? [Number(pins.floor[place]) - 1] : [...new Set(scenesAt.map(entry => entry.floor))];
        if (floors.length === 1 && entities.get(place).properties?.world?.floor !== floors[0] + 1) patch(place, { lot: lot.source, floor: floors[0] + 1 });
        else if (floors.length > 1) out.push({ file: 'held', record: { kind: 'floor', place, floors: floors.map(k => k + 1), scenes: scenesAt.map(entry => entry.scene) }, gate: 'held', why: `${place} on floors ${floors.map(k => k + 1).join(', ')}` });
      }
    }
    // What contains what: a named place smaller than a building, playing in a named building's lot.
    const parentOf = new Map(relations.filter(relation => relation.type === 'PART_OF').map(relation => [relation.fromId, relation.toId]));
    for (const [place, lotSource] of lotOfPlace) {
      const scale = script.places?.[place]?.scale; if (scale === 'building') continue;
      const host = [...lotOfPlace].find(([other, source]) => other !== place && source === lotSource && script.places?.[other]?.scale === 'building')?.[0];
      if (!host) continue;
      if (!parentOf.has(place)) out.push({ file: 'relations.jsonl', record: { id: `rel_world_PART_OF_${place}_${host}`, fromId: place, toId: host, type: 'PART_OF', properties: { by: 'world' }, confidence: 0.8, world }, gate: 'applied', why: `${place} plays inside ${host}'s building` });
      else if (parentOf.get(place) !== host) out.push({ file: 'held', record: { kind: 'container', place, host, parent: parentOf.get(place) }, gate: 'held', why: `${place} plays inside ${host}, but canon has it in ${parentOf.get(place)}` });
    }
    // Damage on a named building.
    const placeOfLot = new Map([...lotOfPlace].filter(([place]) => script.places?.[place]?.scale === 'building').map(([place, source]) => [source, place]));
    const struck = new Map();
    for (const blast of placed.blasts) { const place = placeOfLot.get(blast.lot); if (place && !ledger.some(row => row.state === 'held' && row.law === 'L13' && String(row.value?.what ?? '').startsWith(blast.scene))) (struck.get(place) ?? struck.set(place, []).get(place)).push({ scene: blast.scene, card: blast.card, cells: blast.cells }); }
    for (const [place, damage] of struck) patch(place, { damage });
    // Time from travel: the later scene at least the walk later, where both scenes share one unstated time.
    const atOf = new Map(script.scenes.map(scene => [scene.id, scene.at]));
    const firstEventOf = new Map(), lastEventOf2 = new Map();
    for (const event of [...events.values()].sort((a, b) => a.chronologicalOrder - b.chronologicalOrder)) for (const id of event.evidence?.sentenceIds ?? []) { const scene = [...scenes.values()].find(entry => entry.sentenceIds?.includes(id))?.id; if (scene) { if (!firstEventOf.has(scene)) firstEventOf.set(scene, event.id); lastEventOf2.set(scene, event.id); } }
    const pairs = new Map();
    for (const arrival of placed.arrivals) {
      const a = atOf.get(arrival.fromScene), b = atOf.get(arrival.scene);
      if (!a || !b || a.node !== b.node || (a.stated && b.stated)) continue;
      const key = `${arrival.fromScene}|${arrival.scene}`, minutes = Math.ceil(arrival.metres / 1.4 / 60);
      if (minutes >= 2 && (pairs.get(key)?.minutes ?? 0) < minutes) pairs.set(key, { ...arrival, minutes });
    }
    const known = new Set(relations.map(relation => `${relation.type}|${relation.fromId}|${relation.toId}`));
    for (const pair of pairs.values()) {
      const from = lastEventOf2.get(pair.fromScene), to = firstEventOf.get(pair.scene);
      if (!from || !to || from === to || known.has(`PRECEDES|${from}|${to}`)) continue;
      out.push({ file: 'relations.jsonl', record: { id: `rel_world_PRECEDES_${from}_${to}`, fromId: from, toId: to, type: 'PRECEDES', properties: { by: 'world', fromScene: pair.fromScene, toScene: pair.scene, minMinutes: pair.minutes, metres: Math.round(pair.metres), who: pair.who }, confidence: 0.7, world }, gate: 'applied', why: `${pair.scene} at least ${pair.minutes} min after ${pair.fromScene}: ${Math.round(pair.metres)} m on foot` });
    }
  }
  // Someone in two places at once more than once (L2): perhaps two people; the review says.
  const twice = new Map();
  for (const row of ledger.filter(entry => entry.state === 'held' && entry.law === 'L2')) twice.set(row.subject, [...(twice.get(row.subject) ?? []), row.value?.what]);
  for (const [who, where] of twice) if (where.length >= 2) out.push({ file: 'held', record: { kind: 'split', who, where }, gate: 'held', why: `${who} in two places at once ${where.length} times` });
  for (const entity of aliased.values()) out.push({ file: 'entities.jsonl', record: entity, gate: 'applied', why: entity.properties?.world ? 'the world: its building, floor or damage' : 'the review: a description of theirs' });
  // A timeline per strand (each fork of the strands), its scenes in order.
  for (const fork of [...new Set((strands?.scenes ?? []).map(scene => scene.fork))]) {
    const inIt = strands.scenes.filter(scene => scene.fork === fork).map(scene => scene.id);
    out.push({ file: 'timelines.jsonl', record: { id: `tl_strand_${fork}`, kind: 'Timeline', names: [{ text: `strand ${fork}`, lang: 'und', kind: 'canonical' }], properties: { scenes: inIt, from: 'world' }, confidence: 1, world }, gate: 'applied', why: `${inIt.length} scenes` });
  }
  return out;
}

/**
 * Where each played scene was, from the run's page (W6): the lot it played in (the building spawning bound it to, else
 * the one most of its people stood in) and the floor they stood on; each blast's lot; the arrivals between scenes.
 * `{ places: { [place]: [{ scene, lot, floor }] }, blasts, arrivals }`.
 */
export function worldPlaces({ page, spawn = null, script, record, arrivals = [] }) {
  const g = page.world, decode = node => { const i = node % g.NX - g.oi, j = Math.floor(node / g.NX) % g.NZ - g.oj, k = Math.floor(node / (g.NX * g.NZ)) - g.ok; return { x: (i + 0.5) * 2, z: (j + 0.5) * 2, y: k * 3 }; };
  const lotAt = (x, z) => { const i = Math.floor(x / 2), j = Math.floor(z / 2); return (g.lots ?? []).filter(lot => i >= lot.i0 && i < lot.i0 + lot.nx && j >= lot.j0 && j < lot.j0 + lot.nz).sort((a, b) => a.nx * a.nz - b.nx * b.nz)[0] ?? null; };
  const placeOf = new Map(script.scenes.map(scene => [scene.id, scene.place])), boxOf = new Map((spawn?.scenes ?? []).filter(scene => scene.target?.kind === 'building').map(scene => [scene.id, scene.target.box]));
  const pageScene = new Map(page.scenes.map(scene => [scene.id, scene])), places = {};
  for (const entry of record.scenes) {
    const scene = pageScene.get(entry.scene), place = placeOf.get(entry.scene);
    if (!scene || !place) continue;
    const at = Object.values(scene.starts).filter(node => node != null).map(decode), box = boxOf.get(entry.scene);
    const counts = new Map(); for (const p of at) { const lot = lotAt(p.x, p.z); if (lot) counts.set(lot, (counts.get(lot) ?? 0) + 1); }
    const lot = (box ? lotAt(box[0], box[1]) : null) ?? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const inLot = lot ? at.filter(p => lotAt(p.x, p.z) === lot).map(p => Math.round(p.y / 3)).sort((a, b) => a - b) : [];
    (places[place] ??= []).push({ scene: entry.scene, lot: lot ? { source: lot.source, floors: lot.floors, role: lot.role ?? null } : null, floor: inLot.length ? inLot[Math.floor(inLot.length / 2)] : null });
  }
  const blasts = page.scenes.flatMap(scene => scene.events.filter(event => event.hit && event.hit.lot !== undefined && event.hit.lot !== null).map(event => ({ scene: scene.id, card: event.id, lot: g.lots?.[event.hit.lot]?.source ?? null, cells: event.hit.destroyed?.length ?? null })));
  return { places, blasts, arrivals };
}

/**
 * What the world settled that the review should see, as ledger entries of run `run`: each line it could not settle
 * (held: who says it, of those there), and an audit of a share of what it settled on its own (applied, checked after).
 */
export function speakerEntries(run, settled, start = 0) {
  let n = start;
  const out = [];
  for (const entry of settled.filter(row => row.by === 'world' || (row.gate === 'held' && row.by !== 'reading'))) {
    const value = { scene: entry.scene, card: entry.card, line: entry.line, who: entry.who, to: entry.to, why: entry.why, candidates: entry.candidates, ...(entry.guess ? { guess: entry.guess } : {}) };
    if (entry.gate === 'held') out.push({ id: `${run}:s${++n}`, run, kind: 'speaker', state: 'held', source: 'world', subject: entry.line, value, evidence: [] });
    else if (audited(`${run}|${entry.line}`)) out.push({ id: `${run}:s${++n}`, run, kind: 'audit', state: 'held', source: 'world', class: 'speaker', subject: entry.line, value, evidence: [] });
  }
  return out;
}

/** A class's audits so far (pins.audits): right and wrong, and whether it is routed to the review. */
export const routeOf = (pins, kind) => { const audit = pins.audits?.[kind]; return audit && audit.right + audit.wrong >= AUDIT_MIN && audit.wrong / (audit.right + audit.wrong) > AUDIT_LIMIT ? 'review' : null; };

/** Run `run`'s canon records written (what passed its gate), each logged with what it replaced. Returns counts. */
export async function toCanon(novelDir, { run, reading }) {
  const ontology = join(novelDir, 'ontology');
  const [record, ledger, pins, scenes, events, script, strands] = await Promise.all([
    readJson(join(novelDir, 'stage', 'director', 'run.json')), readJsonl(join(novelDir, 'stage', 'world', 'ledger', `${run}.jsonl`)), readJson(join(novelDir, 'stage', 'world', 'pins.json'), {}),
    readJsonl(join(ontology, 'scenes.jsonl')).then(foldById), readJsonl(join(ontology, 'events.jsonl')).then(foldById), readJson(join(novelDir, 'stage', 'world', 'script.json'), { scenes: [] }), readJson(join(novelDir, 'stage', 'world', 'strands.json')),
  ]);
  // Who says each line, settled by the world from where everyone stood when it was said (the run's page).
  const page = await readJson(join(novelDir, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`));
  const peopleOf = new Map((reading.cards ?? []).map(card => [card.id, card.people ?? []]));
  const settled = page ? settleSpeakers({ cards: playedLine({ record, page, reading }).cards, reading, pins, peopleOf: id => peopleOf.get(id) ?? [], route: routeOf(pins, 'speaker') }) : [];
  const entities = foldById(await readJsonl(join(ontology, 'entities.jsonl'))), relations = await readJsonl(join(ontology, 'relations.jsonl'));
  const spawn = await readJson(join(novelDir, 'stage', 'world', 'spawn.json'));
  const placed = page ? worldPlaces({ page, spawn, script, record, arrivals: playedLine({ record, page, reading }).arrivals }) : null;
  const records = canonOf({ run, record, ledger, pins: { notSpeaker: {}, ...pins }, scenes, events, script, strands, reading, settled, entities, world: placed, relations });
  // The speakers the director shows (its bubbles) and the review's share: settled ones in stage/world/speakers.json, held
  // ones and audits into the run's ledger.
  await writeFile(join(novelDir, 'stage', 'world', 'speakers.json'), JSON.stringify({ version: 1, run, lines: Object.fromEntries(settled.filter(entry => entry.gate === 'applied' && entry.by !== 'reading').map(entry => [entry.line, { who: entry.who, by: entry.by }])) }), { mode: 0o644 });
  const ledgerFile = join(novelDir, 'stage', 'world', 'ledger', `${run}.jsonl`), already = new Set(ledger.filter(row => row.kind === 'speaker' || row.kind === 'audit').map(row => row.subject));
  const review = speakerEntries(run, settled.filter(entry => !already.has(entry.line)), ledger.filter(row => String(row.id).includes(':s')).length);
  // What canon could not take on its own (a building in two lots, a room on two floors, a container against canon's, a
  // split): held in the ledger for the review.
  const heldHere = new Set(ledger.filter(row => ['building', 'floor', 'container', 'split'].includes(row.kind)).map(row => row.subject));
  let w = ledger.filter(row => String(row.id).includes(':w')).length;
  for (const entry of records.filter(item => item.file === 'held')) { const subject = entry.record.place ?? entry.record.who; if (!heldHere.has(subject)) review.push({ id: `${run}:w${++w}`, run, kind: entry.record.kind, state: 'held', source: 'world', subject, value: { ...entry.record, why: entry.why }, evidence: [] }); }
  if (review.length) await appendFile(ledgerFile, review.map(row => JSON.stringify(row)).join('\n') + '\n');
  const before = new Map();
  for (const file of new Set(records.filter(entry => entry.file !== 'held').map(entry => entry.file))) before.set(file, foldById(await readJsonl(join(ontology, file))));
  const written = records.filter(entry => entry.gate === 'applied' && entry.file !== 'held'), at = new Date().toISOString();
  for (const file of new Set(written.map(entry => entry.file))) await appendFile(join(ontology, file), written.filter(entry => entry.file === file).map(entry => JSON.stringify(entry.record)).join('\n') + '\n');
  await appendFile(join(novelDir, 'stage', 'world', 'canon.jsonl'), written.map(entry => JSON.stringify({ run, at, file: entry.file, id: entry.record.id, why: entry.why, previous: before.get(entry.file)?.get(entry.record.id) ?? null })).join('\n') + (written.length ? '\n' : ''), { mode: 0o644 });
  const count = gate => Object.fromEntries([...new Set(records.filter(entry => entry.file !== 'held').map(entry => entry.file))].map(file => [file, records.filter(entry => entry.file === file && entry.gate === gate).length]));
  const by = settled.reduce((sum, entry) => ({ ...sum, [`${entry.by} ${entry.gate}`]: (sum[`${entry.by} ${entry.gate}`] ?? 0) + 1 }), {});
  return { applied: count('applied'), held: count('held'), speakers: by, review: { held: review.filter(row => row.kind === 'speaker').length, audits: review.filter(row => row.kind === 'audit').length, places: review.filter(row => ['building', 'floor', 'container', 'split'].includes(row.kind)).length } };
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
