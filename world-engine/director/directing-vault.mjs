// The directing notes of the docs vault (the user, 2026-11-03: a page per faculty and per director, how each is asked and
// what it may answer, kept in Obsidian): docs/ is the vault, docs/v2/directing/ these notes, all written from the code
// (specialists.mjs, questions.mjs, the Jev modes, digest.mjs). Standard markdown links, so they read the same in
// Obsidian and on GitHub. Run after changing any of them; never edit the notes by hand.
//   node world-engine/director/directing-vault.mjs [--check]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, DAMPING, DIRECTORS, FACULTIES, FLOW, GATES, LAWS, LOG_KINDS, SIGNALS, STATE, registryProblems } from './specialists.mjs';
import { FACULTY_ASKS, directorQuestions, generalistAsks } from './questions.mjs';
import { firedBy, fires, lands, lawsOf, metres, readers } from './specialists-doc.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), folder = join(repository, 'docs', 'v2', 'directing');
const HEAD = '<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->';
// Placeholders (<the mover>) are text, not tags: escaped wherever they are not in code.
const safe = text => String(text ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = text => safe(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const yaml = fields => ['---', ...Object.entries(fields).map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(item => JSON.stringify(item)).join(', ')}]` : JSON.stringify(value)}`), '---'].join('\n');
const facultyLink = (id, from = 'directors') => `[${FACULTIES[id].label}](${from === 'root' ? 'faculties/' : '../faculties/'}${id}.md)`;
const directorLink = (id, from = 'faculties') => `[${DIRECTORS[id].label}](${from === 'root' ? 'directors/' : '../directors/'}${id}.md)`;
const options = value => Array.isArray(value) ? value.map(item => `\`${item}\``).join(' · ') : typeof value === 'object' && value ? Object.entries(value).map(([key, inner]) => `**${key}**: ${options(inner)}`).join('; ') : cell(value);
const shapeTable = shape => ['| Field | Answers |', '|---|---|', ...Object.entries(shape).map(([field, value]) => `| \`${field}\` | ${Array.isArray(value) && typeof value[0] === 'object' ? options(value[0]) : options(value)} |`)].join('\n');
const quote = text => safe(text).split('\n').map(line => `> ${line}`).join('\n');

