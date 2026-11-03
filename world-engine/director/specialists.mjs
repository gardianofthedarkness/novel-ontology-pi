// The director as specialists (docs/v2/next-steps.md A4–A5; the user, 2026-11-03): "jev can be asked for different
// questions based on what the input director sees... we can split our directors into specialist". One registry, in
// code, of what reads the text (the summary faculties, the work model), what fires them (Jev's block types and the
// reading's own signals), and which specialist director each one feeds (the questions Jev is asked on pictures, the
// scale it works at, its camera, its tools). The docs and the plan page are written from it
// (specialists-doc.mjs), so the design and the code cannot drift apart.
//
// `status` says how far each thing is: built (in the code now), partial (some of it), proposed.

/** Block types: what a window of about 12 sentences is about, asked of Jev in the kinds pass as one distribution. */
export const BLOCK_TYPES = {
  routine: { label: 'Routine interaction', means: 'people together: talk and small acts', volume1: 'the dart bar (13–18), the crosswalk (11–12), walking with Index (8)' },
  confrontation: { label: 'Confrontation', means: 'a fight or standoff: blows, dodges, powers used on someone', volume1: '21–22, 25–31, 40' },
  traversal: { label: 'Pursuit / traversal', means: 'going somewhere at scale: chases, escapes, crossing the city', volume1: 'the escape (1), the chase to the subway (3), the tower leaps (26), the tower\'s shaft (34)' },
  mediated: { label: 'Mediated exchange', means: 'talk through a channel: a phone, a door, a broadcast, a message', volume1: 'phone calls (12, 29, 33), through a door (42–43)' },
  interior: { label: 'Interior flow', means: 'thought, reflection, free indirect thought', volume1: '18, 36, the long narration and thought stretches' },
  exposition: { label: 'Exposition', means: 'world-building and background with no one acting', volume1: 'the Board (37), R&C Occultics (39)' },
  establishing: { label: 'Establishing / ambience', means: 'where and when: the place, weather, crowds, mood', volume1: 'the openings of 1, 2, 10, 45' },
  memory: { label: 'Memory / flashback', means: 'what happened before this scene\'s now', volume1: '35' },
  catastrophe: { label: 'Spectacle / catastrophe', means: 'the world itself changing: ground splits, floods, collapses', volume1: '21, 22, 26, 27' },
};
/** Types that fire no reader: they hold the world still (no implied moves, no drift; the camera close; a memory apart). */
export const DAMPING = ['interior', 'exposition', 'memory'];

/** The reading's own signals, counted per window, that can fire a faculty beside the block types. */
export const SIGNALS = {
  vehicles: { label: 'vehicles named', from: 'the reading\'s vehicle slots and things (23 vehicle slots in volume 1)' },
  weapons: { label: 'weapons named', from: 'the reading\'s weapon slots (27 in volume 1)' },
  buildings: { label: 'buildings named or described', from: 'place EM\'s buildings and the spatial mentions' },
  crowds: { label: 'crowds named', from: 'the reading\'s crowd slots (134 in volume 1)' },
  scaleJump: { label: 'a jump in scale', from: 'the scene frame: a scale band wider than the scene\'s own' },
};

/**
 * The summary faculties: work-model readers of the text. `always`: on for every scene or window; else fired by the
 * density of `types` (and `signals`) in a span. `writes`: the claims it puts on the scene board.
 */
