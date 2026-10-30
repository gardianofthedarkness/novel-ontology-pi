import type { FlowResult } from "./flow.js";

/**
 * The v2 reading as a world-first workspace's canon (ontology/*.jsonl, the records every stage step and the engine read), so
 * the world engine runs on it as it is. From the flow, with no model calls:
 * - scenes: the tiles, each with the people its cards name (mentioned, not present: presence is the world loop's) and its
 *   exchange and monologue cards as dialogue cards (their people: the ones the card names);
 * - entities: the chart's people, places and things (Character, Location, Item), proper names first, descriptions kept apart;
 * - events: the action cards, in reading order, each with the people it names as its actors (PARTICIPATES_IN).
 * Times are not canon yet (EM for times is the calendar's).
 */
const KIND = { person: "Character", place: "Location", thing: "Item" } as const;
const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

/** The action cards as events, numbered in reading order (the world loop's base layer uses the same ids). */
export function actionEvents(result: FlowResult): { id: string; card: FlowResult["cards"][number] }[] {
  return result.cards.filter((card) => card.kind === "action").map((card, index) => ({ id: `evt_${String(index + 1).padStart(6, "0")}`, card }));
}

export function canonRecords(result: FlowResult, text: (sentence: string) => string) {
  const isPerson = (id: string) => result.chart.entities.get(id)?.category === "person";
  const sceneOf = new Map(result.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene] as const)));
  const people = (card: FlowResult["cards"][number]) => card.entities.map((hit) => hit.id).filter(isPerson);
  const cardsOf = new Map<string, FlowResult["cards"]>();
  for (const card of result.cards) { const scene = sceneOf.get(card.first); if (scene) cardsOf.set(scene.id, [...(cardsOf.get(scene.id) ?? []), card]); }
  const scenes = result.scenes.map((scene) => {
    const cards = cardsOf.get(scene.id) ?? [];
    return {
      id: scene.id, chapterIndex: scene.chapter, sentenceIds: scene.sentences, charactersPresent: [], turns: [], locationId: null,
      charactersMentioned: [...new Set(cards.flatMap(people))],
      dialogues: cards.filter((card) => card.kind === "dialogue" || card.kind === "monologue").map((card) => ({ id: card.id, sentenceIds: card.sentences, participantIds: people(card), ...(card.kind === "monologue" ? { kind: "monologue" as const } : {}) })),
    };
  });
  const entities = [...result.chart.entities.values()].map((entity) => {
    const names = [...entity.proper, ...entity.names.filter((name) => !entity.proper.includes(name))];
    return {
      id: entity.id, kind: KIND[entity.category as keyof typeof KIND], confidence: 0.7,
      names: names.map((name, index) => ({ text: name, lang: "zh", kind: index === 0 ? "canonical" : "alias" })),
      properties: { v2Type: entity.type, firstSentenceId: entity.first, descriptions: entity.names.filter((name) => !entity.proper.includes(name)) },
    };
  });
  const events = actionEvents(result).map(({ id, card }, index) => {
    const body = card.sentences.map(text).join("");
    return { id, timelineId: "tl_canon", chapterIndex: sceneOf.get(card.first)?.chapter ?? 0, chronologicalOrder: index + 1, eventType: "other", summaryEn: clip(body, 140), evidence: { text: body, sentenceIds: card.sentences }, importance: 0.5, primaryActors: people(card), affectedCharacters: [], confidence: 0.7 };
  });
  const relations = events.flatMap((event) => event.primaryActors.map((actor) => ({ fromId: actor, toId: event.id, type: "PARTICIPATES_IN", properties: {}, confidence: 0.7 })));
  return { scenes, entities, events, relations };
}
