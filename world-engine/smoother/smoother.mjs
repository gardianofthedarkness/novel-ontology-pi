// The smoother (docs/v2/world-ontology.md §5a "Back-propagation is Bayesian smoothing"; Track B W5b, the user and the
// research handoff "Trap reconstruction", 2026-11-02): every person a particle whose place at each moment is a cloud,
// smoothed over a director run with the action we define,
//
//   S = S_walk + S_seen + S_talk + S_frame
//
//   S_walk   moving between moments: metres (a floor as three) over the person's drive and the moments between;
//   S_seen   where the run had them, as tight as how it came to be (pinned, stated, met, answered, ruled): the history as
//            played is itself an observation, so least change is this term, as strong as its rank;
//   S_talk   a line face to face puts its speaker within reach of whom they speak to (public, within earshot).
//   S_frame  at a scene's start, the frame the reader gave its first beat (L16: the room, the street, measured round the
//            cast): someone outside it is pulled toward it as the reader's answer is trusted (the user, 2026-11-03: where
//            the strand's ground truth and a law disagree, smoothing settles it, not a rule).
//
// Forward-backward over each moment's cloud in log space gives each moment's posterior (α·β) and the least-action history
// (Viterbi); talk couples two people's clouds, so it is run twice, each person against the other's smoothed place. A
// cloud's spots are the walkable nodes the run touched in that scene (everyone's starts, every walked path and its other
// draws): the laws' walls are kept by what is there to stand on. Pure: the run's page, its world log and record in; no
// world, no model call.

const RANK_SIGMA = { pinned: 1.5, stated: 3, met: 3, answered: 8, ruled: 20 };
const REACH = { live: 4, group: 6, public: 25 };
const TALK_SIGMA = 2, STEP = 8, SCENE_GAP = 6, CLOUD = 48, KEEP = 8;
/** The most a scene start may move (m) before the revision goes to the review instead (§7b class R). */
export const REVISION_LIMIT = 300;
/** A line whose kind no one gave (neither Jev nor the review): face to face this likely, else from afar, a mixture. */
export const LIVE_PRIOR = 0.8;

const logSumExp = values => { const top = Math.max(...values); return top === -Infinity ? -Infinity : top + Math.log(values.reduce((sum, v) => sum + Math.exp(v - top), 0)); };
export const metres = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y);

/** The page's dense node as a point (world-log.mjs decoderOf). */
const decoderOf = world => node => { const i = node % world.NX - world.oi, j = Math.floor(node / world.NX) % world.NZ - world.oj, k = Math.floor(node / (world.NX * world.NZ)) - world.ok; return { x: (i + 0.5) * 2, z: (j + 0.5) * 2, y: k * 3 }; };

/**
 * Each person's moments over the run, in order: a scene's start and every card where they move or talk, each with the
 * node they were played at, how sure that is (the world log's rank), what they said to whom, and the scene's spots.
 */
