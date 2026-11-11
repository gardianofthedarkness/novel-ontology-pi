// The run report (docs/v3/design.html#world-ontology §8, Track B W7; the user, 2026-11-02: read a run's changes without the
// developer): one page per director run, in words. What the laws found and how each was settled, the review's questions
// and the main agent's answers, what the run put into canon layer by layer (and how to take it back), who says each line,
// what the smoothing moved, the world's own check. Rendered on the server from the workspace's records; no script, read
// only, on the private link like the rest of the viewer.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { directorReview } from './sim-play.mjs';

const LAWS = { L1: 'Continuity: people come in from where their strand left them', L2: 'Nobody is in two places at once', L5: 'Travel takes time', L6: 'Talk needs nearness', L9: 'Whoever acts is there', L10: 'A move must be walkable', L11: 'Bodies: a floor the building has; not too many on one spot', L12: 'Abilities', L13: 'A blast only where the text breaks something' };
const KINDS = { actor: 'Is this person there?', speaker: 'Is the speaker there?', talk: 'How does this talk happen?', reach: 'Do they get there?', continuity: 'Where do they come in from?', 'two-places': 'Which place is wrong?', travel: 'Too fast to get there', blast: 'Does something break?', note: 'Your note', revision: 'Should the history change this much?', 'who-speaks': 'Who says this line?', audit: 'Audit: is what the world settled right?', identity: 'Same person?', building: 'One building?', floor: 'Which floor?', container: 'What contains it?', split: 'One person or two?' };
const FILES = { 'scenes.jsonl': 'Scenes', 'state-changes.jsonl': 'Where people are', 'relations.jsonl': 'Relations', 'entities.jsonl': 'People and places', 'timelines.jsonl': 'Strands' };

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (dir, ...path) => readFile(resolve(dir, ...path), 'utf8').then(JSON.parse, () => null);
const lines = (dir, ...path) => readFile(resolve(dir, ...path), 'utf8').then(text => text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }), () => []);

/** The report's data: the review's (directorReview) with the laws as checked after the run, canon's writes and names. */
export async function runReport(workspace) {
  const dir = resolve(workspace), review = await directorReview(dir);
  if (!review) return null;
  const run = review.run;
  const [laws, canon, reading, pool, answers, record, smoothed] = await Promise.all([json(dir, 'stage', 'director', 'laws.json'), lines(dir, 'stage', 'world', 'canon.jsonl'), json(dir, 'stage', 'director', 'reading.json'), lines(dir, 'stage', 'world', 'pool.jsonl'), lines(dir, 'stage', 'world', 'answers.jsonl'), json(dir, 'stage', 'director', 'run.json'), run ? json(dir, 'stage', 'world', 'smoothed', `${run}.json`) : null]);
  const undone = new Set(canon.filter(entry => entry.undo).map(entry => entry.undo));
  const writes = canon.filter(entry => entry.run === run && !entry.undo && !undone.has(`${entry.run}|${entry.file}|${entry.id}|${entry.at}`));
  // Each write's record as it now stands (the bundle folded by id), beside what it replaced.
  const now = {};
  for (const file of new Set(writes.map(entry => entry.file))) now[file] = new Map((await lines(dir, 'ontology', file)).filter(row => row.id).map(row => [row.id, row]));
  const items = [...new Map(pool.map(item => [item.id, item])).values()], answerOf = new Map(answers.map(answer => [answer.item, answer]));
  return { run, review, laws: laws?.run === run ? laws.laws : null, writes: writes.map(entry => ({ ...entry, current: now[entry.file]?.get(entry.id) ?? null })), names: reading?.names ?? {}, items: items.map(item => ({ ...item, answer: answerOf.get(item.id) ?? null })), record, smoothed };
}

/**
 * Faculties and cost (M12): each stretch of the gate, which faculties fired there and whether each found anything; the
 * leads the findings changed; each model's requests and tokens by part, and the price where the workspace has rates.
 */
