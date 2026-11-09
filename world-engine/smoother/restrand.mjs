// Re-stranding after smoothing (docs/v2/strands.md section 5; milestones M17d; the user, 2026-11-09: "there maybe
// overstranding and we could need restrand after smoothing"). The text's strands are the reading's: a unit's group is
// whom the text names in it, its envelope the place the text gives it. A run knows more: where each person stood, card
// by card, smoothed along their strands (smoother.mjs). Here the same rules (groupStrands, src/v2/extraction/strands.ts)
// are applied to the run instead of the text:
//
//   - a unit's **envelope** is the built place at the envelope scale that held its people (the terrain registry's
//     sites: the smallest site whose box holds a spot, then up its parents to the scale);
//   - its **group** is the text's people who stood there, with anyone else on the stage within earshot of them (someone
//     the text does not name in the unit, who stood with the group all the same);
//   - the text's people who stood in an envelope apart from it for the whole unit are a group of their own, told in a
//     sub-unit (`<unit>~2`): where the rules make a strand of them, a split the text hid.
//
// What comes out is the run's strands file (the text's shape, version 2: what the cross-book registry of M16a takes when
// a run exists) and what it says against the text's strands: hidden splits, unions the text did not say, units played in
// another envelope than the text gives them. The functions are pure; `restrandRun` binds them to a book and a run.
//   npm run build && node world-engine/smoother/restrand.mjs <novel-dir> [--run <id>] [--envelope <scale>] [--out <file>] [--write]
// --run: the run to read (the last smoothed one when not given); --envelope: another scale than the book's setting;
// --out: the run's strands file, written there; --write: written to <novel>/stage/world/restrand/<run>.json.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { builtTree, envelopes, groupStrands, strandsDocument } from '../../dist/src/v2/extraction/strands.js';
import { setting } from '../../dist/src/v2/settings.js';

const holds = (box, at) => at.x >= box[0] && at.x <= box[2] && at.z >= box[1] && at.z <= box[3];
const area = box => (box[2] - box[0]) * (box[3] - box[1]);
const metres = (a, b) => Math.hypot(a.x - b.x, a.z - b.z, (a.y ?? 0) - (b.y ?? 0));

/** The unit a sub-unit belongs to (`<unit>~2` is the second group of `<unit>`). */
export const unitOf = id => String(id).split('~')[0];

/**
 * The built places by where they are: the smallest site of the registry whose box holds a spot (a building before its
 * street, a street before its district: districts' boxes overlap, a street stands in one of them), or none. Of several
 * of one size (two districts' boxes over one spot) the one whose centre is nearest: the spot is deeper inside it.
 */
export function siteAt(sites) {
  const boxed = Object.entries(sites ?? {}).filter(([, site]) => Array.isArray(site?.box)).map(([id, site]) => ({ id, box: site.box, area: area(site.box), x: (site.box[0] + site.box[2]) / 2, z: (site.box[1] + site.box[3]) / 2 })).sort((a, b) => a.area - b.area);
  const off = (site, at) => Math.hypot(at.x - site.x, at.z - site.z);
  return at => {
    if (!at) return null;
    let best = null;
    for (const site of boxed) {
      if (best && site.area > best.area + 1) break;
      if (holds(site.box, at) && (!best || off(site, at) < off(best, at))) best = site;
    }
    return best?.id ?? null;
  };
}

/**
 * One place tree for a run: the script's places (a sampling pool has no scale of its own, as in the text's strands),
 * under the built tree, under the registry's sites, whose parents and scales are where the engine built each place.
 */
export function runPlaces(script, sites, tree = {}) {
  const out = {};
  for (const [id, place] of Object.entries(script?.places ?? {})) out[id] = { scale: place.pool ? null : place.scale ?? null, parent: place.parent ?? null };
  for (const known of [tree ?? {}, sites ?? {}]) for (const [id, own] of Object.entries(known)) out[id] = { scale: own.scale ?? out[id]?.scale ?? null, parent: own.parent !== undefined ? own.parent : out[id]?.parent ?? null };
  return out;
}