export const FACULTIES = {
  frame: { label: 'Scene frame', always: 'scene', status: 'proposed', writes: ['the set as a path down the place tree', 'the scale band', 'who is on stage', 'how it follows the scene before', 'the beats'] },
  generalist: { label: 'Generalist', always: 'window', status: 'built', code: 'world-engine/digest/digest.mjs', writes: ['stated moves (graded)', 'facts, stated and implied', 'items', 'talk kinds', 'breaks'] },
  conversation: { label: 'Conversation and blocking', types: ['routine', 'mediated'], status: 'proposed', writes: ['who talks with whom and through what', 'formations: beside, across a table, a ring, two sides of a door', 'attention: who looks at whom'] },
  feeling: { label: 'Inner state', types: ['interior', 'routine'], status: 'proposed', writes: ['each person\'s emotional state as it changes (a distribution)', 'intent: what they want next'] },
  journeys: { label: 'Journeys', types: ['traversal'], signals: ['scaleJump'], status: 'proposed', writes: ['from, via and to as places of the tree', 'the manner (alleys, up a wall, leaps, carried)', 'distance and duration'] },
  choreography: { label: 'Choreography', types: ['confrontation', 'catastrophe'], status: 'proposed', writes: ['exchanges: attacker, target, attack, outcome', 'knock-backs, dodges, throws', 'what breaks and how wide'] },
  ambience: { label: 'Ambience', types: ['establishing'], signals: ['crowds'], status: 'proposed', writes: ['the crowd as a density of the place: its make-up and flow', 'weather, light, mood', 'set dressing'] },
  props: { label: 'Props and vehicles', types: [], signals: ['vehicles', 'weapons'], status: 'partial', code: 'world-engine/digest/digest.mjs (items)', writes: ['vehicles: kind, who drives or rides, where they go', 'weapons: kind, who holds them', 'things held, thrown, broken'] },
  setting: { label: 'Set description', types: ['establishing'], signals: ['buildings'], status: 'proposed', writes: ['a building\'s look, floors and uses (a 70-floor tower: mall, offices, flats)', 'a room\'s make-up (a container bar, a thick-doored cell)', 'changes to them'] },
};

/**
 * The specialist directors: each asks Jev its own questions on pictures framed at its own scale. `reads`: the faculties
 * whose claims it plays; `scale`: metres across its frame [near, far]; `asks`: its Jev questions (built: a mode in
 * src/v2/context, proposed: to be written); `tools`: the world's means it plays with. The stage manager always runs; the
 * others lead a beat when their faculties fire (lead()).
 */
export const DIRECTORS = {
  stage: { label: 'Stage manager', role: 'the set, who is on stage, the camera and who leads each beat', reads: ['frame', 'generalist'], always: true, scale: [5, 2000], camera: 'chooses the shot per beat from the lead director\'s scale; holds one group until the text cuts', status: 'partial',
    asks: [{ name: 'spawnSpotMode', status: 'built', what: 'where each person starts in the set' }, { name: 'sceneGoesOnMode', status: 'built', what: 'whether the scene carries straight on' }, { name: 'set and scale band on a map of the place tree', status: 'proposed' }],
    tools: ['spawning', 'the place tree', 'the smoother'] },
  routine: { label: 'Routine director', role: 'inside a room or on a street corner: positions, gaze, who talks to whom, how people feel', reads: ['conversation', 'feeling', 'generalist'], scale: [2, 15], camera: 'medium and close; a room cut away', status: 'partial',
    asks: [{ name: 'dialogueKindMode', status: 'built', what: 'how a talk happens (face to face, group, remote, public)' }, { name: 'moveSpotMode', status: 'built', what: 'a spot near the speaker' }, { name: 'formation on a room plan (who sits where, facing whom)', status: 'proposed' }, { name: 'emotional state as a score (Jev\'s score primitive)', status: 'proposed' }, { name: 'who is addressed, from the faces turned', status: 'proposed' }],
    tools: ['rooms and doors of the building skeleton', 'talk rings (L6)'] },
  mega: { label: 'Mega-scene director', role: 'traversals and catastrophes seen from far: routes across blocks, leaps between towers, the ground splitting, crowds flowing', reads: ['journeys', 'ambience', 'choreography'], scale: [100, 2000], camera: 'wide and aerial; follows a journey whole', status: 'proposed',
    asks: [{ name: 'moveDirectionMode at the journey\'s scale', status: 'partial', what: 'the arrows, framed wide' }, { name: 'a landmark on a top-down map (lettered towers, bridges, stations)', status: 'proposed' }, { name: 'a route among the place graph\'s routes', status: 'proposed' }, { name: 'the extent of a catastrophe (an area on the map)', status: 'proposed' }, { name: 'which way a crowd flows', status: 'proposed' }],
    tools: ['map routes on the place graph', 'the terrain', 'the crowd field', 'percolation damage'] },
  combat: { label: 'Combat director', role: 'a fight, exchange by exchange: the kind and shape of each attack, who it hits, what it breaks', reads: ['choreography', 'generalist'], scale: [5, 60], camera: 'close to medium, following the exchange; wider for a blast', status: 'partial',
    asks: [{ name: 'the hit spot and size (red spheres)', status: 'built', what: 'where a blast lands and how big' }, { name: 'attack kind: hand to hand, grapple, weapon, ranged power, beam, blast, thrown object, the ground itself', status: 'proposed' }, { name: 'attack shape: point, line or beam, cone, sphere, wave along the ground', status: 'proposed' }, { name: 'outcome: hit, dodged, blocked, cancelled; how far knocked back', status: 'proposed' }],
    tools: ['hitSphere and percolation', 'graded moves', 'destruction (L13)'] },
  transport: { label: 'Transport specialist', role: 'vehicles and weapons: what they are, who drives or holds them, where they go', reads: ['props', 'generalist'], scale: [10, 2000], camera: 'follows the vehicle; wide for flight', status: 'proposed',
    asks: [{ name: 'which model a vehicle or weapon is (the model packs)', status: 'proposed' }, { name: 'its path: on the road, the rails, in the air', status: 'proposed' }, { name: 'who rides, drives or holds it', status: 'proposed' }],
    tools: ['model packs (CC0)', 'roads and rails of the terrain', 'things on the page'] },
  architect: { label: 'Architect', role: 'a building borrowed from the world made the one the text describes: its look, floors, uses, rooms and what changes in it', reads: ['setting', 'generalist'], scale: [10, 300], camera: 'establishing on the building; cut-aways of floors', status: 'partial',
    asks: [{ name: 'terrainHeightMode and terrainPartMode', status: 'built', what: 'a building\'s height and what it belongs to' }, { name: 'its look among the model packs and themes', status: 'proposed' }, { name: 'floors and uses (the mall below, offices, flats, the rooftop deck)', status: 'proposed' }, { name: 'a room\'s make-up and furniture', status: 'proposed' }],
    tools: ['building skeletons', 'architecture models', 'model packs', 'building EM'] },
};

