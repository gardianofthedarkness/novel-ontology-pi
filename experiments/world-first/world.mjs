// The world as the reading goes, world first: every person the story has placed, where they are and since when, and the
// scene timeline on one clock. Extraction happens inside it: each scene, Jev says who is there, where, and when it is
// against the scene before, and the world keeps what the text cannot break. Its laws:
//
// - Nobody vanishes. Not being detected in a scene never removes anyone: a person stays where they were last placed
//   until a later scene places them somewhere else (and then they went there, between the two). People of the scene
//   before who are not mentioned, in a scene that carries straight on in the same place, are still there.
// - Nobody is in two places at once. A scene at the same time as another (elsewhere, or a new group in the same place)
//   cannot share a person with any scene on that stretch of the clock at another place; so a scene that has someone of
//   the scene before can only come after it, or be a flashback.
// - A flashback is the past: it logs what people did then, and moves nobody now. The scenes after it stay in the past
//   (carrying on, or later in it) until one goes back to the main time, which picks up after the last scene before it.
// - Without text, nothing changes: a fragment scene (a stray line between two scenes) carries the scene before on.
//
// The clock counts scenes, not hours: each scene is a stretch [start, end] of it; time the text names (a date, an hour,
// "the next morning") is kept as the scene's time node, and every person's log carries both.

export const TIMES = {
  after: 'right after the previous scene (it carries straight on)',
  later: 'later: some time has passed since the previous scene',
  same: 'at the same time as the previous scene, somewhere else or with other people',
  flashback: 'earlier: a flashback to before the previous scene',
};
/** The relations after a scene in the past (a flashback): still in it, or back to the main time. */
export const PAST_TIMES = {
  after: 'still in the flashback, carrying straight on',
  later: 'still in the flashback, some time later',
  back: 'back to the main time: after the last scene before the flashback',
};
/** Whether the scene before is in the past (a flashback, or a scene still in one): its relations are then PAST_TIMES. */
export const inPast = world => !!world.scenes.length && !world.scenes.at(-1).clock;
/** Clock ticks a scene "later" than the one before leaves between them. */
const GAP = 2;

export const createWorld = () => ({ people: {}, places: {}, scenes: [] });

/** The stretch of the clock a scene takes, by its relation to the scene before; null for a flashback (the unplaced past). */
export function stretchOf(world, relation) {
  const previous = world.scenes.findLast(scene => scene.clock);
  if (!previous) return [0, 1];
  if (relation === 'flashback' || (inPast(world) && relation !== 'back')) return null;
  if (relation === 'back') return [previous.clock[1], previous.clock[1] + 1];
  if (relation === 'same') return [...previous.clock];
  const start = previous.clock[1] + (relation === 'later' ? GAP : 0);
  return [start, start + 1];
}

/** People who would be in two places at once: present at `place` over `stretch`, and in another scene at another place over the same stretch. */
export function conflicts(world, present, place, stretch) {
  if (!stretch) return [];
  const overlaps = scene => scene.clock && scene.clock[0] < stretch[1] && stretch[0] < scene.clock[1];
  return present.filter(id => world.scenes.some(scene => overlaps(scene) && scene.place !== place && (scene.present.includes(id) || scene.stayed.includes(id))));
}

/** The relations a scene may take to the one before, given who is in it and where: those that break no law. */
export function allowedTimes(world, present, place) {
  if (!world.scenes.some(scene => scene.clock)) return ['after'];
  return Object.keys(inPast(world) ? PAST_TIMES : TIMES).filter(relation => !conflicts(world, present, place, stretchOf(world, relation)).length);
}

/** Who of the scene before is still there, not mentioned: the scene carries straight on in the same place. */
export function stayers(world, present, place, relation) {
  const previous = world.scenes.at(-1);
  if (!previous || relation !== 'after' || previous.place !== place) return [];
  return [...previous.present, ...previous.stayed].filter((id, index, all) => !present.includes(id) && all.indexOf(id) === index);
}

/**
 * A scene into the world: where it is, when, who is in it (with each one's spot), and the time it names, if any. Present
 * people go to its place (logging the trip when they come from elsewhere); the scene before's people who carry on unseen
 * stay; everyone else stays where they were. A flashback only logs.
 */
export function enter(world, scene) {
  const { id, chapter, place, relation, present, spots = {}, timeNode = null, fragment = false } = scene;
  const clock = stretchOf(world, relation), stayed = stayers(world, present, place, relation), entry = { id, chapter, place, relation, clock, timeNode, present: [...present], stayed, fragment, travelled: [] };
  for (const person of present) {
    const now = world.people[person] ?? (world.people[person] = { place: null, spot: null, since: null, log: [] });
    now.log.push({ scene: id, place, spot: spots[person] ?? null, clock, timeNode, past: !clock });
    if (!clock) continue;
    if (now.place && now.place !== place) entry.travelled.push({ person, from: now.place, to: place, after: now.since });
    Object.assign(now, { place, spot: spots[person] ?? (now.place === place ? now.spot : null), since: id });
  }
  for (const person of stayed) world.people[person].log.push({ scene: id, place, spot: world.people[person].spot, clock, timeNode, unseen: true });
  world.scenes.push(entry);
  return entry;
}

/** Everyone the world holds and where, for a scene's context: the latest placed first. */
export const whereabouts = world => Object.entries(world.people).filter(([, person]) => person.place).sort(([, a], [, b]) => world.scenes.findIndex(scene => scene.id === b.since) - world.scenes.findIndex(scene => scene.id === a.since));

/** Whether a person is in another scene at another place over the stretch of the scene `entry` (so cannot be in it). */
export const elsewhere = (world, entry, person) => !!entry.clock && world.scenes.some(scene => scene !== entry && scene.clock && scene.clock[0] < entry.clock[1] && entry.clock[0] < scene.clock[1] && scene.place !== entry.place && (scene.present.includes(person) || scene.stayed.includes(person)));

/**
 * Someone the scene turns out to have (a dialogue's party, an event's actor): into the entered scene, as if detected
 * there, with `why` kept on the scene. A person already in it, or elsewhere at this time, is not moved.
 */
export function join(world, entry, person, why) {
  if (entry.present.includes(person) || elsewhere(world, entry, person)) return false;
  entry.stayed = entry.stayed.filter(id => id !== person);
  entry.present.push(person);
  (entry.joined ??= []).push({ person, why });
  const now = world.people[person] ?? (world.people[person] = { place: null, spot: null, since: null, log: [] });
  now.log.push({ scene: entry.id, place: entry.place, spot: null, clock: entry.clock, timeNode: entry.timeNode, past: !entry.clock, why });
  if (entry.clock) {
    if (now.place && now.place !== entry.place) entry.travelled.push({ person, from: now.place, to: entry.place, after: now.since });
    Object.assign(now, { place: entry.place, spot: null, since: entry.id });
  }
  return true;
}