export function momentsOf({ page, log, record, reading = null }) {
  const decode = decoderOf(page.world), pageScene = new Map(page.scenes.map(scene => [scene.id, scene]));
  const rankOf = new Map(log.filter(row => row.who).map(row => [`${row.scene}|${row.card ?? 'start'}|${row.who}`, row.rank]));
  const out = new Map(), spotsOf = new Map(), readCard = new Map((reading?.cards ?? []).map(card => [card.id, card]));
  // Whom a line is said to: the reading's (its answer even when unsure), else whom its card says is addressed.
  const toOf = (line, cardId) => { const role = reading?.roles?.[line.id]; return role?.to?.id ?? (role?.to?.answer && role.to.answer !== 'none' ? role.to.answer : null) ?? readCard.get(cardId)?.people?.find(person => person.how.includes('addressed') && person.id !== line.who)?.id ?? null; };
  // The crowd (the director's extras, then its field's samples, M9) is scenery, never observations.
  const add = (who, moment) => { if (!/^(extra|crowd):/.test(String(who))) (out.get(who) ?? out.set(who, []).get(who)).push(moment); };
  for (const entry of record.scenes) {
    const scene = pageScene.get(entry.scene);
    if (!scene) continue;
    // The scene's spots: every node the run stood or walked on in it.
    const spots = new Set(Object.values(scene.starts).filter(node => node != null));
    for (const event of scene.events) for (const move of event.moves) for (const path of [move.path, ...(move.ensemble ?? [])]) for (const node of path ?? []) spots.add(node);
    spotsOf.set(entry.scene, [...spots]);
    const now = Object.fromEntries(Object.entries(scene.starts).filter(([, node]) => node != null));
    // The scene's frame (L16), measured round its cast by the director: its middle and half its width.
    const frame = entry.frame?.middle ? { x: entry.frame.middle.x, z: entry.frame.middle.z, r: entry.frame.metres / 2 } : null;
    for (const [who, node] of Object.entries(now)) add(who, { scene: entry.scene, card: null, node, rank: rankOf.get(`${entry.scene}|start|${who}`) ?? 'ruled', draws: [], talk: [], ...(frame ? { frame } : {}) });
    const cardOf = new Map(entry.cards.map(card => [card.event, card]));
    scene.events.forEach((event, index) => {
      const card = cardOf.get(index), cardId = card?.card ?? event.id;
      for (const move of event.moves) {
        now[move.person] = move.path.at(-1);
        add(move.person, { scene: entry.scene, card: cardId, node: now[move.person], rank: rankOf.get(`${entry.scene}|${cardId}|${move.person}`) ?? 'answered', draws: (move.ensemble ?? []).map(draw => draw.at(-1)), talk: [] });
      }
      // A line said to someone (the reading's speaker and addressee, both there): a moment for each, coupled by its kind.
      if (card?.kind === 'dialogue') {
        // The kind Jev gave or the review pinned holds them together; with none given, a mixture of near and afar.
        const kind = card.talk?.kind ?? 'live', known = !!card.talk?.kind, pairs = new Set();
        for (const line of card.lines ?? []) { const to = line.to ?? toOf(line, cardId); if (line.who && to && now[line.who] != null && now[to] != null && line.who !== to) pairs.add(`${line.who}|${to}`); }
        for (const pair of pairs) {
          const [a, b] = pair.split('|');
          if (!REACH[kind]) continue;
          for (const [who, other] of [[a, b], [b, a]]) {
            const last = out.get(who)?.at(-1);
            if (last?.scene === entry.scene && last.card === cardId) last.talk.push({ with: other, reach: REACH[kind], known });
            else add(who, { scene: entry.scene, card: cardId, node: now[who], rank: rankOf.get(`${entry.scene}|${cardId}|${who}`) ?? last?.rank ?? 'ruled', draws: [], talk: [{ with: other, reach: REACH[kind], known }] });
          }
        }
      }
    });
  }
  for (const moments of out.values()) for (const moment of moments) { moment.at = decode(moment.node); moment.spots = spotsOf.get(moment.scene); }
  return { moments: out, decode };
}

/** A person's drive: how far they go a moment along their chains, against everyone's (median metres, ½ to 3 times). */
function drives(chains) {
  const step = lists => { const gaps = lists.flatMap(list => list.slice(1).map((moment, k) => metres(moment.at, list[k].at))).filter(gap => gap > 0.5).sort((a, b) => a - b); return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null; };
  const all = [...chains.values()].map(step).filter(value => value !== null).sort((a, b) => a - b), middle = all.length ? all[Math.floor(all.length / 2)] : STEP;
  return new Map([...chains.entries()].map(([who, lists]) => { const own = step(lists); return [who, own === null ? 1 : Math.min(3, Math.max(0.5, own / middle))]; }));
}

