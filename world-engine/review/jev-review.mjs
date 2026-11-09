// The review by Jev (docs/v2/jev-review.md §3–§6, R3): each held item answered by Jev from its evidence pack, with the line
// that shows it; below 0.5 the same request goes to the work model (system 2, world-engine/director/system2.mjs) and its
// answer is used; the laws check what is used; what cannot stand goes on to the main agent (Pi). Jev gives no prose, so the
// line it picks is the answer's reason.
//
//   node world-engine/review/jev-review.mjs <novel-dir> --reading <data.json> --out <answers.jsonl>
//        [--items answered|open|all] [--ids wi_…,wi_…] [--limit N] [--cache <dir>] [--no-work] [--stand-in] [--dry]
//        [--looks N]: Jev chooses its looks (look.mjs) instead of the fixed pack, N at most; [--min-looks K]: the first K must read;
//        [--work-all]: the work model on every item too (recorded; routing as §6)
//
// It reads the book's pool, ledger and script and writes only `--out` (one line per item: the answer as Pi's are, with who
// settled it, how sure, the runner-up, the evidence line and why it would go on to Pi). Nothing in the book's folder is
// written: putting answers into answers.jsonl is R5's, after the measurement (§8).
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { anchorOf, bookOf, nearbyPeople, packFor, peopleOf, quoteSpans, voiceMarks, voicesOf } from './evidence.mjs';
import { gramsOf, quoteOf } from './voices.mjs';
import { lookAt, lookQuestion, menuOf, packOf, startOf } from './look.mjs';
import { lawAgainst, loadPins, SPEAKER_OTHER, whoSpeaksOptions } from './review.mjs';
import { SYSTEM2_BELOW, workAnswers } from '../director/system2.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(join(repository, path)).href);
const jsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));

/** Below this Jev's answer goes to the work model (the user's system 2 rule). */
export const STAND = SYSTEM2_BELOW;
/** Who is one person and what a person can do: Jev at least this sure and the work model agreeing (§6). */
export const STRICT = 0.8;
export const STRICT_KINDS = new Set(['identity', 'person', 'sheet']);
export const NO_LINE = 'no line shows it';

/** What each option means, for the kinds whose options are words (review.mjs OPTIONS). */
export const HINTS = {
  actor: { present: 'in the scene where the action happens', 'not present': 'not in the scene: the action or line is someone else\'s, or remembered, or imagined', remote: 'acts or speaks from elsewhere (a phone, a broadcast, a power at range)' },
  speaker: { present: 'in the scene, saying the line there', remote: 'says it from elsewhere (a phone, a broadcast, a recording)', 'not the speaker': 'someone else says this line' },
  talk: { live: 'face to face, within earshot', group: 'among several people together, within earshot', remote: 'by phone, message, radio or broadcast', public: 'aloud in public, to whoever is around' },
  reach: { arrives: 'gets to where the card has them go', stays: 'does not go there in this card (stays where they are)', 'another way': 'goes, but not on foot: a leap, flight, a vehicle, a lift, being carried' },
  identity: { same: 'one person the text names in two ways', different: 'two different people' },
  person: { 'same person': 'one person the text names in two ways', 'different people': 'two different people' },
};

const TASK = [
  'A light novel is staged as a 3D world. The world could not settle the item below on its own; answer it from the book.',
  'lines: the book\'s sentences by id, in reading order (b0003_s0120 is book 3, sentence 120); "item" marks the item\'s own line.',
  'A spoken line carries whom the reading took for its speaker (said_by) and listener (to), with how sure it was; those are guesses.',
  'people: who each id is, with their other names. Answer the verdict, then name the one line that shows it best.',
].join(' ');
/** Speaker questions (§16): the people carry their voice too. */
const TASK_SPEAKER = TASK.replace('with their other names.', 'with their other names and their voice (word pieces their own lines often carry, across scenes; a habit of speech).');

