// The terrain io (the user's call, 2026-11-01: "Prepare the run you just did into a GitHub io for terrain step"): a public
// page of one terrain run, made from its live record (stage/simulation/live): the world as it was kept, in 3D, beside the
// run's parts in order, each with the pictures Jev saw, its answers and how sure it was, and what the program made of them
// (placed, settled, sized, kept). Tapping a part frames it in the world. Beside it, /v2/: the two stages and where each
// stands, the concept map and the street compatibility page, linked to the design on GitHub.
//
// No prompt and no sentence of the book goes in: the record's prompts are dropped, names are all it keeps of the text, and
// the pages are refused if anything sentence-like is in them.
//
//   npm run build && node experiments/v2/terrain-io.mjs <novel-dir> <out-dir> [--run "run 11"] [--ref terrain-run11]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GITHUB = 'https://github.com/gardianofthedarkness/novel-ontology-pi';
const esc = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

/** Anything that reads as a sentence of the book: a long run of CJK, or CJK beside sentence marks or quote brackets. */
const SENTENCE = /[一-鿿]{16,}|[一-鿿][，。！？；：「」『』]|[，。！？「」『』][一-鿿]|（原文：/;
const refuseText = (name, page) => { const hit = page.match(SENTENCE); if (hit) throw new Error(`${name}: something sentence-like would be published (…${page.slice(Math.max(0, hit.index - 20), hit.index + 30)}…)`); };

/** The run's parts in order, from the live record: each part's asks (its pictures and Jev's answers) and the program's outcomes. */
export function partsOf(rows, macro) {
  const parts = [];
  let part = null;
  for (const row of rows) {
    if (row.kind === 'ask') {
      const keys = (row.questions ?? []).map(question => question.key);
      // A part begins with its kind question; a pool's part has none and begins with its first outcome.
      if (!part || keys.includes('kind')) parts.push(part = { subject: null, asks: [], outcomes: [] });
      part.asks.push({ keys, pictures: (row.pictures ?? []).map(({ name, file }) => ({ name, file })), answers: (row.answers ?? []).map(({ key, value, confidence, top }) => ({ key, value, confidence, top: (top ?? []).slice(0, 3) })) });
    } else if (row.kind === 'outcome') {
      if (!part || (part.subject && part.subject !== row.subject)) parts.push(part = { subject: row.subject, asks: [], outcomes: [] });
      part.subject ??= row.subject;
      part.outcomes.push(String(row.text).replace(/ \(blinking in World · Live\)$/, ''));
    }
  }
  const byLabel = new Map(macro.map(node => [node.label, node])), byId = new Map(macro.map(node => [node.id, node]));
  const pathOf = node => { const path = []; for (let at = byId.get(node?.parent); at; at = byId.get(at.parent)) path.unshift(at.label); return path; };
  return parts.map((entry, n) => {
    const node = byLabel.get(entry.subject), answer = key => entry.asks.flatMap(ask => ask.answers).find(found => found.key === key) ?? null;
    const decided = entry.outcomes.map(text => text.match(/^.+?: ([\w-]+), median (\d+(?:\.\d+)?) m/)).find(Boolean);
    return {
      n: n + 1, subject: entry.subject, id: node?.id ?? null, scale: entry.subject?.endsWith(' · pool') ? 'pool' : node?.scale ?? null, path: pathOf(node),
      kind: answer('kind'), height: answer('height'), decidedKind: decided?.[1] ?? null, median: decided ? Number(decided[2]) : null,
      pictures: entry.asks.flatMap(ask => ask.pictures), outcomes: entry.outcomes,
    };
  });
}

