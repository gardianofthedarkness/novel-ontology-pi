// An unpaid rehearsal of the director (docs/v2/next-steps.md A6, M13): the stand-in Jev and a work model that answers by
// rule, over a copy of a workspace (never the live one: the director writes its records there). It proves the loop runs
// end to end at the volume's scale and counts what each milestone changed; it says nothing about how well Jev or the work
// model would answer.
//   node world-engine/director/rehearsal.mjs <copy of novel-dir> --reading <reading>/v2/data.json --from scene_000001 --to scene_000046 [--out report.json]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { direct, standIn } from './director.mjs';

/**
 * A work model answering every summarizer request by rule: the scene digest (everyone walking or standing, a few in
 * the crowd), the window digest (action lines move the first person, now and then a stated "indoors"), scale (by the
 * beat's type), journeys, exchanges and talk (from the passage's action and spoken lines).
 */
export function ruledWork() {
  const reply = (body, prompt = 50, completion = 20) => ({ content: JSON.stringify(body), usage: { promptTokens: prompt, completionTokens: completion } });
  return { modelId: 'ruled-work', async generateWithUsage({ prompt }) {
    const request = JSON.parse(prompt), people = (request.people ?? []).map(person => person.id), [a, b] = people, c = people[2] ?? null;
    const lines = request.passage ?? [], action = lines.filter(line => line.kind === 'action'), spoken = lines.filter(line => line.kind === 'spoken');
    if (request.beat) { const t = request.beat.type; return reply({ zoom: t === 'traversal' ? 'block' : t === 'routine' || t === 'interior' ? 'room' : 'street', metres: t === 'traversal' ? 400 : 60, angle: t === 'traversal' ? 'aerial' : 'high', reach: t === 'traversal' ? '50–300 m' : 'under 50 m', sure: 0.7 }); }
    if (request.shape?.journeys) return reply({ journeys: a ? action.slice(0, 2).map((line, k) => ({ sentence: line.id, who: a, to: k && request.places?.[0] ? request.places[0].id : 'the tallest tower', manner: k ? 'run' : 'leaps between roofs', distance: '50–300 m', sure: 0.8 })) : [] });
    if (request.shape?.exchanges) return reply({ exchanges: a && b ? action.slice(0, 6).map((line, k) => ({ sentence: line.id, attacker: k % 2 ? b : a, target: k % 2 ? a : b, attack: ['hand to hand', 'ranged power', 'area blast'][k % 3], shape: 'point', range: k % 3 ? 'near (under 15 m)' : 'close (under 3 m)', outcome: ['hit', 'dodged', 'blocked'][k % 3], knockback: k % 3 ? 0 : 6, condition: k === 2 ? 'hurt' : null, sure: k % 4 === 3 ? 0.4 : 0.8 })) : [] });
    if (request.shape?.formations) return reply({ exchanges: a && b ? spoken.slice(0, 8).map((line, k) => ({ sentence: line.id, who: a, with: [b], channel: k % 4 === 3 ? 'phone' : 'face to face', sure: 0.8 })) : [], formations: a && b && spoken[0] ? [{ sentence: spoken[0].id, who: c ? [a, b, c] : [a, b], formation: 'a ring', sure: 0.8 }] : [], attention: [] });
    if (request.key || !request.shape) return reply({ answers: [] }, 1, 1);
    if (!request.passage) return reply({ summary: 'ruled', where: 'a street', background: { doing: 'standing', crowd: 'few', crowdDoing: 'strolling' }, people: people.map((who, k) => ({ who, doing: k % 2 ? 'standing' : 'walking', holding: [] })), memory: 'ruled' });
    const moves = [], facts = [];
    lines.forEach((line, k) => {
      if (line.kind === 'action' && a) moves.push({ sentence: line.id, who: a, motion: ['step', 'nearby', 'elsewhere'][k % 3], toward: b ?? null, how: 'walk', basis: 'stated', sure: 0.8 });
      if (k % 17 === 4 && a) facts.push({ sentence: line.id, who: a, kind: 'indoors', basis: 'stated', sure: 0.9 });
    });
    return reply({ moves, facts, items: [], talk: [], breaks: [], background: [] }, 100, 40);
  } };
}

/** What a run did, for the milestones: scenes played and cast, camera jumps, moves by source, fights, talk, laws, usage. */
export function measure(record) {
  const cards = record.scenes.flatMap(scene => scene.cards), moves = cards.flatMap(card => card.moves), moved = moves.filter(move => move.moved);
  let jumps = 0, cameras = 0;
  for (const scene of record.scenes) { let last = null; for (const card of scene.cards) { const focus = card.camera?.focus; if (!focus) continue; cameras++; if (last && Math.hypot(focus.x - last.x, focus.z - last.z) > 40) jumps++; last = focus; } }
  const source = move => { const why = String(move.why ?? ''); return why.split(':')[0].replace(/ .*/, '') || (move.direction && /^[A-Z]$/.test(move.direction) ? 'jev' : 'other'); };
  const count = list => list.reduce((sum, key) => ({ ...sum, [key]: (sum[key] ?? 0) + 1 }), {});
  return {
    scenes: record.scenes.length, cast: record.scenes.filter(scene => Object.keys(scene.starts ?? {}).length).length, castFrom: count(record.scenes.map(scene => scene.castFrom).filter(Boolean)), gathered: record.scenes.reduce((n, scene) => n + (scene.gathered?.length ?? 0), 0),
    cards: cards.length, cameras, jumps, moved: moved.length, bySource: count(moved.map(source)),
    basement: moved.filter(move => /^under /.test(move.to ?? '')).length, airborne: moved.filter(move => move.airborne).length,
    beats: record.gate?.beats ?? null, scaled: record.scenes.reduce((n, scene) => n + (scene.scales?.length ?? 0), 0), journeys: record.scenes.reduce((n, scene) => n + (scene.journeys?.length ?? 0), 0),
    exchanges: cards.reduce((n, card) => n + (card.exchanges?.length ?? 0), 0), askedJev: cards.reduce((n, card) => n + (card.exchanges?.filter(entry => entry.by === 'jev').length ?? 0), 0), conditions: cards.reduce((n, card) => n + (card.conditions?.length ?? 0), 0),
    talkKinds: count(cards.map(card => card.talk?.kind).filter(Boolean)), formations: cards.reduce((n, card) => n + (card.formations?.length ?? 0), 0),
    laws: count(cards.flatMap(card => (card.laws ?? []).map(law => `${law.law} ${law.verdict}`))), calls: record.calls, usage: record.usage,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node world-engine/director/rehearsal.mjs <copy of novel-dir> --reading <data.json> --from <scene> --to <scene> [--out report.json]'); process.exit(2); }
  const reading = JSON.parse(await readFile(values.reading, 'utf8')), started = Date.now();
  const { record } = await direct(resolve(novelDir), { reading, from: values.from, to: values.to, jev: standIn(), workModel: ruledWork(), speakers: false, log: () => {} });
  const report = { from: values.from, to: values.to, minutes: Math.round((Date.now() - started) / 6000) / 10, ...measure(record) };
  if (values.out) await writeFile(resolve(values.out), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
}
