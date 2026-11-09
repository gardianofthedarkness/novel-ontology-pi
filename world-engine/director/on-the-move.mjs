// Talk on the move (the user, 2026-11-08: "Yes that order, then highway/subway system": walking talk built into the
// director now, riding once the terrain has a road system; the experiment: experiments/v2/moving-talk.mjs, options C and
// P, and docs/v2/world-ontology.md §5a "Moving conversations").
//
// The director plays a walk and the talk on it as separate cards: the card that tells the walk takes the whole way, and
// the talk cards after it stand still. Where the reading says people keep moving while they talk, this step spreads the
// way they went over those cards, by how long each card's lines take to read:
//   - the reading's casts say who is on the move, card by card: the script supervisor's moves (going "with" someone,
//     carried, walking or running) and the background's activity (strolling, walking, running; standing or sitting stops
//     it), and the dialogue coverage's formations ("side by side walking"; facing, across a table, a ring stop it);
//   - people the reading ties together (one goes with the other, one carries the other, they walk side by side) keep
//     together: the group's leader (a carrier, else whoever went furthest) goes its own way, the others a cell beside it
//     and anyone carried on their carrier, in step (layout);
//   - each card's piece of the way is walked at the pace that makes it last the card's lines, never faster than their
//     own pace and never slower than a stroll (a run no slower than a jog): the timing, the key animator's;
//   - where each of them ends the stretch is not changed, so nothing after it moves; the way itself is the path
//     integral's, only spread over more time.
// Riding is not here: a vehicle needs the terrain's road system first (the user, 2026-11-08).

import { setting } from '../../dist/src/v2/settings.js';
/** The player's own clock (strand-demo.html): a card lasts long enough to read its spoken lines; moves play DEMO× life. */
export const { say: SAY, read: READ, demo: DEMO } = setting('replay.clock');
/** The player's own paces (m/s, strand-demo.html SPEED), and the slowest a paced piece goes: a slow stroll; a run no slower than a jog. */
export const { pace: PACE, slowest: SLOWEST } = setting('replay.pace');
const MOVING = new Set(['walk', 'run', 'carried', 'ride']);

/** How long the player holds a card for its lines (strand-demo.html: its spoken lines' characters at SAY a character). */
export function readSeconds(lines) {
  const chars = (lines ?? []).filter(line => line.kind === 'spoken' && String(line.text ?? '').trim()).reduce((sum, line) => sum + String(line.text).length, 0);
  return Math.max(READ, chars ? chars * SAY + 0.6 : 0);
}

/** What one of the script supervisor's moves says of someone's motion: walk, run, carried, ride, other (a leap, a flight), or null. */
export function stateOfMove(move) {
  if (!['elsewhere', 'nearby'].includes(move?.motion)) return null;
  return { walk: 'walk', run: 'run', carried: 'carried', vehicle: 'ride', step: null }[move.how] ?? 'other';
}
/** What an activity (the digest's `doing`) says: walk, run, ride, stop, or null. */
export const stateOfDoing = doing => ({ strolling: 'walk', walking: 'walk', running: 'run', riding: 'ride', standing: 'stop', sitting: 'stop', lying: 'stop', working: 'stop', fighting: 'stop', gone: 'stop' })[doing] ?? null;
/** What a dialogue coverage formation says: side by side walking is a walk; facing, across a table, a ring, a door between stop. */
export const stateOfFormation = formation => (formation === 'side by side walking' ? 'walk' : ['facing', 'across a table', 'a ring', 'two sides of a door'].includes(formation) ? 'stop' : null);

/**
 * Who is on the move at each card, and who goes with whom. `cards`: each card's last line (its index in the scene's
 * lines); `signals`: { at (a line's index), who, state, with: [ids] }; `initial`: who → state at the scene's start (the
 * scene digest's routine). A signal holds from its line until the next one for that person. Each card gets the states
 * that hold at its end, and the ties its own lines give (a pair going together, both on the move).
 */
export function statesOf({ cards, signals, initial = new Map() }) {
  const now = new Map(initial), ordered = [...signals].sort((a, b) => a.at - b.at), out = [];
  let next = 0;
  for (const card of cards) {
    const ties = [];
    while (next < ordered.length && ordered[next].at <= card.last) {
      const signal = ordered[next++];
      if (signal.state) now.set(signal.who, signal.state);
      for (const other of signal.with ?? []) if (other && other !== signal.who) ties.push([signal.who, other]);
    }
    out.push({ states: new Map(now), ties: ties.filter(([a, b]) => MOVING.has(now.get(a)) && MOVING.has(now.get(b))) });
  }
  return out;
}