function facultyNote(id) {
  const faculty = FACULTIES[id], asks = id === 'generalist' ? generalistAsks() : FACULTY_ASKS[id], by = readers(id);
  const parts = asks.parts ?? [{ name: null, ...asks }];
  return [yaml({ type: 'faculty', id, aliases: [faculty.label], status: faculty.status, fired_by: faculty.always ? [`always: each ${faculty.always}`] : [...(faculty.types ?? []), ...(faculty.signals ?? [])], read_by: by.map(entry => entry.key), tags: ['directing/faculty', `status/${faculty.status}`] }), HEAD, '',
    `# ${faculty.label}`, '', `A summary faculty: the work model reading the text. Status: **${faculty.status}**${faculty.code ? ` (\`${faculty.code}\`)` : ''}. Back to [Directing](../Directing.md).`, '',
    '## What it writes', '', ...faculty.writes.map(line => `- ${safe(line)}`), '',
    '## When it fires', '', faculty.always ? `Always: once each ${faculty.always}.` : `On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (\`firing()\` in specialists.mjs).`, '',
    ...(faculty.types ?? []).map(type => `- block type **${BLOCK_TYPES[type].label}**: ${BLOCK_TYPES[type].means} (volume 1: ${BLOCK_TYPES[type].volume1})`), ...(faculty.kinds ?? []).map(kind => `- sentence kind **${kind}**: its share in the window's sentences, weighted by each one's confidence`), ...(faculty.signals ?? []).map(signal => `- signal **${SIGNALS[signal].label}**: ${SIGNALS[signal].from}`), '',
    '## How it is asked', '', `How often: ${asks.unit}.`, '',
    ...parts.flatMap(part => [...(part.name ? [`### ${part.name}`, ''] : []), '**System**', '', quote(part.system), '', '**Task**', '', quote(part.task), '', '**Given**', '', ...part.given.map(line => `- ${safe(line)}`), '', '**Answers** (JSON; every entry with its sentence)', '', shapeTable(part.shape), '']),
    '## Read by', '', ...by.map(entry => `- ${directorLink(entry.key)}${entry.own ? ' (its own faculty)' : ''}`), ''].join('\n');
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
    '## Zoom and camera', '', action ? `Reads the ${facultyLink('scale')} faculty: its camera operator frames each beat, and Jev's pictures for its questions, at the recommended zoom and view angle. Zoom range ${metres(director.scale)}; camera: ${director.camera}.` : director.kind === 'stage' ? 'No zoom of its own: it chooses which action director leads each beat and where the cuts fall; the lead\'s camera operator holds the camera.' : 'None: a state director keeps what rides with people and things. Its questions are asked on the text and on fixed reference pictures; a thing in motion is played by the beat\'s action director.', '',
    '## Plays', '', ...director.reads.map((faculty, k) => `- ${facultyLink(faculty)}${k === 0 ? ' (its own)' : ''}`), '',
    '## How Jev is asked', '', ...questions.flatMap(question), '## Tools', '', ...director.tools.map(tool => `- ${tool}`), '',
    '## State and the ontology', '', 'What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).', '',
    '| State | World log | Laws | Into the ontology | Gate | Status |', '|---|---|---|---|---|---|',
    ...STATE[id].map(entry => `| ${cell(entry.state)}${entry.what ? ` (${cell(entry.what)})` : ''} | ${entry.log ? `\`${entry.log}\`${LOG_KINDS[entry.log].built ? '' : ' (new)'}` : '—'}${entry.smoothed ? ', smoothed' : ''} | ${entry.laws.map(law => `${law} ${LAWS[law]}`).join('; ') || '—'} | ${cell(lands(entry))}${entry.note ? `; ${cell(entry.note)}` : ''} | ${entry.gate} | ${entry.status} |`), ''].join('\n');
}

function index() {
  return [yaml({ type: 'dashboard', aliases: ['Directing'], tags: ['directing'] }), HEAD, '',
    '# Directing', '', 'The director as readers and specialists (docs/v2/next-steps.md A4–A5). Faculties read the text (the work model); directors decide (Jev). Every note here is written from the code: `world-engine/director/specialists.mjs` and `questions.mjs`. The visual plan with volume 1\'s density strip and gate preview: [summarizer-faculties.html](../summarizer-faculties.html).', '',
    '## Faculties', '', '| Faculty | Fired by | Read by | Status |', '|---|---|---|---|',
    ...Object.keys(FACULTIES).map(id => `| ${facultyLink(id, 'root')} | ${cell(firedBy(FACULTIES[id]))} | ${readers(id).map(entry => directorLink(entry.key, 'root')).join(', ')} | ${FACULTIES[id].status} |`), '',
    '## Directors', '', '| Director | Kind | Zoom | Plays | Status |', '|---|---|---|---|---|',
    ...Object.entries(DIRECTORS).map(([id, director]) => `| ${directorLink(id, 'root')} | ${director.kind} | ${director.scale ? metres(director.scale) : '—'} | ${director.reads.map(faculty => facultyLink(faculty, 'root')).join(', ')} | ${director.status} |`), '',
    '## Block types', '', '| Type | What it is | In volume 1 | Fires |', '|---|---|---|---|',
    ...Object.entries(BLOCK_TYPES).map(([id, type]) => `| ${type.label} | ${type.means} | ${type.volume1} | ${[...(DAMPING.includes(id) ? ['damps the world'] : []), ...fires(id)].join(', ')} |`), '',
    '## How state flows into the ontology', '', ...FLOW.map((step, n) => `${n + 1}. **${step.step}**: ${step.what} (\`${step.code}\`)`), '', ...Object.entries(GATES).map(([gate, what]) => `- **${gate}**: ${what}`), ''].join('\n');
}

/** Every note: path (under docs/v2/directing) → text. */
export async function notes() {
  const problems = registryProblems();
  if (problems.length) throw new Error(problems.join('\n'));
  const questions = await directorQuestions(), out = new Map([['Directing.md', index()]]);
  for (const id of Object.keys(FACULTIES)) out.set(`faculties/${id}.md`, facultyNote(id));
  for (const id of Object.keys(DIRECTORS)) out.set(`directors/${id}.md`, directorNote(id, questions[id]));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), written = await notes();
  let stale = 0;
  for (const [path, text] of written) {
    const file = join(folder, path), before = await readFile(file, 'utf8').catch(() => null);
    if (before === text) continue;
    stale++;
    if (!check) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, text); }
    console.log(`${check ? 'stale' : 'written'}: docs/v2/directing/${path}`);
  }
  // A note the code no longer writes (a faculty or director removed) is stale too.
  for (const sub of ['faculties', 'directors']) for (const name of await readdir(join(folder, sub)).catch(() => [])) if (!written.has(`${sub}/${name}`)) { stale++; console.log(`no longer written: docs/v2/directing/${sub}/${name}`); }
  if (check && stale) process.exit(1);
}
