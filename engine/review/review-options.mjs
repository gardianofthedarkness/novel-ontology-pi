// Which reviewer for which kind of held item (docs/v3/design.html#jev-review §15; the user, 2026-11-07: "Maybe in some category
// of question the mini harness of jev is enough, but for some it's not. Can we test it out?"). From answer files the
// review runner wrote on the same items and the settled answers, each option per kind: how many answers stand without
// Pi, how many of those are right, how many are right overall with Pi taking the rest, Pi's load, and the cost.
//
//   node engine/review/review-options.mjs <novel-dir> --fixed <answers with --work-all> --looks <answers with --looks>
//        --settled <settled.json> [--pi-misread <item,item…>] [--out <report.json>]
//
// Pi's answer on an item it takes is right as its reason reads (R1 now offers the one spoken to, whom its 16 option
// misses named), except the items named by --pi-misread. Prices: Jev and the work model as measured on W12 (§13), Pi
// as W12's review cost per item.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { fixed: { type: 'string' }, looks: { type: 'string' }, settled: { type: 'string' }, 'pi-misread': { type: 'string' }, out: { type: 'string' } } });
if (!novelDir || !values.fixed || !values.settled) { console.error('usage: node engine/review/review-options.mjs <novel-dir> --fixed <answers.jsonl> [--looks <answers.jsonl>] --settled <settled.json> [--pi-misread …] [--out …]'); process.exit(2); }
const jsonl = async path => (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const byItem = rows => new Map(rows.map(row => [row.item, row]));
const fixed = byItem(await jsonl(values.fixed)), looks = values.looks ? byItem(await jsonl(values.looks)) : new Map();
const settled = JSON.parse(await readFile(values.settled, 'utf8'));
const pi = byItem(await jsonl(`${novelDir}/stage/world/answers.jsonl`));
const misread = new Set((values['pi-misread'] ?? '').split(',').filter(Boolean));

const NONE = new Set(['none of them', 'a voice from elsewhere', 'someone unnamed']);
const same = (a, b) => a === b || (NONE.has(a) && NONE.has(b)) || (a === 'someone in the crowd' && String(b).startsWith('crowd:'));
const truth = id => (settled[id] ? [settled[id].verdict, ...(settled[id].also ?? [])] : [pi.get(id)?.verdict]);
const fits = (id, value) => value != null && truth(id).some(accepted => same(value, accepted));
const piRight = id => !misread.has(id);
// Per item (W12, §13): Jev's verdict and evidence $0.00053, the work model $0.00064, Pi $0.0028 and 0.42 min.
const COST = { jev: 0.082 / 154, work: 0.046 / 72, pi: 0.434 / 154, piMinutes: 65 / 154 };

const items = [...fixed.keys()].filter(id => settled[id]?.verdict !== 'unclear' && pi.has(id));
const kindOf = id => fixed.get(id).kind, group = kind => (kind === 'actor' || kind === 'speaker' ? 'presence (actor, speaker)' : kind);
const conf = id => fixed.get(id).jev?.confidence ?? 0, jevV = id => fixed.get(id).jev?.value, workV = id => fixed.get(id).work?.value ?? null;
const agree = id => workV(id) != null && same(workV(id), jevV(id));

/** Each option: for an item, the verdict it uses and whether it stands (else Pi takes it), and what it costs. */
const OPTIONS = [
  { name: 'Pi only', stand: () => false, verdict: () => null, cost: () => 0 },
  { name: 'Jev alone', stand: () => true, verdict: jevV, cost: () => COST.jev },
  { name: 'work model alone', stand: () => true, verdict: workV, cost: () => COST.work },
  { name: 'Jev, the work model below 0.5', stand: () => true, verdict: id => (conf(id) < 0.5 && workV(id) != null ? workV(id) : jevV(id)), cost: id => COST.jev + (conf(id) < 0.5 ? COST.work : 0) },
  ...(looks.size ? [{ name: 'Jev choosing its looks', stand: () => true, verdict: id => looks.get(id)?.jev?.value, cost: () => COST.jev * 1.8 }] : []),
  ...[0.5, 0.7, 0.8, 0.9].map(t => ({ name: `Jev at ${t}+, else Pi`, stand: id => conf(id) >= t, verdict: jevV, cost: () => COST.jev })),
  { name: 'Jev and the work model agreeing, else Pi', stand: agree, verdict: jevV, cost: () => COST.jev + COST.work },
  { name: 'agreeing or Jev at 0.8+, else Pi', stand: id => agree(id) || conf(id) >= 0.8, verdict: jevV, cost: () => COST.jev + COST.work },
];

const groups = [...new Set(items.map(id => group(kindOf(id))))].sort((a, b) => items.filter(id => group(kindOf(id)) === b).length - items.filter(id => group(kindOf(id)) === a).length);
const report = {};
for (const name of [...groups, 'all']) {
  const list = items.filter(id => name === 'all' || group(kindOf(id)) === name);
  report[name] = OPTIONS.map(option => {
    const stand = list.filter(id => option.stand(id)), rest = list.filter(id => !option.stand(id));
    const standRight = stand.filter(id => fits(id, option.verdict(id))).length, right = standRight + rest.filter(piRight).length;
    const cost = list.reduce((sum, id) => sum + option.cost(id), 0) + rest.length * COST.pi;
    return { option: option.name, items: list.length, stand: stand.length, standRight, right, share: +(right / list.length).toFixed(3), toPi: rest.length, costPer100: +(cost / list.length * 100).toFixed(3), piMinutesPer100: +(rest.length * COST.piMinutes / list.length * 100).toFixed(1) };
  });
}
for (const [name, rows] of Object.entries(report)) {
  console.log(`\n${name} (${rows[0].items} items)`);
  console.log(`  ${'option'.padEnd(44)} stand  right of those  right overall  to Pi  $/100 items  Pi min/100`);
  for (const row of rows) console.log(`  ${row.option.padEnd(44)} ${String(row.stand).padStart(5)}  ${(row.stand ? `${row.standRight} (${Math.round(100 * row.standRight / row.stand)}%)` : '—').padStart(14)}  ${`${row.right} (${Math.round(100 * row.share)}%)`.padStart(13)}  ${String(row.toPi).padStart(5)}  ${row.costPer100.toFixed(3).padStart(11)}  ${String(row.piMinutesPer100).padStart(10)}`);
}
if (values.out) await writeFile(values.out, JSON.stringify(report, null, 1), { mode: 0o600 });