const STYLE_TOKENS = `
:root { --bg: #0d1214; --panel: #141b1e; --raise: #1a2327; --fg: #e3ebe8; --muted: #8fa29b; --rule: #24302f; --accent: #5fe08a; --gold: #ffd36e; --cyan: #7ce6ff; --soft: #18241f; color-scheme: dark; }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg: #f3f5f2; --panel: #ffffff; --raise: #f7f9f6; --fg: #17201d; --muted: #586660; --rule: #dbe1dc; --accent: #1f7a4a; --gold: #9a6a00; --cyan: #0b6f86; --soft: #e6f0ea; color-scheme: light; } }
:root[data-theme="light"] { --bg: #f3f5f2; --panel: #ffffff; --raise: #f7f9f6; --fg: #17201d; --muted: #586660; --rule: #dbe1dc; --accent: #1f7a4a; --gold: #9a6a00; --cyan: #0b6f86; --soft: #e6f0ea; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif; }
a { color: var(--accent); }
.eyebrow { font: 600 11px/1.3 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 4px 0 0; font-size: 28px; line-height: 1.15; text-wrap: balance; }
code { font: 12.5px ui-monospace, "SF Mono", Menlo, monospace; }
[hidden] { display: none !important; }`;

function terrainPage({ parts, run, ref, calls, tokens, date, placed }) {
  const pct = value => `${Math.round((value ?? 0) * 100)}%`;
  const answerRow = (label, answer, extra = '') => answer ? `<div class="answer"><span class="label">${esc(label)}</span><b>${esc(answer.value)}</b><span class="bar" style="--p:${pct(answer.confidence)}"><i></i></span><span class="sure">${pct(answer.confidence)}</span>${answer.top?.length > 1 ? `<span class="alts">${answer.top.slice(1).map(([option, p]) => `${esc(option)} ${pct(p)}`).join(' · ')}</span>` : ''}${extra}</div>` : '';
  const tagOf = text => (text.match(/^(placed|settled|sized|laid)/) ?? [])[1] ?? (/ kept: /.test(text) ? 'kept' : /: [\w-]+, median /.test(text) || /: empty \(/.test(text) ? 'decided' : 'note');
  const card = part => `<article class="part" data-scale="${esc(part.scale ?? 'other')}" ${part.id ? `data-id="${esc(part.id)}" tabindex="0" role="button" aria-label="Show ${esc(part.subject)} in the world"` : ''}>
  <header><span class="num">${part.n}</span><div class="name"><h2>${esc(part.subject)}</h2><span class="path">${esc([...part.path, part.scale ?? ''].filter(Boolean).join(' › '))}</span></div></header>
  ${part.kind || part.height ? `<div class="jev"><span class="who">Jev</span>${answerRow('kind', part.kind)}${answerRow('height', part.height, part.median != null ? `<span class="then">→ median ${part.median} m</span>` : '')}</div>` : `<div class="jev none"><span class="who">Jev</span><span class="muted">not asked: a pool takes what its places decided</span></div>`}
  ${part.pictures.length ? `<div class="pics">${part.pictures.map(picture => `<button type="button" class="pic" data-src="${esc(picture.file)}" data-caption="${esc(`${part.subject} · ${picture.name}`)}"><img src="${esc(picture.file)}" alt="${esc(`What Jev saw for ${part.subject}: ${picture.name}`)}" loading="lazy" width="320" height="200"><span>${esc(picture.name)}</span></button>`).join('')}</div>` : ''}
  <ul class="outcomes">${part.outcomes.map(text => `<li><span class="tag ${tagOf(text)}">${tagOf(text)}</span><span>${esc(text)}</span></li>`).join('')}</ul>
</article>`;
  const count = scale => parts.filter(part => part.scale === scale).length;
  const filters = [['all', 'All', parts.length], ['city', 'Cities', count('city')], ['district', 'Districts', count('district')], ['street', 'Streets', count('street')], ['pool', 'Pools', count('pool')]].filter(([, , n]) => n);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Terrain · ${esc(run)}</title>
<meta name="description" content="The world engine's first step, terrain: each part of the world as Jev saw and answered it, and what the program built.">
<style>${STYLE_TOKENS}
.top { display: grid; gap: 6px; padding-block: 18px 14px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); border-bottom: 1px solid var(--rule); }
.top p { margin: 0; color: var(--muted); max-width: 72ch; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 13px ui-monospace, "SF Mono", Menlo, monospace; color: var(--fg); }
.stats b { color: var(--accent); font-weight: 600; }
.links { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; }
.layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); align-items: start; }
.world { position: sticky; top: 0; height: 100vh; height: 100dvh; border-right: 1px solid var(--rule); background: #05080a; }
.world iframe { width: 100%; height: 100%; border: 0; display: block; }
.steps { display: grid; gap: 12px; padding-block: 14px 48px; padding-left: max(14px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); min-width: 0; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; position: sticky; top: 0; z-index: 2; background: var(--bg); padding-block: 8px; }
.filters button { font: 13px system-ui, sans-serif; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--rule); background: var(--panel); color: var(--fg); cursor: pointer; }
.filters button span { color: var(--muted); margin-left: 4px; }
.filters button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--soft); }
.part { display: grid; gap: 10px; padding: 14px; border-radius: 12px; background: var(--panel); border: 1px solid var(--rule); min-width: 0; cursor: pointer; scroll-margin-top: 56px; transition: border-color .15s; }
.part:hover, .part:focus-visible { border-color: var(--cyan); outline: none; }
.part.on { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold); }
.part header { display: flex; gap: 10px; align-items: flex-start; }
.num { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font: 600 12px ui-monospace, monospace; background: var(--soft); color: var(--accent); }
.name { min-width: 0; display: grid; gap: 2px; }
.name h2 { margin: 0; font-size: 17px; line-height: 1.25; overflow-wrap: anywhere; }
.path { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.jev { display: grid; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--raise); border: 1px solid var(--rule); }
.who, .label { font: 600 10px/1 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.who { color: var(--cyan); }
.answer { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 14px; }
.answer .label { width: 46px; }
.bar { width: 72px; height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; }
.bar i { display: block; height: 100%; width: var(--p); background: var(--accent); }
.sure { font: 12px ui-monospace, monospace; color: var(--accent); }
.alts { font-size: 12px; color: var(--muted); }
.then { font-size: 13px; color: var(--gold); }
.muted { color: var(--muted); font-size: 13px; }
.pics { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.pic { display: grid; gap: 4px; padding: 0; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; background: #05080a; cursor: zoom-in; color: var(--muted); font: 11px ui-monospace, monospace; text-align: left; }
.pic img { width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; display: block; }
.pic span { padding: 0 8px 6px; }
.outcomes { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.outcomes li { display: flex; gap: 8px; align-items: baseline; font-size: 13px; min-width: 0; }
.outcomes li > span:last-child { overflow-wrap: anywhere; min-width: 0; }
.tag { flex: none; width: 58px; font: 600 10px/1.6 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.tag.placed, .tag.sized { color: var(--cyan); } .tag.settled { color: var(--accent); } .tag.decided, .tag.kept { color: var(--gold); }
dialog { max-width: min(1100px, 96vw); width: 100%; padding: 0; border: 1px solid var(--rule); border-radius: 12px; background: var(--panel); color: var(--fg); }
dialog::backdrop { background: rgba(0, 0, 0, .7); }
dialog img { display: block; width: 100%; height: auto; }
dialog .bar2 { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; }
dialog button { font: 13px system-ui, sans-serif; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--rule); background: var(--raise); color: var(--fg); cursor: pointer; }
footer { color: var(--muted); font-size: 12px; padding-top: 8px; }
@media (max-width: 860px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .world { height: 42vh; height: 42dvh; z-index: 3; border-right: 0; border-bottom: 1px solid var(--rule); }
  .filters { position: static; }
  .part { scroll-margin-top: calc(42dvh + 12px); }
}
</style>
</head>
<body>
<header class="top">
  <span class="eyebrow">novel-ontology-pi · v2 · world engine, step 1 of 3</span>
  <h1>Terrain, vol 1</h1>
  <p>Part by part, from the cities down to their streets, Jev was asked what each place is and how high it rises, with two pictures of the world as it stood. The program sized each area by its pins, placed it as one optimization, settled the part and laid its streets. Tap a part to see it in the world.</p>
  <div class="stats"><span><b>${parts.length}</b> parts</span><span><b>${calls}</b> Jev calls</span>${tokens ? `<span><b>${tokens.toLocaleString('en')}</b> input tokens</span>` : ''}${placed.length ? `<span>placed <b>${Math.min(...placed)}–${Math.max(...placed)} m</b> from the spot the text suggested</span>` : ''}<span>${esc(run)} · ${esc(date)}</span></div>
  <nav class="links"><a href="../v2/">The two stages and where they stand</a><a href="../v2/concepts.html">Concept map</a><a href="../v2/street-compatibility.html">Street compatibility</a><a href="${GITHUB}/tree/${esc(ref)}">Code at ${esc(ref)}</a></nav>
</header>
<div class="layout">
  <div class="world"><iframe src="world/" title="The world as the terrain run kept it" id="world" allow="fullscreen"></iframe></div>
  <main class="steps">
    <div class="filters" role="group" aria-label="Show parts">${filters.map(([key, name, n], i) => `<button type="button" data-filter="${key}" aria-pressed="${i === 0}">${name}<span>${n}</span></button>`).join('')}</div>
    ${parts.map(card).join('\n    ')}
    <footer>Made from the run's live record by <code>experiments/v2/terrain-io.mjs</code>. Jev's prompts are not published, and nothing of the book but its names.</footer>
  </main>
</div>
<dialog id="look"><img alt=""><div class="bar2"><span id="lookCaption"></span><button type="button" id="lookClose">Close</button></div></dialog>
<script>
const frame = document.getElementById('world'), target = location.protocol === 'file:' ? '*' : location.origin;
const focus = id => frame.contentWindow?.postMessage({ type: 'focus', id }, target);
const first = document.querySelector('.part[data-scale="city"]');
addEventListener('message', event => { if (event.source === frame.contentWindow && event.data?.type === 'ready' && first) focus(first.dataset.id); });
const pick = part => { for (const other of document.querySelectorAll('.part.on')) other.classList.remove('on'); part.classList.add('on'); focus(part.dataset.id); if (matchMedia('(max-width: 860px)').matches) part.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
const look = document.getElementById('look');
document.querySelector('.steps').addEventListener('click', event => {
  const picture = event.target.closest('.pic');
  if (picture) { look.querySelector('img').src = picture.dataset.src; look.querySelector('img').alt = picture.dataset.caption; document.getElementById('lookCaption').textContent = picture.dataset.caption; look.showModal(); return; }
  const part = event.target.closest('.part[data-id]'); if (part) pick(part);
});
document.querySelector('.steps').addEventListener('keydown', event => { const part = event.target.closest?.('.part[data-id]'); if (part && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(part); } });
document.getElementById('lookClose').addEventListener('click', () => look.close());
look.addEventListener('click', event => { if (event.target === look) look.close(); });
for (const button of document.querySelectorAll('.filters button')) button.addEventListener('click', () => {
  for (const other of document.querySelectorAll('.filters button')) other.setAttribute('aria-pressed', String(other === button));
  for (const part of document.querySelectorAll('.part')) part.hidden = button.dataset.filter !== 'all' && part.dataset.scale !== button.dataset.filter;
});
</script>
</body>
</html>
`;
}

function stagesPage({ STAGES, LAYERS, CONCEPTS, ref }) {
  const doc = file => `${GITHUB}/blob/v2/${file}`;
  const stage = entry => `<section class="stage">
  <div class="head"><h2>${esc(entry.name)}</h2><p>${esc(entry.what)}</p></div>
  ${entry.steps.length ? `<ol class="steps">${entry.steps.map(step => `<li class="${esc(step.progress)}"><span class="mark">${esc(step.progress)}</span><b>${esc(step.name)}</b><span>${esc(step.what)}</span>${step.name === 'Terrain' ? '<a href="../terrain/">See the terrain run →</a>' : ''}</li>`).join('')}</ol>` : ''}
  <div class="layers">${entry.layers.map(layer => `<a href="concepts.html#layer-${esc(layer)}"><b>${esc(layer)}</b> <span>${CONCEPTS.filter(concept => concept.layer === layer).length} concepts</span><small>${esc(LAYERS[layer])}</small></a>`).join('')}</div>
</section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Novel Ontology v2</title>
<meta name="description" content="v2 in two stages, extraction and the world engine: what each does and where each step stands.">
<style>${STYLE_TOKENS}
main { display: grid; gap: 28px; max-width: 1040px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
header { display: grid; gap: 8px; }
header p, .head p { margin: 0; color: var(--muted); max-width: 70ch; }
.principles { margin: 0; padding-left: 18px; display: grid; gap: 4px; color: var(--fg); max-width: 78ch; }
.principles li::marker { color: var(--accent); }
.stage { display: grid; gap: 14px; padding-top: 18px; border-top: 2px solid var(--fg); }
.head { display: grid; gap: 4px; }
h2 { margin: 0; font-size: 22px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.steps li { display: grid; gap: 4px; align-content: start; padding: 12px 14px; border-radius: 10px; background: var(--panel); border: 1px solid var(--rule); font-size: 14px; }
.steps li > span:last-of-type { color: var(--muted); }
.steps .next { border-color: var(--gold); }
.mark { font: 600 10px/1 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; }
.done .mark { color: var(--accent); } .next .mark { color: var(--gold); } .later .mark { color: var(--muted); }
.layers { display: flex; flex-wrap: wrap; gap: 8px; }
.layers a { display: grid; gap: 2px; flex: 1 1 240px; min-width: 0; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--rule); background: var(--raise); color: var(--fg); text-decoration: none; text-transform: capitalize; }
.layers a span { color: var(--muted); font-size: 12px; text-transform: none; }
.layers small { color: var(--muted); text-transform: none; }
.more { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.more a { display: grid; gap: 2px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--rule); background: var(--panel); color: var(--fg); text-decoration: none; }
.more a span { color: var(--muted); font-size: 13px; }
footer { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
<header>
  <span class="eyebrow">novel-ontology-pi · v2</span>
  <h1>From a novel to a world you can watch</h1>
  <p>Extraction reads the book into a world model: who says and does each line, when it happens, where every place and thing is. The world engine builds that world on the ground: the terrain first, then where everyone stands, then how they move.</p>
  <ul class="principles">
    <li>The program does geometry; Jev does meaning. No model is asked for a coordinate or a size.</li>
    <li>Jev sees what the user sees: every terrain question carries pictures of the world as it stands.</li>
    <li>One context engine composes every Jev request: the raw text around the place's name, ranked by the question, nothing padded.</li>
    <li>Pins are suggestions; placement is one optimization, settled part by part.</li>
  </ul>
</header>
${STAGES.map(stage).join('\n')}
<section class="stage">
  <div class="head"><h2>Read further</h2></div>
  <div class="more">
    <a href="../terrain/"><b>The terrain run</b><span>Each part as Jev saw it, and the world it built.</span></a>
    <a href="concepts.html"><b>Concept map</b><span>Every concept we invented, with its code and its design.</span></a>
    <a href="street-compatibility.html"><b>Street compatibility</b><span>Which streets share ground, which buildings they take.</span></a>
    <a href="${doc('docs/v2/README.md')}"><b>The guide by stage</b><span>From each concept to its design and its code.</span></a>
    <a href="${doc('docs/v2/status.md')}"><b>Status</b><span>What each step decided, and what is open.</span></a>
    <a href="${doc('docs/v2/whats-new.md')}"><b>What is new in v2</b><span>For a teammate catching up.</span></a>
  </div>
</section>
<footer>Made from <code>src/v2/concepts.ts</code> by <code>experiments/v2/terrain-io.mjs</code> at <a href="${GITHUB}/tree/${esc(ref)}">${esc(ref)}</a>.</footer>
</main>
</body>
</html>
`;
}

/** Links a reference page makes to the design docs beside it (docs/v2/*.md) go to GitHub, where they can be read. */
const toGithub = page => page.replace(/href="((?:\.\.\/)*)([\w./-]+\.(?:md|yaml))(#[^"]*)?"/g, (whole, up, file, hash = '') => `href="${GITHUB}/blob/v2/${up ? file : `docs/v2/${file}`}${hash}"`);

export async function terrainIo(novelDir, outDir, { run = 'run 11', ref = 'terrain-run11' } = {}) {
  const live = join(novelDir, 'stage', 'simulation', 'live');
  const rows = (await readFile(join(live, 'frames.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const data = JSON.parse(await readFile(join(live, 'page.json'), 'utf8'));
  const parts = partsOf(rows, data.macro ?? []);
  const usageFile = join(novelDir, 'stage', 'terrain', 'jev-usage.json');
  const tokens = existsSync(usageFile) ? JSON.parse(await readFile(usageFile, 'utf8')).reduce((sum, entry) => sum + (entry.input_tokens ?? 0), 0) : 0;
  const placed = parts.flatMap(part => part.outcomes.map(text => text.match(/(?:^placed|laid on [^,]*,) (\d+) m from its spot/)).filter(Boolean).map(match => Number(match[1])));
  const date = (rows.find(row => row.at)?.at ?? '').slice(0, 10);
  const terrainDir = join(outDir, 'terrain'), v2Dir = join(outDir, 'v2');
  await mkdir(join(terrainDir, 'frames'), { recursive: true }); await mkdir(v2Dir, { recursive: true });

  const page = terrainPage({ parts, run, ref, calls: rows.filter(row => row.kind === 'ask').length, tokens, date, placed });
  refuseText('terrain/index.html', page);
  await writeFile(join(terrainDir, 'index.html'), page);
  for (const file of new Set(parts.flatMap(part => part.pictures.map(picture => picture.file)))) await copyFile(join(live, file), join(terrainDir, file));

  // The world as kept: the engine's own page in live mode (the whole world drawn on the terrain stage), three.js beside it.
  const { inlineStrand } = await import(pathToFileURL(join(repository, 'world-engine', 'world', 'export-strand-demo.mjs')).href);
  const { VENDOR_FILES } = await import(pathToFileURL(join(repository, 'world-engine', 'live', 'sim-jev.mjs')).href);
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  const world = inlineStrand(template, { ...data, title: `Terrain · ${run}`, live: { ...data.live, moment: `Terrain · ${run}: the world as kept` } }, { name: `Terrain · ${run}`, vendor: true });
  refuseText('terrain/world/index.html', world);
  await mkdir(join(terrainDir, 'world'), { recursive: true });
  await writeFile(join(terrainDir, 'world', 'index.html'), world);
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(terrainDir, 'world', 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(terrainDir, 'world', 'vendor', path)); }

  const { STAGES, LAYERS, CONCEPTS } = await import(pathToFileURL(join(repository, 'dist/src/v2/concepts.js')).href);
  const { conceptsPage } = await import(pathToFileURL(join(repository, 'experiments', 'v2', 'concepts-page.mjs')).href);
  const pages = { 'index.html': stagesPage({ STAGES, LAYERS, CONCEPTS, ref }), 'concepts.html': toGithub(await conceptsPage()), 'street-compatibility.html': toGithub(await readFile(join(repository, 'docs', 'v2', 'street-compatibility.html'), 'utf8')) };
  for (const [name, html] of Object.entries(pages)) { refuseText(`v2/${name}`, html); await writeFile(join(v2Dir, name), html); }
  return { parts: parts.length, unplaced: parts.filter(part => !part.id).map(part => part.subject), pictures: parts.reduce((sum, part) => sum + part.pictures.length, 0), calls: rows.filter(row => row.kind === 'ask').length, tokens };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, ref: { type: 'string' } } });
  const [novelDir, outDir] = positionals;
  if (!novelDir || !outDir) throw new Error('Usage: node experiments/v2/terrain-io.mjs <novel-dir> <out-dir> [--run "run 11"] [--ref terrain-run11]');
  console.log(JSON.stringify(await terrainIo(resolve(novelDir), resolve(outDir), { run: values.run, ref: values.ref })));
}
