// How faculties should fire, tested on real faculty reads (the user, 2026-11-03): scenes tiled into segments
// (segment-tiling.mjs), then three stages.
//   oracle    every built faculty reader (conversation: talkOf, journeys: journeysOf, choreography: exchangesOf) on every
//             stretch, with the work model: what each finds there (items at least MOVE_SURE sure) is where it should
//             have fired. Paid: work-model requests, cached.
//   firing    the firing rule (specialists.mjs firing(): the mixed index's z-scores, on at kOn, off below kOff, at least
//             `minimum` windows, a margin either side) replayed over a grid, the stretches' distributions raw, smoothed or
//             between, beside a plain rule (fire where the faculty's types hold at least τ); each scored against the
//             oracle: recall, precision, F1, the share of stretches read. Nothing paid.
//   residual  the residual flow of typing: the faculties the best rule fires read their stretches, and what they found
//             goes into the context of the next type question (one Jev request a scene); the stretches retyped, fired
//             again, scored again. The faculties' reads are the oracle's (the same reads a fired faculty makes).
//   node experiments/v2/faculty-firing.mjs <novel-dir> <reading>/v2/data.json <segments.json> --stage oracle|firing|residual [--oracle file] [--grid file] [--out file]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { firing } from '../../world-engine/director/specialists.mjs';
import { windowsOf } from '../../world-engine/director/gate.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const FIRED = ['conversation', 'journeys', 'choreography'], SURE = 0.5;
const TYPES = ['routine', 'confrontation', 'traversal', 'mediated', 'interior', 'exposition', 'establishing', 'memory', 'catastrophe'];
const mean = list => { const out = Object.fromEntries(TYPES.map(type => [type, 0])); for (const dist of list) for (const type of TYPES) out[type] += (dist?.[type] ?? 0) / (list.length || 1); return out; };

/** The stretches of the segments file, each with its sentences and its distribution raw (as asked), smoothed, and between. */
export function stretchesOf(segments, order) {
  const position = new Map(order.map((id, n) => [id, n]));
  return segments.scenes.flatMap(scene => scene.segments.map(run => {
    const ids = order.slice(position.get(run.first), position.get(run.last) + 1), raw = mean(ids.map(id => scene.distributions[id]?.asked)), smoothed = mean(ids.map(id => scene.distributions[id]?.smoothed));
    return { scene: scene.scene, first: run.first, last: run.last, sentences: ids, type: run.type, confidence: run.confidence, raw, smoothed, between: Object.fromEntries(TYPES.map(type => [type, (raw[type] + smoothed[type]) / 2])) };
  }));
}

/** On at kOn, off below kOff after `minimum` windows, `margin` windows either side (firing()'s rule, its margin free). */
export function hysteresis(index, { kOn, kOff, minimum, margin }) {
  const on = new Array(index.length).fill(false);
  let state = false, since = 0;
  index.forEach((value, n) => { if (!state && value >= kOn) { state = true; since = n; } else if (state && value < kOff && n - since >= minimum) state = false; on[n] = state; });
  return on.map((_, n) => on.slice(Math.max(0, n - margin), n + margin + 1).some(Boolean));
}