/**
 * The run as a script: each unit's groups by where its people stood. A person's envelope in a unit is that of the last
 * spot they had in it (where the unit left them); they stood **apart** from the unit's group only when every spot they
 * had is in an envelope known to be apart from the group's (someone who walks in is with the group). The unit's own
 * envelope is the one most of the text's people ended in. Someone on the stage whom the text does not name in the unit
 * is with a group when they stand within `earshot` of one of its people (or of someone already with it), and is left
 * out otherwise: not told, they stay on the strand they were on. A unit nobody was placed in keeps the text's envelope.
 */
export function runUnits({ script, smoothed, sites, envelope = 'district', tree = {}, earshot = 25, text = null }) {
  const places = runPlaces(script, sites, tree), areas = envelopes(places, { envelope }), at = siteAt(sites);
  const told = text ?? groupStrands(script, { envelope, tree });
  const persons = new Set(script.scenes.flatMap(scene => scene.present ?? [])), spots = new Map();
  for (const [who, list] of Object.entries(smoothed?.people ?? {})) {
    if (!persons.has(who)) continue;
    for (const moment of list) {
      const spot = moment.map ?? moment.played;
      if (!spot) continue;
      const cast = spots.get(moment.scene) ?? spots.set(moment.scene, new Map()).get(moment.scene);
      (cast.get(who) ?? cast.set(who, []).get(who)).push(spot);
    }
  }
  const scenes = [], units = [];
  for (const scene of script.scenes) {
    const cast = spots.get(scene.id) ?? new Map(), present = scene.present ?? [];
    const stood = new Map([...cast].map(([who, list]) => [who, { at: list.at(-1), last: areas.envelopeOf(at(list.at(-1))), all: list.map(spot => areas.envelopeOf(at(spot))) }]));
    const placed = present.filter(who => stood.has(who)), written = told.envelopeOf.get(scene.id) ?? null;
    // The unit's own envelope: where most of the text's people ended; the text's own on a tie it is part of.
    const votes = new Map();
    for (const who of placed) { const last = stood.get(who).last; if (last) votes.set(last, (votes.get(last) ?? 0) + 1); }
    const most = Math.max(0, ...votes.values()), leading = [...votes].filter(([, count]) => count === most).map(([id]) => id);
    const own = placed.length ? leading.find(id => written && (id === written || areas.within(id, written))) ?? leading[0] ?? null : written;
    const groups = [{ envelope: own, people: [], with: [] }];
    for (const who of present) {
      const where = stood.get(who);
      const away = !!(where?.last && own && where.all.every(id => id && areas.apart(id, own)));
      if (!away) { groups[0].people.push(who); continue; }
      (groups.find(group => group !== groups[0] && group.envelope === where.last) ?? groups[groups.push({ envelope: where.last, people: [], with: [] }) - 1]).people.push(who);
    }
    // Those the text does not name here: with the group they stand within earshot of, one after another.
    const others = [...stood.keys()].filter(who => !present.includes(who)), near = (who, group) => [...group.people, ...group.with].some(other => stood.has(other) && metres(stood.get(who).at, stood.get(other).at) <= earshot);
    for (let joined = true; joined && others.length;) {
      joined = false;
      for (const who of [...others]) { const group = groups.find(entry => near(who, entry)); if (group) { group.with.push(who); others.splice(others.indexOf(who), 1); joined = true; } }
    }
    groups.forEach((group, n) => {
      const id = n ? `${scene.id}~${n + 1}` : scene.id;
      scenes.push({ ...scene, id, place: group.envelope, present: [...group.people, ...group.with] });
      units.push({ id, of: scene.id, envelope: group.envelope, written, people: group.people, with: group.with, placed: group.people.filter(who => stood.has(who)).length, ...(n ? {} : { leftOut: others.length, noSite: placed.filter(who => !stood.get(who).last).length }) });
    });
  }
  return { script: { ...script, places, scenes }, units, areas };
}

