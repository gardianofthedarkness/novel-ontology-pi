// M3 (docs/v2/next-steps.md A6): the gate over a reading. Every block of twelve sentences, with its block types (M2),
// its sentences' kinds (M1) and the reading's signals in it, read by the registry's mixed index (firing()); the beats
// smoothed per strand (beats.mjs); who leads each beat (lead()). Faculties co-fire wherever their evidence is. Writes
// gate.json beside the reading and, with --docs, the strip page and the vault note (numbers and ids only, no text).
//   node world-engine/director/gate.mjs <reading>/v2/data.json [--strands <novel>/stage/world/strands.json] [--docs]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BLOCK_TYPES, DIRECTORS, FACULTIES, firing, lead } from './specialists.mjs';
import { beatsOf, smooth } from './beats.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const round = value => Math.round(value * 1000) / 1000;

/** The windows of a reading: its blocks in reading order, each with its sentences' kinds and the signals in it. */
export function windowsOf(reading) {
  const position = new Map(reading.scenes.flatMap(scene => scene.sentences).map((id, n) => [id, n]));
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const mentions = (list, test) => list.filter(test).map(entry => new Set(entry.sentences ?? [entry.sentence]));
  const signal = { vehicles: mentions(reading.references ?? [], entry => entry.type === 'vehicle'), weapons: mentions(reading.references ?? [], entry => entry.type === 'weapon'), crowds: mentions(reading.references ?? [], entry => entry.type === 'crowd'),
    buildings: [...mentions(reading.places?.references ?? [], () => true), ...mentions(reading.spatial ?? [], () => true)] };
  return [...(reading.blocks ?? [])].sort((a, b) => position.get(a.first) - position.get(b.first)).map(block => {
    const tally = new Map(); for (const id of block.sentences) tally.set(sceneOf.get(id), (tally.get(sceneOf.get(id)) ?? 0) + 1);
    return { first: block.first, last: block.last, scene: [...tally].sort((a, b) => b[1] - a[1])[0][0], block: { distribution: block.distribution, confidence: block.confidence, type: block.type },
      sentences: block.sentences.map(id => ({ distribution: reading.kinds?.[id]?.distribution ?? { [reading.kinds?.[id]?.kind ?? 'narration']: 1 }, confidence: reading.kinds?.[id]?.confidence ?? 0.5 })),
      signals: Object.fromEntries(Object.entries(signal).map(([name, sets]) => [name, sets.filter(set => block.sentences.some(id => set.has(id))).length])) };
  });
}

/** The gate over a reading's windows: fired faculties, indexes, beats with their leads, coverage. */
export function gateOf(windows, { strandOf = () => 'the book' } = {}) {
  // The block types smoothed per strand (beats.mjs smooth()): each strand's blocks in story order, across its scenes; the
  // raw answer kept as `asked`. The index and the beats read the smoothed distributions.
  const byStrand = new Map();
  windows.forEach((window, n) => { const strand = strandOf(window.scene) ?? 'the book'; (byStrand.get(strand) ?? byStrand.set(strand, []).get(strand)).push(n); });
  const smoothed = new Array(windows.length);
  for (const indexes of byStrand.values()) smooth(indexes.map(n => windows[n].block), { cuts: indexes.map((n, k) => k > 0 && windows[n].scene !== windows[indexes[k - 1]].scene) }).forEach((entry, k) => { smoothed[indexes[k]] = entry; });
  windows = windows.map((window, n) => ({ ...window, block: { ...smoothed[n], asked: { type: window.block.type, distribution: window.block.distribution, confidence: window.block.confidence } } }));
  const fired = firing(windows), types = windows.map(window => window.block.type), scenes = windows.map(window => window.scene);
  const leads = windows.map((window, n) => lead(fired, n, window.block.type));
  const beats = beatsOf(types, scenes).map(beat => {
    const span = leads.slice(beat.from, beat.to + 1), count = new Map();
    for (const entry of span) count.set(entry.lead, (count.get(entry.lead) ?? 0) + 1);
    return { ...beat, first: windows[beat.from].first, last: windows[beat.to].last, lead: [...count].sort((a, b) => b[1] - a[1])[0][0], with: [] };
  }).map(beat => {
    const span = leads.slice(beat.from, beat.to + 1);
    return { ...beat, with: [...new Set(span.flatMap(entry => [entry.lead, ...entry.with]))].filter(id => id !== beat.lead) };
  });
  const faculties = Object.keys(FACULTIES).filter(id => !FACULTIES[id].always);
  return {
    windows: windows.map((window, n) => ({ first: window.first, last: window.last, scene: window.scene, strand: strandOf(window.scene) ?? 'the book', type: window.block.type, confidence: window.block.confidence, asked: window.block.asked.type, beat: types[n], lead: leads[n].lead, with: leads[n].with,
      fired: faculties.filter(id => fired[id][n]), index: Object.fromEntries(faculties.map(id => [id, round(fired.index[id][n])])), signals: window.signals })),
    beats,
    coverage: Object.fromEntries(faculties.map(id => [id, round(fired[id].filter(Boolean).length / (windows.length || 1))])),
  };
}

