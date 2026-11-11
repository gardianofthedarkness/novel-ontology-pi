// The directing notes (the user, 2026-11-03: a page per cast and per director, how each is asked and what it may
// answer), written from the code (specialists.mjs, questions.mjs, the Jev modes, digest.mjs) into their section of
// docs/v3/design.html (§17.2), between the <!-- directing:start --> and <!-- directing:end --> markers. Each note is
// written as markdown (notes()) and rendered there with an anchor of its own: #cast-<id>, #director-<id>. Run after
// changing any of them; never edit the section by hand.
//   node world-engine/director/directing-vault.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, QUIET, DIRECTORS, CASTS, FLOW, GATES, LAWS, LOG_KINDS, SIGNALS, STATE, registryProblems } from './specialists.mjs';
import { CAST_ASKS, builtAsks, directorQuestions, scriptSupervisorAsks } from './questions.mjs';
import { firedBy, fires, lands, lawsOf, metres, readers } from './specialists-doc.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), design = join(repository, 'docs', 'v3', 'design.html');
const HEAD = '<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->';
const START = '<!-- directing:start -->', END = '<!-- directing:end -->';
// Placeholders (<the mover>) are text, not tags: escaped wherever they are not in code.
const safe = text => String(text ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = text => safe(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const yaml = fields => ['---', ...Object.entries(fields).map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(item => JSON.stringify(item)).join(', ')}]` : JSON.stringify(value)}`), '---'].join('\n');
const castLink = (id, from = 'directors') => `[${CASTS[id].label}](${from === 'root' ? 'casts/' : '../casts/'}${id}.md)`;
const directorLink = (id, from = 'casts') => `[${DIRECTORS[id].label}](${from === 'root' ? 'directors/' : '../directors/'}${id}.md)`;
const options = value => Array.isArray(value) ? value.map(item => `\`${item}\``).join(' · ') : typeof value === 'object' && value ? Object.entries(value).map(([key, inner]) => `**${key}**: ${options(inner)}`).join('; ') : cell(value);
const shapeTable = shape => ['| Field | Answers |', '|---|---|', ...Object.entries(shape).map(([field, value]) => `| \`${field}\` | ${Array.isArray(value) && typeof value[0] === 'object' ? options(value[0]) : options(value)} |`)].join('\n');
const quote = text => safe(text).split('\n').map(line => `> ${line}`).join('\n');

