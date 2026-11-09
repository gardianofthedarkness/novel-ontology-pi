// The review by Jev measured against Pi's answers (docs/v2/jev-review.md §8): pack recall on the lines Pi cited (free), and
// for an answers file of world-engine/review/jev-review.mjs, agreement with Pi per kind, how sure against how often right
// (the calibration that sets §6's thresholds), and the disagreements to read. `--settled <json>` (item → the answer the
// text supports, read by hand where the two disagree) scores against that instead of Pi alone.
//
//   node experiments/v2/review-measure.mjs <novel-dir> --reading <data.json> [--answers <jev.jsonl>] [--settled <json>] [--out <report.json>]
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { packFor } from '../../world-engine/review/evidence.mjs';
import { asAsked, storesOf, STAND, STRICT } from '../../world-engine/review/jev-review.mjs';

const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, answers: { type: 'string' }, settled: { type: 'string' }, out: { type: 'string' } } });
if (!novelDir || !values.reading) { console.error('usage: node experiments/v2/review-measure.mjs <novel-dir> --reading <data.json> [--answers <jev.jsonl>] [--settled <json>] [--out <report.json>]'); process.exit(2); }
const jsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));
const stores = await storesOf(novelDir, values.reading);
const pi = new Map(jsonl(await readFile(`${novelDir}/stage/world/answers.jsonl`, 'utf8')).map(answer => [answer.item, answer]));

// Pi's cited lines: sentence ids in its reason, ranges ("b0004_s0040-s0041") opened.
const cited = reason => [...String(reason ?? '').matchAll(/\b(b\d{4})_s(\d{4})(?:\s*[-–]\s*(?:b\d{4}_)?s?(\d{4}))?/g)].flatMap(([, book, a, b]) => { const from = Number(a), to = b && Number(b) >= from && Number(b) - from <= 30 ? Number(b) : from; return Array.from({ length: to - from + 1 }, (_, n) => `${book}_s${String(from + n).padStart(4, '0')}`); });
const report = { recall: {}, agreement: {}, calibration: [], coverage: [], lines: {}, disagreements: [] };

// 1. Pack recall (free).
const byKind = {};
for (const [id, answer] of pi) {
  const item = stores.pool.get(id); if (!item) continue;
  const lines = [...new Set(cited(answer.reason))].filter(line => stores.book.pos.has(line));
  if (!lines.length) continue;
  const asked = asAsked(item, { ledger: stores.ledger }), pack = packFor(asked, { ...stores, more: asked.to ? [asked.to] : [] });
  const row = (byKind[item.kind] ??= { items: 0, lines: 0, held: 0, itemsAny: 0 });
  const held = lines.filter(line => pack.lines.includes(line)).length;
  row.items++; row.lines += lines.length; row.held += held; if (held) row.itemsAny++;
}
const total = Object.values(byKind).reduce((sum, row) => ({ items: sum.items + row.items, lines: sum.lines + row.lines, held: sum.held + row.held, itemsAny: sum.itemsAny + row.itemsAny }), { items: 0, lines: 0, held: 0, itemsAny: 0 });
report.recall = { ...Object.fromEntries(Object.entries(byKind).map(([kind, row]) => [kind, { ...row, share: +(row.held / row.lines).toFixed(3) }])), all: { ...total, share: +(total.held / total.lines).toFixed(3) } };
console.log('pack recall of the lines Pi cited:', JSON.stringify(report.recall));