export function facultiesBody(record) {
  const stretches = record.stretches ?? [], usage = record.usage ?? {}, cost = record.cost ?? null;
  if (!stretches.length && !usage.jev) return '<p>This run kept no faculty records (before M12).</p>';
  const ids = [...new Set(stretches.flatMap(entry => entry.fired ?? []))].sort();
  const rows = ids.map(id => { const fired = stretches.filter(entry => entry.fired.includes(id)), read = fired.filter(entry => entry.found?.[id] !== undefined), found = read.filter(entry => entry.found[id] > 0);
    return `<tr><td>${esc(id)}</td><td>${fired.length} of ${stretches.length}</td><td>${read.length ? `${found.length} of ${read.length}` : '—'}</td></tr>`; }).join('');
  const leads = (record.scenes ?? []).flatMap(scene => scene.leads ?? []), changed = leads.filter(entry => entry.lead !== entry.gate);
  const meter = (name, entry) => entry ? `<tr><td>${esc(name)}</td><td>${entry.requests ?? 0}${entry.cached ? ` (${entry.cached} cached)` : ''}</td><td>${entry.prompt ?? entry.input ?? 0} in, ${entry.completion ?? entry.output ?? 0} out</td><td>${cost?.byPart?.[name] ?? '—'}</td></tr>` : '';
  const parts = [meter('jev', usage.jev), meter('digest', usage.digest), meter('system2', usage.system2), ...Object.entries(usage.faculties ?? {}).map(([id, entry]) => meter(id, entry))].join('');
  return `<p>Fired is where the gate's index stood above its average; found is where the faculty, having read the stretch, found something (only fired stretches are read).</p>
  <div class="wide"><table><tr><th>faculty</th><th>fired</th><th>found, of those read</th></tr>${rows}</table></div>
  <p>The findings changed ${changed.length} of ${leads.length} beats' leads${changed.length ? ` (${Object.entries(changed.reduce((sum, entry) => ({ ...sum, [`${entry.gate} → ${entry.lead}`]: (sum[`${entry.gate} → ${entry.lead}`] ?? 0) + 1 }), {})).map(([key, n]) => `${esc(key)} ${n}`).join(', ')})` : ''}.</p>
  <div class="wide"><table><tr><th>part</th><th>requests</th><th>tokens</th><th>price${cost?.currency ? ` (${esc(cost.currency)})` : ''}</th></tr>${parts}</table></div>
  <p>${cost?.total !== undefined ? `The run cost ${cost.total} ${esc(cost.currency)} in all.` : 'Unpriced: no stage/director/prices.json in the workspace (rates per million tokens for jev and the work model).'}</p>`;
}

