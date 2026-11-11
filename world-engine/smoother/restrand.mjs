// Re-stranding after smoothing (docs/v3/design.html#strands §0 and §5; milestones M17d, M17f; the user, 2026-11-09: "there maybe
// overstranding and we could need restrand after smoothing"; "As long as the group splits on different things and no
// longer interact with each other on semantic scale, they become two strands"). The text's strands are the reading's:
// a unit's group is whom the text has acting in it. A run knows more: where each person stood, card by card, smoothed
// along their strands (smoother.mjs). Here the same builder (groupStrands, src/v2/extraction/strands.ts) is applied to
// the run instead of the text:
//
//   - a unit's acting people are one group when they stood within earshot of each other (one after another), or the
//     text has them interacting there (one conversation, one action, one event: at any distance, and the distance is a
//     run fault, `apartTalk`); a group out of reach of the rest and not linked to it is told in a sub-unit (`<unit>~2`);
//   - anyone else on the stage within earshot of a group is in view of it (someone the text does not name there);
//   - a unit is **moved** when the built sites its people stood on are outside the place the text gives it.
//
// What comes out is the run's strands file (the text's shape, version 2: what the cross-book registry of M16a takes when
// a run exists) and what it says against the text's strands. The functions are pure; `restrandRun` binds them to a book
// and a run.
//   npm run build && node world-engine/smoother/restrand.mjs <novel-dir> [--run <id>] [--reading <data.json>] [--out <file>] [--write]
// --run: the run to read (the last smoothed one when not given); --reading: the reading whose interactions link the
// people (default <novel-dir>/../reading/data.json); --out: the run's strands file, written there; --write: written to
// <novel>/stage/world/restrand/<run>.json.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { builtTree, groupStrands, placeTree, strandBeats, strandsDocument } from '../../dist/src/v2/extraction/strands.js';
import { setting } from '../../dist/src/v2/settings.js';
import { segmentWorld } from '../director/segments.mjs';

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
 * The run as a script: each unit's groups by where its people stood and whom the text has interacting. A person stands
 * where the unit left them (their last spot in it). The unit's acting people chain into one group within `earshot` of
 * each other, and the text's interactions (`beats[unit].links`) join people at any distance; each linked pair that stood
 * beyond earshot is a fault (`apartTalk`). The largest group is the unit itself, with the acting people never placed;
 * the others are sub-units. Anyone else on the stage within earshot of a group's people is in view of it. A unit is
 * `moved` when most of its placed people stood in another district than the one the text's place is in (a placement
 * check of the run, not a strand rule; a place in no known district tells nothing).
 */
