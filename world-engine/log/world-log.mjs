// The world log (docs/v2/world-ontology.md §3, §5a; Track B W1): what a director run did to the world, as records the
// laws and back-propagation read: who was present in each scene and where, every move, meeting and blast, each scene's
// building. Every position says how it came to be (its rank: stated, met, answered, ruled; a pin will be above them all)
// and what it was derived from (the record it carries on from, the people it is tied to), so a new anchor can re-derive
// exactly what depended on what it replaces. Append-only: a later revision supersedes records, it never edits them.

/** Ranks, strongest first (§5a). An anchor is a pinned, stated or met position. */
export const RANKS = ['pinned', 'stated', 'met', 'answered', 'ruled'];
export const isAnchor = record => RANKS.indexOf(record.rank) <= RANKS.indexOf('met');
/** Spawning's ways of placing someone that rest on the text (src/v2/spawning/positions.ts `by`). */
const STATED_BY = new Set(['spatial', 'part', 'speaking']);

const round = value => Math.round(value * 10) / 10;
const point = p => ({ x: round(p.x), y: round(p.y), z: round(p.z) });

/** The page's dense node as a point in metres (its world grid). */
export const decoderOf = world => node => { const i = node % world.NX - world.oi, j = Math.floor(node / world.NX) % world.NZ - world.oj, k = Math.floor(node / (world.NX * world.NZ)) - world.ok; return { x: (i + 0.5) * 2, z: (j + 0.5) * 2, y: k * 3 }; };
const metresOf = (path, decode) => path.slice(1).reduce((sum, node, n) => { const a = decode(path[n]), b = decode(node); return sum + Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y); }, 0);

/**
 * The world log of a run: `record` (stage/director/run.json), its `page` (the run's page: scenes' starts, each card's
 * walks), `spawn` (stage/world/spawn.json: each start's `by`), `strands` (stage/world/strands.json).
 */
export function worldLog({ run, record, page, spawn, strands }) {
  const decode = decoderOf(page.world), pageScene = new Map(page.scenes.map(scene => [scene.id, scene]));
  const strandOf = new Map(strands.scenes.map(scene => [scene.id, scene.fork])), spawnOf = new Map((spawn?.scenes ?? []).map(scene => [scene.id, scene]));
  const out = [], last = new Map();
  let n = 0;
  const add = fields => { const entry = { id: `${run}:${++n}`, run, ...fields }; out.push(entry); return entry; };
  for (const sceneRecord of record.scenes) {
    const scene = pageScene.get(sceneRecord.scene);
    if (!scene) continue;
    const strand = strandOf.get(scene.id) ?? null, spawned = spawnOf.get(scene.id);
    // The scene's building or area, as spawning bound it.
    if (spawned?.target) add({ kind: 'binding', strand, scene: scene.id, place: spawned.target.place ?? scene.place, target: spawned.target.kind, box: spawned.target.box, rank: 'ruled', source: 'spawn' });
    // Who is present at its start, and where, and why.
    for (const [who, node] of Object.entries(scene.starts)) {
      if (node == null || who.startsWith('extra:')) continue;
      const at = point(decode(node)), before = last.get(who);
      let fields;
      if (sceneRecord.revised?.includes(who)) { const revision = record.revisions?.find(entry => entry.applied && entry.who === who && entry.scene === scene.id); fields = { how: 'revised', rank: 'ruled', source: 'smoothed', from: before?.id ?? null, ...(revision ? { metres: revision.metres } : {}) }; }
      else if (sceneRecord.carried.includes(who)) fields = { how: 'carried', rank: before?.rank ?? 'ruled', source: 'carried', from: before?.id ?? null };
      else if (sceneRecord.spawned.includes(who)) { const by = spawned?.starts?.find(entry => entry.who === who)?.by ?? null; fields = { how: 'spawned', rank: STATED_BY.has(by) ? 'stated' : 'ruled', source: `spawn:${by ?? 'anchor'}` }; }
      else if (sceneRecord.offPage.includes(who)) fields = { how: 'arrived', rank: 'ruled', source: 'off-page', from: before?.id ?? null };
      else fields = { how: 'arrived', rank: 'ruled', source: 'walked in', from: before?.id ?? null };
      last.set(who, add({ kind: 'presence', strand, scene: scene.id, place: scene.place, who, at, ...fields }));
    }
    // Every card: its walks (each with its rank and ties), its meeting, its blast.
    const cardOf = new Map(sceneRecord.cards.map(card => [card.event, card]));
    scene.events.forEach((event, index) => {
      const card = cardOf.get(index), moves = card?.moves ?? [];
      for (const move of event.moves.filter(entry => !entry.person.startsWith('extra:'))) {
        const said = moves.find(entry => entry.person === move.person && entry.moved), why = String(said?.why ?? '');
        const talk = why.startsWith('spoken to by '), together = why.startsWith('with ');
        const tie = talk || together ? Object.keys(scene.starts).find(id => page.people?.[id]?.name === why.replace(/^(spoken to by|with) /, '')) ?? null : null;
        // The summarizer's moves (graded, implied by a fact, the background's routine) carry their own source.
        const fields = said?.pinned ? { rank: 'pinned', source: talk ? 'met (the review)' : 'the review' } : event.id.startsWith('arrive') ? { rank: 'ruled', source: 'walked in' } : talk ? { rank: 'ruled', source: 'talk' } : together ? { rank: 'answered', source: 'with' }
          : why.startsWith('journey') ? { rank: 'answered', source: 'journey' } : why.startsWith('implied') ? { rank: 'answered', source: 'implied' } : why.startsWith('background') ? { rank: 'ruled', source: 'background' } : why.startsWith('digest') ? { rank: 'answered', source: 'digest', way: said?.direction ?? null } : { rank: 'answered', source: 'answer', way: said?.direction ?? null };
        last.set(move.person, add({ kind: 'position', strand, scene: scene.id, place: scene.place, card: card?.card ?? event.id, who: move.person, at: point(decode(move.path.at(-1))), how: move.how, metres: round(metresOf(move.path, decode)), from: last.get(move.person)?.id ?? null, ...(tie ? { ties: [tie] } : {}), ...fields }));
      }
      // An arrival the review pinned (no walk, they get there): where they are now, at the rank of the pin.
      for (const move of moves.filter(entry => entry.arrived && entry.at)) last.set(move.person, add({ kind: 'position', strand, scene: scene.id, place: scene.place, card: card.card, who: move.person, at: point(move.at), how: 'arrived', metres: 0, from: last.get(move.person)?.id ?? null, rank: 'pinned', source: 'the review' }));
      const gathered = moves.filter(move => String(move.why ?? '').startsWith('spoken to by '));
      if (card?.kind === 'dialogue' && gathered.length) add({ kind: 'meeting', strand, scene: scene.id, card: card.card, parties: [...new Set(gathered.map(move => move.person))], rank: 'ruled', source: 'talk gathers' });
      if (event.hit) add({ kind: 'damage', strand, scene: scene.id, card: card?.card ?? event.id, lot: event.hit.lot ?? null, sphere: event.hit.sphere ?? null, strength: event.hit.strength ?? null, rank: 'answered', source: 'blast' });
    });
  }
  return out;
}