/** One person's clouds: forward-backward and the least-action path over their moments, against the others' places (`placeOf`). */
function smoothOne(list, { decode, drive, placeOf }) {
  const clouds = list.map(moment => {
    const nodes = new Set([moment.node, ...moment.draws, ...moment.talk.map(entry => placeOf(entry.with, moment)?.node).filter(node => node != null)]);
    // The nearest of the scene's spots, up to the cloud's size.
    const near = moment.spots.map(node => ({ node, gap: metres(decode(node), moment.at) })).sort((a, b) => a.gap - b.gap);
    for (const { node } of near) { if (nodes.size >= CLOUD) break; nodes.add(node); }
    return [...nodes].map(node => ({ node, at: decode(node) }));
  });
  // S_seen and S_talk at each spot of each moment.
  const local = list.map((moment, k) => clouds[k].map(spot => {
    const sigma = RANK_SIGMA[moment.rank] ?? RANK_SIGMA.ruled, seen = metres(spot.at, moment.at) ** 2 / (2 * sigma * sigma);
    // A meeting the review pinned holds them together as tightly as a pin.
    const pull = moment.pinned ? RANK_SIGMA.pinned : TALK_SIGMA;
    const talk = moment.talk.reduce((sum, entry) => {
      const other = placeOf(entry.with, moment); if (!other) return sum;
      const over = Math.max(0, metres(spot.at, other.at) - entry.reach), near = over * over / (2 * pull * pull);
      return sum + (entry.known || moment.pinned ? near : -Math.log(LIVE_PRIOR * Math.exp(-near) + (1 - LIVE_PRIOR)));
    }, 0);
    // Outside the frame, as far as the reader's answer is trusted (S_frame).
    const over = moment.frame ? Math.max(0, Math.hypot(spot.at.x - moment.frame.x, spot.at.z - moment.frame.z) - moment.frame.r) : 0;
    return -(seen + talk + over * over / (2 * RANK_SIGMA.answered ** 2));
  }));
  // Between two moments of one scene, or a scene they enter at the same place (the strands' samePlace), one step; into
  // another scene of the strand, the time a scene change allows.
  const walk = (k, a, b) => { const gap = list[k].scene === list[k - 1].scene || list[k].samePlace ? 1 : SCENE_GAP; return -metres(clouds[k - 1][a].at, clouds[k][b].at) / (STEP * drive * gap); };
  const alpha = [local[0].slice()], back = [];
  for (let k = 1; k < list.length; k++) alpha.push(clouds[k].map((_, b) => local[k][b] + logSumExp(clouds[k - 1].map((__, a) => alpha[k - 1][a] + walk(k, a, b)))));
  const beta = Array.from({ length: list.length }, (_, k) => clouds[k].map(() => 0));
  for (let k = list.length - 2; k >= 0; k--) beta[k] = clouds[k].map((_, a) => logSumExp(clouds[k + 1].map((__, b) => walk(k + 1, a, b) + local[k + 1][b] + beta[k + 1][b])));
  // The least-action history (Viterbi).
  const best = [local[0].slice()];
  for (let k = 1; k < list.length; k++) { back.push([]); best.push(clouds[k].map((_, b) => { let top = -Infinity, from = 0; clouds[k - 1].forEach((__, a) => { const v = best[k - 1][a] + walk(k, a, b); if (v > top) { top = v; from = a; } }); back[k - 1][b] = from; return local[k][b] + top; })); }
  const path = new Array(list.length);
  path[list.length - 1] = best.at(-1).indexOf(Math.max(...best.at(-1)));
  for (let k = list.length - 1; k > 0; k--) path[k - 1] = back[k - 1][path[k]];
  return list.map((moment, k) => {
    const logs = clouds[k].map((_, a) => alpha[k][a] + beta[k][a]), total = logSumExp(logs), weights = logs.map(v => Math.exp(v - total));
    const mean = clouds[k].reduce((sum, spot, a) => ({ x: sum.x + weights[a] * spot.at.x, y: sum.y + weights[a] * spot.at.y, z: sum.z + weights[a] * spot.at.z }), { x: 0, y: 0, z: 0 });
    const spread = Math.sqrt(clouds[k].reduce((sum, spot, a) => sum + weights[a] * metres(spot.at, mean) ** 2, 0));
    const map = clouds[k][path[k]];
    // The observation as it went in (where played, how much it was trusted, whom it was coupled to) beside what came out.
    return { scene: moment.scene, card: moment.card, rank: moment.rank, sigma: RANK_SIGMA[moment.rank] ?? RANK_SIGMA.ruled, talk: moment.talk.map(entry => ({ with: entry.with, reach: entry.reach, known: !!entry.known })), ...(moment.pinned ? { pinned: true } : {}), draws: moment.draws.length,
      ...(moment.frame ? { frame: { r: moment.frame.r, played: Math.round(Math.max(0, Math.hypot(moment.at.x - moment.frame.x, moment.at.z - moment.frame.z) - moment.frame.r) * 10) / 10, map: Math.round(Math.max(0, Math.hypot(map.at.x - moment.frame.x, map.at.z - moment.frame.z) - moment.frame.r) * 10) / 10 } } : {}),
      played: { node: moment.node, ...moment.at }, map: { node: map.node, ...map.at }, mean, spread: Math.round(spread * 10) / 10, shift: Math.round(metres(map.at, moment.at) * 10) / 10,
      cloud: clouds[k].map((spot, a) => ({ node: spot.node, ...spot.at, w: weights[a] })).sort((a, b) => b.w - a.w).slice(0, KEEP).map(spot => ({ ...spot, w: Math.round(spot.w * 1000) / 1000 })) };
  });
}

