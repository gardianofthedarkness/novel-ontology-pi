// The specialists' registry (specialists.mjs) written into the design: the tables of docs/v2/next-steps.md (A5) and the
// sections of docs/v2/summarizer-faculties.html, each between its <!-- specialists:start --> and <!-- specialists:end -->
// markers. Run after changing the registry; the docs are never edited there by hand.
//   node world-engine/director/specialists-doc.mjs [--check]
// --check: exits 1 if a doc differs from what the registry writes (for the tests).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, DAMPING, DIRECTORS, FACULTIES, SIGNALS, registryProblems } from './specialists.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = '<!-- specialists:start -->', END = '<!-- specialists:end -->';
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const firedBy = faculty => faculty.always ? `always (each ${faculty.always})` : [...(faculty.types ?? []).map(type => BLOCK_TYPES[type].label), ...(faculty.signals ?? []).map(signal => SIGNALS[signal].label)].join(', ');
const readers = id => Object.entries(DIRECTORS).filter(([, director]) => director.reads.includes(id)).map(([key, director]) => ({ key, label: director.label, own: director.reads[0] === id }));
const fires = type => Object.entries(FACULTIES).filter(([, faculty]) => faculty.types?.includes(type)).map(([, faculty]) => faculty.label);
const metres = ([near, far]) => `${near}–${far >= 1000 ? `${far / 1000} km` : `${far} m`}`;

/** The markdown for next-steps.md. */
export function markdown() {
  const lines = ['_Written from `world-engine/director/specialists.mjs` by `specialists-doc.mjs`; change the registry, not this._', ''];
  lines.push('**Block types** (Jev, in the kinds pass, as one distribution a window):', '', '| Type | What it is | In volume 1 | Fires |', '|---|---|---|---|');
  for (const [id, type] of Object.entries(BLOCK_TYPES)) lines.push(`| ${type.label} | ${type.means} | ${type.volume1} | ${[...(DAMPING.includes(id) ? ['damps the world'] : []), ...fires(id)].join(', ')} |`);
  lines.push('', '**Summary faculties** (the work model reads the text) and the directors that play them (own: the director\'s first faculty):', '', '| Faculty | Fired by | Writes | Read by | Status |', '|---|---|---|---|---|');
  for (const [id, faculty] of Object.entries(FACULTIES)) lines.push(`| ${faculty.label} | ${firedBy(faculty)} | ${faculty.writes.join('; ')} | ${readers(id).map(entry => `${entry.label}${entry.own ? ' (own)' : ''}`).join(', ')} | ${faculty.status} |`);
  lines.push('', '**Specialist directors** (Jev, on pictures framed at their scale):', '', '| Director | Plays | Scale | Camera | Asks Jev | Status |', '|---|---|---|---|---|---|');
  for (const director of Object.values(DIRECTORS)) lines.push(`| ${director.label}${director.always ? ' (always)' : ''} | ${director.role} | ${metres(director.scale)} | ${director.camera} | ${director.asks.map(ask => `${ask.name}${ask.status === 'built' ? ' (built)' : ask.status === 'partial' ? ' (partial)' : ''}`).join('; ')} | ${director.status} |`);
  return lines.join('\n');
}

/** The HTML sections for the plan page: block types, the faculty-to-director matrix, the faculties, the directors. */
export function html() {
  const pill = status => `<span class="pill ${status === 'built' ? 'always' : status === 'partial' ? 'damp' : 'fired'}">${status}</span>`;
  const ids = Object.keys(DIRECTORS);
  const types = Object.entries(BLOCK_TYPES).map(([id, type]) => `<tr><td>${esc(type.label)}</td><td>${esc(type.means)}</td><td>${esc(type.volume1)}</td><td>${[...(DAMPING.includes(id) ? ['<span class="pill damp">damps the world</span>'] : []), ...fires(id).map(label => `<span class="pill fired">${esc(label)}</span>`)].join(' ')}</td></tr>`).join('\n');
  const matrix = Object.entries(FACULTIES).map(([id, faculty]) => `<tr><th scope="row">${esc(faculty.label)}<br><small>${esc(firedBy(faculty))}</small></th>${ids.map(key => { const k = DIRECTORS[key].reads.indexOf(id); return `<td class="cell">${k === 0 ? '<b title="its own">●</b>' : k > 0 ? '<span title="reads">○</span>' : ''}</td>`; }).join('')}</tr>`).join('\n');
  const faculties = Object.entries(FACULTIES).map(([id, faculty]) => `<div class="card ${faculty.always ? 'always' : 'fired'}"><span class="tag">${faculty.always ? `Always on · each ${faculty.always}` : 'Fired'}</span> ${pill(faculty.status)}<h3>${esc(faculty.label)}</h3><dl>
    <dt>Fired by</dt><dd>${esc(firedBy(faculty))}</dd><dt>Writes</dt><dd>${faculty.writes.map(esc).join('; ')}</dd><dt>Read by</dt><dd>${readers(id).map(entry => esc(entry.label)).join(', ')}</dd>${faculty.code ? `<dt>Code</dt><dd><code>${esc(faculty.code)}</code></dd>` : ''}</dl></div>`).join('\n');
  const directors = Object.values(DIRECTORS).map(director => `<div class="card ${director.always ? 'always' : 'fired'}"><span class="tag">${director.always ? 'Always on' : `Leads when its faculties fire`}</span> ${pill(director.status)}<h3>${esc(director.label)}</h3><p>${esc(director.role)}</p><dl>
    <dt>Scale</dt><dd>${metres(director.scale)}</dd><dt>Camera</dt><dd>${esc(director.camera)}</dd><dt>Plays</dt><dd>${director.reads.map(id => esc(FACULTIES[id].label)).join(', ')}</dd>
    <dt>Asks Jev</dt><dd><ul class="asks">${director.asks.map(ask => `<li>${pill(ask.status)} ${esc(ask.name)}${ask.what ? ` <span class="note">(${esc(ask.what)})</span>` : ''}</li>`).join('')}</ul></dd><dt>Tools</dt><dd>${director.tools.map(esc).join('; ')}</dd></dl></div>`).join('\n');
  return `<p class="note">Written from <code>world-engine/director/specialists.mjs</code> by <code>specialists-doc.mjs</code>: the registry is the design.</p>
<h2>Block types</h2>
<p>A block is a window of about 12 sentences, moving 6 at a time. Jev answers its type with a distribution kept whole, so a block can be 0.5 confrontation and 0.4 pursuit, and both faculties fire.</p>
<div class="scroll"><table><thead><tr><th>Type</th><th>What it is</th><th>In volume 1</th><th>Fires</th></tr></thead><tbody>
${types}
</tbody></table></div>
<h2>Faculties and specialist directors</h2>
<p>Faculties are the work model reading the text; directors are Jev deciding on pictures. Each director owns one faculty (●) and plays others' claims (○). The stage manager always runs and chooses who leads each beat; the director whose faculties weigh most there leads and holds the camera, and others whose faculties fired co-direct, answering their own questions.</p>
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
</div>`;
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
