// Two v2 readings of one book, step by step (the user asked, 2026-10-31: what a change does to the price and the precision):
// how often the second agrees with the first, and how sure each was, for the sentence kinds, the typing, EM, story time
// and EM²; and what each paid. Entities are compared by name (their ids may differ). With --sample <file>, writes up to
// <n> disagreements of each step with their sentences, for a person to judge (it holds the book's text: keep it private).
//
//   node experiments/v2/compare.mjs <novel-dir> <reading-a> <reading-b> [--sample <file> [--n 15]]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const pct = (part, whole) => whole ? Number((100 * part / whole).toFixed(1)) : null;
const mean = list => list.length ? Number((list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(3)) : null;

export async function compare(novelDir, dirA, dirB, { sample = null, n = 15 } = {}) {
  const { loadBlocks } = await load('dist/src/v2/base.js');
  const [a, b] = await Promise.all([dirA, dirB].map(async dir => JSON.parse(await readFile(join(dir, 'v2', 'data.json'), 'utf8'))));
  const text = new Map((await loadBlocks(novelDir)).flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  const namer = data => {
    const entities = new Map(data.chart.entities.map(entity => [entity.id, entity])), slots = new Map((data.slots ?? []).map(slot => [slot.id, slot]));
    return id => !id ? null : slots.has(id) ? `unnamed ${slots.get(id).kind}: ${slots.get(id).label}` : entities.get(id)?.proper[0] ?? entities.get(id)?.names[0] ?? id;
  };
  const nameA = namer(a), nameB = namer(b), out = {}, samples = {};
  const keep = (step, entry) => { (samples[step] ??= []).push(entry); };

  // Sentence kinds (the kind the classifier gave: before the action rule).
  const ids = Object.keys(a.kinds).filter(id => b.kinds[id]);
  const kindOf = kind => kind.was ?? kind.kind;
  const kindsDiffer = ids.filter(id => kindOf(a.kinds[id]) !== kindOf(b.kinds[id]));
  out.kinds = { sentences: ids.length, agree: pct(ids.length - kindsDiffer.length, ids.length), turnAgree: pct(ids.filter(id => (a.kinds[id].turn >= 0.5) === (b.kinds[id].turn >= 0.5)).length, ids.length), confidence: [mean(ids.map(id => a.kinds[id].confidence)), mean(ids.map(id => b.kinds[id].confidence))] };
  for (const id of kindsDiffer) keep('kinds', { id, text: text.get(id), a: kindOf(a.kinds[id]), b: kindOf(b.kinds[id]) });

  // Typing and EM, per listed string (the listing came from the same cache, so the strings are the same).
  const results = data => new Map(data.em.flatMap(batch => batch.results.map(result => [`${batch.batch}\u0000${result.text}`, result])));
  const ra = results(a), rb = results(b), both = [...ra.keys()].filter(key => rb.has(key));
  const typeDiffer = both.filter(key => ra.get(key).type !== rb.get(key).type);
  const said = (result, name) => result.entity ? name(result.entity) : result.outcome;
  const emBoth = both.filter(key => ra.get(key).type === rb.get(key).type);
  const emDiffer = emBoth.filter(key => said(ra.get(key), nameA) !== said(rb.get(key), nameB));
  out.typing = { strings: both.length, typeAgree: pct(both.length - typeDiffer.length, both.length) };
  out.em = { stringsTypedAlike: emBoth.length, agree: pct(emBoth.length - emDiffer.length, emBoth.length), outcomes: [count(ra), count(rb)] };
  for (const key of typeDiffer) { const [batch, string] = key.split('\u0000'); keep('typing', { batch, string, a: ra.get(key).type, b: rb.get(key).type }); }
  for (const key of emDiffer) { const [batch, string] = key.split('\u0000'); keep('em', { batch, string, type: ra.get(key).type, a: said(ra.get(key), nameA), b: said(rb.get(key), nameB) }); }

  // Story time.
  if (a.time && b.time) {
    const wa = new Map(a.time.words.map(word => [word.key, word])), wb = new Map(b.time.words.map(word => [word.key, word]));
    const words = [...wa.keys()].filter(key => wb.has(key)), roleDiffer = words.filter(key => wa.get(key).role !== wb.get(key).role);
    const scenes = a.scenes.map((scene, index) => [a.time.scenes[index]?.when, b.time.scenes[index]?.when]);
    out.time = { words: words.length, roleAgree: pct(words.length - roleDiffer.length, words.length), periods: [a.time.periods.length, b.time.periods.length], captionsAgree: pct(scenes.filter(([x, y]) => x === y).length, scenes.length) };
    for (const key of roleDiffer) keep('time', { word: wa.get(key).text, sentence: wa.get(key).sentence, text: text.get(wa.get(key).sentence), a: wa.get(key).role, b: wb.get(key).role });
  }

  // EM²: who says or does each line, who a line is said to, who each description means (lines both readings asked).
  const lines = Object.keys(a.roles).filter(id => b.roles[id]);
  const pick = (role, name, which) => role[which] ? (role[which].id ? name(role[which].id) : role[which].answer) : null;
  const whoDiffer = lines.filter(id => pick(a.roles[id], nameA, 'who') !== pick(b.roles[id], nameB, 'who'));
  const spoken = lines.filter(id => a.roles[id].to && b.roles[id].to), toDiffer = spoken.filter(id => pick(a.roles[id], nameA, 'to') !== pick(b.roles[id], nameB, 'to'));
  const sure = (data, list) => pct(list.filter(id => data.roles[id].who.id).length, list.length);
  const refKey = reference => `${reference.scene}\u0000${reference.text}\u0000${reference.sentences[0]}`;
  const refA = new Map(a.references.map(reference => [refKey(reference), reference])), refB = new Map(b.references.map(reference => [refKey(reference), reference]));
  const refs = [...refA.keys()].filter(key => refB.has(key)), meant = (reference, name) => reference.entity ? (reference.entity.startsWith('slot_') ? 'an unnamed one' : name(reference.entity)) : reference.answer;
  const refDiffer = refs.filter(key => meant(refA.get(key), nameA) !== meant(refB.get(key), nameB));
  out.roles = {
    lines: lines.length, onlyA: Object.keys(a.roles).length - lines.length, onlyB: Object.keys(b.roles).length - lines.length,
    whoAgree: pct(lines.length - whoDiffer.length, lines.length), toAgree: pct(spoken.length - toDiffer.length, spoken.length),
    whoSure: [sure(a, lines), sure(b, lines)], whoConfidence: [mean(lines.map(id => a.roles[id].who.confidence)), mean(lines.map(id => b.roles[id].who.confidence))],
    references: refs.length, referencesAgree: pct(refs.length - refDiffer.length, refs.length),
  };
  for (const id of whoDiffer) keep('who', { id, kind: a.roles[id].kind, text: text.get(id), a: `${pick(a.roles[id], nameA, 'who')} ${a.roles[id].who.confidence}`, b: `${pick(b.roles[id], nameB, 'who')} ${b.roles[id].who.confidence}` });

  // What each paid.
  // What each paid: Jev's tokens as it reported them (v2/jev-usage.json), the work model's from the log.
  out.paid = await Promise.all([[dirA, a], [dirB, b]].map(async ([dir, data]) => {
    const reported = JSON.parse(await readFile(join(dir, 'v2', 'jev-usage.json'), 'utf8').catch(() => '[]'));
    const sum = key => reported.reduce((total, entry) => total + (entry[key] ?? 0), 0);
    return { jevRequests: data.log?.paidRequests?.jev, jevInputTokens: sum('input_tokens'), jevOutputTokens: sum('output_tokens'), work: data.log?.usage?.work ?? null, wallMs: data.log?.wallMs, steps: (data.log?.steps ?? []).map(step => [step.step, step.requests, step.inputChars, step.questionChars ?? null]) };
  }));
  if (sample) {
    const pickSome = list => list.filter((_, index) => index % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
    await writeFile(sample, JSON.stringify(Object.fromEntries(Object.entries(samples).map(([step, list]) => [step, { total: list.length, sample: pickSome(list) }])), null, 1), { mode: 0o600 });
  }
  return out;
}

const count = results => [...results.values()].reduce((sum, result) => ({ ...sum, [result.outcome]: (sum[result.outcome] ?? 0) + 1 }), {});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), flag = name => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null; };
  const sample = flag('--sample'), n = Number(flag('--n') ?? 15), [novel, a, b] = args;
  if (!novel || !a || !b) { console.error('usage: node experiments/v2/compare.mjs <novel-dir> <reading-a> <reading-b> [--sample <file> [--n 15]]'); process.exit(2); }
  console.log(JSON.stringify(await compare(resolve(novel), resolve(a), resolve(b), { sample: sample && resolve(sample), n }), null, 1));
}