/**
 * A person's continuity (L1, the user, 2026-11-02: by strand, not by scene or card): their moments split into chains
 * that follow the strands' entries, each scene joined to the one the strands say they come from (stage/world/
 * strands.json `entries`: from, samePlace); someone first in a strand starts a chain of their own. No chain crosses
 * from one strand to another unless the strands say so (a fork begins from its parent). Without strands, one chain.
 */
export function chainsOf(list, who, strands) {
  if (!strands?.scenes) return [list.map(moment => ({ ...moment }))];
  const entryOf = new Map(strands.scenes.flatMap(scene => (scene.entries ?? []).filter(entry => entry.person === who).map(entry => [scene.id, entry])));
  const chains = [], chainOfScene = new Map();
  for (const moment of list) {
    let chain = chainOfScene.get(moment.scene);
    if (!chain) {
      const entry = entryOf.get(moment.scene), before = entry?.from ? chainOfScene.get(entry.from) : null;
      chain = before ?? [];
      if (!before) chains.push(chain);
      chainOfScene.set(moment.scene, chain);
      chain.push({ ...moment, samePlace: !!(before && entry?.samePlace) });
      continue;
    }
    chain.push({ ...moment });
  }
  return chains;
}

/**
 * The run smoothed: per person, each moment's cloud, its least-action spot and how far that is from where they were
 * played; and the run's revisions (moments the smoothing moves by more than 2 m). Each person is smoothed along their
 * strands' chains (chainsOf), never across strands. `pins.meet` (a meeting the review pinned) holds both together, tight.
 */
export function smoothRun({ page, log, record, reading = null, strands = null, pins = {}, passes = 2 }) {
  const { moments, decode } = momentsOf({ page, log, record, reading });
  for (const meet of pins.meet ?? []) for (const [who, other] of [[meet.who, meet.to], [meet.to, meet.who]]) for (const moment of moments.get(who) ?? []) if (moment.scene === meet.scene && (!(meet.cards ?? []).length || (meet.cards ?? []).includes(moment.card))) { const known = moment.talk.find(entry => entry.with === other); if (known) Object.assign(known, { reach: REACH.live, known: true }); else moment.talk.push({ with: other, reach: REACH.live, known: true }); moment.pinned = true; }
  const chains = new Map([...moments.entries()].map(([who, list]) => [who, chainsOf(list, who, strands)])), drive = drives(chains);
  // People one at a time against the others' latest (Gauss–Seidel): both of a pair moving at once to where the other
  // was would only swap them.
  const smoothed = new Map();
  const placeOf = (who, moment) => {
    const list = smoothed.get(who) ?? null, own = moments.get(who) ?? [];
    const k = own.findIndex(entry => entry.scene === moment.scene && entry.card === moment.card);
    const at = k >= 0 ? (list ? list[k].mean : own[k].at) : null;
    if (!at) return null;
    return { at, node: k >= 0 ? (list ? list[k].map.node : own[k].node) : null };
  };
  for (let pass = 0; pass < passes; pass++) for (const [who, list] of moments) {
    // Each chain smoothed on its own; the results back in the person's own order of moments.
    const done = new Map();
    for (const chain of chains.get(who)) smoothOne(chain, { decode, drive: drive.get(who) ?? 1, placeOf }).forEach((result, k) => done.set(`${chain[k].scene}|${chain[k].card}`, result));
    smoothed.set(who, list.map(moment => done.get(`${moment.scene}|${moment.card}`)));
  }
  const revisions = [];
  for (const [who, list] of smoothed) for (const moment of list) if (moment.shift > 2) revisions.push({ who, scene: moment.scene, card: moment.card, shift: moment.shift, rank: moment.rank, from: moment.played, to: moment.map });
  return { people: Object.fromEntries(smoothed), chains: Object.fromEntries([...chains.entries()].map(([who, list]) => [who, list.map(chain => [...new Set(chain.map(moment => moment.scene))])])), drive: Object.fromEntries([...drive.entries()].map(([who, value]) => [who, Math.round(value * 100) / 100])), revisions };
}
