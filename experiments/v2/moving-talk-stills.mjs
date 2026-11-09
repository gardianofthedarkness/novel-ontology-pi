// Stills of each moving-talk clip (experiments/v2/moving-talk.mjs), for a flipbook beside the playable page: headless
// Chrome plays each clip to evenly spaced moments, the camera on the people the option moves (their middle, from the
// south-east), and saves a frame; it also says whether the page ran without errors. The frames show the book's lines in
// their bubbles: private, never published.
//   node experiments/v2/moving-talk-stills.mjs <clips dir (with clips.json and vendor/)> <spec.json> [frames=24]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [dir, specFile, count = '24'] = process.argv.slice(2);
const { browser, serve } = await import(pathToFileURL(join(repository, 'world-engine', 'view', 'two-view-things.mjs')).href);
const clips = JSON.parse(await readFile(join(dir, 'clips.json'), 'utf8')), spec = JSON.parse(await readFile(specFile, 'utf8'));
const chrome = await browser({ gpu: true });
await chrome.size(960, 600);
const report = [];
for (const clip of clips.made) {
  const sample = spec.samples.find(entry => entry.id === clip.sample), scene = sample.stage ? sample.stage.id : sample.scene;
  const who = sample.stage ? Object.keys(sample.stage.people) : [...new Set([...(sample.movers ?? []), sample.leader, ...(sample.beside ?? []), ...Object.keys(sample.carried ?? {})].filter(Boolean))];
  const { server, url } = await serve(join(dir, clip.file), join(dir, 'vendor'));
  await chrome.open(url).catch(() => {});
  await new Promise(done => setTimeout(done, 4000));
  const { total, place } = await chrome.evaluate(`({ total: window.__replay().total, place: JSON.parse(document.getElementById('strand-data').textContent).scenes[0].place })`);
  const frames = [], out = join(dir, 'stills', `${clip.sample}-${clip.option}`);
  await mkdir(out, { recursive: true });
  let last = null;
  for (let n = 0; n < Number(count); n++) {
    const at = 2.2 + ((total - 2.4) * n) / (Number(count) - 1);
    await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'place', scene, place, at, frame: [960, 600], people: true })})`);
    const spots = (await chrome.evaluate(`(${JSON.stringify(who)}).map(id => window.__pawnAt(id)).filter(Boolean)`)) ?? [];
    const middle = spots.length ? spots.reduce((sum, p) => [sum[0] + p[0] / spots.length, sum[1] + p[1] / spots.length, sum[2] + p[2] / spots.length], [0, 0, 0]) : last;
    if (!middle) continue;
    last = middle;
    const spread = spots.length ? Math.max(...spots.map(p => Math.hypot(p[0] - middle[0], p[2] - middle[2]))) : 0, away = Math.max(22, spread * 1.6 + 14);
    await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'still', scene, place, at, frame: [960, 600], people: true, view: { fov: 45, position: [middle[0] + away * 0.7, middle[1] + away * 0.75, middle[2] + away * 0.7], target: [middle[0], middle[1] + 1, middle[2]] } })})`);
    await new Promise(done => setTimeout(done, 350));
    const file = `${String(n).padStart(2, '0')}.jpg`;
    await writeFile(join(out, file), Buffer.from(await chrome.still('jpeg'), 'base64'));
    frames.push({ file: `stills/${clip.sample}-${clip.option}/${file}`, at: Math.round(at * 10) / 10, people: spots.length, spread: Math.round(spread) });
  }
  const errors = await chrome.errors().catch(() => []);
  report.push({ ...clip, total: Math.round(total), frames, errors: errors.slice(0, 3) });
  console.error(`${clip.file}: ${frames.length} frames, people seen ${frames.map(f => f.people).join('')}, ${errors.length} errors`);
  server.close();
}
await writeFile(join(dir, 'stills.json'), JSON.stringify(report, null, 1));
await chrome.close();
process.exit(0);