function castNote(id) {
  const cast = CASTS[id], asks = id === 'scriptSupervisor' ? scriptSupervisorAsks() : builtAsks()[id] ?? CAST_ASKS[id], by = readers(id);
  const parts = asks.parts ?? [{ name: null, ...asks }];
  return [yaml({ type: 'cast', id, aliases: [cast.label], status: cast.status, fired_by: cast.always ? [`always: each ${cast.always}`] : [...(cast.types ?? []), ...(cast.signals ?? [])], read_by: by.map(entry => entry.key), tags: ['directing/cast', `status/${cast.status}`] }), HEAD, '',
    `# ${cast.label}`, '', `A summary cast: the work model reading the text. Status: **${cast.status}**${cast.code ? ` (\`${cast.code}\`)` : ''}. Back to [Directing](../Directing.md).`, '',
    '## What it writes', '', ...cast.writes.map(line => `- ${safe(line)}`), '',
    '## When it fires', '', cast.always ? `Always: once each ${cast.always}.` : `On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (\`firing()\` in specialists.mjs).`, '',
    ...(cast.types ?? []).map(type => `- block type **${BLOCK_TYPES[type].label}**: ${BLOCK_TYPES[type].means} (volume 1: ${BLOCK_TYPES[type].volume1})`), ...(cast.kinds ?? []).map(kind => `- sentence kind **${kind}**: its share in the window's sentences, weighted by each one's confidence`), ...(cast.signals ?? []).map(signal => `- signal **${SIGNALS[signal].label}**: ${SIGNALS[signal].from}`), '',
    '## How it is asked', '', `How often: ${asks.unit}.`, '',
    ...parts.flatMap(part => [...(part.name ? [`### ${part.name}`, ''] : []), '**System**', '', quote(part.system), '', '**Task**', '', quote(part.task), '', '**Given**', '', ...part.given.map(line => `- ${safe(line)}`), '', '**Answers** (JSON; every entry with its sentence)', '', shapeTable(part.shape), '']),
    '## Read by', '', ...by.map(entry => `- ${directorLink(entry.key)}${entry.own ? ' (its own cast)' : ''}`), ''].join('\n');
}

function directorNote(id, questions) {
  const director = DIRECTORS[id], action = director.kind === 'action';
  const question = entry => [`### ${entry.mode ?? entry.key} · ${entry.status}`, '', ...(entry.code ? [`Asked in \`${entry.code}\`${entry.mode ? `, mode \`${entry.mode}\` (run here on a sample whose names are placeholders)` : ''}.`, ''] : []),
    ...(entry.picture ? [`**Picture**: ${entry.picture}.`, ''] : []), ...(entry.note ? [`**Note**: ${entry.note}.`, ''] : []),
    ...(entry.task ? ['**Task**', '', quote(entry.task), ''] : []), ...(entry.given?.length ? [`**Given**: ${entry.given.join(', ')}.`, ''] : []),
    '| Key | Kind | Asks | Options |', '|---|---|---|---|',
    ...entry.questions.map(item => `| \`${item.key}\` | ${item.primitive} | ${cell(item.instructions)}${item.criteria ? ` (${cell(item.criteria)})` : ''} | ${item.options.length ? item.options.map(option => `\`${option}\`${item.hints?.[option] ? `: ${cell(item.hints[option])}` : ''}`).join('<br>') : '(a box on the picture)'} |`), ''];
  return [yaml({ type: 'director', id, aliases: [director.label], kind: director.kind, status: director.status, zoom: director.scale ? metres(director.scale) : 'none', reads: director.reads, tags: ['directing/director', `kind/${director.kind}`, `status/${director.status}`] }), HEAD, '',
    `# ${director.label}`, '', `${director.role[0].toUpperCase()}${director.role.slice(1)}. ${/^[aeiou]/.test(director.kind) ? 'An' : 'A'} **${director.kind}** director; status **${director.status}**. Back to [Directing](../Directing.md).`, '',
    '## Zoom and camera', '', action ? `Reads the ${castLink('cinematographer')} cast: its camera operator frames each beat, and Jev's pictures for its questions, at the recommended zoom and view angle. Zoom range ${metres(director.scale)}; camera: ${director.camera}.` : director.kind === 'stage' ? 'No zoom of its own: it chooses which action director leads each beat and where the cuts fall; the lead\'s camera operator holds the camera.' : 'None: a state director keeps what rides with people and things. Its questions are asked on the text and on fixed reference pictures; a thing in motion is played by the beat\'s action director.', '',
    '## Plays', '', ...director.reads.map((cast, k) => `- ${castLink(cast)}${k === 0 ? ' (its own)' : ''}`), '',
    '## How Jev is asked', '', ...questions.flatMap(question), '## Tools', '', ...director.tools.map(tool => `- ${tool}`), '',
    '## State and the ontology', '', 'What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).', '',
    '| State | World log | Laws | Into the ontology | Gate | Status |', '|---|---|---|---|---|---|',
    ...STATE[id].map(entry => `| ${cell(entry.state)}${entry.what ? ` (${cell(entry.what)})` : ''} | ${entry.log ? `\`${entry.log}\`${LOG_KINDS[entry.log].built ? '' : ' (new)'}` : '—'}${entry.smoothed ? ', smoothed' : ''} | ${entry.laws.map(law => `${law} ${LAWS[law]}`).join('; ') || '—'} | ${cell(lands(entry))}${entry.note ? `; ${cell(entry.note)}` : ''} | ${entry.gate} | ${entry.status} |`), ''].join('\n');
}

function index() {
  return [yaml({ type: 'dashboard', aliases: ['Directing'], tags: ['directing'] }), HEAD, '',
    '# Directing', '', 'The director as readers and specialists (design §8.2). Casts read the text (the work model); directors decide (Jev). Every note here is written from the code: `world-engine/director/specialists.mjs` and `questions.mjs`. The registry\'s tables: [the specialists\' registry](#registry). The gate over volume 1 (M3): [its note](../reports/gate-volume-1.md) and [its strip](../reports/gate-volume-1.html). How Jev picks on a map, tested: [the pick test](../reports/pick-test-2026-11-03.md).', '',
    '## Casts', '', '| Cast | Fired by | Read by | Status |', '|---|---|---|---|',
    ...Object.keys(CASTS).map(id => `| ${castLink(id, 'root')} | ${cell(firedBy(CASTS[id]))} | ${readers(id).map(entry => directorLink(entry.key, 'root')).join(', ')} | ${CASTS[id].status} |`), '',
    '## Directors', '', '| Director | Kind | Zoom | Plays | Status |', '|---|---|---|---|---|',
    ...Object.entries(DIRECTORS).map(([id, director]) => `| ${directorLink(id, 'root')} | ${director.kind} | ${director.scale ? metres(director.scale) : '—'} | ${director.reads.map(cast => castLink(cast, 'root')).join(', ')} | ${director.status} |`), '',
    '## Block types', '', '| Type | What it is | In volume 1 | Fires |', '|---|---|---|---|',
    ...Object.entries(BLOCK_TYPES).map(([id, type]) => `| ${type.label} | ${type.means} | ${type.volume1} | ${[...(QUIET.includes(id) ? ['fires no reader'] : []), ...fires(id)].join(', ')} |`), '',
    '## How state flows into the ontology', '', ...FLOW.map((step, n) => `${n + 1}. **${step.step}**: ${step.what} (\`${step.code}\`)`), '', ...Object.entries(GATES).map(([gate, what]) => `- **${gate}**: ${what}`), ''].join('\n');
}

