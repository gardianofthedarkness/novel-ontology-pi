// The director as specialists (docs/v2/next-steps.md A4–A5; the user, 2026-11-03): "jev can be asked for different
// questions based on what the input director sees... we can split our directors into specialist". One registry, in
// code, of what reads the text (the pre-film casts, the work model), what fires them (Jev's block types and the
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
/**
 * Types that fire no reader (exposition, a flashback). Nothing is held still for them: casts co-fire wherever their
 * evidence is sufficient (the user, 2026-11-03), and a stretch with no action is quiet because no action cast fires.
 */
export const QUIET = ['exposition', 'memory'];
/** Sentence kinds (the reading's kinds pass), each sentence's distribution over them kept whole with its top and score. */
export const SENTENCE_KINDS = ['spoken', 'thought', 'fact', 'action', 'environment', 'narration'];

/** The reading's own signals, counted per window, that can fire a cast beside the block types. */
export const SIGNALS = {
  vehicles: { label: 'vehicles named', from: 'the reading\'s vehicle slots and things (23 vehicle slots in volume 1)' },
  weapons: { label: 'weapons named', from: 'the reading\'s weapon slots (27 in volume 1)' },
  buildings: { label: 'buildings named or described', from: 'place EM\'s buildings and the spatial mentions' },
  crowds: { label: 'crowds named', from: 'the reading\'s crowd slots (134 in volume 1)' },
  scaleJump: { label: 'a jump in scale', from: 'the scene frame: a scale band wider than the scene\'s own' },
};

/**
 * The pre-film casts: work-model readers of the text. `always`: on for every scene, beat or window; else fired by a
 * mixed index of its block `types`, its sentence `kinds` and its `signals` (firing()). `writes`: the claims it puts on the
 * scene board.
 */
export const CASTS = {
  firstAD: { label: '1st AD', always: 'scene', status: 'partial', code: 'world-engine/director/director.mjs (M4: the cast from the scene digest, gathered in the set; beats from gate.mjs)', writes: ['the set as a path down the place tree', 'who is on stage', 'how it follows the scene before', 'the beats'] },
  // The user, 2026-11-03: "an implicit or scale cast of summarization pass the zoom and view angle recommendation to
  // it's associated directors and the directors camera man. Only directors who records actions need the zoom parameter."
  cinematographer: { label: 'Cinematographer', always: 'beat', status: 'built', code: 'world-engine/digest/digest.mjs scaleBeats (M5); the director sizes the action directors\' pictures, reach and camera by it', writes: ['the zoom: how many metres across the beat plays (a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km)', 'the view angle: eye level, over a shoulder, high, top-down, low looking up, aerial', 'whose eyes or which landmark it is seen from', 'how far its moves reach'] },
  scriptSupervisor: { label: 'Script supervisor', always: 'window', status: 'built', code: 'world-engine/digest/digest.mjs', writes: ['stated moves (graded)', 'facts, stated and implied', 'items', 'talk kinds', 'breaks'] },
  dialogueCoverage: { label: 'Dialogue coverage', types: ['routine', 'mediated'], kinds: ['spoken'], status: 'built', code: 'world-engine/digest/digest.mjs talkOf (M8)', writes: ['who talks with whom and through what', 'formations: beside, across a table, a ring, two sides of a door', 'attention: who looks at whom'] },
  actingCoach: { label: 'Acting coach', types: ['interior', 'routine'], kinds: ['thought'], status: 'proposed', writes: ['each person\'s emotional state as it changes (a distribution)', 'intent: what they want next', 'bonds: who they are to each other'] },
  blocking: { label: 'Blocking', types: ['traversal'], kinds: ['action'], signals: ['scaleJump'], status: 'built', code: 'world-engine/digest/digest.mjs journeysOf (M6)', writes: ['from, via and to as places of the tree', 'the manner (alleys, up a wall, leaps, carried)', 'distance and duration'] },
  actionDirector: { label: 'Action director', types: ['confrontation', 'catastrophe'], kinds: ['action'], status: 'built', code: 'world-engine/digest/digest.mjs exchangesOf (M7)', writes: ['exchanges: attacker, target, attack, outcome', 'knock-backs, dodges, throws', 'what breaks and how wide'] },
  backgroundAction: { label: 'Background action', types: ['establishing'], kinds: ['environment'], signals: ['crowds'], status: 'built', writes: ['the crowd as a field of the place (M9, world-engine/crowd/field.mjs): its size and state (milling, flowing, gathering, alarmed, gone), its focus; hazards from the fight; drag on the characters (L20)', 'weather, light, mood (not yet)', 'set dressing (not yet)'] },
  propMaster: { label: 'Prop master', types: [], kinds: ['action'], signals: ['vehicles', 'weapons'], status: 'partial', code: 'world-engine/digest/digest.mjs (items)', writes: ['vehicles: kind, who drives or rides', 'weapons: kind, who holds them', 'things held, thrown, broken'] },
  setDresser: { label: 'Set dresser', types: ['establishing'], kinds: ['environment', 'fact'], signals: ['buildings'], status: 'proposed', writes: ['a building\'s look, floors and uses (a 70-floor tower: mall, offices, flats)', 'a room\'s make-up (a container bar, a thick-doored cell)', 'changes to them'] },
};
/** The old cast ids (readings made before 2026-11-04 keep them): each one's pre-film cast. */
export const CAST_OF_FACULTY = { frame: 'firstAD', scale: 'cinematographer', generalist: 'scriptSupervisor', conversation: 'dialogueCoverage', feeling: 'actingCoach', journeys: 'blocking', choreography: 'actionDirector', ambience: 'backgroundAction', props: 'propMaster', setting: 'setDresser' };
/** A reading step's notes with the cast ids, from either file (prefilm.json, or an older casts.json). */
export const prefilmOf = json => (json ? { ...json, units: Object.fromEntries(Object.entries(json.units ?? {}).map(([id, unit]) => [id, Object.fromEntries(Object.entries(unit).map(([key, value]) => [CAST_OF_FACULTY[key] ?? key, value]))])) } : null);