/**
 * The item as asked: who-speaks with the repaired options from its ledger entry (§5, R1), widened (§16) by the reading's
 * own guess for the line and the people near it (the speaker was not among "those there" on 12 of W12's lines); the
 * rest as the pool has it.
 */
export function asAsked(item, { ledger = new Map(), book = null, people = null, roles = {} } = {}) {
  if (item.kind !== 'who-speaks') return { ...item, optionHints: HINTS[item.kind] ?? item.optionHints ?? {} };
  const value = ledger.get(item.ledger)?.value ?? { candidates: item.subjects, to: item.to ?? null };
  const line = item.line ?? item.lines?.[0], guess = roles[line]?.who?.answer;
  const more = book && people ? [...(/^(char|slot)_/.test(String(guess)) ? [guess] : []), ...nearbyPeople(line, { book, people, roles })] : [];
  const { people: ids, crowd, options } = whoSpeaksOptions(value, more);
  return { ...item, subjects: ids, to: value.to ?? null, crowd, options, optionHints: SPEAKER_OTHER };
}

/**
 * who-speaks items in one quotation (evidence.mjs quoteSpans), in one scene, asked as one: one speaker for the quote, its
 * answer each item's (W12: a quote's lines split between Misaka and 10032, an advertisement between two sources).
 */
export function quoteGroups(items, { book, spans }) {
  const groups = new Map(), out = [];
  for (const item of items) {
    const line = item.line ?? item.lines?.[0], span = item.kind === 'who-speaks' && line ? spans.get(line) : null;
    if (!span) { out.push([item]); continue; }
    const key = `${item.scene}|${span}`;
    if (!groups.has(key)) { groups.set(key, []); out.push(groups.get(key)); }
    groups.get(key).push(item);
  }
  return out.map(list => list.sort((a, b) => (book.pos.get(a.line ?? a.lines?.[0]) ?? 0) - (book.pos.get(b.line ?? b.lines?.[0]) ?? 0)));
}

/** A quote's items as one asked item: all their lines, every option any of them has (people first), one question. */
export function askedQuote(asked) {
  if (asked.length === 1) return asked[0];
  const lines = [...new Set(asked.flatMap(item => item.lines?.length ? item.lines : [item.line]))].filter(Boolean);
  const people = [...new Set(asked.flatMap(item => item.subjects ?? []))], crowd = asked.find(item => item.crowd)?.crowd ?? null;
  const others = Object.keys(SPEAKER_OTHER).filter(option => option !== 'someone in the crowd' || crowd);
  return { ...asked[0], id: asked[0].id, line: lines[0], lines, cards: [...new Set(asked.flatMap(item => item.cards ?? []))], subjects: people, crowd, options: [...people, ...others], optionHints: SPEAKER_OTHER,
    question: `In ${asked[0].scene}, who says lines ${lines.join(', ')}? They are one quotation, so one speaker says them all. The reading was unsure of each. Those near: ${people.join(', ')}.`, group: asked.map(item => item.id) };
}

const pct = value => (typeof value === 'number' ? Math.round(value * 100) / 100 : undefined);

