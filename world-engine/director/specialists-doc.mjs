// The specialists' registry (specialists.mjs) written into the design: the tables of docs/v2/next-steps.md (A5) and the
// sections of docs/v2/summarizer-faculties.html, each between its <!-- specialists:start --> and <!-- specialists:end -->
// markers. Run after changing the registry; the docs are never edited there by hand.
//   node world-engine/director/specialists-doc.mjs [--check]
// --check: exits 1 if a doc differs from what the registry writes (for the tests).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, QUIET, DIRECTORS, FACULTIES, FLOW, GATES, LAWS, LOG_KINDS, SIGNALS, STATE, registryProblems, target } from './specialists.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = '<!-- specialists:start -->', END = '<!-- specialists:end -->';
export const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const firedBy = faculty => faculty.always ? `always (each ${faculty.always})` : [...(faculty.types ?? []).map(type => BLOCK_TYPES[type].label), ...(faculty.kinds ?? []).map(kind => `${kind} sentences`), ...(faculty.signals ?? []).map(signal => SIGNALS[signal].label)].join(', ');
export const readers = id => Object.entries(DIRECTORS).filter(([, director]) => director.reads.includes(id)).map(([key, director]) => ({ key, label: director.label, own: director.reads[0] === id }));
export const fires = type => Object.entries(FACULTIES).filter(([, faculty]) => faculty.types?.includes(type)).map(([, faculty]) => faculty.label);
export const metres = ([near, far]) => `${near}–${far >= 1000 ? `${far / 1000} km` : `${far} m`}`;
// A target in words: the record and its field, relation or event type.
const RECORD = { scene: 'Scene', stateChange: 'StateChange', relation: 'Relation', event: 'Event', entity: 'Entity', timeline: 'Timeline' };
const FILE = { scene: 'scenes', stateChange: 'state-changes', relation: 'relations', event: 'events', entity: 'entities', timeline: 'timelines' };
export const where = to => { const t = target(to); if (!t) return 'the run only'; return t.base === 'entity' ? `${t.a}.properties.${t.b}` : t.base === 'relation' ? `${t.a} relation` : t.base === 'event' ? `${t.a} event` : `${RECORD[t.base]}.${t.a}`; };
export const lands = entry => [entry.to, entry.also].filter(Boolean).map(where).join(' + ') || 'the run only';
export const lawsOf = entry => entry.laws.length ? entry.laws.join(', ') : '—';
/** Each ontology file, and which directors' state reaches it. */
export const intoFiles = () => { const out = new Map(); for (const [id, states] of Object.entries(STATE)) for (const entry of states) for (const to of [entry.to, entry.also].filter(Boolean)) { const file = FILE[target(to).base]; (out.get(file) ?? out.set(file, new Map()).get(file)).set(id, [...(out.get(file).get(id) ?? []), entry.state]); } return out; };

/** The markdown for next-steps.md. */
export function markdown() {
  const lines = ['_Written from `world-engine/director/specialists.mjs` by `specialists-doc.mjs`; change the registry, not this._', ''];
  lines.push('**Block types** (Jev, in the kinds pass, as one distribution a window):', '', '| Type | What it is | In volume 1 | Fires |', '|---|---|---|---|');
  for (const [id, type] of Object.entries(BLOCK_TYPES)) lines.push(`| ${type.label} | ${type.means} | ${type.volume1} | ${[...(QUIET.includes(id) ? ['fires no reader'] : []), ...fires(id)].join(', ')} |`);
  lines.push('', '**Summary faculties** (the work model reads the text) and the directors that play them (own: the director\'s first faculty):', '', '| Faculty | Fired by | Writes | Read by | Status |', '|---|---|---|---|---|');
  for (const [id, faculty] of Object.entries(FACULTIES)) lines.push(`| ${faculty.label} | ${firedBy(faculty)} | ${faculty.writes.join('; ')} | ${readers(id).map(entry => `${entry.label}${entry.own ? ' (own)' : ''}`).join(', ')} | ${faculty.status} |`);
  lines.push('', '**Specialist directors.** The stage manager always runs; action directors record action, read the scale faculty and hold a camera (one of them leads each beat); state directors keep what rides with people and things, with no zoom and no camera:', '', '| Director | Kind | Plays | Zoom | Camera | Asks Jev | Status |', '|---|---|---|---|---|---|---|');
  for (const director of Object.values(DIRECTORS)) lines.push(`| ${director.label} | ${director.kind} | ${director.role} | ${director.scale ? metres(director.scale) : '—'} | ${director.camera ?? '—'} | ${director.asks.map(ask => `${ask.name}${ask.status === 'built' ? ' (built)' : ask.status === 'partial' ? ' (partial)' : ''}`).join('; ')} | ${director.status} |`);
  lines.push('', '**State and the ontology.** What each director keeps as it plays, and how it flows:', '', ...FLOW.map((step, n) => `${n + 1}. **${step.step}**: ${step.what} (\`${step.code}\`)`), '', 'Gates: ' + Object.entries(GATES).map(([gate, what]) => `**${gate}**, ${what}`).join('; ') + '.', '');
  for (const [id, states] of Object.entries(STATE)) {
    lines.push(`*${DIRECTORS[id].label}*`, '', '| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |', '|---|---|---|---|---|---|---|');
    for (const entry of states) lines.push(`| ${entry.state}${entry.what ? ` (${entry.what})` : ''} | ${entry.log ?? '—'}${entry.log && !LOG_KINDS[entry.log].built ? ' (new)' : ''} | ${lawsOf(entry)} | ${entry.smoothed ? 'yes' : ''} | ${lands(entry)}${entry.schema ? ' (new field)' : ''}${entry.note ? `; ${entry.note}` : ''} | ${entry.gate} | ${entry.status} |`);
    lines.push('');
  }
  lines.push('Into each ontology file:', '', '| File | From |', '|---|---|');
  for (const [file, by] of intoFiles()) lines.push(`| \`${file}.jsonl\` | ${[...by].map(([id, states]) => `${DIRECTORS[id].label} (${states.join(', ')})`).join('; ')} |`);
  return lines.join('\n');
}