/** The strip page: each faculty's index and firing over the book, the beats by type, the leads; a scene picker. */
export function stripPage(gate, title) {
  const data = JSON.stringify({ windows: gate.windows.map(window => [window.scene, window.first, window.beat, window.lead, 0, ...Object.keys(window.index).map(id => window.index[id]), window.fired.join(',')]), faculties: Object.keys(gate.windows[0]?.index ?? {}), labels: Object.fromEntries(Object.entries(FACULTIES).map(([id, f]) => [id, f.label])), types: Object.keys(BLOCK_TYPES), directors: Object.fromEntries(Object.entries(DIRECTORS).map(([id, d]) => [id, d.label])), coverage: gate.coverage });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--bg:#f4f1ea;--surface:#fffdf8;--ink:#1d2430;--muted:#5d6573;--line:#d9d2c4;--on:#3f4fb8;--damp:#9a5b00;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1419;--surface:#161d25;--ink:#e6e9ee;--muted:#9aa5b4;--line:#2b3642;--on:#a3b0ff;--damp:#f2b45a;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"PingFang SC",sans-serif}main{max-width:1200px;margin:auto;padding:20px max(16px,env(safe-area-inset-left))}
h1{font-family:Georgia,serif;margin:.2em 0}.note{color:var(--muted);font-size:.9rem}.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}
select{font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:6px}svg{display:block}table{border-collapse:collapse;font-size:.9rem}td,th{padding:4px 10px;border-bottom:1px solid var(--line);text-align:left}
</style></head><body><main><h1>${title}</h1><p class="note">Generated by <code>world-engine/director/gate.mjs</code> from the reading (numbers and ids only). Rows: each fired faculty's mixed index (strong where it fires), the beats by block type, and the lead director. Choose a scene to look closer.</p>
<p><label>Scene <select id="pick"><option value="">the whole volume</option></select></label> <span id="read" class="note"></span></p><div class="panel"><svg id="strip"></svg></div><h2>Coverage</h2><table id="cov"></table></main><script>
const D=${data};const pick=document.getElementById("pick"),svg=document.getElementById("strip"),ns="http://www.w3.org/2000/svg";
const scenes=[...new Set(D.windows.map(w=>w[0]))];pick.innerHTML+=scenes.map(s=>'<option>'+s+'</option>').join("");
const hue=t=>(D.types.indexOf(t)*40)%360,el=(t,a)=>{const e=document.createElementNS(ns,t);for(const k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e};
function draw(){svg.replaceChildren();const ws=D.windows.filter(w=>!pick.value||w[0]===pick.value),N=ws.length,W=Math.max(900,N*8),row=22,L=150;svg.setAttribute("width",W+L);const rows=[...D.faculties.map(f=>D.labels[f]),"beat","lead"];svg.setAttribute("height",rows.length*row+20);
rows.forEach((r,i)=>{const t=el("text",{x:2,y:i*row+15,"font-size":11,fill:"var(--muted)"});t.textContent=r});
ws.forEach((w,n)=>{const x=L+n*W/N,cw=W/N+.3;D.faculties.forEach((f,i)=>{const v=w[5+i],on=w[5+D.faculties.length].split(",").includes(f);el("rect",{x,y:i*row+3,width:cw,height:row-6,fill:"var(--on)",opacity:on?.95:Math.max(0,Math.min(.3,(v+1)/8))}).appendChild(document.createElementNS(ns,"title")).textContent=w[0]+" "+w[1]+" · "+D.labels[f]+" "+v});
const b=D.faculties.length;el("rect",{x,y:b*row+3,width:cw,height:row-6,fill:"hsl("+hue(w[2])+" 55% 50%)"}).appendChild(document.createElementNS(ns,"title")).textContent=w[0]+" · "+w[2];
const l=el("text",{x:x+1,y:(b+1)*row+15,"font-size":9,fill:"var(--ink)"});if(n===0||ws[n-1][3]!==w[3])l.textContent=(D.directors[w[3]]||w[3]).split(" ")[0];

if(n===0||ws[n-1][0]!==w[0])el("line",{x1:x,x2:x,y1:0,y2:rows.length*row,stroke:"var(--line)"})});
document.getElementById("read").textContent=N+" blocks"+(pick.value?"":" · "+scenes.length+" scenes")}
pick.onchange=draw;draw();document.getElementById("cov").innerHTML="<tr><th>Faculty</th><th>Reads</th></tr>"+Object.entries(D.coverage).map(([f,c])=>"<tr><td>"+D.labels[f]+"</td><td>"+Math.round(c*100)+"%</td></tr>").join("");
</script></body></html>`;
}

/** The vault note: coverage, and each scene's beats with their leads (to check on the strip). */
export function gateNote(gate, title) {
  const label = id => DIRECTORS[id]?.label ?? id, lines = [`<!-- Written by world-engine/director/gate.mjs from the reading; run it again, never edit this. -->`, '', `# ${title}`, '', 'The gate over volume 1 (M3): each faculty\'s mixed index over the blocks, the beats decoded per scene, the lead of each beat. The strip: [gate-volume-1.html](gate-volume-1.html). Back to [Directing](Directing.md).', '', '## How much each faculty reads', '', '| Faculty | Share of the volume |', '|---|---|'];
  for (const [id, share] of Object.entries(gate.coverage)) lines.push(`| ${FACULTIES[id].label} | ${Math.round(share * 100)}% |`);
  lines.push('', '## Beats by scene', '', '| Scene | Beats (type → lead) |', '|---|---|');
  for (const scene of [...new Set(gate.beats.map(beat => beat.scene))]) lines.push(`| ${scene} | ${gate.beats.filter(beat => beat.scene === scene).map(beat => `${BLOCK_TYPES[beat.type] ? beat.type : '?'} → ${label(beat.lead)}${beat.with.length ? ` (with ${beat.with.map(label).join(', ')})` : ''}`).join('; ')} |`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [readingPath] } = parseArgs({ allowPositionals: true, options: { docs: { type: 'boolean' }, strands: { type: 'string' } } });
  if (!readingPath) { console.error('usage: node world-engine/director/gate.mjs <reading>/v2/data.json [--strands strands.json] [--docs]'); process.exit(2); }
  const reading = JSON.parse(await readFile(readingPath, 'utf8'));
  if (!reading.blocks?.length) { console.error('the reading has no blocks yet (M2: experiments/v2/block-types.mjs)'); process.exit(2); }
  // The story's strands (a workspace's stage/world/strands.json): each scene's fork; without them, the book is one strand.
  const strands = values.strands ? JSON.parse(await readFile(values.strands, 'utf8')) : null, forkOf = new Map((strands?.scenes ?? []).map(entry => [entry.id, entry.fork]));
  const gate = gateOf(windowsOf(reading), { strandOf: scene => forkOf.get(scene) ?? null });
  await writeFile(join(dirname(resolve(readingPath)), 'gate.json'), JSON.stringify({ version: 1, ...gate }));
  if (values.docs) {
    const folder = join(repository, 'docs', 'v2', 'directing');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'gate-volume-1.html'), stripPage(gate, 'Gate · Volume 1'));
    await writeFile(join(folder, 'Gate.md'), gateNote(gate, 'Gate · Volume 1'));
  }
  console.log(JSON.stringify({ windows: gate.windows.length, beats: gate.beats.length, coverage: gate.coverage }));
}