/** The focus Jev is asked on: the item, its pack's lines with the reading's speakers, and the people. */
export function focusOf(item, pack, { book, people, roles = {}, voices = null }, extra = {}) {
  const nameOf = id => people.get(id)?.name ?? id;
  const lines = pack.lines.map(id => {
    const role = roles[id], fields = { text: book.text.get(id) };
    if (pack.why[id] === 'item') fields.item = true;
    if (role?.who && (role.kind === 'spoken' || role.kind === 'thought')) {
      if (role.who.id) fields.said_by = `${nameOf(role.who.id)} (${role.who.id}, ${pct(role.who.confidence)})`;
      else fields.said_by = `unsure (${pct(role.who.confidence)})`;
      if (role.to?.id) fields.to = `${nameOf(role.to.id)} (${role.to.id})`;
    }
    return { id, fields };
  });
  const ids = new Set([...(item.subjects ?? []), ...(item.to ? [item.to] : []), ...pack.lines.flatMap(id => [roles[id]?.who?.id, roles[id]?.to?.id]).filter(Boolean)]);
  // A candidate's voice (§16): the word pieces their sure lines carry far more than anyone's, said across scenes.
  const voiceOf = id => (voices && ['who-speaks', 'speaker'].includes(item.kind) && (item.subjects ?? []).includes(id) ? voiceMarks(voices, id) : []);
  const who = [...ids].filter(id => people.has(id)).map(id => ({ id, fields: { name: nameOf(id), ...(people.get(id).names.length > 1 ? { also: people.get(id).names.slice(1, 5) } : {}), ...(people.get(id).kind ? { kind: people.get(id).kind } : {}), ...(voiceOf(id).length ? { voice: voiceOf(id) } : {}) } }));
  const hints = Object.fromEntries(item.options.map(option => [option, item.optionHints?.[option] ?? (people.has(option) ? nameOf(option) : option)]));
  const anchor = pack.anchor && book.text.has(pack.anchor) ? pack.anchor : null;
  return { item, anchor, lines, who, hints, asked: { kind: item.kind, question: item.question, options: hints, ...(anchor ? { line: anchor } : {}), ...extra } };
}

/** The verdict: a choice over the item's options, each said in words (a person by name). */
export function questionsOf(focus) {
  const { item, anchor, hints } = focus;
  return [{ key: 'verdict', primitive: 'choice', instructions: `${item.question}${anchor ? ` The line: ${anchor}.` : ''} Answer from the lines.`, options: item.options, optionHints: hints }];
}

/** A line as an option reads (Jev takes an option by its criterion, so a bare id says nothing): who says it, its first words. */
const lineHint = fields => `${fields?.said_by && !fields.said_by.startsWith('unsure') ? `${fields.said_by.split(' (')[0]}: ` : ''}${[...String(fields?.text ?? '')].slice(0, 48).join('')}`;

/**
 * The evidence: which of the lines kept (max 254, and "no line shows it") shows the answer. Asked of Jev after the verdict,
 * with it (W12: asked beside the verdict over bare ids, Jev said no line shows it on 110 of 154); asked of the work model
 * beside the verdict, of its own answer.
 */
export function evidenceQuestion(focus, ids, verdict = null) {
  const fields = new Map(focus.lines.map(entry => [entry.id, entry.fields])), lines = [...ids].sort().slice(0, 254);
  const instructions = verdict
    ? `The answer to "${focus.item.question.slice(0, 200)}" is: ${verdict.hint ?? verdict.value}. Which one line of the book shows that best? Or "${NO_LINE}" when none bears on it.`
    : `Which one line shows your answer to the verdict best? Its id, or "${NO_LINE}" when none does.`;
  return { key: 'evidence', primitive: 'choice', instructions, options: [...lines, NO_LINE], optionHints: { ...Object.fromEntries(lines.map(id => [id, lineHint(fields.get(id))])), [NO_LINE]: 'none of these lines bears on the answer' } };
}

/** The mode (context-engine.md): the item kept, the lines in reading order, the people kept. */
export function modeOf(kind) {
  return {
    name: `review:${kind}`, task: ['who-speaks', 'speaker'].includes(kind) ? TASK_SPEAKER : TASK,
    sources: [
      { name: 'item', key: 'item', quota: 0, keep: true, collect: focus => [{ id: focus.item.id, score: 1, fields: focus.asked }] },
      // The pack's order is its need (the item, the window, the searched by nearness): over budget, the farthest go first.
      { name: 'lines', key: 'lines', quota: 1000, ranked: true, collect: focus => focus.lines.map(({ id, fields }) => ({ id, score: 1, fields })) },
      { name: 'people', key: 'people', quota: 0, keep: true, always: true, collect: focus => focus.who.map(({ id, fields }) => ({ id, score: 1, fields })) },
    ],
    cutOrder: ['lines'], questions: questionsOf, budget: 60_000,
    // Jev reads the lines in the book's order (ids sort so).
    render: state => ({ ...state, lines: Object.fromEntries(Object.entries(state.lines ?? {}).sort(([a], [b]) => a.localeCompare(b))) }),
  };
}

