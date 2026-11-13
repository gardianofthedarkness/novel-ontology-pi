// The place pass (docs/v3/design.html#place-tree-agent, milestones T3): after a book's reading and before its terrain, the
// main agent is told, in the workflow's own words and with no hint about the book, to check the reading's place tree
// with evidence (novel places ...; the novel-volume skill, "The place tree"). Sent to Pi's console like the look pass;
// the pass is done when Pi is idle again. Nothing here asks a model; Pi's own reasoning is the agent's.
//   node tools/pi-review/place-pass.mjs <library> <volume n> [--wait <seconds>]
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { waitForPass } from './look-pass.mjs';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** The workflow's message: the same for every book; it names the step and the commands, never what the book holds. */
export const placePassMessage = (novelDir, volume) => [
  `Place pass for volume ${volume}: the reading of ${novelDir} is complete and its terrain has not been built. Before terrain, check the reading's place tree with evidence (the novel-volume skill, "The place tree").`,
  `Start with novel places check ${novelDir} and novel places tree ${novelDir}. Decide every city and district (setting, mention or drop), give every story unit with no place a place (hold, set or same), and settle every change of city (travel, or fix the place). Each decision needs a sentence of the book that shows it; a refused claim comes back with why: correct it, do not repeat it.`,
  `When check shows nothing left that matters, run novel places apply ${novelDir}. No paid step. Reply with the settings, the mentions and drops and their sentences, how many units you placed and how, the journeys you kept, and what you left and why.`,
].join('\n\n');

/** Send the place pass to the library's Pi console; the id is stable per book and reading, so a second send is a duplicate. */
export async function sendPlacePass(library, volume, { novelDir = join(resolve(library), `vol-${volume}`, 'novel'), expiresAt } = {}) {
  const { createPiConsole } = await import(pathToFileURL(join(repo, 'tools', 'pi-review', 'pi-console.mjs')).href);
  const links = JSON.parse(await readFile(join(resolve(library), 'links.json'), 'utf8').catch(() => 'null'));
  const until = expiresAt ?? (links?.expiresAt ? Date.parse(links.expiresAt) : Date.now() + 3600_000);
  const reading = join(resolve(library), `vol-${volume}`, 'reading', 'data.json');
  if (!existsSync(reading)) throw new Error(`${reading} is missing: the place pass follows the reading.`);
  const readingSha = createHash('sha256').update(readFileSync(reading)).digest('hex'), hex = createHash('sha256').update(`place-pass|${novelDir}|${readingSha}`).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const piConsole = createPiConsole({ directory: join(resolve(library), 'runtime', 'pi-console'), expiresAt: until });
  return { id, ...(await piConsole.submit({ id, text: placePassMessage(novelDir, volume) })) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { values, positionals: [library, volume] } = parseArgs({ allowPositionals: true, options: { wait: { type: 'string' } } });
  if (!library || !volume) { console.error('usage: node tools/pi-review/place-pass.mjs <library> <volume n> [--wait <seconds>]'); process.exit(2); }
  const since = Date.now(), sent = await sendPlacePass(library, volume);
  console.log(JSON.stringify({ sent }));
  const waited = await waitForPass(library, { seconds: Number(values.wait ?? 1800), since });
  const file = join(resolve(library), `vol-${volume}`, 'novel', 'stage', 'world', 'place-tree.json'), d = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  console.log(JSON.stringify({ ...waited, decisions: d && { places: Object.keys(d.places).length, holds: Object.keys(d.holds).length, units: Object.keys(d.units).length, travels: Object.keys(d.travels).length, log: d.log.length, applied: existsSync(join(resolve(library), `vol-${volume}`, 'novel', 'stage', 'world', 'script.reading.json')) } }, null, 1));
}
