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