/** An answer from the replies: the pick, how sure, the runner-up, the distribution. */
export function readAnswer(replies, key) {
  const reply = replies.find(entry => entry.key === key);
  if (!reply) return null;
  const ranked = Object.entries(reply.distribution ?? {}).sort((a, b) => b[1] - a[1]);
  const runnerUp = ranked.find(([option]) => option !== String(reply.value)) ?? null;
  return { value: String(reply.value), confidence: reply.confidence ?? ranked[0]?.[1] ?? null, ...(runnerUp ? { runnerUp: runnerUp[0], runnerUpP: pct(runnerUp[1]) } : {}), ...(reply.distribution ? { distribution: Object.fromEntries(ranked.slice(0, 6).map(([option, p]) => [option, pct(p)])) } : {}), ...(reply.by ? { by: reply.by } : {}) };
}

/**
 * Which answer is used and whether it stands (§6): Jev's, or below 0.5 the work model's; on to Pi when the two weak
 * readings disagree, when no line shows it, when identity is not sure enough, or when the laws turn it back.
 */
export function route(item, { jev, jevLine, work = null, workLine = null, law = null }) {
  const unsure = (jev?.confidence ?? 0) < STAND;
  const used = unsure && work ? { verdict: work.value, line: workLine?.value ?? jevLine?.value ?? null, by: 'work' } : { verdict: jev?.value ?? null, line: jevLine?.value ?? null, by: 'jev' };
  const escalate = [];
  if (!jev) escalate.push('Jev gave no answer');
  if (unsure && work && work.value !== jev?.value) escalate.push('Jev unsure, and the work model picks another');
  if (used.line === NO_LINE || !used.line) escalate.push('no line shows it');
  if (STRICT_KINDS.has(item.kind) && !((jev?.confidence ?? 0) >= STRICT && work && work.value === jev?.value)) escalate.push(`${item.kind}: Jev below ${STRICT} or the work model not agreeing`);
  if (law) escalate.push(law);
  return { ...used, stands: escalate.length === 0, escalate };
}

/** Rule answers for unpaid runs: the reading's guess where it is an option, else by a hash; evidence the item's line. */
export function standIn(roles = {}) {
  const hash = text => parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16);
  return Object.assign(async (state, questions) => questions.map(question => {
    const h = hash(JSON.stringify([question.key, question.instructions, question.options])), options = question.options ?? [];
    const line = String(question.instructions).match(/The line: (b\d{4}_s\d{4})/)?.[1];
    const guess = line ? roles[line]?.who?.answer : null;
    const value = question.key === 'evidence' ? (options.find(option => state?.item && Object.values(state.item).some(entry => entry.line === option)) ?? options[0]) : options.includes(guess) ? guess : options[h % options.length];
    const confidence = Math.round((0.3 + (h % 70) / 100) * 100) / 100;
    return { key: question.key, value, confidence, distribution: { [value]: confidence, ...(options.find(option => option !== value) ? { [options.find(option => option !== value)]: Math.round((1 - confidence) * 100) / 100 } : {}) } };
  }), { modelId: 'stand-in' });
}
/** A ruled work model for unpaid runs: agrees with the first option's hash half the time (system2.mjs reads its JSON). */
export const standInWork = { modelId: 'stand-in-work', generate: async ({ prompt }) => { const request = JSON.parse(prompt); return JSON.stringify({ answers: request.questions.map((question, n) => ({ key: question.key, value: String(question.options[(n + request.questions.length) % question.options.length].option), confidence: 0.6 })) }); } };