/**
 * The stretches of cards a group (or one person) stays on the move through. On each card the people on the move fall
 * into groups by the ties the scene gives them (going together on any card of it); a stretch is a run of cards in a row
 * with the same group, at least `least` cards long, with someone of it talking on one of them (`talkers[k]`: who
 * speaks or is spoken to on card k). One tied to no one on the move is a group of one.
 * A card where one of the group talks face to face with someone outside it (not on the phone: `remote[k]`) ends the
 * stretch before it: they are where the director brought them for that talk, not still on their way.
 */
export function stretchesOf({ states, talkers, remote = [], least = 2 }) {
  const ties = states.flatMap(entry => entry.ties);
  const groupsAt = states.map((entry, k) => {
    const moving = [...entry.states].filter(([, state]) => MOVING.has(state)).map(([who]) => who), parent = new Map(moving.map(who => [who, who]));
    const find = who => { while (parent.get(who) !== who) who = parent.get(who); return who; };
    for (const [a, b] of ties) if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
    const groups = new Map();
    for (const who of moving) (groups.get(find(who)) ?? groups.set(find(who), []).get(find(who))).push(who);
    const talking = talkers[k] ?? new Set(), withOthers = members => !remote[k] && members.some(who => talking.has(who)) && [...talking].some(who => !members.includes(who));
    return [...groups.values()].filter(members => !withOthers(members)).map(members => members.sort().join('|'));
  });
  const out = [], open = new Map();
  const close = (key, to) => {
    const from = open.get(key);
    open.delete(key);
    const members = key.split('|'), cards = Array.from({ length: to - from }, (_, n) => from + n);
    if (cards.length >= least && cards.some(k => members.some(who => talkers[k]?.has(who)))) out.push({ members, cards });
  };
  groupsAt.forEach((keys, k) => {
    for (const key of [...open.keys()]) if (!keys.includes(key)) close(key, k);
    for (const key of keys) if (!open.has(key)) open.set(key, k);
  });
  for (const key of [...open.keys()]) close(key, states.length);
  return out.sort((a, b) => a.cards[0] - b.cards[0]);
}

/** A way cut into one piece per card, each as long as its share of the weights (pieces join end to start): [from, to] indices. */
export function spreadWay(route, weights, metres) {
  const along = [0];
  for (let n = 1; n < route.length; n++) along.push(along[n - 1] + metres(route[n - 1], route[n]));
  const total = along.at(-1), sum = weights.reduce((a, b) => a + b, 0) || 1, cuts = [];
  let start = 0, so = 0;
  for (const weight of weights) {
    so += weight;
    const goal = (total * so) / sum;
    let end = start;
    while (end < route.length - 1 && along[end + 1] <= goal + 1e-6) end++;
    cuts.push([start, end]);
    start = end;
  }
  return cuts;
}

const lengthOf = (path, metres) => path.slice(1).reduce((sum, node, n) => sum + metres(path[n], node), 0);

/**
 * A group's moves over a stretch, in step. `ways`: [who, nodes] with the leader first, every way cut at the leader's
 * indices (`lead` extra nodes before the leader's start and `tail` after its end are a member's own way in and out);
 * `weights`: each card's reading seconds; `natural`: the leader's own pace (m/s); `slowest`: the slowest a piece goes.
 * Each piece takes the leader's time for it (paced to its card's lines), everyone else in exactly that time. Returns
 * per card (by position in the stretch) a list of { person, path, pace, at }; `pace` only where it differs from
 * `natural`; `at`, each node's time from the move's start (seconds of life, the player's own clock before DEMO): the
 * leader at its pace, and anyone on a way node for node with it (no way in or out on that piece) reaching each node
 * when the leader reaches its own, so the two keep abreast however their ways' lengths differ.
 */