/** The HTML sections for the plan page: block types, the faculty-to-director matrix, the faculties, the directors. */
export function html() {
  const pill = status => `<span class="pill ${status === 'built' ? 'always' : status === 'partial' ? 'damp' : 'fired'}">${status}</span>`;
  const ids = Object.keys(DIRECTORS);
  const types = Object.entries(BLOCK_TYPES).map(([id, type]) => `<tr><td>${esc(type.label)}</td><td>${esc(type.means)}</td><td>${esc(type.volume1)}</td><td>${[...(QUIET.includes(id) ? ['<span class="pill damp">fires no reader</span>'] : []), ...fires(id).map(label => `<span class="pill fired">${esc(label)}</span>`)].join(' ')}</td></tr>`).join('\n');
  const matrix = Object.entries(FACULTIES).map(([id, faculty]) => `<tr><th scope="row">${esc(faculty.label)}<br><small>${esc(firedBy(faculty))}</small></th>${ids.map(key => { const k = DIRECTORS[key].reads.indexOf(id); return `<td class="cell">${k === 0 ? '<b title="its own">●</b>' : k > 0 ? '<span title="reads">○</span>' : ''}</td>`; }).join('')}</tr>`).join('\n');
  const faculties = Object.entries(FACULTIES).map(([id, faculty]) => `<div class="card ${faculty.always ? 'always' : 'fired'}"><span class="tag">${faculty.always ? `Always on · each ${faculty.always}` : 'Fired'}</span> ${pill(faculty.status)}<h3>${esc(faculty.label)}</h3><dl>
    <dt>Fired by</dt><dd>${esc(firedBy(faculty))}</dd><dt>Writes</dt><dd>${faculty.writes.map(esc).join('; ')}</dd><dt>Read by</dt><dd>${readers(id).map(entry => esc(entry.label)).join(', ')}</dd>${faculty.code ? `<dt>Code</dt><dd><code>${esc(faculty.code)}</code></dd>` : ''}</dl></div>`).join('\n');
  const KIND = { stage: 'Stage · always on', action: 'Action · reads the zoom, holds a camera', state: 'State · no zoom, no camera' };
  const directors = Object.values(DIRECTORS).map(director => `<div class="card ${director.kind === 'action' ? 'fired' : director.kind === 'stage' ? 'always' : 'damp'}"><span class="tag">${KIND[director.kind]}</span> ${pill(director.status)}<h3>${esc(director.label)}</h3><p>${esc(director.role)}</p><dl>
    ${director.scale ? `<dt>Zoom</dt><dd>${metres(director.scale)}</dd><dt>Camera</dt><dd>${esc(director.camera)}</dd>` : ''}<dt>Plays</dt><dd>${director.reads.map(id => esc(FACULTIES[id].label)).join(', ')}</dd>
    <dt>Asks Jev</dt><dd><ul class="asks">${director.asks.map(ask => `<li>${pill(ask.status)} ${esc(ask.name)}${ask.what ? ` <span class="note">(${esc(ask.what)})</span>` : ''}</li>`).join('')}</ul></dd><dt>Tools</dt><dd>${director.tools.map(esc).join('; ')}</dd></dl></div>`).join('\n');
  return `<p class="note">Written from <code>world-engine/director/specialists.mjs</code> by <code>specialists-doc.mjs</code>: the registry is the design.</p>
<h2>Block types</h2>
<p>A block is a window of about 12 sentences, moving 6 at a time. Jev answers its type with a distribution kept whole, so a block can be 0.5 confrontation and 0.4 pursuit, and both faculties fire.</p>
<div class="scroll"><table><thead><tr><th>Type</th><th>What it is</th><th>In volume 1</th><th>Fires</th></tr></thead><tbody>
${types}
</tbody></table></div>
<h2>Faculties and specialist directors</h2>
<p>Faculties are the work model reading the text; directors are Jev deciding. Each director owns one faculty (●) and plays others' claims (○). The scale-and-view faculty goes only to the action directors, whose camera operators frame each beat at the zoom and angle it recommends. The stage manager chooses which action director leads each beat; state directors (character, transport, architect) answer their own questions with no zoom and no camera.</p>
<div class="scroll"><table class="matrix"><thead><tr><th>Faculty · fired by</th>${ids.map(key => `<th>${esc(DIRECTORS[key].label)}</th>`).join('')}</tr></thead><tbody>
${matrix}
</tbody></table></div>
<h3>The faculties</h3>
<div class="grid">
${faculties}
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
  for (const [file, inner] of [[join(repository, 'docs', 'v2', 'next-steps.md'), markdown()], [join(repository, 'docs', 'v2', 'summarizer-faculties.html'), html()]]) {
    const before = await readFile(file, 'utf8'), after = between(before, inner);
    if (after === before) continue;
    stale++;
    if (!check) await writeFile(file, after);
    console.log(`${check ? 'stale' : 'written'}: ${file.slice(repository.length + 1)}`);
  }
  if (check && stale) process.exit(1);
}