/** Every note as markdown: its old path (under docs/v2/directing, now its anchor's name) → text. */
export async function notes() {
  const problems = registryProblems();
  if (problems.length) throw new Error(problems.join('\n'));
  const questions = await directorQuestions(), out = new Map([['Directing.md', index()]]);
  for (const id of Object.keys(CASTS)) out.set(`casts/${id}.md`, castNote(id));
  for (const id of Object.keys(DIRECTORS)) out.set(`directors/${id}.md`, directorNote(id, questions[id]));
  return out;
}

// The notes as HTML for the design: a minimal markdown renderer for what the notes use (headings, paragraphs, lists,
// quotes, tables, bold, code, links). A note's own links become anchors in the same section.
const anchor = path => path.replace(/^(\.\.\/)?(casts|directors)\/([\w-]+)\.md$/, (_, up, kind, id) => `#${kind === 'casts' ? 'cast' : 'director'}-${id}`).replace(/^(\.\.\/)?Directing\.md$/, '#directing-notes');
const codeEsc = text => text.replace(/&(?!lt;|gt;|amp;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = text => text.split(/(`[^`]*`)/).map(part => part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${codeEsc(part.slice(1, -1))}</code>`
  : part.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${anchor(href)}">${label}</a>`)).join('');
const cells = row => row.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => inline(cell.trim().replace(/\\\|/g, '|')));
export function noteHtml(id, text) {
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').filter(line => line !== HEAD), out = [];
  for (let n = 0; n < lines.length;) {
    const line = lines[n];
    if (!line.trim()) { n++; continue; }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) { const level = heading[1].length + 2; out.push(level === 3 ? `<h3 id="${id}">${inline(heading[2])}</h3>` : `<h${level}>${inline(heading[2])}</h${level}>`); n++; continue; }
    if (line.startsWith('|')) {
      const rows = []; while (n < lines.length && lines[n].startsWith('|')) rows.push(lines[n++]);
      out.push(`<div class="scroll"><table><thead><tr>${cells(rows[0]).map(cell => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${cells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith('>')) { const quote = []; while (n < lines.length && lines[n].startsWith('>')) quote.push(lines[n++].replace(/^> ?/, '')); out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`); continue; }
    const item = /^(- |\d+\. )/;
    if (item.test(line)) { const ordered = /^\d/.test(line), items = []; while (n < lines.length && item.test(lines[n])) items.push(lines[n++].replace(item, '')); out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(entry => `<li>${inline(entry)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue; }
    const para = []; while (n < lines.length && lines[n].trim() && !/^(#{1,3} |\||>|- |\d+\. )/.test(lines[n])) para.push(lines[n++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return `<section class="note-${id.split('-')[0]}">\n${out.join('\n')}\n</section>`;
}

/** The section of the design: the index, then a note per cast and per director. */
export async function section() {
  const written = await notes(), id = path => path === 'Directing.md' ? 'directing-index' : path.replace(/^casts\/(.*)\.md$/, 'cast-$1').replace(/^directors\/(.*)\.md$/, 'director-$1');
  return [...written].map(([path, text]) => noteHtml(id(path), text)).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), before = await readFile(design, 'utf8');
  const a = before.indexOf(START), b = before.indexOf(END);
  if (a < 0 || b < a) throw new Error('no directing markers in docs/v3/design.html');
  const after = `${before.slice(0, a + START.length)}\n${await section()}\n${before.slice(b)}`;
  if (after !== before) {
    if (!check) await writeFile(design, after);
    console.log(`${check ? 'stale' : 'written'}: docs/v3/design.html (directing)`);
    if (check) process.exit(1);
  }
}