// ── What each director keeps, and how it flows into the ontology (the user, 2026-11-03) ──────────────────────────────
//
// A director's state is what it changes as it plays: where people stand, who talks to whom, how they feel, what an attack
// was, who holds what, what a building is. None of it is written into the ontology directly. It flows:

/** The path every state takes, in order. */
export const FLOW = [
  { step: 'play', what: 'the director changes its state card by card (positions, exchanges, feelings, holdings, buildings)', code: 'world-engine/director/director.mjs' },
  { step: 'world log', what: 'each change a record, append-only, with its rank (pinned, stated, met, answered, ruled) and source', code: 'world-engine/log/world-log.mjs' },
  { step: 'laws', what: 'checked as it plays (held, amended) and over the whole run afterwards', code: 'world-engine/laws/laws.mjs' },
  { step: 'smoother', what: 'positions and presence back-propagated: the least-action history and its clouds (later: feelings, as additive states)', code: 'world-engine/smoother/' },
  { step: 'ledger', what: 'the run\'s proposals to the ontology, each with its evidence and the laws\' verdicts', code: 'world-engine/log/write-log.mjs' },
  { step: 'gate', what: 'applied by canon where a law checks it, held for the review (Pi) otherwise; some state stays with the run', code: 'world-engine/review/canon.mjs, review.mjs' },
  { step: 'canon', what: 'written into ontology/*.jsonl (last write wins by id), every write logged in canon.jsonl and undoable; the graph rebuilt', code: 'world-engine/review/canon.mjs' },
  { step: 'next run', what: 'the review\'s answers become pins; canon, pins and the smoothing are where the next run starts from', code: 'world-engine/review/review.mjs' },
];

/** The gates (docs/v2/world-ontology.md §7b). */
export const GATES = {
  applied: 'written by canon without review: a law checks it and nothing broke',
  held: 'held for the review first; written once answered (some move to applied once audits show they are right)',
  run: 'kept with the run only (its records, the page); never in the ontology',
};

