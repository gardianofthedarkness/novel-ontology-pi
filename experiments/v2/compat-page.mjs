// The street compatibility reference page (docs/v2/street-compatibility.html; docs/v2/world-engine-v2.md §2.0.15), made
// from the code's own tables, so it is made again whenever they change: which street kinds may share ground (OVERLAPS in
// src/v2/context/terrainModes.ts), which building uses each street kind's buildings take (LANDSCAPES' uses in
// src/ground/stage/landscape.ts), the words that give a building its use (the language profile, src/v2/rules/language.ts),
// and which 3D models stand for each use (src/ground/stage/useModels.ts, over apps/playground/src/data/architectureModels.json).
//
//   npm run build && node experiments/v2/compat-page.mjs [out.html]
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const esc = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

export async function compatPage() {
  const T = await load('dist/src/v2/context/terrainModes.js'), { LANDSCAPES } = await load('dist/src/ground/stage/landscape.js');
  const { USE_MODELS, BUILT_SHAPES, UNDERGROUND_MODELS } = await load('dist/src/ground/stage/useModels.js'), { ZH } = await load('dist/src/v2/rules/language.js');
  const U = await load('dist/src/ground/stage/underground.js');
  const library = JSON.parse(await readFile(join(repository, 'apps/playground/src/data/architectureModels.json'), 'utf8'));
  const themes = JSON.parse(await readFile(join(repository, 'apps/playground/src/data/modelThemes.json'), 'utf8'));
  const commit = (() => { try { return execFileSync('git', ['-C', repository, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();

  // The street level's kinds as Jev is offered them, the ground each builds, and the shapes that share its ground.
  const kinds = Object.entries(T.terrainKinds('street', {})).map(([id]) => ({ id, ground: T.terrainKind('street', id)?.ground ?? id, hint: T.terrainKind('street', id)?.hint ?? '' }));
  const shapes = ['platform', 'ramp', 'cut', 'basin'];
  const across = [...kinds.map(kind => kind.id), ...shapes];
  // Each kind's uses, as shares of its row buildings; a form's own pieces (a centre's podium and towers, a station's hall).
  const PIECES = { centre: ['mall', 'office'], station: ['station'] };
  const usesOf = kind => { const list = LANDSCAPES[kind.ground]?.uses ?? [], counts = {}; for (const use of list) counts[use] = (counts[use] ?? 0) + 1 / list.length; return { counts, pieces: PIECES[kind.ground] ?? [], form: !!list.length }; };
  const words = Object.fromEntries(ZH.buildingUses.map(([pattern, use]) => [use, pattern.source.split('|').map(word => word.replace(/[$^]/g, ''))]));
  const uses = Object.keys(USE_MODELS);
  const streetsWith = use => kinds.filter(kind => usesOf(kind).counts[use] || usesOf(kind).pieces.includes(use)).map(kind => kind.id);
  const modelUses = {};
  for (const [use, entry] of Object.entries(USE_MODELS)) for (const [fit, list] of [['own', entry.own], ['stand-in', entry.standIn]]) for (const model of list) (modelUses[model] ??= []).push(`${use}${fit === 'stand-in' ? ' (stand-in)' : ''}`);
  const missing = [...Object.values(USE_MODELS), ...Object.values(UNDERGROUND_MODELS)].flatMap(entry => [...entry.own, ...entry.standIn]).filter(model => !library.models[model] && !BUILT_SHAPES[model]);
  if (missing.length) throw new Error(`USE_MODELS names models the library does not have: ${[...new Set(missing)].join(', ')}`);

  const overlapRows = across.map(a => `<tr><th scope="row">${esc(a)}</th>${across.map(b => { const may = T.mayOverlap(a, b); return `<td class="${may ? 'yes' : 'no'}" title="${esc(`${a} × ${b}: ${may ? 'may share ground' : 'may not'}`)}">${may ? '●' : '·'}</td>`; }).join('')}</tr>`).join('');
  const useRows = uses.map(use => {
    const cells = kinds.map(kind => { const { counts, pieces, form } = usesOf(kind); if (!form && !pieces.length) return '<td class="none">—</td>'; const share = counts[use] ?? 0, piece = pieces.includes(use); return share || piece ? `<td class="share" style="--w:${Math.round(Math.max(share, piece ? 0.25 : 0) * 100)}%">${share ? `${Math.round(share * 100)}%` : ''}${piece ? `<span class="piece">piece</span>` : ''}</td>` : '<td></td>'; }).join('');
    const nowhere = !streetsWith(use).length;
    return `<tr${nowhere ? ' class="nowhere"' : ''}><th scope="row">${esc(use)}${nowhere ? '<span class="flag">Jev</span>' : ''}</th>${cells}</tr>`;
  }).join('');
  const modelRows = uses.map(use => {
    const entry = USE_MODELS[use], chip = (model, fit) => `<span class="chip ${fit}" title="${esc(BUILT_SHAPES[model] ?? library.credits?.[model] ?? '')}">${esc(model)}${BUILT_SHAPES[model] ? ' ✦' : ''}</span>`;
    const fit = entry.own.length ? 'own' : entry.standIn.length ? 'stand-in' : 'gap';
    return `<tr><th scope="row">${esc(use)}</th><td><span class="fit ${fit}">${fit}</span></td><td class="models">${entry.own.length > 6 ? `${entry.own.slice(0, 5).map(model => chip(model, 'own')).join('')}<span class="more">+${entry.own.length - 5} more</span>` : entry.own.map(model => chip(model, 'own')).join('')}${entry.standIn.map(model => chip(model, 'stand-in')).join('')}${entry.note ? `<span class="note">${esc(entry.note)}</span>` : ''}</td><td class="words" lang="zh">${esc((words[use] ?? []).join('、'))}</td><td>${esc(streetsWith(use).join(', ') || 'none: Jev plants it')}</td></tr>`;
  }).join('');
  const byCategory = {};
  for (const model of Object.keys(library.models).sort()) { const category = themes.models[model]?.category ?? 'uncategorised'; (byCategory[category] ??= []).push(model); }
  const libraryRows = Object.entries(byCategory).map(([category, models]) => `<tr><th scope="row">${esc(category)}</th><td class="models">${models.map(model => `<span class="chip ${modelUses[model] ? 'own' : 'unused'}" title="${esc([themes.models[model]?.theme, ...(modelUses[model] ?? [])].filter(Boolean).join(' · '))}">${esc(model)}</span>`).join('')}</td></tr>`).join('');
  // The underground: what each kind usually lies under, and its models (and what the web offers for a gap).
  const halls = Object.keys(U.LIES_UNDER), underWords = Object.fromEntries(ZH.undergroundKinds.map(([pattern, kind]) => [kind, pattern.source.split('|').map(word => word.replace(/[$^\\]/g, ''))]));
  const underRows = halls.map(kind => { const under = U.LIES_UNDER[kind], any = under.includes('*'); return `<tr><th scope="row" title="${esc(U.HALL_LABEL[kind])}">${esc(kind)}</th>${kinds.map(street => { const yes = any || under.includes(street.id); return `<td class="${yes ? 'yes' : 'no'}">${yes ? (any ? '○' : '●') : '·'}</td>`; }).join('')}</tr>`; }).join('');
  const underModelRows = halls.map(kind => {
    const entry = UNDERGROUND_MODELS[kind] ?? { own: [], standIn: [] }, chip = (model, fit) => `<span class="chip ${fit}">${esc(model)}</span>`;
    const fit = entry.own.length ? 'own' : entry.standIn.length ? 'stand-in' : 'gap';
    const found = (entry.candidates ?? []).map(candidate => `<span class="note">web: <a href="${esc(candidate.url)}">${esc(candidate.name)}</a>, ${esc(candidate.licence)}; ${esc(candidate.has)}</span>`).join('');
    return `<tr><th scope="row">${esc(kind)}</th><td>${esc(U.HALL_LABEL[kind])}</td><td><span class="fit ${fit}">${fit}</span></td><td class="models">${entry.own.map(model => chip(model, 'own')).join('')}${entry.standIn.map(model => chip(model, 'stand-in')).join('')}${entry.note ? `<span class="note">${esc(entry.note)}</span>` : ''}${found}</td><td class="words" lang="zh">${esc((underWords[kind] ?? []).join('、'))}</td></tr>`;
  }).join('');
  const counts = { own: uses.filter(use => USE_MODELS[use].own.length).length, standIn: uses.filter(use => !USE_MODELS[use].own.length && USE_MODELS[use].standIn.length).length, gap: uses.filter(use => !USE_MODELS[use].own.length && !USE_MODELS[use].standIn.length).length };
  const unused = Object.keys(library.models).filter(model => !modelUses[model]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Street Compatibility</title>
<meta name="description" content="Which street kinds may share ground, which building uses each street kind holds, and which 3D models stand for each use.">
<style>
:root { --bg: #f6f7f4; --panel: #ffffff; --fg: #1d2421; --muted: #5d6963; --rule: #dfe3dd; --accent: #1f6f5c; --accent-soft: #d8ece5; --warn: #9a5b12; --warn-soft: #f6e8d3; --gap: #a33a3a; --gap-soft: #f5dddd; --cell: #eef1ec; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101513; --panel: #161d1a; --fg: #e3e9e5; --muted: #95a49c; --rule: #26302b; --accent: #6fd0b3; --accent-soft: #173a31; --warn: #e3ad62; --warn-soft: #3a2c17; --gap: #f08a8a; --gap-soft: #3d1f1f; --cell: #1c2420; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #101513; --panel: #161d1a; --fg: #e3e9e5; --muted: #95a49c; --rule: #26302b; --accent: #6fd0b3; --accent-soft: #173a31; --warn: #e3ad62; --warn-soft: #3a2c17; --gap: #f08a8a; --gap-soft: #3d1f1f; --cell: #1c2420; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
main { grid-template-columns: minmax(0, 1fr); max-width: 1120px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
header { display: grid; gap: 6px; }
.eyebrow { font: 600 11px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 0; font-size: 30px; line-height: 1.15; text-wrap: balance; }
h2 { margin: 0; font-size: 19px; text-wrap: balance; }
p { margin: 0; max-width: 68ch; color: var(--muted); }
code { font: 13px ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
section { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 18px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; }
.stat { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; min-width: 120px; }
.stat b { display: block; font-size: 22px; }
.stat span { font-size: 12px; color: var(--muted); }
.scroll { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; font-size: 13px; }
th, td { border: 1px solid var(--rule); padding: 5px 7px; text-align: center; vertical-align: middle; }
thead th { font: 600 11px/1.2 ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted); background: var(--cell); }
.matrix thead th { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; padding: 7px 4px; }
tbody th { text-align: left; font-weight: 600; white-space: nowrap; background: var(--panel); position: sticky; left: 0; }
td.yes { background: var(--accent-soft); color: var(--accent); font-size: 15px; }
td.no { color: var(--muted); }
td.none { color: var(--muted); background: var(--cell); }
td.share { background: linear-gradient(90deg, var(--accent-soft) var(--w), transparent var(--w)); font-variant-numeric: tabular-nums; min-width: 58px; }
.piece { display: inline-block; margin-left: 4px; font: 600 10px/1 ui-monospace, monospace; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 1px 3px; }
tr.nowhere th { color: var(--warn); }
.flag { margin-left: 6px; font: 600 10px/1 ui-monospace, monospace; background: var(--warn-soft); color: var(--warn); border-radius: 3px; padding: 2px 4px; }
.wide td, .wide th { text-align: left; }
td.models { min-width: 260px; }
.models > * { display: inline-block; margin: 2px 4px 2px 0; }
.chip { font: 12px/1 ui-monospace, "SF Mono", Menlo, monospace; border-radius: 4px; padding: 4px 6px; border: 1px solid var(--rule); white-space: nowrap; }
.chip.own { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
.chip.stand-in { background: var(--warn-soft); border-color: transparent; color: var(--warn); }
.chip.unused { color: var(--muted); border-style: dashed; }
.more, .more, .note { font-size: 12px; color: var(--muted); align-self: center; }
a { color: var(--accent); }
.fit { font: 600 11px/1 ui-monospace, monospace; border-radius: 3px; padding: 3px 5px; white-space: nowrap; }
.fit.own { background: var(--accent-soft); color: var(--accent); } .fit.stand-in { background: var(--warn-soft); color: var(--warn); } .fit.gap { background: var(--gap-soft); color: var(--gap); }
.words { font-size: 13px; color: var(--muted); min-width: 140px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--muted); }
footer { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<main>
<header>
  <span class="eyebrow">World engine v2 · terrain · §2.0.15</span>
  <h1>Street compatibility</h1>
  <p>Which street kinds may share ground, which building uses each street kind's buildings take, and which 3D models stand for each use. Generated from the code at <code>${esc(commit)}</code> on ${new Date().toISOString().slice(0, 10)}; a first map at the street level, each level's to be worked out later.</p>
</header>
<div class="stats">
  <div class="stat"><b>${kinds.length}</b><span>street kinds</span></div>
  <div class="stat"><b>${uses.length}</b><span>building uses</span></div>
  <div class="stat"><b>${counts.own}</b><span>uses with their own model</span></div>
  <div class="stat"><b>${counts.standIn}</b><span>on a stand-in</span></div>
  <div class="stat"><b>${counts.gap}</b><span>with no model</span></div>
  <div class="stat"><b>${halls.length}</b><span>underground kinds</span></div>
  <div class="stat"><b>${Object.keys(library.models).length}</b><span>models in the library</span></div>
</div>

<section>
  <h2>Street × street: may they adjoin?</h2>
  <p>Compatible kinds may touch, not lie over each other: a box mostly over a compatible kept place is asked again, and compatible parts still overlapping are moved beside each other (the pool expanding, nothing vanishing). Before Jev boxes a pool's member, its suggested spot moves onto free ground; a box over an incompatible place is asked again. Either side may name the other. Anything kept below the street lies under anything. Across levels the tree decides: a street may not lie over a district that does not hold it. Source: <code>OVERLAPS</code>, <code>mayOverlap</code> in <code>src/v2/context/terrainModes.ts</code>; <code>CROWDED</code>, <code>nearestFree</code> in <code>src/v2/context/zoom.ts</code>.</p>
  <div class="legend"><span>● may adjoin</span><span>· may not touch</span></div>
  <div class="scroll"><table class="matrix"><thead><tr><th></th>${across.map(id => `<th scope="col">${esc(id)}</th>`).join('')}</tr></thead><tbody>${overlapRows}</tbody></table></div>
</section>

<section>
  <h2>Street kind × building use</h2>
  <p>Each street kind's form lays out its own buildings; each row building takes a use from its kind's list (the share shown), and a form's pieces have their own (a centre's mall podium and office towers, a station's hall). A building tied to a street by continuity dwells in one of its buildings of its use, Jev not asked; a use no street has (flagged) is always planted by Jev. Source: <code>uses</code> in <code>LANDSCAPES</code>, <code>src/ground/stage/landscape.ts</code>.</p>
  <div class="scroll"><table class="matrix"><thead><tr><th></th>${kinds.map(kind => `<th scope="col" title="${esc(kind.hint)}">${esc(kind.id)}${kind.ground !== kind.id ? ` → ${esc(kind.ground)}` : ''}</th>`).join('')}</tr></thead><tbody>${useRows}</tbody></table></div>
</section>

<section>
  <h2>Building use × 3D models</h2>
  <p>Which models of the library can draw each use: its own, or a stand-in until one is made; a gap is drawn as a plain block. ✦ marks a shape built from the library in <code>ArchitectureHolograms.tsx</code>. The words are the language profile's: a building whose name has one takes that use. Sources: <code>src/ground/stage/useModels.ts</code>, <code>src/v2/rules/language.ts</code>.</p>
  <div class="scroll"><table class="wide"><thead><tr><th>use</th><th>fit</th><th>models</th><th>words (zh)</th><th>streets that have it</th></tr></thead><tbody>${modelRows}</tbody></table></div>
</section>

<section>
  <h2>Underground × street: what lies under what</h2>
  <p>The city's common underground spaces, grouped as the literature does: transport (the subway's tunnels, stations and passages), commerce (an underground shopping street, under a road or under a station's plaza, as Japan's 地下街), parking, utilities (a utility tunnel, the storm water), a civil defence shelter (often a car park in peace), a building's basement, and the deep facilities. Each usually lies under the street kinds marked; anything kept below the street may share ground with anything above it. A part kept below the street becomes the hall its name says (the words below), else a passage or a hall by its proportions. Source: <code>LIES_UNDER</code> in <code>src/ground/stage/underground.ts</code>.</p>
  <div class="legend"><span>● usually under it</span><span>○ under any street</span><span>· seldom</span></div>
  <div class="scroll"><table class="matrix"><thead><tr><th></th>${kinds.map(kind => `<th scope="col">${esc(kind.id)}</th>`).join('')}</tr></thead><tbody>${underRows}</tbody></table></div>
</section>

<section>
  <h2>Underground type × 3D models</h2>
  <p>Which models dress each kind of hall in the terrain view (a passage's tunnel along it, the mall over a mall, the bunker over a shelter); a gap is drawn as its volume. Searched on the web (2026-10-31): one CC0 subway kit, not downloaded; no free car park, storm-water or basement model. Sources: <code>UNDERGROUND_MODELS</code> in <code>src/ground/stage/useModels.ts</code>, <code>undergroundKinds</code> in <code>src/v2/rules/language.ts</code>.</p>
  <div class="scroll"><table class="wide"><thead><tr><th>kind</th><th>what it is</th><th>fit</th><th>models</th><th>words (zh)</th></tr></thead><tbody>${underModelRows}</tbody></table></div>
</section>

<section>
  <h2>The model library</h2>
  <p>${esc(library.source)}, and KayKit's City Builder and Space Base Bits (CC0). Filled chips are used by a building use; dashed ones by none yet (${esc(unused.join(', ') || 'none')}). Source: <code>apps/playground/src/data/architectureModels.json</code>, <code>modelThemes.json</code>.</p>
  <div class="scroll"><table class="wide"><tbody>${libraryRows}</tbody></table></div>
</section>

<footer>Made by <code>experiments/v2/compat-page.mjs</code>: <code>npm run build &amp;&amp; node experiments/v2/compat-page.mjs</code>. Change the tables in the code, not this page.</footer>
</main>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? join(repository, 'docs', 'v2', 'street-compatibility.html');
  await writeFile(out, await compatPage());
  console.log(`written ${out}`);
}
