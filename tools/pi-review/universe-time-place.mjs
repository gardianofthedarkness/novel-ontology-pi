import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timePlaceProjection } from './time-place.mjs';
import { readStrandAnswers } from './strand-answers.mjs';
import { calendarView, storedYearDecisions } from './calendar-view.mjs';

/**
 * Universe story time and places for the viewer (time-place phase 3).
 * Story time and places belong to a universe, so the Story time and Places
 * views show every book of the universe the reader is in:
 *   - places are universe places (the reviewed atlas joins the same place
 *     across books and carries each place's parent across volumes);
 *   - story time is per continuity: books follow their reading order and
 *     each book's own story order (no cross-book reordering is invented);
 *   - characters with the same name across books are grouped for display
 *     only (not an identity fact).
 * Ids are qualified by volume (`<volume>:<id>`) so books never collide.
 * Pure projection over stored facts; no source text leaves the books.
 */
const rows = async (path) => (await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).split('\n').filter(Boolean).map(JSON.parse);
const json = async (path, fallback) => readFile(path, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return fallback; throw error; });
const nameOf = (entity) => entity?.names?.find((form) => form.kind === 'canonical')?.text ?? entity?.names?.[0]?.text ?? entity?.id;
const cache = new Map();

async function stamp(paths) {
  return (await Promise.all(paths.map(path => stat(path).then(info => `${path}:${info.mtimeMs}:${info.size}`, () => `${path}:-`)))).join('|');
}

async function bookProjection(workspace) {
  const files = ['entities', 'scenes', 'relations', 'events'].map(name => resolve(workspace, `ontology/${name}.jsonl`));
  const key = await stamp([...files, resolve(workspace, 'changesets'), resolve(workspace, 'timeplace')]);
  if (cache.get(workspace)?.key === key) return cache.get(workspace).value;
  const [entities, scenes, relations, events] = await Promise.all(files.map(rows));
  const names = await readdir(resolve(workspace, 'changesets')).catch(() => []);
  const pending = (await Promise.all(names.filter(name => /^cs_timeplace_[\w-]+\.json$/.test(name)).map(name => json(resolve(workspace, 'changesets', name), null)))).filter(entry => entry?.status === 'pending_review').flatMap(entry => entry.proposals ?? []);
  const fold = (records) => [...new Map(records.map(record => [record.id, record])).values()];
  const value = { projection: timePlaceProjection({ entities: fold(entities), scenes: fold(scenes), relations, events: fold(events), pending, strands: await readStrandAnswers(workspace) }), entities: fold(entities) };
  cache.set(workspace, { key, value });
  return value;
}

