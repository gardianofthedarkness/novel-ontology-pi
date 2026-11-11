// The specialists' registry (specialists.mjs) written into the design: its section of docs/v3/design.html (§17.1),
// between the <!-- specialists:start --> and <!-- specialists:end --> markers. Run after changing the registry; the
// section is never edited there by hand.
//   node world-engine/director/specialists-doc.mjs [--check]
// --check: exits 1 if a doc differs from what the registry writes (for the tests).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, QUIET, DIRECTORS, CASTS, FLOW, GATES, LAWS, LOG_KINDS, SIGNALS, STATE, registryProblems, target } from './specialists.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = '<!-- specialists:start -->', END = '<!-- specialists:end -->';
export const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const firedBy = cast => cast.always ? `always (each ${cast.always})` : [...(cast.types ?? []).map(type => BLOCK_TYPES[type].label), ...(cast.kinds ?? []).map(kind => `${kind} sentences`), ...(cast.signals ?? []).map(signal => SIGNALS[signal].label)].join(', ');
export const readers = id => Object.entries(DIRECTORS).filter(([, director]) => director.reads.includes(id)).map(([key, director]) => ({ key, label: director.label, own: director.reads[0] === id }));
export const fires = type => Object.entries(CASTS).filter(([, cast]) => cast.types?.includes(type)).map(([, cast]) => cast.label);
export const metres = ([near, far]) => `${near}–${far >= 1000 ? `${far / 1000} km` : `${far} m`}`;
// A target in words: the record and its field, relation or event type.
const RECORD = { scene: 'Scene', stateChange: 'StateChange', relation: 'Relation', event: 'Event', entity: 'Entity', timeline: 'Timeline' };
const FILE = { scene: 'scenes', stateChange: 'state-changes', relation: 'relations', event: 'events', entity: 'entities', timeline: 'timelines' };
export const where = to => { const t = target(to); if (!t) return 'the run only'; return t.base === 'entity' ? `${t.a}.properties.${t.b}` : t.base === 'relation' ? `${t.a} relation` : t.base === 'event' ? `${t.a} event` : `${RECORD[t.base]}.${t.a}`; };
export const lands = entry => [entry.to, entry.also].filter(Boolean).map(where).join(' + ') || 'the run only';
export const lawsOf = entry => entry.laws.length ? entry.laws.join(', ') : '—';
/** Each ontology file, and which directors' state reaches it. */
export const intoFiles = () => { const out = new Map(); for (const [id, states] of Object.entries(STATE)) for (const entry of states) for (const to of [entry.to, entry.also].filter(Boolean)) { const file = FILE[target(to).base]; (out.get(file) ?? out.set(file, new Map()).get(file)).set(id, [...(out.get(file).get(id) ?? []), entry.state]); } return out; };