/** World log record kinds: those the log writes today, and those the specialists add. */
export const LOG_KINDS = {
  presence: { built: true }, position: { built: true }, meeting: { built: true }, damage: { built: true }, binding: { built: true },
  beat: { built: false, what: 'a beat: its block types, its lead and co-directors, its span' },
  feeling: { built: false, what: 'a person\'s emotional state changing, with how sure' },
  exchange: { built: false, what: 'one attack: attacker, target, kind, shape, outcome' },
  condition: { built: false, what: 'hurt, unconscious, bound, freed' },
  crowd: { built: false, what: 'the crowd field of a place at a beat: density, make-up, flow' },
  item: { built: false, what: 'a thing, vehicle or weapon: where it is' },
  possession: { built: false, what: 'who holds, drives or rides a thing' },
  building: { built: false, what: 'a building\'s look, floors, uses and rooms' },
};

/** The laws a state can be checked by (physics-laws.md): built ones, and L14 (recorded as it plays) and L15 (proposed). */
export const LAWS = {
  L1: 'continuity by strand', L2: 'two places at once', L5: 'travel time', L6: 'talk needs nearness', L9: 'actors are there', L10: 'reachable',
  L11: 'bodies', L12: 'abilities', L13: 'destruction', L14: 'stated facts hold (recorded as it plays)', L15: 'a thing in one place or one hand at a time (proposed)',
};

/**
 * Each director's state. `log`: its world log record kind; `laws`: what checks it; `smoothed`: back-propagated; `to`: where
 * it lands in the ontology (src/ground/ontology/types.ts): scene.<field>, stateChange.<field>, relation.<RelationType>,
 * event.<EventType>, entity.<EntityKind>.<property>, timeline; null when it stays with the run. `schema`: a field the
 * types do not have yet.
 */
