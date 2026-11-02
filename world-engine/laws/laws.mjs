// The physics law engine (docs/v2/physics-laws.md; Track B W2, the user, 2026-11-02: all the laws together, logged only):
// each law a check over a played line, giving a verdict per thing it checks: ok, or a violation with why. Pure functions:
// the line as played (`played`, below), the strands, the script, the reading's speakers and the abilities config in;
// verdicts out. Nothing here changes a run; W4 makes the verdicts act.

/** Ways everyone has; anything else needs the abilities config (`<library>/universe/abilities.json`). */
export const HUMAN = new Set(['step', 'walk', 'run', 'fall']);
/** Speeds (m/s) by way, for L5; a way the abilities config gives may say its own. */
export const SPEED = { step: 1.4, walk: 1.4, run: 4, leap: 6, flight: 15, teleport: Infinity, ride: 12 };
/** Talk distances (m): face to face, and a voice everyone around hears (L6). */
export const LIVE = 4, EARSHOT = 25;
/** People who may share a 2 m cell before it is a crowd (L11). */
export const PER_CELL = 3;

const violation = (law, what, why, extra = {}) => ({ law, what, why, ...extra });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** A time-tree node's minutes from the story's start when it states a clock time (`t:y1:12-24:15:00`), else null. */
export function minutesOf(node) {
  const match = String(node ?? '').match(/^t:y(\d+):(\d{1,2})-(\d{1,2}):(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return ((year * 12 + month) * 31 + day) * 1440 + hour * 60 + minute;
}

/**
 * L1 · Continuity, scoped to a strand: someone carried into a scene must come from the scene the strands say they come
 * from (`entries`: from, samePlace), never from the state another strand left.
 */
export function continuity({ played, strands }) {
  const entries = new Map(strands.scenes.map(scene => [scene.id, new Map((scene.entries ?? []).map(entry => [entry.person, entry]))]));
  const fork = new Map(strands.scenes.map(scene => [scene.id, scene.fork]));
  const lastSeen = new Map(), out = [];
  let checked = 0;
  for (const scene of played.scenes) {
    for (const who of scene.carried) {
      checked++;
      const was = lastSeen.get(who), entry = entries.get(scene.id)?.get(who);
      if (!entry?.from) out.push(violation('L1', `${scene.id} · ${who}`, `carried from ${was ?? 'nowhere'}, but in this strand they appear here first`, { scene: scene.id, who, from: was ?? null, strand: fork.get(scene.id) }));
      else if (was && was !== entry.from) out.push(violation('L1', `${scene.id} · ${who}`, `carried from ${was} (strand ${fork.get(was)}), but they come from ${entry.from} (strand ${fork.get(entry.from)})`, { scene: scene.id, who, from: was, expected: entry.from }));
    }
    for (const who of scene.present) lastSeen.set(who, scene.id);
  }
  return { law: 'L1', checked, violations: out };
}

/** L2 · Nobody is in two places at once: two scenes at one stated moment, at different places, sharing someone. */
export function twoPlaces({ script }) {
  const byMoment = new Map(), out = [];
  for (const scene of script.scenes) if (scene.at?.stated && minutesOf(scene.at.node) !== null && scene.clock) (byMoment.get(scene.at.node) ?? byMoment.set(scene.at.node, []).get(scene.at.node)).push(scene);
  let checked = 0;
  for (const [moment, scenes] of byMoment) for (let a = 0; a < scenes.length; a++) for (let b = a + 1; b < scenes.length; b++) {
    checked++;
    if (scenes[a].place === scenes[b].place) continue;
    for (const who of scenes[a].present.filter(id => scenes[b].present.includes(id))) out.push(violation('L2', `${scenes[a].id} & ${scenes[b].id} · ${who}`, `present at ${scenes[a].place} and ${scenes[b].place} at ${moment}`, { who }));
  }
  return { law: 'L2', checked, violations: out };
}

/**
 * L5 · Travel takes time: an arrival from another scene must fit the time between them at the person's pace. Only
 * where both scenes state a clock time (the user, 2026-11-02: a gap with no stated time fits anything, for now).
 */
export function travelTime({ played, script, abilities }) {
  const at = new Map(script.scenes.map(scene => [scene.id, scene.at?.stated ? minutesOf(scene.at.node) : null]));
  const out = [];
  let checked = 0;
  for (const arrival of played.arrivals) {
    const from = at.get(arrival.fromScene), to = at.get(arrival.scene);
    if (from === null || from === undefined || to === null || to === undefined) continue;
    checked++;
    const ways = waysOf(abilities, arrival.who), pace = Math.max(...[...ways].map(way => abilities?.people?.[arrival.who]?.ways?.[way]?.speed ?? SPEED[way] ?? 0));
    const seconds = (to - from) * 60, need = arrival.metres / pace;
    if (seconds < need) out.push(violation('L5', `${arrival.scene} · ${arrival.who}`, `${Math.round(arrival.metres)} m in ${Math.round(seconds / 60)} min needs ${Math.round(need / 60)} min at their fastest`, { who: arrival.who, metres: Math.round(arrival.metres) }));
  }
  return { law: 'L5', checked, violations: out };
}

/**
 * L6 · Talk needs nearness: a spoken line's speaker (the reading's EM²) is present, and within earshot of whom they
 * speak to when the line is said. The kind of the talk (live, group, remote, public) is Jev's (decision 3), not asked
 * yet: until it is, a line beyond earshot is reported as needing its kind, not as broken.
 */
export function talk({ played, speakers }) {
  const out = [];
  let checked = 0;
  for (const card of played.cards.filter(entry => entry.kind === 'dialogue')) for (const line of card.lines) {
    const said = speakers[line.id];
    if (!said?.who) continue;
    checked++;
    const here = card.positions;
    if (!here[said.who]) { out.push(violation('L6', `${card.scene} · ${line.id}`, `speaker ${said.who} is not present`, { who: said.who, sure: said.sure })); continue; }
    if (said.to && here[said.to]) {
      const gap = distance(here[said.who], here[said.to]), floors = Math.abs(here[said.who].y - here[said.to].y);
      if (gap > EARSHOT || floors > 1) out.push(violation('L6', `${card.scene} · ${line.id}`, `${said.who} speaks to ${said.to} from ${Math.round(gap)} m${floors > 1 ? `, ${Math.round(floors / 3)} floors apart` : ''}: remote, or someone is misplaced (kind not asked yet)`, { who: said.who, to: said.to, metres: Math.round(gap), needsKind: true }));
    }
  }
  return { law: 'L6', checked, violations: out };
}

/** L9 · Actors are there: someone the card says acts or speaks has a place in the scene. */
export function actorsThere({ played }) {
  const out = [];
  let checked = 0;
  for (const card of played.cards) for (const who of card.actors) {
    checked++;
    if (!card.positions[who]) out.push(violation('L9', `${card.scene} · ${card.card} · ${who}`, `acts or speaks, but is not present`, { who }));
  }
  return { law: 'L9', checked, violations: out };
}

/** L10 · Reachable: a move Jev chose that the walk never reached. */
export function reachable({ played }) {
  const out = [];
  let checked = 0;
  for (const card of played.cards) for (const move of card.moves) {
    if (!move.direction || move.direction === 'stays' || String(move.direction).startsWith('with:')) continue;
    checked++;
    if (!move.moved) out.push(violation('L10', `${card.scene} · ${card.card} · ${move.person}`, `${move.how ?? 'move'} to ${move.spot ?? move.height ?? 'a box'}: ${move.why ?? 'no walk there'}`, { who: move.person, how: move.how }));
  }
  return { law: 'L10', checked, violations: out };
}

/** L11 · Bodies: a floor that is in its building; no more than a few people on one 2 m cell at a scene's start. */
export function bodies({ played }) {
  const out = [];
  let checked = 0;
  for (const card of played.cards) for (const move of card.moves) {
    const said = String(move.height ?? move.spot ?? '').match(/\((\d+) floors?\), floor (-?\d+)/);
    if (!said) continue;
    checked++;
    if (Number(said[2]) > Number(said[1])) out.push(violation('L11', `${card.scene} · ${card.card} · ${move.person}`, `floor ${said[2]} of a ${said[1]}-floor building`, { who: move.person }));
  }
  for (const scene of played.scenes) {
    const cells = new Map();
    for (const [who, p] of Object.entries(scene.startAt)) { const key = `${Math.floor(p.x / 2)}|${Math.floor(p.z / 2)}|${Math.round(p.y / 3)}`; (cells.get(key) ?? cells.set(key, []).get(key)).push(who); }
    checked++;
    for (const [key, people] of cells) if (people.length > PER_CELL) out.push(violation('L11', `${scene.id} · ${key}`, `${people.length} people on one 2 m cell at the scene's start`, { people }));
  }
  return { law: 'L11', checked, violations: out };
}

/** The ways a person has: everyone's, and the abilities config's. */
export function waysOf(abilities, who) {
  return new Set([...HUMAN, ...Object.keys(abilities?.people?.[who]?.ways ?? {})]);
}
/** L12 · Abilities: a move made a way the person has; a leap or flight played (today the engine walks them, W4 fixes). */
export function abilitiesHeld({ played, abilities }) {
  const out = [];
  let checked = 0;
  for (const card of played.cards) for (const move of card.moves) {
    if (!move.how || move.direction === 'stays') continue;
    checked++;
    if (!waysOf(abilities, move.person).has(move.how)) out.push(violation('L12', `${card.scene} · ${card.card} · ${move.person}`, `a ${move.how} by someone with no such way${move.moved ? ' (played as a walk)' : ''}`, { who: move.person, how: move.how, moved: !!move.moved }));
    else if (!HUMAN.has(move.how) && move.moved) out.push(violation('L12', `${card.scene} · ${card.card} · ${move.person}`, `a ${move.how} played as a walk: the engine has no ${move.how} yet`, { who: move.person, how: move.how, engine: true }));
  }
  return { law: 'L12', checked, violations: out };
}

/** L13 · Destruction: a blast only where the card's own text breaks something; never twice on what is gone. */
export function destruction({ played }) {
  const out = [];
  let checked = 0;
  const struck = new Map();
  for (const card of played.cards.filter(entry => entry.hit)) {
    checked++;
    if (card.hit.struck && !card.breaks) out.push(violation('L13', `${card.scene} · ${card.card}`, 'a blast with nothing said to break', {}));
    if (card.hit.struck && card.hit.lot !== undefined) { if (struck.has(card.hit.lot)) out.push(violation('L13', `${card.scene} · ${card.card}`, `building ${card.hit.lot} struck again after ${struck.get(card.hit.lot)}`, {})); struck.set(card.hit.lot, card.card); }
  }
  return { law: 'L13', checked, violations: out };
}

export const LAWS = [continuity, twoPlaces, travelTime, talk, actorsThere, reachable, bodies, abilitiesHeld, destruction];
/** Every law over a played line: each one's checks and violations. */
export function checkAll(input) {
  return LAWS.map(law => law(input));
}
