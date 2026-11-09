// The look pass's hook (milestones M14; docs/v2/models-and-settings.md §10): after a book's reading and before its terrain
// loop, the main agent is told, in the workflow's own words and with no hint about the book, to set the world generator
// for the book's places from the text (novel look context, then novel settings set | novel warehouse use ... --place).
// The message goes to Pi's console the way the director's review batches do (review.mjs sendToAgent); the pass is done
// when Pi is idle again. Nothing here asks a model; Pi's own reasoning is the agent's.
//   node tools/pi-review/look-pass.mjs <library> <volume n> [--wait <seconds>]
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(new URL('../..', import.meta.url).pathname);

/** The workflow's message: the same for every book; it names the step and the commands, never what the book holds. */
export const lookPassMessage = (novelDir, volume) => [
  `Look pass for volume ${volume}: the reading of ${novelDir} is complete and its terrain loop has not run. Before the loop, set the world generator for this book's places from the text alone (the novel-models skill, "The look pass").`,
  `novel look context ${novelDir} lists the place tree top down with each place's environment sentences, the warehouse parts the text names, and the keys a place may set. Decide the book-level look first, then each place's overrides where its own sentences differ (--place <id>).`,
  `Write every change with --why "<sentence ids>: <what they say>" (novel settings set, novel warehouse use ... --place <id>); a kind of thing the fill does not know yet gets a kind of its own (prop:<name>) and a fill.ops operator. Finish with one change carrying --before. No analysis and no paid step; a look is never canon. Reply with what you set, for which places, and the sentences behind each.`,
].join('\n\n');

/** Send the look pass to the library's Pi console; the id is stable per book and reading, so a second send is a duplicate, not a repeat. */
export async function sendLookPass(library, volume, { novelDir = join(resolve(library), `vol-${volume}`, 'novel'), expiresAt } = {}) {
  const { createPiConsole } = await import(pathToFileURL(join(repo, 'tools', 'pi-review', 'pi-console.mjs')).href);
  const links = JSON.parse(await readFile(join(resolve(library), 'links.json'), 'utf8').catch(() => 'null'));
  const until = expiresAt ?? (links?.expiresAt ? Date.parse(links.expiresAt) : Date.now() + 3600_000);
  const reading = join(resolve(library), `vol-${volume}`, 'reading', 'data.json');
  if (!existsSync(reading)) throw new Error(`${reading} is missing: the look pass follows the reading.`);
  const readingSha = createHash('sha256').update(readFileSync(reading)).digest('hex'), hex = createHash('sha256').update(`look-pass|${novelDir}|${readingSha}`).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const piConsole = createPiConsole({ directory: join(resolve(library), 'runtime', 'pi-console'), expiresAt: until });
  return { id, ...(await piConsole.submit({ id, text: lookPassMessage(novelDir, volume) })) };
}

/** Wait until Pi has gone idle after the message (its events file), at most `seconds`; the commands it ran meanwhile. */
export async function waitForPass(library, { seconds = 900, since = Date.now() } = {}) {
  const file = join(resolve(library), 'runtime', 'pi-events.jsonl'), started = Date.now(), sinceIso = new Date(since).toISOString();
  const events = () => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : []).filter((e) => e.timestamp >= sinceIso);
  for (;;) {
    const now = events(), busy = now.some((e) => e.type === 'pi.status' && e.status === 'working'), idle = now.at(-1)?.type === 'pi.status' && now.at(-1)?.status === 'idle';
    if (busy && idle) return { done: true, seconds: Math.round((Date.now() - started) / 1000), commands: now.filter((e) => e.type === 'pi.command' && e.status === 'ok').length, refused: now.filter((e) => e.reasonCode === 'allowlist').length, labels: [...new Set(now.filter((e) => e.type === 'pi.command' && e.status === 'ok').map((e) => e.label))] };
    if (Date.now() - started > seconds * 1000) return { done: false, seconds, commands: now.filter((e) => e.type === 'pi.command' && e.status === 'ok').length, refused: now.filter((e) => e.reasonCode === 'allowlist').length };
    await new Promise((d) => setTimeout(d, 5000));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const { values, positionals: [library, volume] } = parseArgs({ allowPositionals: true, options: { wait: { type: 'string' } } });
  if (!library || !volume) { console.error('usage: node tools/pi-review/look-pass.mjs <library> <volume n> [--wait <seconds>]'); process.exit(2); }
  const since = Date.now(), sent = await sendLookPass(library, volume);
  console.log(JSON.stringify({ sent }));
  const waited = await waitForPass(library, { seconds: Number(values.wait ?? 900), since });
  const settings = join(resolve(library), `vol-${volume}`, 'novel', 'stage', 'settings.json'), log = existsSync(settings) ? (JSON.parse(readFileSync(settings, 'utf8')).log ?? []).filter((e) => e.at >= new Date(since).toISOString()) : [];
  console.log(JSON.stringify({ ...waited, writes: log.map((e) => ({ op: e.op, key: e.key, place: e.place ?? null, why: String(e.why ?? '').slice(0, 160) })) }, null, 1));
}
