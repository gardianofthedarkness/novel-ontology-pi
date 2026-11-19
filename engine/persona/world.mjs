// The world as the world agent sees it (docs/v3/design.html §10.2; the user, 2026-11-19: "a proactive world engine ...
// showing misakas position in the terrain and the buildings ... the world agent, which basically serves like a god to the
// user that has all knowledge of now and future"). Every scene of every book on one story order, with what the world
// engine made of it where it has run: the place (and its chain: room, building, district, city), who is there and where
// each one starts (stage/world/spawn.json), the building's box; the story's day and time; and what happens in it, from
// the memories of everyone who lived it. A book the world engine has not run yet has only who is named in each scene.
// Read-only: the canon is never changed here; a call's own events live on its branch.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const json = async (file) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null);
const lines = async (file) => existsSync(file) ? (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** The world: every scene in story order, with place, people, time and what happens. */
export async function worldOf(u) {
  const personOf = new Map(u.cast.persons.flatMap((p) => p.members.map((m) => [`${m.book}/${m.entity}`, p.id])));
  const happened = new Map();
  for (const m of u.memories) { const k = `${m.book}/${m.scene}`; (happened.get(k) ?? happened.set(k, []).get(k)).push(m); }
  const scenes = [], places = new Map();
  for (const b of u.books) {
    const stage = join(b.dir, 'novel', 'stage', 'world');
    const script = await json(join(stage, 'script.json')), spawn = await json(join(stage, 'spawn.json'));
    for (const [id, p] of Object.entries(script?.places ?? {})) places.set(`${b.book}/${id}`, { label: p.label, scale: p.scale, parent: p.parent ? `${b.book}/${p.parent}` : null });
    const spawnOf = new Map((spawn?.scenes ?? []).map((s) => [s.id, s]));
    const onto = new Map(latest(await lines(join(b.dir, 'novel', 'ontology', 'scenes.jsonl'))).map((s) => [s.id, s]));
    b.ids.forEach((id, i) => {
      if (b.paratext.has(id)) return;
      const s = spawnOf.get(id), o = onto.get(id), person = (e) => personOf.get(`${b.book}/${e}`);
      const people = s?.starts?.length
        ? s.starts.filter((x) => x.kind === 'person' && person(x.who)).map((x) => ({ person: person(x.who), at: x.at, floor: x.floor ?? null }))
        : [...new Set([...(o?.charactersPresent ?? []), ...(o?.charactersMentioned ?? [])])].map(person).filter(Boolean).map((p) => ({ person: p, at: null, floor: null }));
      const lived = (happened.get(`${b.book}/${id}`) ?? []).sort((x, y) => (y.arousal + y.relevance) - (x.arousal + x.relevance));
      scenes.push({
        order: b.offset + i + 1, book: b.book, id, day: b.days[i], clock: b.nodes[i],
        place: s?.place ? `${b.book}/${s.place}` : o?.locationId ? `${b.book}/${o.locationId}` : null, box: s?.target?.box ?? null, floors: s?.target?.floors ?? null,
        people, happens: lived.slice(0, 3).map((m) => ({ who: m.holderId, what: m.summaryEn })), staged: !!s,
      });
    });
  }
  const chain = (placeId) => { const out = []; for (let p = places.get(placeId), n = 0; p && n < 8; p = places.get(p.parent), n++) out.push(p); return out; };
  const nameOf = (id) => u.nameOf(id);
  return { scenes, places, chain, nameOf, staged: u.books.filter((b) => existsSync(join(b.dir, 'novel', 'stage', 'world', 'spawn.json'))).map((b) => b.book) };
}

/** The scene a person is in at a story order (their last scene at or before it), or null. */
export function sceneOf(world, personId, order) {
  for (let i = world.scenes.length - 1; i >= 0; i--) { const s = world.scenes[i]; if (s.order <= order && s.people.some((p) => p.person === personId)) return s; }
  return null;
}
/** The person's next scene after a story order, or null (the end of what is read). */
export function nextSceneOf(world, personId, order) {
  return world.scenes.find((s) => s.order > order && s.people.some((p) => p.person === personId)) ?? null;
}

/** The story's clock as words: t:y1:09-01:noon -> "September 1, noon". */
export function clockText(clock) {
  const m = String(clock ?? '').match(/^t:y\d+:(\d\d)-(\d\d)(?::(.+))?$/);
  if (!m) return clock ? String(clock) : 'a time the book does not say';
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[1]) - 1];
  return `${month} ${Number(m[2])}${m[3] ? `, ${m[3]}` : ''}`;
}

/** What the world shows about a person at a story order: where, when, with whom, what is happening; and a map. */
export function glimpse(world, personId, order) {
  const s = sceneOf(world, personId, order);
  if (!s) return { person: personId, where: null, text: `${world.nameOf(personId)} is nowhere the books have shown yet.` };
  const chain = s.place ? world.chain(s.place) : [];
  const others = s.people.filter((p) => p.person !== personId).map((p) => world.nameOf(p.person));
  const me = s.people.find((p) => p.person === personId);
  return {
    person: personId, book: s.book, scene: s.id, order: s.order,
    where: chain.map((p) => p.label), when: clockText(s.clock), with: others,
    happens: s.happens.map((h) => `${world.nameOf(h.who)}: ${h.what}`),
    map: s.staged ? { box: s.box, floors: s.floors, people: s.people.filter((p) => p.at).map((p) => ({ name: world.nameOf(p.person), at: p.at, floor: p.floor, me: p.person === personId })) } : null,
    staged: s.staged,
  };
}