export function runUnits({ script, smoothed, sites = {}, tree = {}, beats = null, earshot = 25 }) {
  const places = runPlaces(script, sites, tree), areas = placeTree(places), at = siteAt(sites);
  // A placement check, not a strand rule: the district a place stands in (the text's, and the one a spot is on).
  const districtOf = place => (place ? areas.pathOf(place).find(id => areas.scaleOf(id) === 'district') ?? null : null);
  const spots = new Map();
  for (const [who, list] of Object.entries(smoothed?.people ?? {})) for (const moment of list) {
    const spot = moment.map ?? moment.played;
    if (spot) (spots.get(moment.scene) ?? spots.set(moment.scene, new Map()).get(moment.scene)).set(who, spot);
  }
  const scenes = [], units = [];
  for (const scene of script.scenes) {
    const cast = spots.get(scene.id) ?? new Map(), acting = scene.evidence ?? scene.present ?? [], present = scene.present ?? [];
    const stood = acting.filter(who => cast.has(who)), root = new Map(stood.map(who => [who, who])), find = who => (root.get(who) === who ? who : find(root.get(who)));
    for (let i = 0; i < stood.length; i++) for (let j = i + 1; j < stood.length; j++) if (metres(cast.get(stood[i]), cast.get(stood[j])) <= earshot) root.set(find(stood[j]), find(stood[i]));
    const apartTalk = [];
    for (const link of beats?.[scene.id]?.links ?? []) {
      const here = link.filter(who => root.has(who));
      for (let i = 1; i < here.length; i++) { const far = metres(cast.get(here[0]), cast.get(here[i])); if (far > earshot) apartTalk.push({ people: [here[0], here[i]], metres: Math.round(far) }); root.set(find(here[i]), find(here[0])); }
    }
    const clusters = new Map();
    for (const who of stood) (clusters.get(find(who)) ?? clusters.set(find(who), []).get(find(who))).push(who);
    const groups = [...clusters.values()].sort((a, b) => b.length - a.length);
    if (!groups.length) groups.push([]);
    const unplaced = acting.filter(who => !cast.has(who));
    // Where the placed people stood, against the text's place: on a built site outside it.
    const written = districtOf(scene.place), off = written ? stood.filter(who => { const there = districtOf(at(cast.get(who))); return there && there !== written; }) : [];
    groups.forEach((group, n) => {
      const id = n ? `${scene.id}~${n + 1}` : scene.id, people = n ? group : [...group, ...unplaced];
      const near = [...cast.keys()].filter(who => !group.includes(who) && group.some(other => metres(cast.get(who), cast.get(other)) <= earshot));
      const with_ = near.filter(who => !present.includes(who));
      scenes.push({ ...scene, id, evidence: people, present: [...new Set([...people, ...near, ...(n ? [] : present.filter(who => !cast.has(who)))])] });
      units.push({ id, of: scene.id, written: scene.place ?? null, people, with: with_, placed: group.length, ...(n ? {} : { district: written, unplaced: unplaced.length, apartTalk, moved: stood.length > 0 && off.length * 2 > stood.length, sites: [...new Set(off.map(who => districtOf(at(cast.get(who)))))] }) });
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
 * What a run's strands say against the text's: the strands of each, the units whose acting people stood apart and
 * unlinked (`splits`; `own` where the rules made a strand of those apart), the unions of the run (`said` when the text
 * has the same one), the text's interacting pairs that stood beyond earshot (`apartTalk`), the units played away from
 * their place (`moved`), and the units on another strand than the text's (`changed`).
 */
export function against({ script, text, strands, units, earshot = null }) {
  const order = new Map(script.scenes.map((scene, n) => [scene.id, n])), unitAt = new Map(units.map(unit => [unit.id, unit]));
  const told = text.forks.filter(fork => !fork.past), played = strands.forks.filter(fork => !fork.past);
  const sum = pick => units.reduce((total, unit) => total + pick(unit), 0), own = units.filter(unit => unit.id === unit.of);
  const splits = own.map(unit => ({ unit, apart: units.filter(other => other.of === unit.id && other !== unit) })).filter(entry => entry.apart.length).map(({ unit, apart }) => ({
    scene: unit.id, people: unit.people,
    apart: apart.map(other => ({ people: other.people, strand: strands.forkOf.get(other.id) ?? null, own: strands.forkOf.get(other.id) !== strands.forkOf.get(unit.id) })),
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
  const apartTalk = own.filter(unit => unit.apartTalk?.length).map(unit => ({ scene: unit.id, pairs: unit.apartTalk }));
  const moved = stretches(own.filter(unit => unit.moved).map(unit => ({ scene: unit.id, text: unit.district, run: unit.sites.join(',') })), order, row => `${row.text}|${row.run}`);
  const changed = stretches(script.scenes.map(scene => ({ scene: scene.id, text: text.forkOf.get(scene.id) ?? null, run: strands.forkOf.get(scene.id) ?? null })).filter(row => goesOn.get(row.text) !== row.run), order, row => `${row.text}|${row.run}`);
  const going = new Set(goesOn.values());
  return {
    scale: strands.scale, earshot,
    strands: { text: told.length, run: played.length, gone: told.filter(fork => !goesOn.has(fork.id)).map(fork => fork.id), begun: played.filter(fork => !going.has(fork.id)).map(fork => fork.id) },
    units: { all: own.length, placed: own.filter(unit => unit.placed).length, people: sum(unit => unit.placed), unplaced: sum(unit => unit.unplaced ?? 0), with: sum(unit => unit.with.length) },
    splits, unions, apartTalk, moved, changed,
    forks: played.map(fork => ({ id: fork.id, units: fork.scenes.length, people: fork.people.length, envelope: fork.envelope, open: fork.open, ...(fork.splitFrom.length ? { splitFrom: fork.splitFrom } : {}), ...(fork.into ? { into: fork.into, intoAt: fork.intoAt } : {}), ...(fork.unites.length ? { unites: fork.unites } : {}) })),
  };
}

/**
 * A run re-stranded: the text's strands (`text`), the run's (`strands`, over the run's units), what the run says against
 * the text (`report`) and the run's strands file (`document`: the text's shape, with the run, its units and the report).
 * `only`: the units the run played, when it played a part of the script (a rehearsal's quarter, a range): the text's
 * strands and the run's are then both read over those units alone.
 */
export function restrand({ script: whole, smoothed, sites = {}, tree = {}, beats = null, earshot = 25, run = null, only = null }) {
  const ran = only ? new Set(only) : null, script = ran ? { ...whole, scenes: whole.scenes.filter(scene => ran.has(scene.id)) } : whole;
  const options = { tree, ...(beats ? { beats } : {}) }, text = groupStrands(script, options);
  const { script: played, units } = runUnits({ script, smoothed, sites, tree, beats, earshot });
  const strands = groupStrands(played, options), report = against({ script, text, strands, units, earshot });
  return { text, strands, units, report, document: { ...strandsDocument(played, strands, run ? `run:${run}` : 'run'), run, earshot, units, against: report } };
}

/** A report in a few counts, for a run's record and a rehearsal's measures. */
export function summary(report) {
  const units = rows => rows.reduce((total, row) => total + row.units, 0);
  return {
    strands: { text: report.strands.text, run: report.strands.run, gone: report.strands.gone.length, begun: report.strands.begun.length },
    splits: { units: report.splits.length, own: report.splits.filter(split => split.apart.some(group => group.own)).length },
    unions: { all: report.unions.length, unsaid: report.unions.filter(union => !union.said).length },
    apartTalk: { units: report.apartTalk.length, pairs: report.apartTalk.reduce((total, row) => total + row.pairs.length, 0) },
    moved: { units: units(report.moved), stretches: report.moved.length }, changed: { units: units(report.changed), stretches: report.changed.length },
    people: { placed: report.units.people, unplaced: report.units.unplaced, with: report.units.with },
  };
}

/** A report in lines, for the terminal and the run's log. */
export function describe(report) {
  const span = row => (row.from === row.to ? row.from : `${row.from} to ${row.to}`), lines = [];
  lines.push(`strands by interaction: the text ${report.strands.text}, the run ${report.strands.run}${report.strands.gone.length ? `; not in the run: ${report.strands.gone.join(', ')}` : ''}${report.strands.begun.length ? `; only in the run: ${report.strands.begun.join(', ')}` : ''}`);
  lines.push(`units ${report.units.all}, ${report.units.placed} with people placed (${report.units.people} placings; ${report.units.unplaced} acting people never placed); unnamed on the stage within ${report.earshot} m of a group: ${report.units.with}`);
  for (const fork of report.forks) lines.push(`  strand ${fork.id}: ${fork.units} units, ${fork.people} people, in ${fork.envelope ?? 'an unknown place'}${fork.splitFrom ? `, split from ${fork.splitFrom.join(', ')}` : ''}${fork.into ? `, into ${fork.into} at ${fork.intoAt}` : fork.open ? ', open' : ''}`);
  lines.push(`groups that stood apart, unlinked: ${report.splits.length} units, ${report.splits.filter(split => split.apart.some(group => group.own)).length} a strand of their own`);
  for (const split of report.splits) lines.push(`  ${split.scene}: ${split.apart.map(group => `${group.people.join(', ')}${group.own ? ` (strand ${group.strand})` : ''}`).join('; ')} apart from ${split.people.join(', ')}`);
  lines.push(`unions in the run: ${report.unions.length}, ${report.unions.filter(union => !union.said).length} the text did not say`);
  for (const union of report.unions) lines.push(`  ${union.scene}: ${union.closed} into ${union.kept}${union.said ? ' (the text says so)' : ''}${union.by.length ? `, with ${union.by.join(', ')}` : ''}`);
  lines.push(`interacting in the text but beyond ${report.earshot} m in the run: ${report.apartTalk.reduce((total, row) => total + row.pairs.length, 0)} pairs in ${report.apartTalk.length} units`);
  for (const row of report.apartTalk) lines.push(`  ${row.scene}: ${row.pairs.map(pair => `${pair.people.join(' and ')} ${pair.metres} m`).join('; ')}`);
  lines.push(`played away from their place: ${report.moved.reduce((total, row) => total + row.units, 0)} units in ${report.moved.length} stretches`);
  for (const row of report.moved) lines.push(`  ${span(row)} (${row.units}): the text ${row.text}, stood on ${row.run}`);
  lines.push(`on another strand than the text's: ${report.changed.reduce((total, row) => total + row.units, 0)} units in ${report.changed.length} stretches`);
  for (const row of report.changed) lines.push(`  ${span(row)} (${row.units}): the text ${row.text}, the run ${row.run}`);
  return lines;
}

const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

/**
 * A book's run re-stranded from its files: the script the director played (stage/world/segments/script.json, else the
 * book's own), the run's smoothed positions (stage/world/smoothed/<run>.json; the last one when no run is given), the
 * terrain registry's sites and built tree, the reading's interactions (`reading`, as segmentWorld returns it, else read
 * from `readingFile`, by default <novel>/../reading/data.json) and earshot. `write` puts the run's strands file at
 * stage/world/restrand/<run>.json; `script`, `smoothed` and `reading` may be handed in (the director has them at a
 * run's end), and `only`, the units the run played of the script.
 */
export async function restrandRun(novelDir, { run = null, earshot = null, script = null, smoothed = null, reading = null, readingFile = null, only = null, write = false } = {}) {
  const dir = resolve(novelDir), world = join(dir, 'stage', 'world'), volume = basename(dirname(dir));
  const id = run ?? smoothed?.run ?? (await readdir(join(world, 'smoothed')).catch(() => [])).filter(name => name.endsWith('.json')).sort().at(-1)?.slice(0, -5) ?? null;
  if (!id) throw new Error(`no smoothed run in ${join(world, 'smoothed')}`);
  const positions = smoothed ?? (await json(join(world, 'smoothed', `${id}.json`)));
  if (!positions?.people) throw new Error(`run ${id} has no smoothed positions (${join(world, 'smoothed', `${id}.json`)})`);
  const played = script ?? (await json(join(world, 'segments', 'script.json'))) ?? (await json(join(world, 'script.json')));
  if (!played?.scenes?.length) throw new Error(`no script in ${world}`);
  // The interactions come from the reading as the director loads it (the credit checked).
  let given = reading;
  if (!given) { const raw = await json(resolve(readingFile ?? join(dir, '..', 'reading', 'data.json'))); given = raw ? segmentWorld({ reading: raw, script: played })?.reading ?? null : null; }
  const beats = given?.cards ? strandBeats(given.cards, given.roles ?? {}, given.scenes ?? [], played) : null;
  const terrain = (await json(join(dir, 'stage', 'terrain.json'))) ?? (await json(join(dir, '..', '..', 'universe', 'terrain.json')));
  const result = restrand({ script: played, smoothed: positions, sites: terrain?.sites ?? {}, tree: builtTree(terrain?.slots, terrain?.book ?? volume), beats, earshot: earshot ?? setting('talk.earshot', { book: dir }), run: id, only });
  let file = null;
  if (write) { file = join(world, 'restrand', `${id}.json`); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(result.document, null, 1)); }
  return { ...result, run: id, file };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, reading: { type: 'string' }, out: { type: 'string' }, write: { type: 'boolean' } } });
  if (!novelDir) { console.error('usage: node world-engine/smoother/restrand.mjs <novel-dir> [--run <id>] [--reading <data.json>] [--out <file>] [--write]'); process.exit(2); }
  const result = await restrandRun(novelDir, { run: values.run ?? null, readingFile: values.reading ?? null, write: !!values.write });
  if (values.out) await writeFile(values.out, JSON.stringify(result.document, null, 1));
  console.log(`run ${result.run}${result.file ? `, written to ${result.file}` : ''}${values.out ? `, written to ${values.out}` : ''}`);
  for (const line of describe(result.report)) console.log(line);
}