/** Rows that follow each other in the script and say the same thing, as stretches: { from, to, units, ...what they say }. */
function stretches(rows, order, keyOf) {
  const out = [];
  for (const { scene, ...rest } of rows) {
    const last = out.at(-1);
    if (last && order.get(scene) === order.get(last.to) + 1 && keyOf(last) === keyOf(rest)) { last.to = scene; last.units++; } else out.push({ from: scene, to: scene, units: 1, ...rest });
  }
  return out;
}

/**
 * What a run's strands say against the text's: the strands of each, the units whose text people stood in two envelopes
 * (`splits`; `own` where the rules made a strand of those apart), the unions of the run (`said` when the text has the
 * same one; `by` those who stood with the group unnamed), the units played in an envelope apart from the text's
 * (`moved`), and the units on another strand than the text's (`changed`).
 */
export function against({ script, text, strands, units, areas, earshot = null }) {
  const order = new Map(script.scenes.map((scene, n) => [scene.id, n])), unitAt = new Map(units.map(unit => [unit.id, unit]));
  const told = text.forks.filter(fork => !fork.past), played = strands.forks.filter(fork => !fork.past);
  const sum = pick => units.reduce((total, unit) => total + pick(unit), 0), own = units.filter(unit => unit.id === unit.of);
  const splits = own.map(unit => ({ unit, apart: units.filter(other => other.of === unit.id && other !== unit) })).filter(entry => entry.apart.length).map(({ unit, apart }) => ({
    scene: unit.id, envelope: unit.envelope, written: unit.written,
    apart: apart.map(other => ({ envelope: other.envelope, people: other.people, strand: strands.forkOf.get(other.id) ?? null, own: strands.forkOf.get(other.id) !== strands.forkOf.get(unit.id) })),
  }));
  // Which strand of the run is which of the text's: a strand is named by its first unit, and the run's may begin at
  // another. A run's strand is the text's it shares most units with; the text's goes on in the largest of those.
  const shared = new Map();
  for (const unit of units) {
    const now = strands.forkOf.get(unit.id), was = text.forkOf.get(unit.of);
    if (!now || !was) continue;
    const row = shared.get(now) ?? shared.set(now, new Map()).get(now);
    row.set(was, (row.get(was) ?? 0) + 1);
  }
  const twin = new Map([...shared].map(([now, row]) => [now, [...row].sort((a, b) => b[1] - a[1])[0]])), goesOn = new Map();
  for (const [now, [was, count]] of twin) if (!goesOn.has(was) || count > twin.get(goesOn.get(was))[1]) goesOn.set(was, now);
  const said = new Set(text.checks.filter(check => check.kind === 'union').map(check => `${check.sceneId}|${check.otherId}`));
  const unions = strands.checks.filter(check => check.kind === 'union').map(check => ({ scene: unitOf(check.sceneId), kept: strands.forkOf.get(check.sceneId) ?? null, closed: check.otherId, said: said.has(`${unitOf(check.sceneId)}|${check.otherId}`) || said.has(`${unitOf(check.sceneId)}|${twin.get(check.otherId)?.[0]}`), by: unitAt.get(check.sceneId)?.with ?? [] }));
  const moved = stretches(own.filter(unit => unit.placed && unit.written && unit.envelope && areas.apart(unit.written, unit.envelope)).map(unit => ({ scene: unit.id, text: unit.written, run: unit.envelope })), order, row => `${row.text}|${row.run}`);
  const changed = stretches(script.scenes.map(scene => ({ scene: scene.id, text: text.forkOf.get(scene.id) ?? null, run: strands.forkOf.get(scene.id) ?? null })).filter(row => goesOn.get(row.text) !== row.run), order, row => `${row.text}|${row.run}`);
  const going = new Set(goesOn.values());
  return {
    envelope: strands.scale, earshot,
    strands: { text: told.length, run: played.length, gone: told.filter(fork => !goesOn.has(fork.id)).map(fork => fork.id), begun: played.filter(fork => !going.has(fork.id)).map(fork => fork.id) },
    units: { all: own.length, placed: own.filter(unit => unit.placed).length, people: sum(unit => unit.placed), unplaced: sum(unit => unit.people.length - unit.placed), with: sum(unit => unit.with.length), leftOut: sum(unit => unit.leftOut ?? 0), noSite: sum(unit => unit.noSite ?? 0) },
    splits, unions, moved, changed,
    forks: played.map(fork => ({ id: fork.id, units: fork.scenes.length, people: fork.people.length, envelope: fork.envelope, open: fork.open, ...(fork.splitFrom.length ? { splitFrom: fork.splitFrom } : {}), ...(fork.into ? { into: fork.into, intoAt: fork.intoAt } : {}), ...(fork.unites.length ? { unites: fork.unites } : {}) })),
  };
}