/** Review `items` (pool items) and append one answer line per item to `out`. */
export async function reviewItems(items, { book, people, roles, cards, scenes, ledger, script, pins, spans = null, voices = null, decide, work: workModel = null, out = null, dry = false, concurrency = 4, looks = 0, minLooks = 0, workAll = false, log = () => {} }) {
  const results = [];
  const { ask, compose } = await load('dist/src/v2/context/engine.js');
  const one = async unit => {
    const item = unit[0], asked = askedQuote(unit.map(member => asAsked(member, { ledger, book, people, roles })));
    const mode = modeOf(item.kind), ctx = { book, people, roles, scenes };
    // The pack: fixed (evidence.mjs), or made by Jev's own looks (look.mjs, §14).
    let pack, extra = {}, moves = null, workLook = null;
    if (looks > 0 && !dry) {
      const state = startOf(asked, ctx, anchorOf(asked));
      moves = [];
      const said = value => asked.optionHints?.[value] ?? people.get(value)?.name ?? value;
      const extraOf = () => ({ ...(state.done.length ? { read: state.done.map(look => (look.move === 'work' ? 'asked the work model' : `${look.move}: ${look.added} lines`)) } : {}), ...(state.notes.length ? { notes: state.notes } : {}) });
      for (let left = looks; left > 0; left--) {
        // The first `minLooks` looks must read (no answer, no hand-off): to test the choice of look apart from stopping.
        const menu = menuOf(state, ctx, { work: !!workModel }).filter(entry => looks - left >= minLooks || !['answer', 'pi'].includes(entry.key));
        const now = await compose(mode, focusOf(asked, packOf(state), { book, people, roles, voices }, extraOf()), null);
        const reply = readAnswer(await decide(now.document, [lookQuestion(state, menu, left)]), 'look');
        const move = menu.some(entry => entry.key === reply?.value) ? reply.value : 'answer';
        moves.push({ move, confidence: reply?.confidence ?? null, runnerUp: reply?.runnerUp ?? null, menu: menu.length });
        if (move === 'answer' || move === 'pi') break;
        if (move === 'work') {
          workLook = readAnswer(await workAnswers(workModel, now.document, now.questions).catch(() => []), 'verdict');
          state.notes.push(workLook ? `the work model reads it as: ${said(workLook.value)} (sure ${workLook.confidence})` : 'the work model gave no answer');
          state.done.push({ move: 'work', added: 0 });
          continue;
        }
        moves.at(-1).added = lookAt(state, move, ctx).length;
      }
      pack = packOf(state); extra = extraOf();
    } else pack = packFor(asked, { book, people, cards, scenes, more: asked.to ? [asked.to] : [] });
    const focus = focusOf(asked, pack, { book, people, roles, voices }, extra);
    if (dry) { const composed = await compose(mode, focus, null); return { item: item.id, kind: item.kind, dry: true, chars: composed.manifest.used, lines: pack.lines.length, options: asked.options.length }; }
    const { replies, composed } = await ask(decide, mode, focus, null);
    const jev = readAnswer(replies, 'verdict');
    const kept = composed.manifest.entries.filter(entry => entry.source === 'lines' && entry.kept).map(entry => entry.id);
    // System 2 below 0.5, on the very document and question Jev had (and the evidence for its own answer); identity
    // always (it needs the work model agreeing).
    let work = workLook, workLine = null;
    // `workAll`: the work model on every item, recorded beside Jev's (to measure its agreement as a gate, §15).
    if (!work && workModel && (workAll || STRICT_KINDS.has(item.kind) || (jev?.confidence ?? 0) < STAND)) {
      const second = await workAnswers(workModel, composed.document, [...composed.questions, evidenceQuestion(focus, kept)]).catch(() => []);
      work = readAnswer(second, 'verdict'); workLine = readAnswer(second, 'evidence');
    }
    // Jev's line for its own verdict: a second request on the same document.
    const jevLine = jev ? readAnswer(await decide(composed.document, [evidenceQuestion(focus, kept, { value: jev.value, hint: focus.hints[jev.value] })]), 'evidence') : null;
    const used = (jev?.confidence ?? 0) < STAND && work ? work.value : jev?.value;
    const law = used ? lawAgainst({ item: asked, verdict: used }, { script, pins }) : null;
    const routed = route(asked, { jev, jevLine, work, workLine, law });
    if (moves?.at(-1)?.move === 'pi') { routed.stands = false; routed.escalate.push('Jev handed it on'); }
    const answer = {
      batch: item.batch ?? null, item: item.id, kind: item.kind, verdict: routed.verdict, reason: routed.line && routed.line !== NO_LINE ? `the line that shows it: ${routed.line}` : NO_LINE,
      by: routed.by, stands: routed.stands, escalate: routed.escalate, line: routed.line,
      jev: { ...jev, line: jevLine?.value ?? null, lineConfidence: jevLine?.confidence ?? null },
      work: work ? { ...work, line: workLine?.value ?? null } : null,
      ...(moves ? { looks: moves, seen: pack.lines } : {}),
      law, pack: { anchor: pack.anchor, lines: pack.lines.length, kept: composed.manifest.entries.filter(entry => entry.source === 'lines' && entry.kept).length, chars: composed.manifest.used }, options: asked.options,
      at: new Date().toISOString(),
    };
    // One answer per item; a quote's items share theirs (`group`).
    const answers = unit.map(member => ({ ...answer, batch: member.batch ?? null, item: member.id, ...(unit.length > 1 ? { group: unit.map(entry => entry.id) } : {}) }));
    for (const entry of answers) { if (out) await appendFile(out, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); log(entry); }
    return answers;
  };
  const queue = spans ? quoteGroups(items, { book, spans }) : items.map(item => [item]);
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => { while (queue.length) results.push(...[await one(queue.shift())].flat()); }));
  return results;
}

