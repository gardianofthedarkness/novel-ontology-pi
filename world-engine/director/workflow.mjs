// The runtime workflow (the user, 2026-11-04: "runtime casts workflow ... model the workflows into strands and nodes";
// docs/v2/directing/casts-jev-and-crew.md, "The runtime workflow"). As a studio tracks a production (the anime cut
// bag carried desk to desk; ShotGrid's and Kitsu's tasks, statuses and published versions):
//
//   each storyboard cut is a node carrying a chain of tasks, cut-wide or card by card:
//     layout → frame → layout check → keys → key check → in-betweens → reframe → photography → rush check
//   every task has a status (waiting, ready, in progress, checking, done, retake, passed with faults) and publishes
//   numbered versions; a check names the faults it found, and a retake keeps the version before it;
//   strands order the nodes: a cut waits for the last earlier cut that cast each of its people.
//
// Nobody is in the loop (the user, 2026-11-04: "user is never on the loop. Everything automatic"): every check is a law
// or a geometry test; a task gets at most RETAKES retakes, then the desk keeps the version with the fewest faults, marks
// it passed with faults, and the cut moves on.

export const TASKS = ['layout', 'frame', 'layout check', 'keys', 'key check', 'in-betweens', 'reframe', 'photography', 'rush check'];
export const CUT_TASKS = new Set(['layout', 'frame', 'layout check']);
export const RETAKES = 2;
export const BODY = 1.7;
// What a shot size takes in, metres across (a close-up one face, a wide shot the room or the street round them).
export const SHOT_SPAN = { 'extreme close-up': 0.6, 'close-up': 1.2, 'medium close-up': 2, 'medium shot': 3.5, 'full shot': 6, 'wide shot': 30, 'extreme wide shot': 250 };
export const ELEVATION = { 'eye level': 12, 'over a shoulder': 20, 'over the shoulder': 20, high: 45, 'top-down': 80, overhead: 80, 'low, looking up': 6, low: 6, aerial: 60 };
// The camera moves that follow someone out of where the frame stood (a pan turns after them, a track or a crane goes with
// them, a handheld camera is carried along); a still camera, a tilt or a zoom holds its place.
export const FOLLOWS = new Set(['pan', 'track', 'crane', 'handheld']);
const MAX_WINDOW = 400;

const round = value => Math.round(value * 10) / 10;

// ── The frame (the photographer) ───────────────────────────────────────────────────────────────────────────────────
// The window a cut's camera holds: centred on its subjects, as wide as its shot size and never cutting off the people
// it holds; `window` is metres from the centre on the ground. `camera` is what the page's camera takes.
export function frameOf({ points, size, angle, move, lead = null }) {
  const span = SHOT_SPAN[size] ?? SHOT_SPAN['medium shot'];
  const centre = lead ?? (points.length ? [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length) : null);
  if (!centre) return null;
  const spread = lead ? 0 : Math.max(0, ...points.map(p => Math.hypot(p[0] - centre[0], p[2] - centre[2])));
  const window = Math.min(MAX_WINDOW, Math.max(span / 2, spread + BODY));
  return {
    centre: centre.map(round), window: round(window), size, angle, move, follows: FOLLOWS.has(move),
    camera: { focus: { x: centre[0], z: centre[2], y0: centre[1], w: 6, d: 6, h: 3 }, radius: Math.max(span + 1.5, spread * 1.2 + 2 * BODY), elevation: ELEVATION[angle] ?? 12, yaw: 0 },
  };
}

// Whether a point stands in the frame's window: within it on the ground, and on the frame's level (a floor or two).
export const inFrame = (frame, p) => !!frame && Math.hypot(p[0] - frame.centre[0], p[2] - frame.centre[2]) <= frame.window + 0.5 && Math.abs(p[1] - frame.centre[1]) <= Math.max(4, frame.window);