export const STATE = {
  stage: [
    { state: 'Who is on stage', log: 'presence', laws: ['L2', 'L9'], smoothed: true, to: 'scene.charactersPresent', also: 'relation.PRESENT_IN', gate: 'applied', status: 'built' },
    { state: 'The set', what: 'the scene\'s place and its path up the tree', log: 'binding', laws: [], to: 'scene.locationId', also: 'relation.PART_OF', gate: 'applied', status: 'built' },
    { state: 'The scale band', log: 'binding', laws: ['L5'], to: 'entity.Location.scale', gate: 'applied', status: 'proposed' },
    { state: 'Facts about where people are', what: 'stated or implied: indoors, a floor, near someone', log: 'position', laws: ['L14'], smoothed: true, to: 'stateChange.location', gate: 'applied', status: 'partial' },
    { state: 'Beats and who led them', log: 'beat', laws: [], to: 'event.action', also: 'relation.PRECEDES', gate: 'held', status: 'proposed' },
    { state: 'The camera', log: null, laws: [], to: null, gate: 'run', status: 'partial' },
  ],
  routine: [
    { state: 'Positions in the room', log: 'position', laws: ['L1', 'L10', 'L11'], smoothed: true, to: 'stateChange.location', also: 'relation.PART_OF', gate: 'applied', status: 'partial', note: 'today at the building; a room becomes a Location inside it' },
    { state: 'Who talks with whom, through what', log: 'meeting', laws: ['L6'], to: 'relation.SPEAKS_TO', also: 'scene.turns', gate: 'held', status: 'partial', note: 'speakers are off for now; the channel (face to face, phone, door) a property of the relation' },
    { state: 'Formations and attention', log: 'meeting', laws: ['L6'], to: 'relation.ADDRESSES', gate: 'held', status: 'proposed' },
    { state: 'Feelings', log: 'feeling', laws: [], smoothed: true, to: 'stateChange.emotions', gate: 'held', status: 'proposed', note: 'additive deltas clamped to [-1, 1] (the ontology\'s rule); applied once audits show them right' },
    { state: 'Bonds and first meetings', log: 'feeling', laws: [], to: 'stateChange.relationships', also: 'relation.KNOWS', gate: 'held', status: 'proposed' },
    { state: 'Intent', log: 'feeling', laws: [], to: 'stateChange.goalsAdd', gate: 'held', status: 'proposed' },
  ],
  mega: [
    { state: 'Journeys', what: 'routes, stops, manner', log: 'position', laws: ['L5', 'L10', 'L12'], smoothed: true, to: 'stateChange.location', also: 'event.movement', gate: 'applied', status: 'partial', note: 'each stop a location; the journey an event, held' },
    { state: 'A catastrophe\'s extent', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', also: 'event.conflict', gate: 'applied', status: 'partial' },
    { state: 'Crowds', log: 'crowd', laws: [], to: 'entity.Organization.members', also: 'relation.MEMBER_OF', gate: 'held', status: 'proposed', note: 'a named crowd (the student column) an Organization its people are members of; an unnamed density stays with the run' },
  ],
  combat: [
    { state: 'Exchanges', what: 'attacker, target, kind and shape of the attack, outcome', log: 'exchange', laws: ['L12', 'L13'], to: 'relation.PARTICIPATES_IN', also: 'event.conflict', gate: 'held', status: 'proposed', note: 'the attack\'s kind, shape and outcome properties of each participant\'s relation to the event; CAUSES from it to what it broke' },
    { state: 'Knock-backs and dodges', log: 'position', laws: ['L1', 'L10'], smoothed: true, to: 'stateChange.location', gate: 'applied', status: 'partial' },
    { state: 'Injury and condition', what: 'hurt, unconscious, bound', log: 'condition', laws: [], to: 'stateChange.conditionAdd', gate: 'held', status: 'proposed', schema: true },
    { state: 'Abilities shown', log: 'exchange', laws: ['L12'], to: 'entity.Character.abilities', gate: 'held', status: 'proposed' },
    { state: 'What breaks', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', gate: 'applied', status: 'built' },
  ],
  transport: [
    { state: 'Vehicles and weapons', log: 'item', laws: [], to: 'entity.Item.class', gate: 'held', status: 'proposed', note: 'new identities: held, as EM\'s are' },
    { state: 'Who holds, drives or rides', log: 'possession', laws: ['L15'], to: 'stateChange.possessionsAdd', also: 'stateChange.possessionsRemove', gate: 'applied', status: 'proposed' },
    { state: 'Where things are', log: 'item', laws: ['L15'], smoothed: true, to: 'relation.LOCATED_AT', gate: 'applied', status: 'proposed' },
    { state: 'Ownership', log: 'possession', laws: [], to: 'relation.OWNS', gate: 'held', status: 'proposed' },
  ],
  architect: [
    { state: 'Which building it is', log: 'binding', laws: [], to: 'entity.Location.world', gate: 'held', status: 'built', note: 'W6: building identity from the lot each scene played in; unsure ones held' },
    { state: 'Floors, uses, look', log: 'building', laws: ['L11'], to: 'entity.Location.floors', also: 'entity.Location.uses', gate: 'held', status: 'partial', note: 'a room\'s floor is in canon (W6); uses and look proposed' },
    { state: 'Rooms', log: 'building', laws: ['L11'], to: 'relation.PART_OF', gate: 'held', status: 'partial', note: 'container and split held items (W6)' },
    { state: 'Changes to it', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', gate: 'applied', status: 'built' },
  ],
};

/** A target's parts: scene.<field> | stateChange.<field> | relation.<Type> | event.<type> | entity.<Kind>.<property> | timeline. */
export const target = to => { if (!to) return null; const [base, a, b] = to.split('.'); return { base, a: a ?? null, b: b ?? null }; };

/** Problems the registry must not have: references to nothing, a type nobody listens to, a director with no reader. */
export function registryProblems() {
  const out = [];
  for (const [id, faculty] of Object.entries(FACULTIES)) {
    for (const type of faculty.types ?? []) if (!BLOCK_TYPES[type]) out.push(`faculty ${id}: no block type ${type}`);
    for (const signal of faculty.signals ?? []) if (!SIGNALS[signal]) out.push(`faculty ${id}: no signal ${signal}`);
    if (!faculty.always && !(faculty.types?.length || faculty.signals?.length)) out.push(`faculty ${id}: nothing fires it`);
    if (!Object.values(DIRECTORS).some(director => director.reads.includes(id))) out.push(`faculty ${id}: no director reads it`);
  }
  for (const type of Object.keys(BLOCK_TYPES)) if (!DAMPING.includes(type) && !Object.values(FACULTIES).some(faculty => faculty.types?.includes(type))) out.push(`block type ${type}: fires nothing and damps nothing`);
  for (const [id, director] of Object.entries(DIRECTORS)) for (const faculty of director.reads) if (!FACULTIES[faculty]) out.push(`director ${id}: no faculty ${faculty}`);
  for (const id of Object.keys(DIRECTORS)) if (!STATE[id]?.length) out.push(`director ${id}: no state`);
  for (const [id, states] of Object.entries(STATE)) for (const entry of states) {
    if (!DIRECTORS[id]) out.push(`state of ${id}: no such director`);
    if (entry.log && !LOG_KINDS[entry.log]) out.push(`${id} · ${entry.state}: no log kind ${entry.log}`);
    for (const law of entry.laws) if (!LAWS[law]) out.push(`${id} · ${entry.state}: no law ${law}`);
    if (!GATES[entry.gate]) out.push(`${id} · ${entry.state}: no gate ${entry.gate}`);
    if ((entry.gate === 'run') !== (entry.to === null)) out.push(`${id} · ${entry.state}: kept with the run exactly when it has no target`);
    if (entry.status === 'built' && entry.log && !LOG_KINDS[entry.log].built) out.push(`${id} · ${entry.state}: built, but its log kind is not`);
  }
  return out;
}

/**
 * The gate (A4): which faculties fire over the book's windows in reading order (`windows`: [{ types: { type: p },
 * signals: { signal: count } }]). A faculty's density in a window is the summed share of its types, plus each of its
 * signals as a share of that signal's most in any window; its baseline is that density's mean and spread over the book.
 * It turns on at mu + kOn·sd, off below mu + kOff·sd, stays on at least `minimum` windows, and reads a margin of one window
 * either side. Returns { faculty: boolean[] }.
 */
export function firing(windows, { kOn = 1.5, kOff = 0.5, minimum = 2 } = {}) {
  const most = Object.fromEntries(Object.keys(SIGNALS).map(signal => [signal, Math.max(0, ...windows.map(window => window.signals?.[signal] ?? 0))]));
  const out = {};
  for (const [id, faculty] of Object.entries(FACULTIES)) {
    if (faculty.always) { out[id] = windows.map(() => true); continue; }
    const density = windows.map(window => (faculty.types ?? []).reduce((sum, type) => sum + (window.types?.[type] ?? 0), 0) + (faculty.signals ?? []).reduce((sum, signal) => sum + (most[signal] ? (window.signals?.[signal] ?? 0) / most[signal] : 0), 0));
    const mu = density.reduce((sum, value) => sum + value, 0) / (density.length || 1), sd = Math.sqrt(density.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (density.length || 1)) || 1;
    const on = new Array(windows.length).fill(false);
    let state = false, since = 0;
    density.forEach((value, n) => { const z = (value - mu) / sd; if (!state && z >= kOn) { state = true; since = n; } else if (state && z < kOff && n - since >= minimum) state = false; on[n] = state; });
    out[id] = on.map((value, n) => value || !!on[n - 1] || !!on[n + 1]);
  }
  return out;
}

/** Whether a window is damped: a damping type is its largest share. */
export const damped = window => { const top = Object.entries(window.types ?? {}).sort((a, b) => b[1] - a[1])[0]; return !!top && DAMPING.includes(top[0]); };

/**
 * Who leads a window's beat: of the specialists (not the stage manager), the one whose fired faculties weigh most there
 * (its first faculty, its own, weighs 2, the others it reads 1; the always-on ones nothing); with none fired, the routine
 * director. A fight alone is the combat director's; a fight during a chase the mega-scene director's, the combat
 * director co-directing. Co-directors answer their own questions; the lead holds the camera.
 */
export function lead(fired, n) {
  const weight = id => DIRECTORS[id].reads.reduce((sum, faculty, k) => sum + (!FACULTIES[faculty].always && fired[faculty]?.[n] ? (k === 0 ? 2 : 1) : 0), 0);
  const ranked = Object.keys(DIRECTORS).filter(id => id !== 'stage').map(id => ({ id, weight: weight(id) })).filter(entry => entry.weight > 0).sort((a, b) => b.weight - a.weight);
  return { lead: ranked[0]?.id ?? 'routine', with: ranked.slice(1).map(entry => entry.id) };
}