/**
 * The ledger's proposals from a world log and the laws' verdicts (§2, §6): what the world would write into the ontology,
 * each with its evidence (log ids) and state. Nothing is applied here: world records wait for the user's decision on
 * applying them without review, and the laws' breaks are held for the review.
 */
export function proposalsOf({ run, log, laws, eventOf, record = null }) {
  const out = [];
  let n = 0;
  const add = fields => out.push({ id: `${run}:p${++n}`, run, state: 'proposed', ...fields });
  // Where each person is after each card or scene start: the ontology's state changes (location), by canon's event.
  for (const entry of log.filter(record => record.kind === 'presence' || record.kind === 'position')) {
    const after = entry.card ? eventOf(entry.card) : null;
    add({ kind: 'state-change', subject: entry.who, value: { characterId: entry.who, afterEventId: after, ...(after ? {} : { atSceneStart: entry.scene }), location: entry.place, at: entry.at }, evidence: [entry.id], rank: entry.rank });
  }
  // Each strand as a timeline of the ontology.
  for (const strand of [...new Set(log.map(record => record.strand).filter(Boolean))]) add({ kind: 'timeline', subject: strand, value: { id: `tl_strand_${strand}`, scenes: [...new Set(log.filter(record => record.strand === strand).map(record => record.scene))] }, evidence: [] });
  // Damage the world took.
  for (const entry of log.filter(record => record.kind === 'damage')) add({ kind: 'damage', subject: entry.lot, value: { scene: entry.scene, card: entry.card, strength: entry.strength }, evidence: [entry.id] });
  // What the laws decided as the run played (W4): each held move, speaker or actor, and each amended entry, with why.
  for (const scene of record?.scenes ?? []) for (const [card, laws] of [[null, scene.laws ?? []], ...scene.cards.map(entry => [entry.card, entry.laws ?? []])]) {
    for (const decided of laws) add({ kind: 'law', state: decided.verdict === 'held' ? 'held' : 'applied', source: 'play', law: decided.law, subject: decided.who ?? null, value: { scene: scene.scene, card, verdict: decided.verdict, why: decided.why, ...(decided.code ? { code: decided.code } : {}) }, evidence: [] });
  }
  // What the world's own check found round each scene (W0): a broken world, held for the review apart from the story's laws.
  for (const scene of record?.scenes ?? []) for (const issue of scene.world ?? []) add({ kind: 'world', state: 'held', source: 'check', subject: issue.source ?? null, value: { scene: scene.scene, code: issue.code, lot: issue.lot, ...(issue.room != null ? { room: issue.room } : {}), name: issue.name ?? null }, evidence: [] });
  // The smoothing's revisions of scene starts (§5a, W5b): applied below the limit, else held for the review (class R).
  for (const revision of record?.revisions ?? []) add({ kind: 'revision', state: revision.applied ? 'applied' : 'held', source: 'smoothing', subject: revision.who, value: { scene: revision.scene, moments: revision.moments ?? [], metres: revision.metres ?? null, rank: revision.rank ?? null }, evidence: [] });
  // What the laws find over the whole run afterwards (W2): held for the review.
  for (const law of laws) for (const broken of law.violations) add({ kind: 'held', state: 'held', subject: broken.who ?? null, law: law.law, value: { what: broken.what, why: broken.why }, evidence: [] });
  return out;
}
