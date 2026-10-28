import type { WebCard, WebCharacter, WebData, WebDelta, WebEvent, WebScene } from "./web.js";

/**
 * What the character host sends for one extracted volume: the bundle's own
 * records, trimmed to what the web reads (no evidence quotes, no source text).
 */
export interface VolumeBundle {
  volume: number;
  label: string;
  entities: { id: string; kind: string; names: { text: string; kind: string }[] }[];
  scenes: { id: string; chapterIndex: number; charactersPresent: string[]; charactersMentioned: string[]; locationId: string | null; summary?: string; dialogues?: { id: string; participantIds: string[]; summary?: string }[] }[];
  events: { id: string; chapterIndex: number; summary: string; importance: number; primaryActors: string[]; affectedCharacters: string[]; sentenceIds: string[] }[];
  /** Which scene holds each sentence, so events (cited by sentence) land in their scene. */
  sceneOfSentence: Record<string, string>;
  stateChanges: { id: string; characterId: string; afterEventId: string; relationships: Record<string, number> }[];
  causes: { fromId: string; toId: string }[];
  portraits: { entityId: string }[];
}

export type Joining = "volume" | "series-by-name";

/** Scene titles: the summary's first clause (else its main event's), short enough for a log line. */
const titleOf = (summary: string | undefined, fallback: string) => {
  const clause = (summary ?? "").split(/[。！？；.!?;\n]/)[0].trim();
  return clause ? (clause.length > 28 ? `${clause.slice(0, 27)}…` : clause) : fallback;
};

/**
 * Bundles → the web's input. Ids are namespaced by volume (each workspace
 * numbers its own `char_000001`). "series-by-name" joins characters across
 * volumes when they share a recorded name form: a provisional join for the
 * view, not reviewed identity. A scene's cast is its recorded cast plus
 * whoever acts in or is affected by its events.
 */
export function fromBundles(bundles: VolumeBundle[], joining: Joining = "volume", portraitUrl?: (volume: number, entityId: string) => string): WebData {
  const local = (volume: number, id: string) => `v${volume}:${id}`;
  const characters = new Map<string, WebCharacter>();
  const alias = new Map<string, string>();
  const byForm = new Map<string, string>();
  for (const bundle of [...bundles].sort((x, y) => x.volume - y.volume)) {
    const portraits = new Set(bundle.portraits.map((portrait) => portrait.entityId));
    for (const entity of bundle.entities) {
      if (entity.kind !== "Character") continue;
      const forms = [...new Set(entity.names.map((name) => name.text))];
      const canonical = entity.names.find((name) => name.kind === "canonical")?.text ?? forms[0] ?? entity.id;
      const joined = joining === "series-by-name" ? forms.map((form) => byForm.get(form)).find(Boolean) : undefined;
      const id = joined ?? local(bundle.volume, entity.id);
      alias.set(local(bundle.volume, entity.id), id);
      const existing = characters.get(id);
      const portrait = portraits.has(entity.id) && portraitUrl ? portraitUrl(bundle.volume, entity.id) : undefined;
      characters.set(id, existing
        ? { ...existing, names: [...new Set([...existing.names, ...forms])], volumes: [...new Set([...existing.volumes, bundle.volume])], ...(existing.portrait || !portrait ? {} : { portrait }) }
        : { id, name: canonical, names: forms, volumes: [bundle.volume], ...(portrait ? { portrait } : {}) });
      for (const form of forms) if (!byForm.has(form)) byForm.set(form, id);
    }
  }
  const scenes: WebScene[] = [], events: WebEvent[] = [], cards: WebCard[] = [], deltas: WebDelta[] = [];
  let reading = 0;
  for (const bundle of [...bundles].sort((x, y) => x.volume - y.volume)) {
    const who = (id: string) => alias.get(local(bundle.volume, id));
    const ids = (list: string[]) => [...new Set(list.map(who).filter((id): id is string => !!id))];
    const place = new Map(bundle.entities.map((entity) => [entity.id, entity.names[0]?.text ?? ""]));
    const sceneEvents = new Map<string, VolumeBundle["events"]>();
    for (const event of bundle.events) {
      const sceneId = event.sentenceIds.map((sentence) => bundle.sceneOfSentence[sentence]).find(Boolean);
      if (sceneId) sceneEvents.set(sceneId, [...sceneEvents.get(sceneId) ?? [], event]);
    }
    for (const scene of bundle.scenes) {
      reading++;
      const id = local(bundle.volume, scene.id);
      const own = sceneEvents.get(scene.id) ?? [];
      const present = ids([...scene.charactersPresent, ...own.flatMap((event) => [...event.primaryActors, ...event.affectedCharacters])]);
      scenes.push({ id, book: bundle.volume, chapter: scene.chapterIndex, reading, story: reading, place: scene.locationId ? place.get(scene.locationId) ?? "" : "", title: titleOf(scene.summary || [...own].sort((x, y) => y.importance - x.importance)[0]?.summary, `Scene ${reading}`), present, mentioned: ids(scene.charactersMentioned).filter((character) => !present.includes(character)) });
      for (const event of own) events.push({ id: local(bundle.volume, event.id), sceneId: id, summary: event.summary, importance: event.importance, actors: ids(event.primaryActors), affected: ids(event.affectedCharacters) });
      for (const card of scene.dialogues ?? []) {
        const participants = ids(card.participantIds);
        // Fragments of one exchange share its card id across scene cuts: keep each fragment.
        if (participants.length > 1) cards.push({ id: `${id}:${card.id}`, sceneId: id, participants, summary: card.summary ?? "" });
      }
    }
    for (const change of bundle.stateChanges) {
      const from = who(change.characterId);
      for (const [toward, delta] of Object.entries(change.relationships)) {
        const to = who(toward);
        if (from && to && from !== to && Number.isFinite(delta)) deltas.push({ id: `${local(bundle.volume, change.id)}:${toward}`, characterId: from, towardId: to, afterEventId: local(bundle.volume, change.afterEventId), delta });
      }
    }
  }
  const causes = bundles.flatMap((bundle) => bundle.causes.map((cause) => ({ from: local(bundle.volume, cause.fromId), to: local(bundle.volume, cause.toId) })));
  return {
    title: bundles.length === 1 ? bundles[0].label : `${bundles.length} volumes`,
    books: bundles.map((bundle) => ({ index: bundle.volume, title: bundle.label })),
    characters: [...characters.values()], scenes, events, cards, deltas, causes,
  };
}