// 2. Jev's answers against Pi's (or the settled answers).
if (values.answers) {
  const settled = values.settled ? JSON.parse(await readFile(values.settled, 'utf8')) : {};
  const rows = jsonl(await readFile(values.answers, 'utf8'));
  // Pi's "none of them" covers the two ways no one listed says it (R1 split it); the crowd is not one (Pi had its members).
  const NONE = new Set(['none of them', 'a voice from elsewhere', 'someone unnamed']);
  const same = (a, b) => a === b || (NONE.has(a) && NONE.has(b)) || (a === 'someone in the crowd' && String(b).startsWith('crowd:'));
  const truth = row => settled[row.item]?.verdict ?? pi.get(row.item)?.verdict;
  // A settled answer may accept more than one option (`also`: the same person under a slot, two equally fitting).
  const fits = (row, value) => [truth(row), ...(settled[row.item]?.also ?? [])].some(accepted => same(value, accepted));
  const scored = rows.filter(row => truth(row) !== undefined && settled[row.item]?.verdict !== 'unclear').map(row => ({ ...row, truth: truth(row), right: fits(row, row.jev?.value), usedRight: fits(row, row.verdict), workRight: row.work ? fits(row, row.work.value) : null }));
  report.unclear = rows.filter(row => settled[row.item]?.verdict === 'unclear').length;
  const kinds = [...new Set(scored.map(row => row.kind))];
  for (const kind of [...kinds, 'all']) {
    const list = scored.filter(row => kind === 'all' || row.kind === kind), stands = list.filter(row => row.stands);
    report.agreement[kind] = { items: list.length, piRight: list.filter(row => fits(row, pi.get(row.item)?.verdict)).length, jevRight: list.filter(row => row.right).length, usedRight: list.filter(row => row.usedRight).length, stands: stands.length, standsRight: stands.filter(row => row.usedRight).length, toPi: list.length - stands.length, byWork: list.filter(row => row.by === 'work').length, workRight: list.filter(row => row.by === 'work' && row.usedRight).length };
  }
  // Calibration: Jev's verdict confidence in bins, and the share right in each.
  const bins = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
  for (let n = 0; n + 1 < bins.length; n++) { const list = scored.filter(row => (row.jev?.confidence ?? 0) >= bins[n] && (row.jev?.confidence ?? 0) < bins[n + 1]); report.calibration.push({ from: bins[n], to: Math.min(1, bins[n + 1]), items: list.length, right: list.filter(row => row.right).length, share: list.length ? +(list.filter(row => row.right).length / list.length).toFixed(2) : null, meanConfidence: list.length ? +(list.reduce((sum, row) => sum + row.jev.confidence, 0) / list.length).toFixed(2) : null }); }
  // Coverage: accepting Jev only at or above t, how many and how often right; and a rank measure (AUC) of confidence.
  for (const t of [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) { const list = scored.filter(row => (row.jev?.confidence ?? 0) >= t); report.coverage.push({ atLeast: t, kept: list.length, share: +(list.length / scored.length).toFixed(2), right: list.length ? +(list.filter(row => row.right).length / list.length).toFixed(3) : null }); }
  const right = scored.filter(row => row.right).map(row => row.jev?.confidence ?? 0), wrong = scored.filter(row => !row.right).map(row => row.jev?.confidence ?? 0);
  report.auc = right.length && wrong.length ? +(right.reduce((sum, r) => sum + wrong.reduce((s, w) => s + (r > w ? 1 : r === w ? 0.5 : 0), 0), 0) / (right.length * wrong.length)).toFixed(3) : null;
  // The margin over the runner-up as a second signal.
  const margin = row => (row.jev?.confidence ?? 0) - (row.jev?.runnerUpP ?? 0);
  report.aucMargin = right.length && wrong.length ? +(scored.filter(row => row.right).reduce((sum, r) => sum + scored.filter(row => !row.right).reduce((s, w) => s + (margin(r) > margin(w) ? 1 : margin(r) === margin(w) ? 0.5 : 0), 0), 0) / (right.length * wrong.length)).toFixed(3) : null;
  // The evidence line: in Pi's cited lines, or within 2 of one.
  const near = (line, list) => list.some(other => Math.abs((stores.book.pos.get(line) ?? -99) - (stores.book.pos.get(other) ?? 99)) <= 2);
  const withCites = scored.map(row => ({ row, lines: cited(pi.get(row.item)?.reason) })).filter(entry => entry.lines.length);
  report.lines = { items: withCites.length, exact: withCites.filter(entry => entry.lines.includes(entry.row.jev?.line)).length, within2: withCites.filter(entry => entry.row.jev?.line && near(entry.row.jev.line, entry.lines)).length, noLine: scored.filter(row => row.jev?.line === 'no line shows it').length };
  report.disagreements = scored.filter(row => !row.right || !row.usedRight).map(row => ({ item: row.item, kind: row.kind, jev: row.jev?.value, jevConfidence: row.jev?.confidence, runnerUp: row.jev?.runnerUp, work: row.work?.value ?? null, used: row.verdict, by: row.by, stands: row.stands, truth: row.truth, settledBy: settled[row.item] ? 'read' : 'pi', line: row.jev?.line, piLines: cited(pi.get(row.item)?.reason).slice(0, 6) }));
  // Looks (look.mjs, §14): how Jev read, how far it got, where it stopped, and how often it was right by each.
  if (scored.some(row => row.looks)) {
    const withLooks = scored.filter(row => row.looks), kindOf = move => move.split(':')[0];
    const moves = {}; for (const row of withLooks) for (const look of row.looks) moves[kindOf(look.move)] = (moves[kindOf(look.move)] ?? 0) + 1;
    const ended = row => { const last = row.looks.at(-1)?.move; return last === 'answer' ? `answered after ${row.looks.length - 1}` : last === 'pi' ? 'handed to Pi' : 'out of looks'; };
    const ends = {}; for (const row of withLooks) { const end = (ends[ended(row)] ??= { items: 0, right: 0 }); end.items++; if (row.right) end.right++; }
    const reach = withLooks.map(row => ({ row, cites: [...new Set(cited(pi.get(row.item)?.reason))].filter(line => stores.book.pos.has(line)) })).filter(entry => entry.cites.length);
    // What each kind of move found: the share of its looks that added one of Pi's cited lines (the start counts as one).
    // A look's lines are rebuilt from `seen` (the start, then each look's lines in turn) and the count each look added.
    const found = {};
    for (const { row, cites } of reach) {
      const order = row.seen ?? [], adds = row.looks.reduce((sum, look) => sum + (look.added ?? 0), 0);
      let at = order.length - adds;
      const start = (found.start ??= { looks: 0, hit: 0 }); start.looks++; if (order.slice(0, at).some(line => cites.includes(line))) start.hit++;
      for (const look of row.looks) {
        const n = look.added ?? 0, lines = order.slice(at, at + n); at += n;
        if (['answer', 'pi', 'work'].includes(kindOf(look.move))) continue;
        const entry = (found[kindOf(look.move)] ??= { looks: 0, hit: 0 }); entry.looks++; if (lines.some(line => cites.includes(line))) entry.hit++;
      }
    }
    report.looks = {
      items: withLooks.length, meanLooks: +(withLooks.reduce((sum, row) => sum + row.looks.filter(look => !['answer', 'pi'].includes(look.move)).length, 0) / withLooks.length).toFixed(2),
      meanLines: +(withLooks.reduce((sum, row) => sum + (row.seen?.length ?? 0), 0) / withLooks.length).toFixed(1), moves, ends,
      reach: { items: reach.length, lines: reach.reduce((sum, entry) => sum + entry.cites.length, 0), read: reach.reduce((sum, entry) => sum + entry.cites.filter(line => entry.row.seen?.includes(line)).length, 0), itemsAny: reach.filter(entry => entry.cites.some(line => entry.row.seen?.includes(line))).length },
      found,
      workAsked: withLooks.filter(row => row.looks.some(look => look.move === 'work')).length, workAskedRight: withLooks.filter(row => row.looks.some(look => look.move === 'work') && row.workRight).length,
    };
  }
  report.thresholds = { STAND, STRICT };
  console.log(JSON.stringify({ looks: report.looks, agreement: report.agreement, calibration: report.calibration, coverage: report.coverage, auc: report.auc, aucMargin: report.aucMargin, lines: report.lines, disagreements: report.disagreements.length }, null, 1));
}
if (values.out) await writeFile(values.out, JSON.stringify(report, null, 1), { mode: 0o600 });
