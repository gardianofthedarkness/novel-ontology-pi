// Underground stretches as places (docs/v3/design.html#terrain-levels §8.5; world-engine/digest/underground-note.mjs): a run of
// underground units filed under a whole city or district gets an unnamed underground place of its own, of the street's
// scale, under that city or district. Free: it asks nothing. With --write it changes the reading and the world script:
//   - the reading (data.json `places`): the place as a slot with its evidence lines, its units set there, and the people
//     those units held at the city held there instead;
//   - the world script (stage/world/script.json): the place, and its units' place.
// Then the terrain loop places it (the underground's slices are offered at the street's scale), spawning starts its units
// there, and the underground notes note it. In a library, take a snapshot before (novel universe snapshot --before).
//
// A library keeps the reading twice (the reading step's own output, which the terrain loop reads by the book's manifest, and
// the library's copy in vol-<n>/reading, which spawning and the director read): --also writes the same places into another.
//
//   node experiments/v2/underground-stretches.mjs <novel-dir> <reading>/data.json [--also <other data.json>] [--write]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { factLinesOf, undergroundStretches } from '../../world-engine/digest/underground-note.mjs';

const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { write: { type: 'boolean' }, also: { type: 'string', multiple: true } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/underground-stretches.mjs <novel-dir> <reading>/data.json [--write]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), json = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null);
const scriptFile = join(resolve(novelDir), 'stage', 'world', 'script.json'), script = await json(scriptFile), reading = await json(resolve(readingPath));
if (!script || !reading) { console.error('needs the world script (stage/world/script.json) and the reading'); process.exit(1); }
// The set dresser's settings and the pre-film notes, beside whichever reading has them (the library's copy has both).
const besides = [dir, ...(values.also ?? []).map(path => dirname(resolve(path)))], firstOf = async name => { for (const at of besides) { const found = await json(join(at, name)); if (found) return found; } return null; };
const settings = (await firstOf('settings.json'))?.units ?? {}, prefilm = await firstOf('prefilm.json');
const stretches = undergroundStretches({ scenes: reading.scenes.map(scene => ({ id: scene.id, sequence: scene.sequence })), script, settings, facts: factLinesOf(prefilm) })
  .filter(stretch => !script.places?.[`unnamed:${stretch.id}`]);
// The world script names an unnamed place's parent as its city's pool where the city has one (an unnamed street of the city).
const parentFor = city => { const slot = (reading.places?.slots ?? []).find(entry => entry.in === city && script.places?.[`unnamed:${entry.id}`]?.parent); return slot ? script.places[`unnamed:${slot.id}`].parent : city; };
const others = await Promise.all((values.also ?? []).map(async path => ({ path: resolve(path), reading: await json(resolve(path)) })));
if (others.some(other => !other.reading)) { console.error('an --also reading could not be read'); process.exit(1); }
const intoReading = (reading, stretch) => {
  const units = new Set(stretch.units);
  if (reading.places.slots.some(slot => slot.id === stretch.id)) return;
  reading.places.slots.push({ id: stretch.id, kind: 'place', scene: stretch.units[0], label: stretch.label, names: [stretch.label], sentences: stretch.sentences, in: stretch.parent, scale: stretch.scale, held: 'setting', underground: true, by: 'underground stretch' });
  for (const entry of reading.places.settings ?? []) if (units.has(entry.scene) && entry.place === stretch.parent) Object.assign(entry, { place: stretch.id, by: 'underground stretch' });
  for (const entry of reading.places.occupancy ?? []) if (units.has(entry.scene) && entry.place === stretch.parent) entry.place = stretch.id;
};
for (const stretch of stretches) {
  const units = new Set(stretch.units), place = `unnamed:${stretch.id}`;
  for (const into of [reading, ...others.map(other => other.reading)]) intoReading(into, stretch);
  script.places[place] = { label: stretch.label, scale: stretch.scale, parent: parentFor(stretch.parent), unnamed: true, held: 'setting', scene: stretch.units[0], underground: true };
  for (const scene of script.scenes) if (units.has(scene.id) && scene.place === stretch.parent) Object.assign(scene, { place, placeBy: 'underground stretch' });
}
if (values.write && stretches.length) { await writeFile(resolve(readingPath), JSON.stringify(reading)); for (const other of others) await writeFile(other.path, JSON.stringify(other.reading)); await writeFile(scriptFile, JSON.stringify(script)); }
console.log(JSON.stringify({ written: !!values.write && stretches.length > 0, stretches: stretches.map(({ id, parent, units, evidence, sentences }) => ({ id, parent, units: units.length, from: units[0], to: units.at(-1), evidence: evidence.length, lines: sentences.length })) }));
