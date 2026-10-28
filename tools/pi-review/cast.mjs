import { readFile } from 'node:fs/promises';

/**
 * The Characters view's input: one volume's records, trimmed to what the cast
 * web reads (apps/playground/src/data/castBundle.ts, `VolumeBundle`). Names,
 * casts, event summaries and actors, dialogue-card members, the relationship
 * part of state changes and CAUSES links. Evidence quotes and source text stay
 * in the workspace, and so do sentence ids: each event arrives with its scene.
 * Portraits come from the album projection, not from here.
 */
async function rows(path) {
  try { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function castProjection(directory, { entities, scenes, events, relations, volume = 1, label = `Volume ${volume}` }) {
  if (!scenes.length) return null;
  const changes = [...new Map((await rows(`${directory}/ontology/state-changes.jsonl`)).map((change) => [change.id, change])).values()];
  const sceneOfSentence = new Map(scenes.flatMap((scene) => (scene.sentenceIds ?? []).map((sentence) => [sentence, scene.id])));
  return {
    volume, label,
    entities: entities.filter((entity) => entity.kind === 'Character' || entity.kind === 'Location')
      .map((entity) => ({ id: entity.id, kind: entity.kind, names: (entity.names ?? []).map((name) => ({ text: name.text, kind: name.kind })) })),
    scenes: scenes.map((scene) => ({
      id: scene.id, chapterIndex: scene.chapterIndex ?? 0, charactersPresent: scene.charactersPresent ?? [], charactersMentioned: scene.charactersMentioned ?? [],
      locationId: scene.locationId ?? null, summary: scene.summary, dialogues: (scene.dialogues ?? []).map((card) => ({ id: card.id, participantIds: card.participantIds ?? [] })),
    })),
    events: events.map((event) => ({
      id: event.id, chapterIndex: event.chapterIndex ?? 0, summary: String(event.summaryEn ?? '').slice(0, 280), importance: event.importance ?? 0,
      primaryActors: event.primaryActors ?? [], affectedCharacters: event.affectedCharacters ?? [],
      sceneId: (event.evidence?.sentenceIds ?? []).map((sentence) => sceneOfSentence.get(sentence)).find(Boolean) ?? null,
    })),
    stateChanges: changes.filter((change) => change.relationships && Object.keys(change.relationships).length)
      .map((change) => ({ id: change.id, characterId: change.characterId, afterEventId: change.afterEventId, relationships: change.relationships })),
    causes: relations.filter((relation) => relation.type === 'CAUSES').map((relation) => ({ fromId: relation.fromId, toId: relation.toId })),
    portraits: [],
  };
}