/** The book's stores for a review: sentences, reading, people, ledger, script and pins (read only). */
export async function storesOf(novelDir, readingPath) {
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const sentences = [...(await loadWorkspaceSentences(novelDir)).entries()].map(([id, sentence]) => ({ id, text: sentence.text }));
  const reading = JSON.parse(await readFile(readingPath, 'utf8'));
  const entities = jsonl(await readFile(join(novelDir, 'ontology', 'entities.jsonl'), 'utf8').catch(() => ''));
  const world = join(novelDir, 'stage', 'world');
  const pool = new Map(); for (const item of jsonl(await readFile(join(world, 'pool.jsonl'), 'utf8').catch(() => ''))) pool.set(item.id, item);
  const ledger = new Map(); for (const file of (await readdir(join(world, 'ledger')).catch(() => [])).filter(name => name.endsWith('.jsonl'))) for (const entry of jsonl(await readFile(join(world, 'ledger', file), 'utf8'))) ledger.set(entry.id, entry);
  const script = JSON.parse(await readFile(join(world, 'script.json'), 'utf8').catch(() => '{"scenes":[]}'));
  const book = bookOf(sentences), roles = reading.roles ?? {}, sceneOf = new Map((reading.scenes ?? []).flatMap(scene => (scene.sentences ?? []).map(line => [line, scene.id])));
  // Voices from the lines the reading is sure of (§16).
  const sure = Object.entries(roles).filter(([line, role]) => role?.kind === 'spoken' && role.who?.id && (role.who.confidence ?? 0) >= 0.6 && book.text.has(line));
  const voices = voicesOf(sure.map(([line, role]) => ({ who: role.who.id, quote: quoteOf(book.text.get(line)), scene: sceneOf.get(line) ?? null })), gramsOf);
  return {
    spans: quoteSpans(book), voices,
    book, people: peopleOf({ entities, slots: reading.slots ?? [], references: reading.references ?? [], roles: reading.roles ?? {} }), roles: reading.roles ?? {},
    cards: new Map((reading.cards ?? []).map(card => [card.id, card])), scenes: new Map((reading.scenes ?? []).map(scene => [scene.id, scene])),
    pool, ledger, script, pins: await loadPins(novelDir),
  };
}