/**
 * The specialist directors, of three kinds (the user, 2026-11-03):
 * - `stage`: the stage manager, always on: the set, who is on stage, who leads each beat, where the cuts fall;
 * - `action`: directors who record action (where people go, how they fight, how far they travel). Only they read the
 *   scale cast: each has a camera operator framing its beats at the zoom and view angle the cast recommends, and Jev's
 *   pictures for its questions are framed the same way. One of them leads each beat;
 * - `state`: directors who keep what rides with people and things, not where they move: a character's feelings, a vehicle
 *   or weapon, a building. They need no zoom and hold no camera; their questions are asked on the text and on fixed
 *   reference pictures (a model sheet, a building's elevation and plan). Things in motion are played by the beat's action
 *   director, at its zoom.
 * `reads`: the casts whose claims it plays, its own first; `scale`: an action director's zoom range in metres
 * [near, far]; `asks`: its Jev questions (built: a mode in src/v2/context, proposed: to be written); `tools`: its means.
 */
export const DIRECTORS = {
  stage: { kind: 'stage', label: 'Stage manager', role: 'the set, who is on stage, which action director leads each beat and where the cuts fall', reads: ['firstAD', 'scriptSupervisor'], always: true, status: 'partial',
    asks: [{ name: 'spawnSpotMode', status: 'built', what: 'where each person starts in the set' }, { name: 'sceneGoesOnMode', status: 'built', what: 'whether the scene carries straight on' }, { name: 'the set on a map of the place tree', status: 'proposed' }],
    tools: ['spawning', 'the place tree', 'the smoother', 'the gate (lead)'] },
  routine: { kind: 'action', label: 'Routine director', role: 'inside a room or on a street corner: positions, gaze, who talks to whom and from where', reads: ['dialogueCoverage', 'cinematographer', 'scriptSupervisor'], scale: [2, 15], camera: 'medium and close at the recommended angle; a room cut away', status: 'partial',
    asks: [{ name: 'dialogueKindMode', status: 'built', what: 'how a talk happens (face to face, group, remote, public)' }, { name: 'moveSpotMode', status: 'built', what: 'a spot near the speaker' }, { name: 'formation on a room plan (who sits where, facing whom)', status: 'proposed' }, { name: 'who is addressed, from the faces turned', status: 'proposed' }],
    tools: ['rooms and doors of the building skeleton', 'talk rings (L6)'] },
  mega: { kind: 'action', label: 'Mega-scene director', role: 'traversals and catastrophes seen from far: routes across blocks, leaps between towers, the ground splitting, crowds flowing', reads: ['blocking', 'cinematographer', 'backgroundAction', 'actionDirector'], scale: [100, 2000], camera: 'wide and aerial at the recommended angle; follows a journey whole', status: 'partial',
    asks: [{ name: 'moveDirectionMode at the journey\'s zoom', status: 'partial', what: 'the arrows, framed wide' }, { name: 'a landmark on a top-down map (lettered towers, bridges, stations)', status: 'built', what: 'where a journey goes when no place or label names it (M6)' }, { name: 'a route among the place graph\'s routes', status: 'proposed' }, { name: 'the extent of a catastrophe (an area on the map)', status: 'proposed' }, { name: 'which way a crowd flows', status: 'proposed' }],
    tools: ['map routes on the place graph', 'the terrain', 'the crowd field', 'percolation damage'] },
  combat: { kind: 'action', label: 'Combat director', role: 'a fight, exchange by exchange: the kind and shape of each attack, who it hits, what it breaks', reads: ['actionDirector', 'cinematographer', 'scriptSupervisor'], scale: [5, 60], camera: 'close to medium at the recommended angle, following the exchange; wider for a blast', status: 'partial',
    asks: [{ name: 'the hit spot and size (red spheres)', status: 'built', what: 'where a blast lands and how big' }, { name: 'attack kind: hand to hand, grapple, weapon, ranged power, beam, blast, thrown object, the ground itself', status: 'built', what: 'where the reader is unsure (M7)' }, { name: 'attack shape: point, line or beam, cone, sphere, wave along the ground', status: 'built', what: 'where the reader is unsure (M7)' }, { name: 'outcome: hit, dodged, blocked, cancelled; how far knocked back', status: 'partial', what: 'the outcome asked where the reader is unsure; the distance the reader\'s (M7)' }],
    tools: ['hitSphere and percolation', 'graded moves', 'destruction (L13)'] },
  character: { kind: 'state', label: 'Character director', role: 'what rides with a person: how they feel, what they want, who they are to each other', reads: ['actingCoach', 'scriptSupervisor'], status: 'proposed',
    asks: [{ name: 'emotional state as a score (Jev\'s score primitive)', status: 'proposed' }, { name: 'intent: what they want next', status: 'proposed' }, { name: 'a bond changing (closer, colder, a first meeting)', status: 'proposed' }],
    tools: ['the ontology\'s state fold (additive deltas)', 'the smoother, later'] },
  transport: { kind: 'state', label: 'Transport specialist', role: 'vehicles and weapons: what they are, who drives, rides or holds them, whose they are; their motion is played by the beat\'s action director', reads: ['propMaster', 'scriptSupervisor'], status: 'partial',
    asks: [{ name: 'which model a vehicle is (its kind\'s CC0 models: KayKit and Kenney cars, vans and trucks)', status: 'built', what: 'experiments/v2/transport.mjs, a pre-film step: universe/transport.json' }, { name: 'who rides, drives or holds it', status: 'built', what: 'card by card from the rides\' ties and the things\' holders: the card\'s holdings, the world log\'s possession, canon\'s possessions' }, { name: 'whose it is', status: 'built', what: 'the same pre-film step: each vehicle\'s, weapon\'s and machine\'s owner' }],
    tools: ['model packs (CC0)', 'things on the page'] },
  architect: { kind: 'state', label: 'Architect', role: 'a building borrowed from the world made the one the text describes: its look, floors, uses, rooms and what changes in it', reads: ['setDresser', 'scriptSupervisor'], status: 'partial',
    asks: [{ name: 'terrainHeightMode and terrainPartMode', status: 'built', what: 'a building\'s height and what it belongs to' }, { name: 'its look among the model packs and themes (on its elevation)', status: 'proposed' }, { name: 'floors and uses (the mall below, offices, flats, the rooftop deck)', status: 'proposed' }, { name: 'a room\'s kind where a conversation plays in it, and its furniture', status: 'built', what: 'director.mjs roomFor: Jev picks the kind (digest/rooms.mjs ROOM_TYPES), the room furnished by it (KayKit Furniture Bits)' }],
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
  exchange: { built: true, what: 'one attack: attacker, target, kind, shape, outcome' },
  condition: { built: true, what: 'hurt, unconscious, bound, freed' },
  crowd: { built: false, what: 'the crowd field of a place at a beat: density, make-up, flow' },
  item: { built: false, what: 'a thing, vehicle or weapon: where it is' },
  possession: { built: false, what: 'who holds, drives or rides a thing' },
  building: { built: false, what: 'a building\'s look, floors, uses and rooms' },
};

/** The laws a state can be checked by (physics-laws.md): built ones, and L14 (recorded as it plays) and L15 (proposed). */
export const LAWS = {
  L1: 'continuity by strand', L2: 'two places at once', L5: 'travel time', L6: 'talk needs nearness', L9: 'actors are there', L10: 'reachable',
  L11: 'bodies', L12: 'abilities', L13: 'destruction', L14: 'stated facts hold (recorded as it plays)', L15: 'a thing in one place or one hand at a time (proposed)',
  L16: 'presence in the frame', L17: 'displacement', L20: 'crowd drag (on foot through a crowd field, the speed its density leaves)',
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
    { state: 'Facts about where people are', what: 'stated or implied: indoors, a floor, near someone', log: 'position', laws: ['L14'], smoothed: true, to: 'stateChange.location', gate: 'applied', status: 'partial' },
    { state: 'Beats and who led them', log: 'beat', laws: [], to: 'event.action', also: 'relation.PRECEDES', gate: 'held', status: 'proposed' },
    { state: 'The cuts', what: 'where one beat ends and the next begins, and who leads it', log: 'beat', laws: [], to: null, gate: 'run', status: 'proposed' },
  ],
  routine: [
    { state: 'Positions in the room', log: 'position', laws: ['L1', 'L10', 'L11'], smoothed: true, to: 'stateChange.location', also: 'relation.PART_OF', gate: 'applied', status: 'partial', note: 'today at the building; a room becomes a Location inside it' },
    { state: 'Who talks with whom, through what', log: 'meeting', laws: ['L6'], to: 'relation.SPEAKS_TO', also: 'scene.turns', gate: 'held', status: 'partial', what: 'the channel sets the card\'s talk kind (M8); L6 respects a remote one', note: 'speakers are off for now; the channel (face to face, phone, door) a property of the relation' },
    { state: 'Formations and attention', log: 'meeting', laws: ['L6'], to: 'relation.ADDRESSES', gate: 'held', status: 'partial', note: 'formations played by rule (M8); attention read, not yet drawn' },
    { state: 'Its camera', what: 'the zoom and view angle the scale cast recommends, as framed', log: null, laws: [], to: null, gate: 'run', status: 'proposed' },
  ],
  character: [
    { state: 'Feelings', log: 'feeling', laws: [], smoothed: true, to: 'stateChange.emotions', gate: 'held', status: 'proposed', note: 'additive deltas clamped to [-1, 1] (the ontology\'s rule); applied once audits show them right' },
    { state: 'Bonds and first meetings', log: 'feeling', laws: [], to: 'stateChange.relationships', also: 'relation.KNOWS', gate: 'held', status: 'proposed' },
    { state: 'Intent', log: 'feeling', laws: [], to: 'stateChange.goalsAdd', gate: 'held', status: 'proposed' },
  ],
  mega: [
    { state: 'Journeys', what: 'routes, stops, manner', log: 'position', laws: ['L5', 'L10', 'L12'], smoothed: true, to: 'stateChange.location', also: 'event.movement', gate: 'applied', status: 'partial', note: 'each stop a location; the journey an event, held' },
    { state: 'A catastrophe\'s extent', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', also: 'event.conflict', gate: 'applied', status: 'partial' },
    { state: 'Its camera', what: 'the zoom and view angle the scale cast recommends, as framed', log: null, laws: [], to: null, gate: 'run', status: 'proposed' },
    { state: 'Crowds', log: 'crowd', laws: [], to: 'entity.Organization.members', also: 'relation.MEMBER_OF', gate: 'held', status: 'proposed', note: 'a named crowd (the student column) an Organization its people are members of; an unnamed density stays with the run' },
  ],
  combat: [
    { state: 'Exchanges', what: 'attacker, target, kind and shape of the attack, outcome', log: 'exchange', laws: ['L12', 'L13'], to: 'relation.PARTICIPATES_IN', also: 'event.conflict', gate: 'held', status: 'partial', note: 'the attack\'s kind, shape and outcome properties of each participant\'s relation to the event; CAUSES from it to what it broke' },
    { state: 'Knock-backs and dodges', log: 'position', laws: ['L1', 'L10'], smoothed: true, to: 'stateChange.location', gate: 'applied', status: 'partial' },
    { state: 'Injury and condition', what: 'hurt, unconscious, bound', log: 'condition', laws: [], to: 'stateChange.conditionsAdd', also: 'stateChange.conditionsRemove', gate: 'held', status: 'partial', note: 'the field added 2026-11-03 (set add/remove, as possessions)' },
    { state: 'Abilities shown', log: 'exchange', laws: ['L12'], to: 'entity.Character.abilities', gate: 'held', status: 'proposed' },
    { state: 'What breaks', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', gate: 'applied', status: 'built' },
    { state: 'Its camera', what: 'the zoom and view angle the scale cast recommends, as framed', log: null, laws: [], to: null, gate: 'run', status: 'partial' },
  ],
  transport: [
    { state: 'Vehicles and weapons', log: 'item', laws: [], to: 'entity.Item.class', gate: 'held', status: 'proposed', note: 'new identities: held, as EM\'s are' },
    { state: 'Who holds, drives or rides', log: 'possession', laws: ['L15'], to: 'stateChange.possessionsAdd', also: 'stateChange.possessionsRemove', gate: 'applied', status: 'partial', note: 'the card\'s holdings and the world log\'s possession records; canon fills each scene\'s possessions; L15 not yet' },
    { state: 'Where things are', log: 'item', laws: ['L15'], smoothed: true, to: 'relation.LOCATED_AT', gate: 'applied', status: 'proposed', note: 'where the beat\'s action director put them, at its zoom' },
    { state: 'Ownership', log: 'possession', laws: [], to: 'relation.OWNS', gate: 'held', status: 'partial', note: 'universe/transport.json (the pre-film step) and on the page; the OWNS relation not yet written' },
  ],
  architect: [
    { state: 'Which building it is', log: 'binding', laws: [], to: 'entity.Location.world', gate: 'held', status: 'built', note: 'W6: building identity from the lot each scene played in; unsure ones held' },
    { state: 'Floors, uses, look', log: 'building', laws: ['L11'], to: 'entity.Location.floors', also: 'entity.Location.uses', gate: 'held', status: 'partial', note: 'a room\'s floor is in canon (W6); uses and look proposed' },
    { state: 'Rooms', log: 'building', laws: ['L11'], to: 'relation.PART_OF', gate: 'held', status: 'partial', note: 'container and split held items (W6); a room\'s kind where a conversation plays (the world log\'s room records), a view input' },
    { state: 'Changes to it', log: 'damage', laws: ['L13'], to: 'entity.Location.damage', gate: 'applied', status: 'built' },
  ],
};

/** A target's parts: scene.<field> | stateChange.<field> | relation.<Type> | event.<type> | entity.<Kind>.<property> | timeline. */
export const target = to => { if (!to) return null; const [base, a, b] = to.split('.'); return { base, a: a ?? null, b: b ?? null }; };

/** Problems the registry must not have: references to nothing, a type nobody listens to, a director with no reader. */
export function registryProblems() {
  const out = [];
  for (const [id, cast] of Object.entries(CASTS)) {
    for (const type of cast.types ?? []) if (!BLOCK_TYPES[type]) out.push(`cast ${id}: no block type ${type}`);
    for (const signal of cast.signals ?? []) if (!SIGNALS[signal]) out.push(`cast ${id}: no signal ${signal}`);
    for (const kind of cast.kinds ?? []) if (!SENTENCE_KINDS.includes(kind)) out.push(`cast ${id}: no sentence kind ${kind}`);
    if (!cast.always && !(cast.types?.length || cast.signals?.length)) out.push(`cast ${id}: nothing fires it`);
    if (!Object.values(DIRECTORS).some(director => director.reads.includes(id))) out.push(`cast ${id}: no director reads it`);
  }
  for (const type of Object.keys(BLOCK_TYPES)) if (!QUIET.includes(type) && !Object.values(CASTS).some(cast => cast.types?.includes(type))) out.push(`block type ${type}: fires nothing and is not one of the quiet types`);
  for (const [id, director] of Object.entries(DIRECTORS)) for (const cast of director.reads) if (!CASTS[cast]) out.push(`director ${id}: no cast ${cast}`);
  for (const id of Object.keys(DIRECTORS)) if (!STATE[id]?.length) out.push(`director ${id}: no state`);
  // Only those who record action read the zoom, and hold a camera and a zoom range.
  for (const [id, director] of Object.entries(DIRECTORS)) {
    const action = director.kind === 'action';
    if (action !== director.reads.includes('cinematographer')) out.push(`director ${id}: ${action ? 'records action but does not read' : 'reads'} the scale cast`);
    if (action !== !!director.camera || action !== !!director.scale) out.push(`director ${id}: ${action ? 'an action director needs' : 'only action directors have'} a camera and a zoom range`);
    if (!['stage', 'action', 'state'].includes(director.kind)) out.push(`director ${id}: no kind`);
  }
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

/** How much each part of the evidence weighs in a cast's mixed index, before each window's own scores scale it. */
export const MIX = { block: 1, sentence: 0.6, signal: 0.6 };

/**
 * The gate (A4; the user, 2026-11-03: "we keep top distributions and scores for blocks and sentences, and we use them all
 * for cast triggering calculates on a score based mixed index"). `windows` in reading order, each
 *   { block: { distribution: { type: p }, confidence }, sentences: [{ distribution: { kind: p }, confidence }], signals: { signal: count } }
 * (a window's top candidates are kept beside, for the record; the index reads the whole distributions). For a cast, in
 * each window, three parts:
 *   block    = Σ over its types   P(type | block)
 *   sentence = Σ over its kinds   P(kind | sentence), averaged over the window's sentences weighted by their confidence
 *   signal   = Σ over its signals count ÷ the most in any window
 * each made a z-score against its own mean and spread over the book, and mixed by weight × the window's score for it (the
 * block's confidence, the sentences' mean confidence, 1 for signals):
 *   index = Σ aᵢ·zᵢ ÷ √Σ aᵢ²
 * so an unsure block leans on its sentences and the reverse. It turns on at kOn, off below kOff, stays on at least
 * `minimum` windows, and reads a margin of `margin` windows either side. Returns { cast: boolean[] } and, as `index`, each
 * cast's index per window.
 */
/**
 * The firing settings by window (the user, 2026-11-03, tested on real cast reads of scenes 1–13,
 * experiments/v2/cast-firing.mjs): on 12-sentence blocks, on at 1.5, off below 0.5, at least 2, a margin of 1; on
 * segments (M14), above the stretches' average with no hysteresis or margin (F1 0.52 against 0.33).
 */
export const FIRING = { block: { kOn: 1.5, kOff: 0.5, minimum: 2, margin: 1 }, segment: { kOn: 0, kOff: 0, minimum: 0, margin: 0 } };
export function firing(windows, { kOn = 1.5, kOff = 0.5, minimum = 2, margin = 1 } = {}) {
  const most = Object.fromEntries(Object.keys(SIGNALS).map(signal => [signal, Math.max(0, ...windows.map(window => window.signals?.[signal] ?? 0))]));
  const stats = values => { const mu = values.reduce((sum, value) => sum + value, 0) / (values.length || 1), sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length || 1)); return value => (sd ? (value - mu) / sd : 0); };
  const out = { index: {} };
  for (const [id, cast] of Object.entries(CASTS)) {
    if (cast.always) { out[id] = windows.map(() => true); continue; }
    const parts = windows.map(window => {
      const sentences = window.sentences ?? [], trust = sentences.reduce((sum, sentence) => sum + (sentence.confidence ?? 1), 0);
      return {
        block: (cast.types ?? []).reduce((sum, type) => sum + (window.block?.distribution?.[type] ?? 0), 0),
        sentence: trust ? sentences.reduce((sum, sentence) => sum + (sentence.confidence ?? 1) * (cast.kinds ?? []).reduce((share, kind) => share + (sentence.distribution?.[kind] ?? 0), 0), 0) / trust : 0,
        signal: (cast.signals ?? []).reduce((sum, signal) => sum + (most[signal] ? (window.signals?.[signal] ?? 0) / most[signal] : 0), 0),
        scores: { block: window.block ? window.block.confidence ?? 1 : 0, sentence: sentences.length ? trust / sentences.length : 0, signal: 1 },
      };
    });
    const used = ['block', 'sentence', 'signal'].filter(part => (part === 'block' ? cast.types : part === 'sentence' ? cast.kinds : cast.signals)?.length);
    const z = Object.fromEntries(used.map(part => [part, stats(parts.map(entry => entry[part]))]));
    const index = parts.map(entry => { let top = 0, under = 0; for (const part of used) { const a = MIX[part] * entry.scores[part]; top += a * z[part](entry[part]); under += a * a; } return under ? top / Math.sqrt(under) : 0; });
    const on = new Array(windows.length).fill(false);
    let state = false, since = 0;
    index.forEach((value, n) => { if (!state && value >= kOn) { state = true; since = n; } else if (state && value < kOff && n - since >= minimum) state = false; on[n] = state; });
    out[id] = on.map((_, n) => on.slice(Math.max(0, n - margin), n + margin + 1).some(Boolean));
    out.index[id] = index;
  }
  return out;
}


/**
 * Who leads a window's beat: of the action directors, the one whose fired casts weigh most there (its own cast
 * weighs 2, the others it reads 1; the always-on ones nothing); with none fired, the routine director. A fight alone is
 * the combat director's; a fight during a chase the mega-scene director's, the combat director co-directing. The lead's
 * camera operator holds the camera; co-directors (action or state) answer their own questions. `type`: the window's
 * smoothed block type; the director whose own cast listens for it weighs one more (a confrontation is the combat
 * director's even where its action sentences fire journeys too).
 */
export function lead(fired, n, type = null) {
  const weight = id => DIRECTORS[id].reads.reduce((sum, cast, k) => sum + (!CASTS[cast].always && fired[cast]?.[n] ? (k === 0 ? 2 : 1) : 0), 0) + (type && CASTS[DIRECTORS[id].reads[0]]?.types?.includes(type) ? 1 : 0);
  // Equal weights: the one whose own cast stands higher on its mixed index there (firing()'s `index`), so a cast
  // two directors read is not counted twice.
  const strength = id => { const own = DIRECTORS[id].reads[0]; return fired[own]?.[n] ? fired.index?.[own]?.[n] ?? 0 : -Infinity; };
  const ranked = Object.keys(DIRECTORS).filter(id => DIRECTORS[id].kind !== 'stage').map(id => ({ id, weight: weight(id), strength: strength(id), action: DIRECTORS[id].kind === 'action' })).filter(entry => entry.weight > 0).sort((a, b) => b.weight - a.weight || b.strength - a.strength);
  const first = ranked.find(entry => entry.action)?.id ?? 'routine';
  return { lead: first, with: ranked.filter(entry => entry.id !== first).map(entry => entry.id) };
}