// The layout check (the episode director's): what is wrong with a layout in a frame. Two of the cast on one cell (L11);
// someone the cut holds outside its window; a shot size that cannot hold its cast (a close-up of people thirty metres
// apart). Each fault names who and why.
export function layoutFaults({ frame, cast }) {
  const faults = [], cell = new Map();
  for (const entry of cast) {
    const other = cell.get(entry.node);
    if (other !== undefined) faults.push({ law: 'L11', who: entry.who, why: `on one cell with ${other}`, fix: 'layout' });
    else cell.set(entry.node, entry.who);
  }
  if (frame) {
    for (const entry of cast) if (entry.held !== false && !inFrame(frame, entry.at)) faults.push({ law: 'frame', who: entry.who, why: `outside the ${frame.size} (${round(Math.hypot(entry.at[0] - frame.centre[0], entry.at[2] - frame.centre[2]))} m from its centre)`, fix: 'frame' });
    const span = SHOT_SPAN[frame.size] ?? SHOT_SPAN['medium shot'];
    if (frame.window > 3 * (span / 2) + 6) faults.push({ law: 'frame', who: null, why: `a ${frame.size} cannot hold a cast ${round(frame.window * 2)} m across`, fix: 'tighten' });
  }
  return faults;
}

// The reframe (after the in-betweens): who of the cut's cast ended outside the window, and what the camera does.
// Still in frame: held. A camera that follows: it follows (the frame recentred on the cast as they stand). A still
// camera: someone who leaves and is not seen again in this cut exits frame (a cut where someone walks out of shot);
// someone who leaves and acts or speaks again in this cut needs a new cut (the storyboard's retake).
export function reframeOf({ frame, ended, later }) {
  const outside = ended.filter(entry => !inFrame(frame, entry.at)).map(entry => entry.who);
  if (!outside.length) return { decision: 'held', outside };
  if (frame.follows) return { decision: 'followed', outside };
  if (outside.some(who => later.has(who))) return { decision: 'new cut', outside };
  return { decision: 'exits frame', outside };
}

// ── The cuts and the strands (the production desk's board) ───────────────────────────────────────────────────────
// Each cut with its cast (the people who act, speak or are addressed in its cards), in reading order; each waits for the
// last earlier cut that cast each of its people (`after`), and its wave is how many such cuts stand before it: cuts of one
// wave share no one and could be made side by side.
export function strandOrder(cuts) {
  const lastOf = new Map(), waveOf = new Map();
  return cuts.map(cut => {
    const after = [...new Set(cut.cast.map(who => lastOf.get(who)).filter(Boolean))];
    const wave = after.length ? 1 + Math.max(...after.map(id => waveOf.get(id))) : 0;
    waveOf.set(cut.id, wave);
    for (const who of cut.cast) lastOf.set(who, cut.id);
    return { ...cut, after, wave };
  });
}

export function castOfCuts({ storyboard, cards, present = new Set(['speaks', 'acts', 'addressed']) }) {
  const cardOf = new Map(cards.map(card => [card.id, card]));
  return storyboard.map(cut => ({ id: cut.id, n: cut.index + 1, scene: cut.scene, cards: cut.cards, cast: [...new Set(cut.cards.flatMap(id => (cardOf.get(id)?.people ?? []).filter(person => person.how.some(how => present.has(how))).map(person => person.id)))] }));
}

