// The concept map's page (docs/v2/concepts.html), made from src/v2/concepts.ts: every abstract concept of the v2 build in
// its layer, what it is, where it lives in code and where it is designed, what it builds on and what builds on it. It
// refuses to write a page whose pointers no longer hold (test/concepts.test.ts checks the same on every `npm test`).
//
//   npm run build && node experiments/v2/concepts-page.mjs [out.html]
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esc = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

export async function conceptsPage() {
  const { CONCEPTS, LAYERS, STAGES } = await import(pathToFileURL(join(repository, 'dist/src/v2/concepts.js')).href);
  const holds = pointer => { const [file, text] = pointer.split('#'), path = join(repository, file); return existsSync(path) && readFileSync(path, 'utf8').includes(text); };
  const broken = CONCEPTS.flatMap(concept => [...concept.lives, ...concept.docs].filter(pointer => !holds(pointer)).map(pointer => `${concept.id}: ${pointer}`));
  if (broken.length) throw new Error(`The concept map no longer holds:\n${broken.join('\n')}`);
  const commit = (() => { try { return execFileSync('git', ['-C', repository, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
  const byId = new Map(CONCEPTS.map(concept => [concept.id, concept]));
  const builtOnBy = id => CONCEPTS.filter(concept => concept.uses?.includes(id));
  const pointers = CONCEPTS.reduce((sum, concept) => sum + concept.lives.length + concept.docs.length, 0);
  // A code pointer: the file and what it holds; a design pointer: the doc (relative to docs/v2) and its heading.
  const code = pointer => { const [file, text] = pointer.split('#'); return `<li><code class="path">${esc(file)}</code> <code class="sym">${esc(text)}</code></li>`; };
  const design = pointer => { const [file, text] = pointer.split('#'), href = file.startsWith('docs/v2/') ? file.slice('docs/v2/'.length) : `../../${file}`; return `<li><a href="${esc(href)}">${esc(file.split('/').pop())}</a> <span class="head">§ ${esc(text)}</span></li>`; };
  const chip = id => { const concept = byId.get(id); return `<a class="chip ${esc(concept.layer)}" href="#${esc(id)}">${esc(concept.name)}</a>`; };
  const card = concept => {
    const on = concept.uses ?? [], by = builtOnBy(concept.id).map(other => other.id);
    return `<article class="card" id="${esc(concept.id)}" data-layer="${esc(concept.layer)}" data-text="${esc(`${concept.name} ${concept.what} ${concept.id}`.toLowerCase())}">
  <header><h4>${esc(concept.name)}</h4>${concept.user ? '<span class="badge">the user\'s design</span>' : ''}</header>
  <p>${esc(concept.what)}</p>
  <div class="where"><div><span class="label">code</span><ul>${concept.lives.map(code).join('')}</ul></div><div><span class="label">design</span><ul>${concept.docs.map(design).join('')}</ul></div></div>
  ${on.length || by.length ? `<div class="links">${on.length ? `<div><span class="label">builds on</span>${on.map(chip).join('')}</div>` : ''}${by.length ? `<div><span class="label">built on by</span>${by.map(chip).join('')}</div>` : ''}</div>` : ''}
</article>`;
  };
  // The strip and the sections follow the two stages (extraction, then the world engine), the rules last as serving both.
  const count = layer => CONCEPTS.filter(concept => concept.layer === layer).length;
  const strip = STAGES.map(stage => `<a class="stage-link" href="#stage-${esc(stage.id)}"><b>${esc(stage.name)}</b>${stage.layers.map(layer => `<span class="step ${esc(layer)}">${esc(layer)} <span>${count(layer)}</span></span>`).join('')}</a>`).join('<span class="arrow" aria-hidden="true">→</span>');
  const progress = stage => stage.steps.length ? `<ol class="progress">${stage.steps.map(step => `<li class="${esc(step.progress)}"><span class="mark">${esc(step.progress)}</span><b>${esc(step.name)}</b><span>${esc(step.what)}</span></li>`).join('')}</ol>` : '';
  const layerSection = layer => `<section class="layer" id="layer-${esc(layer)}" data-layer="${esc(layer)}">
  <div class="layer-head"><h3><span class="dot ${esc(layer)}"></span>${esc(layer)}</h3><p>${esc(LAYERS[layer])}</p></div>
  <div class="cards">${CONCEPTS.filter(concept => concept.layer === layer).map(card).join('\n')}</div>
</section>`;
  const sections = STAGES.map(stage => `<section class="stage" id="stage-${esc(stage.id)}">
  <div class="stage-head"><h2>${esc(stage.name)}</h2><p>${esc(stage.what)}</p>${progress(stage)}</div>
${stage.layers.map(layerSection).join('\n')}
</section>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Concept Map</title>
<meta name="description" content="Every abstract concept of the v2 build in its layer: what it is, where it lives in code and in the design, what it builds on.">
<style>
:root { --bg: #f5f6f3; --panel: #ffffff; --fg: #1c2320; --muted: #5d6963; --rule: #dde2dc; --accent: #1f6f5c; --soft: #e7efe9;
  --reading: #7a5cc4; --tree: #2f7d4f; --terrain: #a86a16; --world: #2b6fb0; --view: #0e8a96; --rules: #8a5a6b; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f1412; --panel: #161c19; --fg: #e2e8e4; --muted: #94a39b; --rule: #27302c; --accent: #6fd0b3; --soft: #1d2622;
  --reading: #b59cff; --tree: #7fd39f; --terrain: #e8b462; --world: #7fb6ec; --view: #6fdce6; --rules: #e0a6bb; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #0f1412; --panel: #161c19; --fg: #e2e8e4; --muted: #94a39b; --rule: #27302c; --accent: #6fd0b3; --soft: #1d2622;
  --reading: #b59cff; --tree: #7fd39f; --terrain: #e8b462; --world: #7fb6ec; --view: #6fdce6; --rules: #e0a6bb; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; max-width: 1180px; margin: 0 auto; padding-block: 32px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.eyebrow { font: 600 11px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 6px 0 0; font-size: 30px; line-height: 1.15; text-wrap: balance; }
h2 { margin: 0; font-size: 22px; text-wrap: balance; }
h3 { margin: 0; font-size: 17px; text-transform: capitalize; display: flex; align-items: center; gap: 8px; }
h4 { margin: 0; font-size: 15px; text-wrap: balance; }
p { margin: 0; color: var(--muted); max-width: 70ch; }
code { font: 12px ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
header.top { display: grid; gap: 8px; }
.status { display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: var(--accent); }
.status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.stage { display: grid; gap: 22px; min-width: 0; padding-top: 18px; border-top: 2px solid var(--fg); }
.stage-head { display: grid; gap: 8px; }
.progress { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 8px; }
.progress li { display: grid; gap: 3px; align-content: start; padding: 10px 12px; border-radius: 8px; background: var(--panel); border: 1px solid var(--rule); font-size: 13px; min-width: 0; }
.progress li > span:last-child { color: var(--muted); }
.mark { font: 600 10px/1 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
.progress .done .mark { color: var(--accent); } .progress .next .mark { color: var(--terrain); } .progress .later .mark { color: var(--muted); }
.progress .next { border-color: var(--terrain); }
.stage-link { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--rule); background: var(--panel); color: var(--fg); text-decoration: none; }
.stage-link > b { margin-right: 4px; }
.step { display: inline-flex; gap: 6px; align-items: baseline; padding: 4px 8px; border-radius: 6px; background: var(--soft); color: var(--fg); font-size: 13px; border-top: 3px solid; }
.step span { color: var(--muted); font-size: 12px; }
.arrow { color: var(--muted); }
.tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tools input { flex: 1 1 220px; min-width: 0; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--rule); background: var(--panel); color: var(--fg); font: inherit; }
.tools button { padding: 8px 12px; border-radius: 999px; border: 1px solid var(--rule); background: var(--panel); color: var(--fg); font: 13px system-ui, sans-serif; cursor: pointer; }
.tools button[aria-pressed="true"] { background: var(--soft); border-color: var(--accent); color: var(--accent); }
.layer { display: grid; gap: 14px; min-width: 0; }
.layer-head { display: grid; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 14px; display: grid; gap: 10px; align-content: start; min-width: 0; scroll-margin-top: 16px; }
.card:target { outline: 2px solid var(--accent); }
.card header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; justify-content: space-between; }
.badge { font: 600 10px/1 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); background: var(--soft); padding: 3px 6px; border-radius: 4px; white-space: nowrap; }
.where { display: grid; gap: 8px; }
.where ul { margin: 4px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.where li { font-size: 12px; color: var(--muted); }
.path { color: var(--fg); }
.sym { color: var(--accent); }
.head { color: var(--muted); }
.label { display: block; font: 600 10px/1 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.links { display: grid; gap: 8px; border-top: 1px solid var(--rule); padding-top: 10px; }
.links .label { margin-bottom: 4px; }
.chip { display: inline-block; margin: 2px 4px 2px 0; font-size: 12px; padding: 3px 8px; border-radius: 999px; text-decoration: none; color: var(--fg); background: var(--soft); border-left: 3px solid; }
a { color: var(--accent); }
.reading { border-color: var(--reading); } .tree { border-color: var(--tree); } .terrain { border-color: var(--terrain); } .world { border-color: var(--world); } .view { border-color: var(--view); } .rules { border-color: var(--rules); }
.dot.reading { background: var(--reading); } .dot.tree { background: var(--tree); } .dot.terrain { background: var(--terrain); } .dot.world { background: var(--world); } .dot.view { background: var(--view); } .dot.rules { background: var(--rules); }
.step.reading, .chip.reading { border-color: var(--reading); } .step.tree, .chip.tree { border-color: var(--tree); } .step.terrain, .chip.terrain { border-color: var(--terrain); } .step.world, .chip.world { border-color: var(--world); } .step.view, .chip.view { border-color: var(--view); } .step.rules, .chip.rules { border-color: var(--rules); }
[hidden] { display: none !important; }
footer { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<main>
<header class="top">
  <span class="eyebrow">Novel ontology · v2 · the concepts we invented</span>
  <h1>Concept map</h1>
  <p>Every abstract concept of the v2 build, in the stage and layer it belongs to — extraction (what the text says, where things are), then the world engine (the ground, what stands, what is seen): what it is, where it lives in code, where it is designed, what it builds on and what builds on it. Made from <code>src/v2/concepts.ts</code> at <code>${esc(commit)}</code> on ${new Date().toISOString().slice(0, 10)}.</p>
  <span class="status">${CONCEPTS.length} concepts · all ${pointers} pointers hold · ${CONCEPTS.filter(concept => concept.user).length} of the user's design</span>
</header>
<nav class="strip" aria-label="Stages and layers">${strip}</nav>
<div class="tools" role="search">
  <input id="find" type="search" placeholder="Find a concept (pools, zoom, shells…)" aria-label="Find a concept">
  <button type="button" id="mine" aria-pressed="false">Only the user's designs</button>
</div>
${sections}
<footer>Kept true by <code>test/concepts.test.ts</code> (a pointer that no longer holds fails <code>npm test</code>). Made by <code>experiments/v2/concepts-page.mjs</code>: <code>npm run build &amp;&amp; node experiments/v2/concepts-page.mjs</code>. Change the concepts in <code>src/v2/concepts.ts</code>, not this page.</footer>
</main>
<script>
const find = document.getElementById('find'), mine = document.getElementById('mine');
const apply = () => {
  const words = find.value.trim().toLowerCase(), only = mine.getAttribute('aria-pressed') === 'true';
  for (const card of document.querySelectorAll('.card')) card.hidden = (words && !card.dataset.text.includes(words)) || (only && !card.querySelector('.badge'));
  for (const layer of document.querySelectorAll('.layer')) layer.hidden = ![...layer.querySelectorAll('.card')].some(card => !card.hidden);
  for (const stage of document.querySelectorAll('.stage')) stage.hidden = ![...stage.querySelectorAll('.layer')].some(layer => !layer.hidden);
};
find.addEventListener('input', apply);
mine.addEventListener('click', () => { mine.setAttribute('aria-pressed', String(mine.getAttribute('aria-pressed') !== 'true')); apply(); });
</script>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? join(repository, 'docs', 'v2', 'concepts.html');
  await writeFile(out, await conceptsPage());
  console.log(`written ${out}`);
}