/**
 * A run re-stranded: the text's strands (`text`), the run's (`strands`, over the run's units), what the run says against
 * the text (`report`) and the run's strands file (`document`: the text's shape, with the run, its units and the report).
 * `only`: the units the run played, when it played a part of the script (a rehearsal's quarter, a range): the text's
 * strands and the run's are then both read over those units alone.
 */
export function restrand({ script: whole, smoothed, sites, envelope = 'district', tree = {}, earshot = 25, run = null, only = null }) {
  const ran = only ? new Set(only) : null, script = ran ? { ...whole, scenes: whole.scenes.filter(scene => ran.has(scene.id)) } : whole;
  const text = groupStrands(script, { envelope, tree });
  const { script: played, units, areas } = runUnits({ script, smoothed, sites, envelope, tree, earshot, text });
  const strands = groupStrands(played, { envelope }), report = against({ script, text, strands, units, areas, earshot });
  return { text, strands, units, report, document: { ...strandsDocument(played, strands, run ? `run:${run}` : 'run'), run, earshot, units, against: report } };
}

/** A report in a few counts, for a run's record and a rehearsal's measures. */
export function summary(report) {
  const units = rows => rows.reduce((total, row) => total + row.units, 0);
  return {
    envelope: report.envelope, strands: { text: report.strands.text, run: report.strands.run, gone: report.strands.gone.length, begun: report.strands.begun.length },
    splits: { units: report.splits.length, own: report.splits.filter(split => split.apart.some(group => group.own)).length },
    unions: { all: report.unions.length, unsaid: report.unions.filter(union => !union.said).length },
    moved: { units: units(report.moved), stretches: report.moved.length }, changed: { units: units(report.changed), stretches: report.changed.length },
    people: { placed: report.units.people, unplaced: report.units.unplaced, with: report.units.with, leftOut: report.units.leftOut, noSite: report.units.noSite },
  };
}

/** A report in lines, for the terminal and the run's log. */
export function describe(report) {
  const span = row => (row.from === row.to ? row.from : `${row.from} to ${row.to}`), lines = [];
  lines.push(`strands at the ${report.envelope} scale: the text ${report.strands.text}, the run ${report.strands.run}${report.strands.gone.length ? `; not in the run: ${report.strands.gone.join(', ')}` : ''}${report.strands.begun.length ? `; only in the run: ${report.strands.begun.join(', ')}` : ''}`);
  lines.push(`units ${report.units.all}, ${report.units.placed} with people placed (${report.units.people} placings; ${report.units.unplaced} of the text's people never placed, ${report.units.noSite} on no built site); unnamed on the stage: ${report.units.with} with a group (within ${report.earshot} m), ${report.units.leftOut} left out`);
  for (const fork of report.forks) lines.push(`  strand ${fork.id}: ${fork.units} units, ${fork.people} people, envelope ${fork.envelope ?? 'unknown'}${fork.splitFrom ? `, split from ${fork.splitFrom.join(', ')}` : ''}${fork.into ? `, into ${fork.into} at ${fork.intoAt}` : fork.open ? ', open' : ''}`);
  lines.push(`splits the text hid: ${report.splits.length} units with its people in two envelopes, ${report.splits.filter(split => split.apart.some(group => group.own)).length} a strand of their own`);
  for (const split of report.splits) lines.push(`  ${split.scene} in ${split.envelope}: ${split.apart.map(group => `${group.people.join(', ')} in ${group.envelope}${group.own ? ` (strand ${group.strand})` : ''}`).join('; ')}`);
  lines.push(`unions in the run: ${report.unions.length}, ${report.unions.filter(union => !union.said).length} the text did not say`);
  for (const union of report.unions) lines.push(`  ${union.scene}: ${union.closed} into ${union.kept}${union.said ? ' (the text says so)' : ''}${union.by.length ? `, with ${union.by.join(', ')}` : ''}`);
  lines.push(`played in another envelope than the text's: ${report.moved.reduce((total, row) => total + row.units, 0)} units in ${report.moved.length} stretches`);
  for (const row of report.moved) lines.push(`  ${span(row)} (${row.units}): the text ${row.text}, the run ${row.run}`);
  lines.push(`on another strand than the text's: ${report.changed.reduce((total, row) => total + row.units, 0)} units in ${report.changed.length} stretches`);
  for (const row of report.changed) lines.push(`  ${span(row)} (${row.units}): the text ${row.text}, the run ${row.run}`);
  return lines;
}