/** The HTML section of the design: block types, the cast-to-director matrix, the casts, the directors. */
export function html() {
  const pill = status => `<span class="pill ${status === 'built' ? 'always' : status === 'partial' ? 'damp' : 'fired'}">${status}</span>`;
  const ids = Object.keys(DIRECTORS);
  const types = Object.entries(BLOCK_TYPES).map(([id, type]) => `<tr><td>${esc(type.label)}</td><td>${esc(type.means)}</td><td>${esc(type.volume1)}</td><td>${[...(QUIET.includes(id) ? ['<span class="pill damp">fires no reader</span>'] : []), ...fires(id).map(label => `<span class="pill fired">${esc(label)}</span>`)].join(' ')}</td></tr>`).join('\n');
  const matrix = Object.entries(CASTS).map(([id, cast]) => `<tr><th scope="row">${esc(cast.label)}<br><small>${esc(firedBy(cast))}</small></th>${ids.map(key => { const k = DIRECTORS[key].reads.indexOf(id); return `<td class="cell">${k === 0 ? '<b title="its own">●</b>' : k > 0 ? '<span title="reads">○</span>' : ''}</td>`; }).join('')}</tr>`).join('\n');
  const casts = Object.entries(CASTS).map(([id, cast]) => `<div class="card ${cast.always ? 'always' : 'fired'}"><span class="tag">${cast.always ? `Always on · each ${cast.always}` : 'Fired'}</span> ${pill(cast.status)}<h3>${esc(cast.label)}</h3><dl>
    <dt>Fired by</dt><dd>${esc(firedBy(cast))}</dd><dt>Writes</dt><dd>${cast.writes.map(esc).join('; ')}</dd><dt>Read by</dt><dd>${readers(id).map(entry => esc(entry.label)).join(', ')}</dd>${cast.code ? `<dt>Code</dt><dd><code>${esc(cast.code)}</code></dd>` : ''}</dl></div>`).join('\n');
  const KIND = { stage: 'Stage · always on', action: 'Action · reads the zoom, holds a camera', state: 'State · no zoom, no camera' };
  const directors = Object.values(DIRECTORS).map(director => `<div class="card ${director.kind === 'action' ? 'fired' : director.kind === 'stage' ? 'always' : 'damp'}"><span class="tag">${KIND[director.kind]}</span> ${pill(director.status)}<h3>${esc(director.label)}</h3><p>${esc(director.role)}</p><dl>
    ${director.scale ? `<dt>Zoom</dt><dd>${metres(director.scale)}</dd><dt>Camera</dt><dd>${esc(director.camera)}</dd>` : ''}<dt>Plays</dt><dd>${director.reads.map(id => esc(CASTS[id].label)).join(', ')}</dd>
    <dt>Asks Jev</dt><dd><ul class="asks">${director.asks.map(ask => `<li>${pill(ask.status)} ${esc(ask.name)}${ask.what ? ` <span class="note">(${esc(ask.what)})</span>` : ''}</li>`).join('')}</ul></dd><dt>Tools</dt><dd>${director.tools.map(esc).join('; ')}</dd></dl></div>`).join('\n');
  return `<p class="note">Written from <code>world-engine/director/specialists.mjs</code> by <code>specialists-doc.mjs</code>: the registry is the design.</p>
<h2>Block types</h2>
<p>A block is a window of about 12 sentences, moving 6 at a time. Jev answers its type with a distribution kept whole, so a block can be 0.5 confrontation and 0.4 pursuit, and both casts fire.</p>
<div class="scroll"><table><thead><tr><th>Type</th><th>What it is</th><th>In volume 1</th><th>Fires</th></tr></thead><tbody>
${types}
</tbody></table></div>
<h2>Casts and specialist directors</h2>
<p>Casts are the work model reading the text; directors are Jev deciding. Each director owns one cast (●) and plays others' claims (○). The scale-and-view cast goes only to the action directors, whose camera operators frame each beat at the zoom and angle it recommends. The stage manager chooses which action director leads each beat; state directors (character, transport, architect) answer their own questions with no zoom and no camera.</p>
<div class="scroll"><table class="matrix"><thead><tr><th>Cast · fired by</th>${ids.map(key => `<th>${esc(DIRECTORS[key].label)}</th>`).join('')}</tr></thead><tbody>
${matrix}
</tbody></table></div>
<h3>The casts</h3>
<div class="grid">
${casts}
</div>
<h3>The directors</h3>
<div class="grid">
${directors}
</div>
<h2>State and the ontology</h2>
<p>Each director keeps a state as it plays. None of it is written into the ontology directly: it goes through the world log, the laws, the smoother and the ledger, and a gate decides whether canon writes it, the review sees it first, or it stays with the run.</p>
<ol class="flow-steps">${FLOW.map(step => `<li><b>${esc(step.step)}</b><span>${esc(step.what)}</span><code>${esc(step.code)}</code></li>`).join('')}</ol>
<div class="gates">${Object.entries(GATES).map(([gate, what]) => `<div class="gate-${gate}"><b>${gate}</b> ${esc(what)}</div>`).join('')}</div>
${Object.entries(STATE).map(([id, states]) => `<h3>${esc(DIRECTORS[id].label)}</h3>
<div class="scroll"><table class="state"><thead><tr><th>State</th><th>World log</th><th>Laws</th><th>Into the ontology</th><th>Gate</th><th>Status</th></tr></thead><tbody>
${states.map(entry => `<tr><td>${esc(entry.state)}${entry.what ? `<br><small>${esc(entry.what)}</small>` : ''}</td><td>${entry.log ? `<code>${esc(entry.log)}</code>${LOG_KINDS[entry.log].built ? '' : ' <small>new</small>'}` : '—'}${entry.smoothed ? '<br><small>smoothed</small>' : ''}</td><td>${entry.laws.map(law => `<span title="${esc(LAWS[law])}">${law}</span>`).join(', ') || '—'}</td><td>${esc(lands(entry))}${entry.schema ? ' <small>(new field)</small>' : ''}${entry.note ? `<br><small>${esc(entry.note)}</small>` : ''}</td><td><span class="pill ${entry.gate === 'applied' ? 'always' : entry.gate === 'held' ? 'damp' : ''}">${entry.gate}</span></td><td>${pill(entry.status)}</td></tr>`).join('\n')}
</tbody></table></div>`).join('\n')}
<h3>Into each ontology file</h3>
<div class="scroll"><table><thead><tr><th>File</th><th>From</th></tr></thead><tbody>
${[...intoFiles()].map(([file, by]) => `<tr><td><code>${file}.jsonl</code></td><td>${[...by].map(([id, states]) => `<b>${esc(DIRECTORS[id].label)}</b>: ${states.map(esc).join(', ')}`).join('<br>')}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

const between = (text, inner) => { const a = text.indexOf(START), b = text.indexOf(END); if (a < 0 || b < a) throw new Error('no specialists markers'); return `${text.slice(0, a + START.length)}\n${inner}\n${text.slice(b)}`; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = registryProblems();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [file, inner] of [[join(repository, 'docs', 'v3', 'design.html'), html()]]) {
    const before = await readFile(file, 'utf8'), after = between(before, inner);
    if (after === before) continue;
    stale++;
    if (!check) await writeFile(file, after);
    console.log(`${check ? 'stale' : 'written'}: ${file.slice(repository.length + 1)}`);
  }
  if (check && stale) process.exit(1);
}
