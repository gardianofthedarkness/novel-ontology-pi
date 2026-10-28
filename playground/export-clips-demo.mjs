// Stage clips as one shareable page: the clips of each prepared book, cut down to what they play,
// with the clip player (apps/playground clips-demo.html) inlined around them. No host, archive,
// book text or agent is reachable from the page; each clip carries its scene's beats (summaries
// and names, no quotes or source positions), its place and the prepared moves.
//   npm run build && node playground/export-clips-demo.mjs <live-volumes.json> <out.html> [--catalog catalog.json] [--fragment]
// live-volumes.json is the Pi runner's list of books ({id, workspace, metadataDirectory}).
// --fragment leaves out the document wrapper (<!doctype>, <html>, <head>, <body>), for hosts that add their own.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = `${repository}/apps/playground`;
const load = path => import(pathToFileURL(`${repository}/${path}`));

/**
 * A place's clips cut down to what they play: each clip's scene from its title card to its last
 * beat (enough for the stage to place everyone), the scenes one after another in one script per
 * place, so clips of a place share one stage. Quotes and source positions are left out.
 */
export function trimPlace(entries) {
  const { script, plan } = entries[0];
  const cuts = entries.map(({ clip }) => ({ clip, start: script.beats.findIndex(beat => beat.sceneId === clip.sceneId) })).sort((first, second) => first.start - second.start);
  const beats = [], clips = [];
  for (const { clip, start } of cuts) {
    const offset = beats.length - start;
    beats.push(...script.beats.slice(start, clip.to + 1).map(({ quote, source, ...beat }) => beat));
    clips.push({ ...clip, from: clip.from + offset, to: clip.to + offset });
  }
  const people = new Set(beats.flatMap(beat => [...beat.actors, ...beat.present]));
  const ids = new Set(beats.map(beat => beat.id)), scenes = cuts.map(({ clip }) => clip.sceneId);
  const pick = record => Object.fromEntries(scenes.map(scene => [scene, record[scene] ?? {}]));
  return {
    clips,
    script: { title: script.title, places: script.places.slice(0, 1), actors: script.actors.filter(actor => people.has(actor.id)), beats },
    plan: { place: plan.place, kind: plan.kind, starts: pick(plan.starts), moves: Object.fromEntries(Object.entries(plan.moves).filter(([id]) => ids.has(id))), ...(plan.notes ? { notes: pick(plan.notes) } : {}) },
  };
}

/** One book's clips, as the host's clip page picks them: {stages: {placeId: {script, plan}}, clips} in reading order. */
export async function bookClips(volume, { snapshot, stagePlan, placeScript, keyedPlan, placePlan, sceneClips, pickClips }) {
  const [data, stage] = await Promise.all([snapshot(volume.workspace, volume.metadataDirectory, { volume: volume.id }), stagePlan(volume.workspace)]);
  if (!stage?.places || !data.timePlace) return null;
  const stages = new Map();
  for (const key of Object.keys(stage.places)) {
    const placeId = data.timePlace.places.find(place => place.id === key || place.id === `${volume.id}:${key}`)?.id;
    if (!placeId || stages.has(placeId)) continue;
    const script = placeScript(data.timePlace, data.world, placeId, volume.id);
    const plan = placePlan(stage, placeId, volume.id);
    if (plan && script.beats.length) stages.set(placeId, { script, plan: keyedPlan(plan, script) });
  }
  const picked = pickClips([...stages.values()].flatMap(({ script, plan }) => sceneClips(script, plan)));
  const trimmed = {}, cut = new Map();
  for (const placeId of new Set(picked.map(clip => clip.placeId))) {
    const { clips, ...stage } = trimPlace(picked.filter(clip => clip.placeId === placeId).map(clip => ({ clip, ...stages.get(placeId) })));
    trimmed[placeId] = stage;
    for (const clip of clips) cut.set(clip.id, clip);
  }
  return { stages: trimmed, clips: picked.map(clip => cut.get(clip.id)) };
}

/** The built page with its script, stylesheet and clips inlined. */
export function inlinePage(html, { script, style, data, fragment = false }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  let page = html
    .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, () => '')
    .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${style}</style>`)
    .replace('<script type="application/json" id="clips-data"></script>', () => `<script type="application/json" id="clips-data">${json}</script>\n<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);
  if (fragment) {
    const title = page.match(/<title>[^<]*<\/title>/)?.[0] ?? '';
    const body = page.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
    const styles = [...page.matchAll(/<style>[\s\S]*?<\/style>/g)].map(match => match[0]).join('\n');
    page = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${styles}\n${body}`;
  }
  if (/\/view\/[A-Za-z0-9_-]{43}\//.test(page)) throw new Error('A private viewer path ended up in the page');
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { catalog: { type: 'string' }, fragment: { type: 'boolean' } } });
  const [volumesFile, out] = positionals;
  if (!volumesFile || !out) throw new Error('Usage: node playground/export-clips-demo.mjs <live-volumes.json> <out.html> [--catalog catalog.json] [--fragment]');
  const volumes = JSON.parse(await readFile(volumesFile, 'utf8'));
  const titles = values.catalog ? new Map(JSON.parse(await readFile(values.catalog, 'utf8')).volumes.map(book => [book.id, book.title])) : new Map();
  const modules = {
    ...await load('tools/pi-review/snapshot.mjs'), ...await load('tools/pi-review/serve.mjs'),
    ...await load('dist/apps/playground/src/data/holoScript.js'), ...await load('dist/apps/playground/src/data/readMode.js'), ...await load('dist/apps/playground/src/data/stageClips.js'),
  };
  const books = [];
  for (const volume of volumes) {
    const { stages, clips } = await bookClips(volume, modules) ?? {};
    if (clips?.length) books.push({ id: volume.id, title: titles.get(volume.id) ?? `Book ${volume.id}`, stages, clips });
  }
  await promisify(execFile)('npx', ['vite', 'build', '--config', 'vite.clips-demo.config.ts'], { cwd: frontend });
  const built = `${frontend}/dist-clips-demo`;
  const html = await readFile(`${built}/clips-demo.html`, 'utf8');
  const asset = pattern => html.match(pattern)?.[1];
  const page = inlinePage(html, { script: await readFile(`${built}/${asset(/src="\.\/([^"]+\.js)"/)}`, 'utf8'), style: await readFile(`${built}/${asset(/href="\.\/([^"]+\.css)"/)}`, 'utf8'), data: { exportedAt: new Date().toISOString(), books }, fragment: values.fragment });
  await writeFile(out, page, { mode: 0o600 });
  console.log(JSON.stringify({ out, bytes: Buffer.byteLength(page), books: books.map(book => ({ id: book.id, clips: book.clips.length })) }));
}