/** Recall, precision, F1 and the share read, of `fired` against where the faculty found something. */
export function score(fired, found) {
  let hit = 0, firedCount = 0, should = 0;
  fired.forEach((value, n) => { if (value) firedCount++; if (found[n]) should++; if (value && found[n]) hit++; });
  const recall = should ? hit / should : 1, precision = firedCount ? hit / firedCount : 1;
  return { recall: Math.round(recall * 100) / 100, precision: Math.round(precision * 100) / 100, f1: Math.round((recall + precision ? 2 * recall * precision / (recall + precision) : 0) * 100) / 100, read: Math.round(firedCount / (fired.length || 1) * 100) / 100 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir, readingPath, segmentsPath] } = parseArgs({ allowPositionals: true, options: { stage: { type: 'string' }, oracle: { type: 'string' }, grid: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !readingPath || !segmentsPath || !values.stage) { console.error('usage: node experiments/v2/faculty-firing.mjs <novel-dir> <data.json> <segments.json> --stage oracle|firing|residual [--oracle file] [--out file]'); process.exit(2); }
  const reading = JSON.parse(await readFile(readingPath, 'utf8')), segments = JSON.parse(await readFile(segmentsPath, 'utf8'));
  const order = reading.scenes.flatMap(scene => scene.sentences), stretches = stretchesOf(segments, order);
  const oraclePath = resolve(values.oracle ?? join(dirname(resolve(segmentsPath)), 'firing-oracle.json'));

  if (values.stage === 'oracle') {
    const DG = await import('../../world-engine/digest/digest.mjs'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    const text = await loadWorkspaceSentences(resolve(novelDir)), work = cachedWork(workModelFromEnv(process.env), join(dirname(resolve(segmentsPath)), 'cache-work-firing'));
    const names = new Map((await readFile(join(resolve(novelDir), 'ontology', 'entities.jsonl'), 'utf8')).trim().split('\n').map(row => JSON.parse(row)).map(entity => [entity.id, entity.names?.[0]?.text ?? entity.id]));
    const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
    const peopleOf = new Map();
    for (const card of reading.cards ?? []) { const scene = sceneOf.get(card.first); if (!scene) continue; const set = peopleOf.get(scene) ?? peopleOf.set(scene, new Set()).get(scene); for (const person of card.people ?? []) set.add(person.id); }
    const line = id => text.get(id)?.text ?? '', kind = id => reading.kinds?.[id]?.kind ?? null;
    const out = [];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (next < stretches.length) {
      const stretch = stretches[next++], scene = reading.scenes.find(entry => entry.id === stretch.scene);
      const people = [...(peopleOf.get(stretch.scene) ?? [])].map(id => ({ id, name: names.get(id) ?? id })), common = { scene, spans: [stretch.sentences], line, kind, people, parallel: 1 };
      const [talk, journeys, exchanges] = await Promise.all([DG.talkOf(work, common), DG.journeysOf(work, common), DG.exchangesOf(work, common)]);
      const sure = list => (list ?? []).filter(entry => (entry.sure ?? 1) >= SURE);
      out.push({ scene: stretch.scene, first: stretch.first, last: stretch.last, found: { conversation: sure(talk?.exchanges).length + sure(talk?.formations).length, journeys: sure(journeys).length, choreography: sure(exchanges).length },
        items: { conversation: sure(talk?.exchanges).slice(0, 12).map(entry => ({ who: names.get(entry.who) ?? entry.who, with: (entry.with ?? []).map(id => names.get(id) ?? id), channel: entry.channel })), journeys: sure(journeys).map(entry => ({ who: names.get(entry.who) ?? entry.who, to: entry.to, manner: entry.manner })), choreography: sure(exchanges).slice(0, 12).map(entry => ({ attacker: names.get(entry.attacker) ?? entry.attacker, target: names.get(entry.target) ?? entry.target, attack: entry.attack, outcome: entry.outcome })) } });
    } }));
    const position = new Map(order.map((id, n) => [id, n]));
    out.sort((a, b) => position.get(a.first) - position.get(b.first));
    await writeFile(oraclePath, JSON.stringify({ stretches: out }, null, 1));
    console.log(JSON.stringify({ stretches: out.length, found: Object.fromEntries(FIRED.map(id => [id, out.filter(entry => entry.found[id]).length])) }));
  }

  const oracle = values.stage === 'oracle' ? null : JSON.parse(await readFile(oraclePath, 'utf8'));
  const foundOf = id => stretches.map(stretch => (oracle.stretches.find(entry => entry.first === stretch.first)?.found[id] ?? 0) > 0);
  /** Every rule over the grid for the stretches' distributions `pick` (raw, smoothed, between): each faculty's score. */
  const grid = (pick, distributions = null) => {
    const windows = windowsOf({ ...reading, blocks: stretches.map((stretch, n) => ({ first: stretch.first, last: stretch.last, sentences: stretch.sentences, type: stretch.type, confidence: Math.max(...Object.values((distributions?.[n]) ?? stretch[pick])), distribution: distributions?.[n] ?? stretch[pick] })) });
    const index = firing(windows).index, rows = [];
    for (const kOn of [0, 0.5, 1, 1.5, 2]) for (const kOff of [-0.5, 0, 0.5, 1]) for (const minimum of [0, 1, 2]) for (const margin of [0, 1]) {
      if (kOff > kOn) continue;
      const scores = Object.fromEntries(FIRED.map(id => [id, score(hysteresis(index[id], { kOn, kOff, minimum, margin }), foundOf(id))]));
      rows.push({ rule: 'mixed index', pick, kOn, kOff, minimum, margin, scores, f1: Math.round(FIRED.reduce((sum, id) => sum + scores[id].f1, 0) / FIRED.length * 100) / 100, read: Math.round(FIRED.reduce((sum, id) => sum + scores[id].read, 0) / FIRED.length * 100) / 100 });
    }
    for (const tau of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      const scores = Object.fromEntries(FIRED.map(id => [id, score(windows.map(window => (TYPE_OF[id] ?? []).reduce((sum, type) => sum + (window.block.distribution?.[type] ?? 0), 0) >= tau), foundOf(id))]));
      rows.push({ rule: 'types at least τ', pick, tau, scores, f1: Math.round(FIRED.reduce((sum, id) => sum + scores[id].f1, 0) / FIRED.length * 100) / 100, read: Math.round(FIRED.reduce((sum, id) => sum + scores[id].read, 0) / FIRED.length * 100) / 100 });
    }
    return { rows, index };
  };
  const { FACULTIES } = await import('../../world-engine/director/specialists.mjs'), TYPE_OF = Object.fromEntries(FIRED.map(id => [id, FACULTIES[id].types]));

  if (values.stage === 'firing') {
    const rows = ['raw', 'smoothed', 'between'].flatMap(pick => grid(pick).rows).sort((a, b) => b.f1 - a.f1);
    const always = Object.fromEntries(FIRED.map(id => [id, score(stretches.map(() => true), foundOf(id))]));
    await writeFile(resolve(values.out ?? 'firing-grid.json'), JSON.stringify({ stretches: stretches.length, always, rows }, null, 1));
    const now = rows.find(row => row.rule === 'mixed index' && row.pick === 'smoothed' && row.kOn === 1.5 && row.kOff === 0.5 && row.minimum === 2 && row.margin === 1);
    console.log(JSON.stringify({ stretches: stretches.length, found: Object.fromEntries(FIRED.map(id => [id, foundOf(id).filter(Boolean).length])), always, now, best: rows.slice(0, 8) }));
  }

  if (values.stage === 'residual') {
    const S = await load('dist/src/digger/autostep/segmentation.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    const text = await loadWorkspaceSentences(resolve(novelDir)), said = id => text.get(id)?.text ?? '';
    const usage = { requests: 0 }, live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { usage.requests++; return live.decide(...args); } }, join(dirname(dirname(resolve(readingPath))), 'cache'));
    const grids = JSON.parse(await readFile(resolve(values.grid ?? 'firing-grid.json'), 'utf8'));
    const best = grids.rows[0], before = grid(best.pick);
    const fired = Object.fromEntries(FIRED.map(id => [id, best.rule === 'mixed index' ? hysteresis(before.index[id], best) : before.rows.length && stretches.map((stretch, n) => (TYPE_OF[id] ?? []).reduce((sum, type) => sum + (stretch[best.pick][type] ?? 0), 0) >= best.tau)]));
    // What the fired faculties found in each stretch, in words, for the next type question.
    const summary = (stretch, n) => {
      const entry = oracle.stretches.find(row => row.first === stretch.first), parts = [];
      if (fired.choreography[n]) parts.push(entry.items.choreography.length ? `the fight choreographer read ${entry.found.choreography} exchanges: ${entry.items.choreography.slice(0, 4).map(item => `${item.attacker ?? 'the world'} on ${item.target ?? 'a place'} (${item.attack}, ${item.outcome})`).join('; ')}` : 'the fight choreographer read it and found no blows');
      if (fired.journeys[n]) parts.push(entry.items.journeys.length ? `the chase unit read ${entry.found.journeys} journeys: ${entry.items.journeys.slice(0, 4).map(item => `${item.who} to ${item.to} (${item.manner})`).join('; ')}` : 'the chase unit read it and found nobody going anywhere');
      if (fired.conversation[n]) parts.push(entry.items.conversation.length ? `the conversation reader read ${entry.found.conversation} lines or groups: ${[...new Set(entry.items.conversation.map(item => item.channel))].join(', ')}` : 'the conversation reader read it and found no talk');
      return parts.length ? parts.join('. ') : 'no specialist read it';
    };
    const retyped = new Array(stretches.length);
    for (const scene of segments.scenes) {
      const indexes = stretches.map((stretch, n) => [stretch, n]).filter(([stretch]) => stretch.scene === scene.scene);
      const state = { task: 'A scene of a novel cut into stretches. Say what each stretch is mostly about (the kinds are defined in stretches). Under found is what the specialists who read a stretch found in it.', stretches: { ...S.BLOCK_TYPES },
        segments: Object.fromEntries(indexes.map(([stretch], k) => [`segment_${k + 1}`, stretch.sentences.map(said).join('')])), found: Object.fromEntries(indexes.map(([stretch, n], k) => [`segment_${k + 1}`, summary(stretch, n)])) };
      const answers = await jev.decide(state, indexes.map((_, k) => ({ key: `seg_retype:${k + 1}`, primitive: 'choice', instructions: `What is segments.segment_${k + 1} mostly about?`, options: TYPES, optionHints: { ...S.BLOCK_TYPES } })));
      indexes.forEach(([, n], k) => { const answer = answers.find(entry => entry.key === `seg_retype:${k + 1}`); retyped[n] = Object.fromEntries(TYPES.map(type => [type, answer?.distribution?.[type] ?? (answer?.value === type ? 1 : 0)])); });
    }
    const after = grid(best.pick, retyped), again = best.rule === 'mixed index' ? after.rows.find(row => row.rule === best.rule && row.kOn === best.kOn && row.kOff === best.kOff && row.minimum === best.minimum && row.margin === best.margin) : after.rows.find(row => row.rule === best.rule && row.tau === best.tau);
    const bestAfter = [...after.rows].sort((a, b) => b.f1 - a.f1)[0];
    await writeFile(resolve(values.out ?? 'firing-residual.json'), JSON.stringify({ best, before: best.scores, after: again.scores, bestAfter, retyped: stretches.map((stretch, n) => ({ first: stretch.first, last: stretch.last, before: stretch[best.pick], after: retyped[n] })), usage }, null, 1));
    console.log(JSON.stringify({ usage, rule: { ...best, scores: undefined }, before: { f1: best.f1, read: best.read, scores: best.scores }, after: { f1: again.f1, read: again.read, scores: again.scores }, bestAfter: { ...bestAfter, scores: bestAfter.scores } }));
  }
}
