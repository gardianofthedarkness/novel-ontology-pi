/**
 * Story-time and place projection for the viewer (time-place faculty,
 * phase 1). Pure: reads applied entities, scenes and relations; no source
 * text is exported (scene labels are stored summaries).
 *
 * - times: TimePoint periods in story order, with flashback marks;
 * - scenes: reading order, the periods each belongs to (anchor or inherited)
 *   and the places it happens in. A scene that names no place carries the
 *   previous scene's place within the same chapter, flagged `carried` so the
 *   map never presents it as stated;
 * - places: named places with the scenes and characters seen there.
 *
 * `pending` are time-place proposals still awaiting review: their new periods
 * and places are included, flagged `proposed`, so the views can show them
 * the moment Pi proposes them (never as canon).
 */
const nameOf = (entity) => entity?.names?.find((form) => form.kind === 'canonical')?.text ?? entity?.names?.[0]?.text ?? entity?.id;
const order = (id) => { const match = /^b(\d+)_s(\d+)$/.exec(id ?? ''); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };
const clip = (value, length) => typeof value === 'string' && value.length > length ? `${value.slice(0, length - 1)}…` : value;

export function timePlaceProjection({ entities: applied, scenes, relations: appliedRelations, events = [], pending = [] }) {
  const known = new Set(applied.map((entity) => entity.id));
  const proposedEntities = pending.filter((proposal) => proposal.kind === 'upsert_entity' && ['TimePoint', 'Location'].includes(proposal.payload?.kind) && !known.has(proposal.payload.id)).map((proposal) => proposal.payload);
  const proposedIds = new Set(proposedEntities.map((entity) => entity.id));
  const entities = [...applied, ...proposedEntities];
  const relations = [...appliedRelations, ...pending.filter((proposal) => proposal.kind === 'add_relation' && ['OCCURS_DURING', 'LOCATED_AT'].includes(proposal.payload?.type)).map((proposal) => proposal.payload)];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const times = entities.filter((entity) => entity.kind === 'TimePoint');
  if (!times.length && !relations.some((relation) => relation.type === 'LOCATED_AT')) return { available: false, times: [], scenes: [], places: [], characters: [], names: {} };
  const ordered = [...scenes].sort((first, second) => order(first.sentenceIds?.[0]) - order(second.sentenceIds?.[0]));
  const during = new Map();
  const located = new Map();
  for (const relation of relations) {
    if (relation.type === 'OCCURS_DURING' && byId.get(relation.toId)?.kind === 'TimePoint') {
      const list = during.get(relation.fromId) ?? [];
      if (!list.some((entry) => entry.id === relation.toId)) list.push({ id: relation.toId, via: relation.properties?.via === 'anchor' ? 'anchor' : 'inherited' });
      during.set(relation.fromId, list);
    }
    if (relation.type === 'LOCATED_AT' && byId.get(relation.toId)?.kind === 'Location') {
      const list = located.get(relation.fromId) ?? new Set();
      list.add(relation.toId);
      located.set(relation.fromId, list);
    }
  }
  // A scene without a stored summary is labelled by its first event's summary.
  const firstEvent = new Map();
  const sceneOf = new Map(ordered.flatMap((scene) => (scene.sentenceIds ?? []).map((id) => [id, scene.id])));
  for (const event of [...events].sort((first, second) => (first.chronologicalOrder ?? 0) - (second.chronologicalOrder ?? 0))) {
    const owner = sceneOf.get(event.evidence?.sentenceIds?.[0]);
    if (owner && !firstEvent.has(owner) && typeof event.summaryEn === 'string' && event.summaryEn.trim()) firstEvent.set(owner, event.summaryEn.trim());
  }
  const sceneRows = [];
  let previous = null;
  for (const [index, scene] of ordered.entries()) {
    const own = new Set(located.get(scene.id) ?? []);
    if (scene.locationId && byId.get(scene.locationId)?.kind === 'Location') own.add(scene.locationId);
    const carried = !own.size && previous && previous.chapterIndex === scene.chapterIndex && previous.placeIds.length;
    const timeIds = (during.get(scene.id) ?? []).sort((first, second) => Number(byId.get(first.id)?.properties?.narrativeIndex ?? 0) - Number(byId.get(second.id)?.properties?.narrativeIndex ?? 0));
    const row = {
      id: scene.id, index, chapterIndex: scene.chapterIndex, label: clip(scene.summary, 90) || clip(firstEvent.get(scene.id), 90) || ((scene.charactersPresent ?? []).filter((id) => byId.get(id)?.kind === 'Character').slice(0, 3).map((id) => nameOf(byId.get(id))).join(' · ') || `Scene ${index + 1}`),
      times: timeIds, flashback: timeIds.some((time) => byId.get(time.id)?.properties?.flashback === true),
      placeIds: own.size ? [...own] : carried ? [...previous.placeIds] : [], placeCarried: !!carried,
      characterIds: (scene.charactersPresent ?? []).filter((id) => byId.get(id)?.kind === 'Character'),
    };
    sceneRows.push(row);
    previous = row;
  }
  const timeRows = times.map((time) => {
    const properties = time.properties ?? {};
    return {
      id: time.id, label: nameOf(time), gloss: properties.gloss ?? '', family: properties.family ?? 'date', role: properties.role ?? 'ADVANCE',
      flashback: properties.flashback === true, flashbackProbability: Number(properties.flashbackProbability ?? 0), decidedBy: properties.decidedBy ?? null,
      toldFromId: properties.toldFromId ?? null, date: properties.date ?? null, partOfDay: properties.partOfDay ?? null,
      chapterIndex: Number(properties.chapterIndex ?? 0), storyIndex: Number(properties.storyIndex ?? 0), narrativeIndex: Number(properties.narrativeIndex ?? 0), proposed: proposedIds.has(time.id),
      anchorSceneId: properties.sceneId ?? null, sceneIds: sceneRows.filter((scene) => scene.times.some((entry) => entry.id === time.id)).map((scene) => scene.id),
    };
  }).sort((first, second) => first.storyIndex - second.storyIndex);
  const placeIds = new Set(sceneRows.flatMap((scene) => scene.placeIds));
  const places = [...placeIds].map((id) => {
    const here = sceneRows.filter((scene) => scene.placeIds.includes(id));
    return { id, label: nameOf(byId.get(id)), sceneIds: here.map((scene) => scene.id), statedScenes: here.filter((scene) => !scene.placeCarried).length, characterIds: [...new Set(here.flatMap((scene) => scene.characterIds))], proposed: proposedIds.has(id) };
  }).sort((first, second) => second.sceneIds.length - first.sceneIds.length);
  const characterCounts = new Map();
  for (const scene of sceneRows) for (const id of scene.characterIds) characterCounts.set(id, (characterCounts.get(id) ?? 0) + 1);
  const characters = [...characterCounts].sort((first, second) => second[1] - first[1]).slice(0, 40).map(([id, scenes]) => ({ id, label: nameOf(byId.get(id)), scenes }));
  const names = Object.fromEntries([...placeIds, ...characterCounts.keys()].map((id) => [id, nameOf(byId.get(id))]));
  return { available: timeRows.length > 0, times: timeRows, scenes: sceneRows, places, characters, names };
}