const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

/**
 * A book's run re-stranded from its files: the script the director played (stage/world/segments/script.json, else the
 * book's own), the run's smoothed positions (stage/world/smoothed/<run>.json; the last one when no run is given), the
 * terrain registry's sites and built tree, the book's envelope scale and earshot. `write` puts the run's strands file
 * at stage/world/restrand/<run>.json; `script` and `smoothed` may be handed in (the director has them at a run's end),
 * and `only`, the units the run played of the script.
 */
export async function restrandRun(novelDir, { run = null, envelope = null, earshot = null, script = null, smoothed = null, only = null, write = false } = {}) {
  const dir = resolve(novelDir), world = join(dir, 'stage', 'world'), volume = basename(dirname(dir));
  const id = run ?? smoothed?.run ?? (await readdir(join(world, 'smoothed')).catch(() => [])).filter(name => name.endsWith('.json')).sort().at(-1)?.slice(0, -5) ?? null;
  if (!id) throw new Error(`no smoothed run in ${join(world, 'smoothed')}`);
  const positions = smoothed ?? (await json(join(world, 'smoothed', `${id}.json`)));
  if (!positions?.people) throw new Error(`run ${id} has no smoothed positions (${join(world, 'smoothed', `${id}.json`)})`);
  const played = script ?? (await json(join(world, 'segments', 'script.json'))) ?? (await json(join(world, 'script.json')));
  if (!played?.scenes?.length) throw new Error(`no script in ${world}`);
  const terrain = (await json(join(dir, 'stage', 'terrain.json'))) ?? (await json(join(dir, '..', '..', 'universe', 'terrain.json')));
  const result = restrand({ script: played, smoothed: positions, sites: terrain?.sites ?? {}, tree: builtTree(terrain?.slots, terrain?.book ?? volume), envelope: envelope ?? setting('strands.envelope', { book: dir }), earshot: earshot ?? setting('talk.earshot', { book: dir }), run: id, only });
  let file = null;
  if (write) { file = join(world, 'restrand', `${id}.json`); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(result.document, null, 1)); }
  return { ...result, run: id, file };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, envelope: { type: 'string' }, out: { type: 'string' }, write: { type: 'boolean' } } });
  if (!novelDir) { console.error('usage: node world-engine/smoother/restrand.mjs <novel-dir> [--run <id>] [--envelope <scale>] [--out <file>] [--write]'); process.exit(2); }
  const result = await restrandRun(novelDir, { run: values.run ?? null, envelope: values.envelope ?? null, write: !!values.write });
  if (values.out) await writeFile(values.out, JSON.stringify(result.document, null, 1));
  console.log(`run ${result.run}${result.file ? `, written to ${result.file}` : ''}${values.out ? `, written to ${values.out}` : ''}`);
  for (const line of describe(result.report)) console.log(line);
}