// ── The desk (statuses, versions, retakes) ───────────────────────────────────────────────────────────────────────
export function createDesk({ cuts = [], now = () => Date.now(), retakes = RETAKES } = {}) {
  const started = now(), nodes = new Map(), timeline = [];
  for (const cut of strandOrder(cuts)) nodes.set(cut.id, { ...cut, tasks: {}, cards: {} });
  const nodeOf = id => nodes.get(id) ?? nodes.set(id, { id, n: null, scene: null, cast: [], cards: {}, after: [], wave: null, tasks: {} }).get(id);
  const taskOf = (cut, task, card = null) => {
    const node = nodeOf(cut), home = card && !CUT_TASKS.has(task) ? (node.cards[card] ??= {}) : node.tasks;
    return home[task] ??= { status: 'ready', versions: [], retakes: [], kept: null };
  };
  const mark = (cut, task, card, status, extra = {}) => { const entry = taskOf(cut, task, card); entry.status = status; timeline.push({ t: now() - started, cut, task, ...(card ? { card } : {}), status, ...extra }); return entry; };
  const desk = {
    nodes, timeline,
    start: (cut, task, card = null) => mark(cut, task, card, 'in progress'),
    // A version handed on: what downstream reads. Returns its number.
    publish(cut, task, data, card = null) {
      const entry = taskOf(cut, task, card), v = entry.versions.length + 1;
      entry.versions.push({ v, data }); entry.kept = v;
      mark(cut, task, card, 'checking', { v });
      return v;
    },
    // Done with no check of its own.
    done(cut, task, card = null) { const entry = taskOf(cut, task, card); mark(cut, task, card, 'done', { v: entry.kept }); return 'done'; },
    // A check (its own task, `task`) on the last version of the task it checks (`of`): each check is a version of its
    // own holding the faults it found and the version it looked at. No faults, done; faults and retakes left (and a way
    // to retake), a retake; else the checked version with the fewest faults is kept, passed with faults.
    check(cut, task, faults, { card = null, canRetake = true, of = null } = {}) {
      const entry = taskOf(cut, task, card), checked = of ? taskOf(cut, of, card) : null, looked = checked?.versions.at(-1)?.v ?? null;
      entry.versions.push({ v: entry.versions.length + 1, data: { of, v: looked }, faults });
      entry.kept = entry.versions.length;
      if (!faults.length) { mark(cut, task, card, 'done', { v: entry.kept }); return 'done'; }
      if (canRetake && entry.retakes.length < retakes) {
        entry.retakes.push({ v: looked, why: faults.map(fault => `${fault.law}${fault.who ? ` ${fault.who}` : ''}: ${fault.why}`) });
        mark(cut, task, card, 'retake', { v: entry.kept, faults: faults.length });
        return 'retake';
      }
      const best = entry.versions.reduce((a, b) => (b.faults.length < a.faults.length ? b : a));
      entry.kept = best.v;
      if (checked && best.data.v !== null) checked.kept = best.data.v;
      mark(cut, task, card, 'passed with faults', { v: entry.kept, faults: best.faults.length, ...(canRetake ? {} : { why: 'no retake for this check yet' }) });
      return 'passed with faults';
    },
    kept(cut, task, card = null) { const entry = taskOf(cut, task, card); return entry.versions.find(version => version.v === entry.kept)?.data ?? null; },
    // A storyboard retake: a cut split where someone left its frame and is seen again in it; the cards after go to a new
    // node after it, with the same shot.
    split(cut, at, why) {
      const node = nodeOf(cut), parts = (node.parts ??= 1) + 1; node.parts = parts;
      const id = `${cut}~${parts}`;
      nodes.set(id, { id, n: node.n, scene: node.scene, cast: node.cast, after: [cut], wave: (node.wave ?? 0) + 1, from: cut, at, tasks: {}, cards: {} });
      timeline.push({ t: now() - started, cut, task: 'storyboard', status: 'retake', to: id, at, why });
      return id;
    },
    // The nodes this run has worked on (a run plays a stretch of the line; the board holds every cut of the reading).
    touched: () => [...nodes.values()].filter(node => Object.keys(node.tasks).length || Object.keys(node.cards).length),
    summary() {
      const by = {}, statuses = {};
      const count = (task, entry) => {
        const row = (by[task] ??= { done: 0, 'passed with faults': 0, retakes: 0, versions: 0 });
        if (entry.status === 'done' || entry.status === 'passed with faults') row[entry.status]++;
        row.retakes += entry.retakes.length; row.versions += entry.versions.length;
        statuses[entry.status] = (statuses[entry.status] ?? 0) + 1;
      };
      const touched = desk.touched();
      for (const node of touched) { for (const [task, entry] of Object.entries(node.tasks)) count(task, entry); for (const card of Object.values(node.cards)) for (const [task, entry] of Object.entries(card)) count(task, entry); }
      const waves = new Set(touched.map(node => node.wave).filter(wave => wave !== null && wave !== undefined)).size;
      return { cuts: touched.length, waves, splits: touched.filter(node => node.from).length, tasks: by, statuses };
    },
    toJSON: () => ({ version: 1, tasks: TASKS, retakesPerTask: retakes, summary: desk.summary(), cuts: desk.touched(), timeline }),
  };
  return desk;
}