async function main() {
  const { parseArgs } = await import('node:util');
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, out: { type: 'string' }, items: { type: 'string', default: 'answered' }, ids: { type: 'string' }, limit: { type: 'string' }, cache: { type: 'string' }, 'no-work': { type: 'boolean' }, 'stand-in': { type: 'boolean' }, dry: { type: 'boolean' }, concurrency: { type: 'string' }, looks: { type: 'string' }, 'min-looks': { type: 'string' }, 'work-all': { type: 'boolean' } } });
  if (!novelDir || !values.reading || (!values.out && !values.dry)) { console.error('usage: node world-engine/review/jev-review.mjs <novel-dir> --reading <data.json> --out <answers.jsonl> [--items answered|open|all] [--ids …] [--limit N] [--cache <dir>] [--no-work] [--stand-in] [--dry]'); process.exit(2); }
  const out = values.out ? resolve(values.out) : null;
  if (out && resolve(out).startsWith(resolve(novelDir))) { console.error('--out must be outside the book folder: this runner never writes the book'); process.exit(2); }
  const stores = await storesOf(resolve(novelDir), resolve(values.reading));
  const wanted = values.ids ? new Set(values.ids.split(',')) : null;
  let items = [...stores.pool.values()].filter(item => !['person', 'sheet', 'note', 'revision'].includes(item.kind));
  items = wanted ? items.filter(item => wanted.has(item.id)) : values.items === 'all' ? items : values.items === 'open' ? items.filter(item => item.status !== 'answered' && item.status !== 'applied') : items.filter(item => item.status === 'answered' || item.status === 'applied');
  items.sort((a, b) => String(a.batch ?? '').localeCompare(String(b.batch ?? '')) || a.id.localeCompare(b.id));
  if (values.limit) items = items.slice(0, Number(values.limit));
  let decide, work = null, usage = null;
  if (values['stand-in']) { decide = standIn(stores.roles); if (!values['no-work']) work = standInWork; }
  else if (!values.dry) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions, cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    const { PICKER_MODEL } = await import('../live/sim-jev.mjs');
    const cache = resolve(values.cache ?? join(dirname(out), 'cache'));
    const client = jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }); usage = client.usage;
    const cached = cachedDecisions(client, cache);
    decide = Object.assign((state, questions) => cached.decide(state, questions), { modelId: cached.modelId });
    if (!values['no-work']) {
      if (process.env.WORK_LLM_API_KEY) { const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'); work = cachedWork(workModelFromEnv(process.env), cache); }
      else console.error('system 2 off: no work model configured (WORK_LLM_API_KEY)');
    }
  }
  if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, '', { mode: 0o600 }); }
  let done = 0;
  const results = await reviewItems(items, { ...stores, decide, work, out, dry: values.dry, concurrency: Number(values.concurrency ?? 4), looks: Number(values.looks ?? 0), minLooks: Number(values['min-looks'] ?? 0), workAll: !!values['work-all'], log: answer => { done++; if (done % 10 === 0 || done === items.length) console.error(`${done}/${items.length} ${answer.kind} ${answer.verdict} by ${answer.by}${answer.stands ? '' : ` -> Pi (${answer.escalate.join('; ')})`}`); } });
  if (values.dry) { const chars = results.reduce((sum, row) => sum + row.chars, 0); console.log(JSON.stringify({ items: results.length, chars, lines: results.reduce((sum, row) => sum + row.lines, 0) / Math.max(1, results.length), byKind: results.reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] ?? 0) + 1 }), {}) })); return; }
  const tokens = (usage ?? []).reduce((sum, entry) => ({ input: sum.input + (entry?.input_tokens ?? 0), output: sum.output + (entry?.output_tokens ?? 0) }), { input: 0, output: 0 });
  const summary = { items: results.length, stands: results.filter(row => row.stands).length, byJev: results.filter(row => row.by === 'jev').length, byWork: results.filter(row => row.by === 'work').length, toPi: results.filter(row => !row.stands).length, jevRequests: usage?.length ?? null, jevTokens: tokens };
  console.log(JSON.stringify(summary));
  if (out) await writeFile(out.replace(/\.jsonl$/, '') + '.summary.json', JSON.stringify(summary, null, 1), { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

/**
 * Which of Jev's answers stand without Pi, kind by kind (§15–16, measured on W12 after the who-speaks fixes: 97% right
 * overall with Pi on the rest, as Pi alone, and Pi's time down by a third). A kind not named goes to Pi; so does an
 * answer the laws turn back.
 */
export const POLICY = {
  'who-speaks': { jev: 0.8 },
  reach: { jev: 0.7 },
  identity: { agree: true },
};
export function standsBy(answer, policy = POLICY) {
  const rule = policy[answer.kind], jev = answer.jev ?? {};
  if (!rule || answer.law || jev.value == null) return null;
  if (rule.jev !== undefined && (jev.confidence ?? 0) >= rule.jev) return `Jev ${Math.round((jev.confidence ?? 0) * 100)}%`;
  if (rule.agree && answer.work?.value === jev.value) return `Jev ${Math.round((jev.confidence ?? 0) * 100)}% and the work model agree`;
  return null;
}
/** Kinds the review by Jev asks (the cast's, the user's notes and revisions are Pi's). */
export const REVIEWED = new Set(['who-speaks', 'speaker', 'actor', 'talk', 'reach', 'identity']);

/**
 * The review by Jev after a director run (§16, wired): every batched item it can ask is asked; who-speaks options are
 * widened in the pool first (Pi sees them too); an answer the policy lets stand is recorded as Pi's are (answers.jsonl,
 * the item answered), with who settled it and how sure; the rest stay batched for Pi. Returns counts per kind.
 */
export async function reviewHeld(novelDir, { readingPath, decide, work = null, policy = POLICY, concurrency = 4, log = () => {} }) {
  const { writePool } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const stores = await storesOf(novelDir, readingPath);
  const batched = [...stores.pool.values()].filter(item => item.status === 'batched' && REVIEWED.has(item.kind));
  const widened = batched.filter(item => item.kind === 'who-speaks').map(item => { const asked = asAsked(item, stores); return { ...item, options: asked.options, optionHints: asked.optionHints, subjects: asked.subjects, names: asked.subjects.map(id => stores.people.get(id)?.name ?? id), ...(asked.to ? { to: asked.to } : {}), ...(asked.crowd ? { crowd: asked.crowd } : {}) }; });
  if (widened.length) await writePool(novelDir, widened);
  const items = batched.map(item => widened.find(entry => entry.id === item.id) ?? item);
  const answers = await reviewItems(items, { ...stores, decide, work, concurrency, log });
  const counts = {}, now = new Date().toISOString(), settled = [];
  for (const answer of answers) {
    const row = (counts[answer.kind] ??= { asked: 0, stood: 0 }), item = items.find(entry => entry.id === answer.item);
    row.asked++;
    const by = standsBy(answer, policy);
    if (!by || !item || !item.options.includes(answer.jev.value)) continue;
    row.stood++;
    settled.push({ item, answer: { batch: item.batch, item: item.id, verdict: answer.jev.value, reason: `${by}; ${answer.jev.line && answer.jev.line !== NO_LINE ? `the line that shows it: ${answer.jev.line}` : 'no single line'}`, at: now, by: answer.work?.value === answer.jev.value && policy[answer.kind]?.agree ? 'jev+work' : 'jev', confidence: answer.jev.confidence ?? null, ...(answer.group ? { group: answer.group } : {}) } });
  }
  if (settled.length) {
    await appendFile(join(novelDir, 'stage', 'world', 'answers.jsonl'), settled.map(({ answer }) => JSON.stringify(answer)).join('\n') + '\n', { mode: 0o600 });
    await writePool(novelDir, settled.map(({ item, answer }) => ({ ...item, status: 'answered', at: answer.at })));
  }
  return { asked: answers.length, stood: settled.length, toPi: answers.length - settled.length, byKind: counts };
}