export function inStep({ ways, weights, natural, slowest, metres }) {
  const [, leaderWay] = ways[0], cuts = spreadWay(leaderWay.nodes, weights, metres);
  const paces = cuts.map(([from, to], n) => {
    if (to <= from) return 0;
    const run = lengthOf(leaderWay.nodes.slice(from, to + 1), metres);
    return Math.min(natural, Math.max(slowest, run / (weights[n] * DEMO)));
  });
  const seconds = cuts.map(([from, to], n) => (paces[n] ? lengthOf(leaderWay.nodes.slice(from, to + 1), metres) / paces[n] / DEMO : 0));
  // The leader's time at each node of each piece (life seconds from the piece's start).
  const clock = cuts.map(([from, to], n) => { const times = [0]; for (let k = from + 1; k <= to; k++) times.push(times.at(-1) + (paces[n] ? metres(leaderWay.nodes[k - 1], leaderWay.nodes[k]) / paces[n] : 0)); return times; });
  const round = value => Math.round(value * 100) / 100;
  const out = cuts.map(() => []), last = cuts.length - 1;
  for (const [person, way] of ways) cuts.forEach(([from, to], n) => {
    const lead = n === 0 ? way.lead ?? [] : [], tail = n === last ? way.tail ?? [] : [];
    if (!lead.length && !tail.length && seconds[n]) {
      // Node for node with the leader: each node at the leader's time for its own (a repeated node waits there).
      const timed = way.nodes.slice(from, to + 1).map((node, k) => [node, clock[n][k]]).filter(([node], k, all) => k === all.length - 1 || node !== all[k + 1][0]);
      if (timed.length < 2) return;
      timed[0][1] = 0;
      const path = timed.map(([node]) => node), run = lengthOf(path, metres), pace = run / (seconds[n] * DEMO);
      out[n].push({ person, path, at: timed.map(([, time]) => round(time)), ...(Math.abs(pace - natural) > 0.01 ? { pace: round(Math.max(0.05, pace)) } : {}) });
      return;
    }
    const path = [...lead, ...way.nodes.slice(from, to + 1), ...tail].filter((node, k, all) => k === 0 || node !== all[k - 1]);
    if (path.length < 2) return;
    const run = lengthOf(path, metres);
    if (!seconds[n]) { out[n].push({ person, path }); return; }
    const pace = Math.max(0.05, run / (seconds[n] * DEMO));
    out[n].push({ person, path, ...(Math.abs(pace - natural) > 0.01 ? { pace: round(pace) } : {}) });
  });
  return out;
}

/**
 * A drive cut across the cards said on it (talk while driving; the user, 2026-11-08: "work on the dialogue/action while
 * driving"). Unlike a walk, the vehicle is not slowed to last the talk: it keeps its own timing (`at`, each node's life
 * seconds from the drive's start, waits at the lights included, world-engine/world/roads.mjs), and while they talk the
 * clock runs at life's own speed (`scale` life seconds a second of reading: 1, so the page plays such a move unhurried,
 * its `real`). Card n's piece runs from the time the cards before it take to read to the time it and they take; the last
 * card takes the rest of the drive, however long. A piece after the arrival is empty: the talk goes on with the car
 * stopped where it arrived. Returns per card [from, to] node indices (to === from: no movement on that card).
 */
export function cutDrive(at, weights, { scale = 1 } = {}) {
  const cuts = [];
  let start = 0, so = 0;
  weights.forEach((weight, n) => {
    so += weight * scale;
    let end = start;
    if (n === weights.length - 1) end = at.length - 1;
    else while (end < at.length - 1 && at[end + 1] <= so + 1e-6) end++;
    cuts.push([start, end]);
    start = end;
  });
  return cuts;
}

/** The side a group's nth follower keeps: right, left, then two cells out, and so on. */
export const sideOf = n => (n % 2 ? -(1 + (n >> 1)) : 1 + (n >> 1));

/**
 * A way `side` cells to the side of another (left of its heading for a positive side), node for node, so the two are as
 * long as each other and whoever walks it keeps abreast at the same pace: across the way's heading over ten nodes,
 * rounded to the grid; where that cell is no ground, the offset it kept before, else the way's own node (never the other
 * side, which zig-zags). `cell(node)`: { i, j, k }; `node(i, j, k)`: a walkable node of that cell, or null.
 */
export function besideWay(route, side, { cell, node }) {
  const cells = route.map(cell);
  let kept = null;
  return route.map((id, n) => {
    const a = cells[Math.max(0, n - 5)], b = cells[Math.min(route.length - 1, n + 5)], here = cells[n], di = b.i - a.i, dj = b.j - a.j, length = Math.hypot(di, dj);
    const offset = length > 1e-6 ? [Math.round((-dj / length) * side), Math.round((di / length) * side)] : kept ?? [side, 0];
    const found = node(here.i + offset[0], here.j + offset[1], here.k);
    if (found !== null && found !== undefined) { kept = offset; return found; }
    const before = kept ? node(here.i + kept[0], here.j + kept[1], here.k) : null;
    return before !== null && before !== undefined ? before : id;
  });
}