/** Merge per-book projections into one universe projection. `atlas` is atlasView's output. */
export function mergeUniverse({ atlas, books, continuities }) {
  const qualify = (volume, id) => `${volume}:${id}`;
  const clusterOf = new Map(atlas.places.flatMap(place => place.members.map(member => [member, place])));
  const universePlace = (book, localId) => { const cluster = clusterOf.get(`${book.sourceId}::${localId}`); return cluster ? `u:${cluster.id}` : `u:${book.sourceId}::${localId}`; };
  const labels = new Map(), characters = new Map(), names = {};
  const scenes = [], times = [], placeRows = new Map();
  const ordered = [...books].sort((first, second) => (first.readingOrder ?? Infinity) - (second.readingOrder ?? Infinity) || first.volume - second.volume);
  const offsets = new Map();
  let sceneIndex = 0;
  for (const book of ordered) {
    const { projection, entities } = book.data;
    const byId = new Map(entities.map(entity => [entity.id, entity]));
    const continuity = book.continuityId ?? `book-${book.volume}`;
    const offset = offsets.get(continuity) ?? 0;
    const span = Math.max(-1, ...projection.times.map(time => time.storyIndex)) + 1;
    offsets.set(continuity, offset + span);
    const characterId = (id) => { const label = projection.names[id] ?? nameOf(byId.get(id)) ?? id; const key = `c:${label}`; characters.set(key, { id: key, label, scenes: (characters.get(key)?.scenes ?? 0) }); names[key] = label; return key; };
    for (const scene of projection.scenes) {
      const row = { ...scene, id: qualify(book.volume, scene.id), index: sceneIndex++, book: book.volume, continuityId: book.continuityId,
        times: scene.times.map(time => ({ ...time, id: qualify(book.volume, time.id) })), placeIds: scene.placeIds.map(id => universePlace(book, id)), characterIds: scene.characterIds.map(characterId) };
      for (const id of row.characterIds) characters.get(id).scenes++;
      scenes.push(row);
    }
    for (const time of projection.times) times.push({ ...time, id: qualify(book.volume, time.id), storyIndex: offset + time.storyIndex, narrativeIndex: offset + time.narrativeIndex, toldFromId: time.toldFromId ? qualify(book.volume, time.toldFromId) : null, anchorSceneId: time.anchorSceneId ? qualify(book.volume, time.anchorSceneId) : null, sceneIds: time.sceneIds.map(id => qualify(book.volume, id)), book: book.volume, continuityId: book.continuityId });
    for (const place of projection.places) {
      const id = universePlace(book, place.id);
      if (!labels.has(id) || place.sceneIds.length > (placeRows.get(id)?.sceneIds.length ?? 0)) labels.set(id, place.label);
      const row = placeRows.get(id) ?? { id, sceneIds: [], statedScenes: 0, characterIds: [], proposed: true, books: [], members: [], localParents: [], generic: place.generic };
      row.members.push(qualify(book.volume, place.id));
      row.sceneIds.push(...place.sceneIds.map(sceneId => qualify(book.volume, sceneId)));
      row.statedScenes += place.statedScenes;
      row.proposed &&= !!place.proposed;
      if (!row.books.includes(book.volume)) row.books.push(book.volume);
      if (place.parentId) row.localParents.push({ id: universePlace(book, place.parentId), proposed: !!place.parentProposed });
      placeRows.set(id, row);
    }
  }
  // Parents: the reviewed universe tree first; a book's still-proposed parent fills a gap, marked proposed.
  const atlasParent = new Map(atlas.places.filter(place => place.parent).map(place => [`u:${place.id}`, { id: `u:${place.parent}`, proposed: !!place.parentProposed }]));
  const parentOf = (id) => atlasParent.get(id) ?? placeRows.get(id)?.localParents.find(entry => entry.proposed) ?? null;
  const pathOf = (id) => { const path = []; const seen = new Set(); for (let at = id; at && !seen.has(at); at = parentOf(at)?.id) { seen.add(at); path.unshift(at); } return path; };
  for (const id of [...placeRows.keys()]) for (const ancestor of pathOf(id)) if (!placeRows.has(ancestor)) placeRows.set(ancestor, { id: ancestor, sceneIds: [], statedScenes: 0, characterIds: [], proposed: false, books: [], members: [], localParents: [], generic: false });
  const atlasLabel = new Map(atlas.labels ?? []);
  const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
  const places = [...placeRows.values()].map(row => {
    const path = pathOf(row.id);
    const total = scenes.filter(scene => scene.placeIds.some(placeId => pathOf(placeId).includes(row.id)));
    return { id: row.id, label: labels.get(row.id) ?? atlasLabel.get(row.id.slice(2)) ?? row.id, sceneIds: row.sceneIds, statedScenes: row.statedScenes, characterIds: [...new Set(row.sceneIds.flatMap(id => sceneById.get(id)?.characterIds ?? []))], proposed: row.proposed && row.sceneIds.length > 0 || !!atlas.places.find(place => `u:${place.id}` === row.id)?.proposed,
      parentId: parentOf(row.id)?.id ?? null, parentProposed: !!parentOf(row.id)?.proposed, depth: path.length - 1, path, totalScenes: total.length, generic: row.generic, books: row.books.length ? row.books : [...new Set(total.map(scene => scene.book))], members: row.members };
  }).sort((first, second) => second.totalScenes - first.totalScenes || second.sceneIds.length - first.sceneIds.length);
  for (const place of places) names[place.id] = place.label;
  times.sort((first, second) => String(first.continuityId).localeCompare(String(second.continuityId)) || first.storyIndex - second.storyIndex);
  return {
    scope: 'universe', universe: { id: atlas.universeId, title: atlas.title }, available: times.length > 0, times, scenes, places,
    characters: [...characters.values()].sort((first, second) => second.scenes - first.scenes).slice(0, 60), names,
    books: ordered.map(({ volume, sourceId, title, continuityId, readingOrder }) => ({ volume, sourceId, title, continuityId, readingOrder })),
    continuities, conflicts: atlas.conflicts ?? [],
  };
}