/** The report as a page. */
export function reportPage(data) {
  const name = id => { const entry = data.names[id]; return entry ? `${esc(entry[0])} <small>${esc(id)}</small>` : esc(id); };
  const named = text => esc(text).replace(/(char|slot|loc)_[\w]+/g, id => (data.names[id] ? `${esc(data.names[id][0])}` : id));
  const r = data.review.report, record = data.record ?? {};
  const scenesPlayed = record.scenes?.length ?? 0, moves = (record.scenes ?? []).reduce((n, scene) => n + (scene.cards ?? []).reduce((m, card) => m + (card.moves ?? []).filter(move => move.moved).length, 0), 0);
  const asPlayed = r.laws ?? {}, lawsAfter = data.laws ?? [];
  const broken = lawsAfter.reduce((n, law) => n + law.violations.length, 0), checked = lawsAfter.reduce((n, law) => n + law.checked, 0);
  const asked = data.items.length, answered = data.items.filter(item => item.answer).length, applied = data.items.filter(item => item.status === 'applied').length;
  const byFile = file => data.writes.filter(entry => entry.file === file);
  const scenesWritten = byFile('scenes.jsonl'), speakersNow = scenesWritten.reduce((n, entry) => n + (entry.current?.turns ?? []).filter(turn => turn.speakerId).length, 0), speakersBefore = scenesWritten.reduce((n, entry) => n + (entry.previous?.turns ?? []).filter(turn => turn.speakerId).length, 0);
  const smoothedMoves = (data.smoothed?.revisions ?? []).sort((a, b) => b.shift - a.shift);
  const section = (title, body, open = false) => `<details${open ? ' open' : ''}><summary><h2>${title}</h2></summary>${body}</details>`;
  // The laws: each as checked after the run, and as the run played (what each decided on the spot).
  const lawRows = Object.keys(LAWS).map(law => {
    const after = lawsAfter.find(entry => entry.law === law), playedHere = Object.entries(asPlayed).filter(([key]) => key.startsWith(`${law} `));
    if (!after && !playedHere.length) return '';
    return `<tr><td><b>${law}</b> ${esc(LAWS[law])}</td><td class="n">${after?.checked ?? '—'}</td><td class="n ${after?.violations.length ? 'bad' : ''}">${after ? after.violations.length : '—'}</td><td>${playedHere.map(([key, n]) => `${esc(key.slice(law.length + 1))} ${n}`).join(', ') || '—'}</td></tr>`;
  }).join('');
  // The review, scene by scene.
  const byScene = new Map();
  for (const item of data.items) (byScene.get(item.scene ?? 'none') ?? byScene.set(item.scene ?? 'none', []).get(item.scene ?? 'none')).push(item);
  const reviewBody = [...byScene.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([scene, list]) => {
    const done = list.filter(item => item.answer).length;
    return `<details${done ? ' open' : ''}><summary>${scene === 'none' ? 'Across scenes' : esc(scene)} · ${list.length} question${list.length === 1 ? '' : 's'}, ${done} answered</summary><ol>${list.map(item => `<li><span class="k">${esc(KINDS[item.kind] ?? item.kind)}</span> ${esc(item.question)}${item.answer ? `<div class="ans"><b>${esc(item.answer.verdict)}</b> · ${esc(item.answer.reason)}${item.status === 'applied' ? ' <span class="ok">pinned</span>' : item.status === 'open' && item.note ? ` <span class="bad">${esc(item.note)}</span>` : ''}</div>` : `<div class="wait">waiting: ${item.options.map(esc).join(' / ')}</div>`}</li>`).join('')}</ol></details>`;
  }).join('') || '<p>No questions.</p>';
  // Canon, layer by layer.
  const sceneRows = scenesWritten.map(entry => { const a = entry.previous ?? {}, b = entry.current ?? {}; return `<tr><td>${esc(entry.id)}</td><td>${(a.charactersPresent ?? []).length} → <b>${(b.charactersPresent ?? []).length}</b></td><td>${a.locationId ? name(a.locationId) : '—'} → <b>${b.locationId ? name(b.locationId) : '—'}</b></td><td>${(a.turns ?? []).filter(turn => turn.speakerId).length} → <b>${(b.turns ?? []).filter(turn => turn.speakerId).length}</b> of ${(b.turns ?? []).length}</td></tr>`; }).join('');
  const relationRows = byFile('relations.jsonl').map(entry => { const rel = entry.current ?? {}; return `<li>${rel.type === 'PART_OF' ? `${name(rel.fromId)} is inside ${name(rel.toId)}` : rel.type === 'PRECEDES' ? `${esc(rel.properties?.toScene)} comes at least <b>${esc(rel.properties?.minMinutes)} min</b> after ${esc(rel.properties?.fromScene)} (${name(rel.properties?.who)} walks ${esc(rel.properties?.metres)} m)` : `${esc(rel.type)} ${name(rel.fromId)} → ${name(rel.toId)}`}</li>`; }).join('');
  const entityRows = byFile('entities.jsonl').map(entry => { const was = entry.previous ?? {}, is = entry.current ?? {}; const added = (is.names ?? []).filter(form => !(was.names ?? []).some(old => old.text === form.text)).map(form => form.text); const world = is.properties?.world ?? {}; return `<li>${name(entry.id)}: ${[added.length ? `also called ${added.map(esc).join(', ')}` : '', world.lot ? `the building ${esc(world.lot)} (${esc(world.floors ?? '?')} floors${world.role ? `, ${esc(world.role)}` : ''})` : '', world.floor ? `on floor ${esc(world.floor)}` : '', world.damage?.length ? `damaged in ${world.damage.map(d => `${esc(d.scene)} (${esc(d.cells ?? '?')} cells)`).join(', ')}` : ''].filter(Boolean).join('; ')}</li>`; }).join('');
  const whereCount = byFile('state-changes.jsonl').length, timelines = byFile('timelines.jsonl').map(entry => `<li>${esc(entry.current?.names?.[0]?.text ?? entry.id)}: ${esc((entry.current?.properties?.scenes ?? []).length)} scenes</li>`).join('');
  const canonBody = data.writes.length ? `<p>${data.writes.length} records, each with what it replaced. To take them all back: <code>novel world undo &lt;book&gt; --run ${esc(data.run)}</code>.</p>
    ${scenesWritten.length ? `<h3>Scenes · who is there, where, who says each line</h3><div class="wide"><table><tr><th>scene</th><th>people there</th><th>place</th><th>lines with a speaker</th></tr>${sceneRows}</table></div>` : ''}
    ${whereCount ? `<h3>Where people are</h3><p>${whereCount} people placed at the end of the scenes they were in (held where a law held them).</p>` : ''}
    ${relationRows ? `<h3>Relations</h3><ul>${relationRows}</ul>` : ''}
    ${entityRows ? `<h3>People and places</h3><ul>${entityRows}</ul>` : ''}
    ${timelines ? `<h3>Strands</h3><ul>${timelines}</ul>` : ''}` : '<p>Nothing written into the ontology by this run.</p>';
  const speakers = r.canon?.speakers ?? {}, said = key => speakers[key] ?? 0;
  const summary = [
    `${scenesPlayed} scenes played, ${moves} moves walked${r.calls ? `, ${r.calls} questions to Jev` : ''}.`,
    lawsAfter.length ? `The laws checked ${checked} things and found ${broken} breaks.` : '',
    asked ? `The review has ${asked} questions; the main agent answered ${answered}, and ${applied} are pinned for the next run.` : '',
    scenesWritten.length ? `Into the ontology: ${scenesWritten.length} scenes now say who is there and where; ${speakersNow - speakersBefore} more lines have a speaker (${speakersNow} in all).` : '',
    data.smoothed ? `The smoothing moved ${data.smoothed.revisions.length} moments, at most ${smoothedMoves[0] ? Math.round(smoothedMoves[0].shift) : 0} m.` : '',
  ].filter(Boolean).map(line => `<li>${line}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Run report</title><style>
  :root { color-scheme: dark; --bg: #060c12; --panel: #0b1620; --ink: #d9e3ea; --dim: #8aa0b0; --line: #1d3442; --accent: #7ce6ff; --jev: #ffd36e; --bad: #ff9a8a; --ok: #8fd18f; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 system-ui, -apple-system, "PingFang SC", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 20px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px)); }
  h1 { font-size: 20px; margin: 0 0 2px; color: var(--accent); letter-spacing: .02em; } h2 { display: inline; font-size: 16px; } h3 { font-size: 14px; color: var(--jev); margin: 18px 0 6px; }
  .meta { color: var(--dim); font-size: 12px; margin-bottom: 14px; } small { color: var(--dim); font-size: 11px; }
  details { border-top: 1px solid var(--line); padding: 10px 0; } summary { cursor: pointer; } details details { border: 0; padding: 4px 0 4px 10px; }
  ul.sum { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px 10px 30px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--dim); font-weight: 600; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; } .bad { color: var(--bad); } .ok { color: var(--ok); } .wide { overflow-x: auto; }
  ol { padding-left: 22px; } li { margin: 6px 0; overflow-wrap: anywhere; } .k { color: var(--jev); font-weight: 600; margin-right: 6px; }
  .ans { color: var(--ink); margin-top: 2px; padding-left: 10px; border-left: 2px solid var(--ok); } .wait { color: var(--dim); padding-left: 10px; border-left: 2px solid var(--line); }
  code { background: var(--panel); padding: 1px 5px; border-radius: 4px; }
  </style></head><body><main>
  <h1>Run report</h1><div class="meta">${esc(data.run ?? '')} · ${esc(r.from ?? '')} – ${esc(r.to ?? '')} · ${esc(r.model ?? '')}${r.startedAt ? ` · ${esc(r.startedAt.slice(0, 16).replace('T', ' '))}` : ''}</div>
  <ul class="sum">${summary}</ul>
  ${section('The laws', lawsAfter.length || Object.keys(asPlayed).length ? `<div class="wide"><table><tr><th>law</th><th>checked</th><th>broken</th><th>as the run played</th></tr>${lawRows}</table></div>` : '<p>No laws recorded for this run.</p>', true)}
  ${section(`The review · ${answered} of ${asked} answered`, reviewBody)}
  ${section('Into the ontology', canonBody)}
  ${section('Who says each line', `<ul><li>the reading, sure: ${said('reading applied')}</li><li>settled by the world (the reading unsure): ${said('world applied')}</li><li>settled by the review: ${said('review applied')}</li><li>held for the review: ${said('world held') + said('reading held') + said('review held')}</li></ul>`)}
  ${section('The smoothing', data.smoothed ? `<p>${r.smoothing?.moments ?? 0} moments smoothed; clouds ${r.smoothing?.meanSpread ?? '?'} m across on average; ${data.smoothed.revisions.length} moved more than 2 m.</p><ol>${smoothedMoves.slice(0, 12).map(move => `<li>${name(move.who)} in ${esc(move.scene)}${move.card ? `, ${esc(move.card)}` : ' (start)'}: ${Math.round(move.shift)} m (${esc(move.rank)})</li>`).join('')}</ol>${(data.smoothed.onStage ?? []).length ? `<h3>Likely on the stage, though the script left them out</h3><ul>${data.smoothed.onStage.map(entry => `<li>${name(entry.who)} in ${esc(entry.scene)}: ${Math.round(entry.p * 100)}%</li>`).join('')}</ul>` : ''}` : '<p>Not smoothed yet.</p>')}
  ${section("The world's own check", r.world.length ? `<ul>${r.world.map(issue => `<li>${esc(issue.scene)}: ${esc(issue.code)} ${esc(issue.name ?? '')}</li>`).join('')}</ul>` : '<p>Every building whole in each scene\'s world can be entered, every room reached.</p>')}
  ${section('System 2', `<p>Below 50%, Jev's question went to the work model ${r.system2.ran} times; its answer was used ${r.system2.used} times.</p>`)}
  ${section('Faculties and cost', facultiesBody(record))}
  </main></body></html>`;
}