/**
 * The universe projection for the book a reader is viewing: null when the
 * book is not in a reviewed universe with at least two hosted books.
 */
export async function readUniverseTimePlace(directory, bindings, resolveWorkspace, volume) {
  const library = await import('../../dist/src/ground/workspace/library.js');
  const { atlasView, atlasContext } = await import('../../dist/src/solidifier/atlas/universeAtlas.js');
  const view = await library.libraryView(resolve(directory));
  const sourceId = bindings.find(binding => binding.volume === volume)?.sourceId;
  const continuityId = view.organization.assignments.find(entry => entry.sourceId === sourceId && entry.status === 'confirmed')?.continuityId;
  const universeId = view.organization.continuities.find(entry => entry.id === continuityId)?.universeId;
  if (!universeId) return null;
  const inUniverse = new Set(view.organization.continuities.filter(entry => entry.universeId === universeId).map(entry => entry.id));
  const members = view.organization.assignments.filter(entry => entry.status === 'confirmed' && inUniverse.has(entry.continuityId));
  const hosted = [];
  for (const assignment of members) {
    const binding = bindings.find(entry => entry.sourceId === assignment.sourceId);
    if (!binding) continue;
    const workspace = await resolveWorkspace(String(binding.volume));
    const source = view.sources.find(entry => entry.id === assignment.sourceId);
    hosted.push({ volume: binding.volume, sourceId: assignment.sourceId, title: source?.title ?? `Book ${binding.volume}`, continuityId: assignment.continuityId, readingOrder: assignment.readingOrder, workspace });
  }
  if (hosted.length < 2) return null;
  const config = { directory: resolve(directory), bindings: hosted.map(book => ({ sourceId: book.sourceId, workspace: book.workspace, inputSha256: '0'.repeat(64) })) };
  const key = await stamp([resolve(directory, 'atlas'), resolve(directory, 'atlas/state.json'), resolve(directory, 'atlas/packets'), resolve(directory, 'catalog.json'), ...hosted.flatMap(book => ['entities', 'relations', 'scenes'].map(name => resolve(book.workspace, `ontology/${name}.jsonl`)))]);
  const cached = cache.get(`atlas:${directory}:${universeId}`);
  let atlas = cached?.key === key ? cached.value : null;
  if (!atlas) {
    atlas = await atlasView(directory, universeId, config);
    const context = await atlasContext(directory, universeId, config);
    atlas.labels = context.places.map(place => [place.qualified, place.label]);
    cache.set(`atlas:${directory}:${universeId}`, { key, value: atlas });
  }
  const books = await Promise.all(hosted.map(async book => ({ ...book, data: await bookProjection(book.workspace) })));
  const continuities = view.organization.continuities.filter(entry => inUniverse.has(entry.id)).map(({ id, title }) => ({ id, title }));
  const merged = mergeUniverse({ atlas, books, continuities });
  // The universe calendar (one clock): every hosted book's periods placed together, with the reviewed year decisions.
  const decisions = await storedYearDecisions(directory, universeId);
  merged.calendar = await calendarView({ universeId, decisions, books: merged.books.map(book => ({ ...book, times: merged.times.filter(time => time.book === book.volume) })) }).catch(() => null);
  return merged;
}
