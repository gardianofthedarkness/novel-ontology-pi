import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cutBlocks } from "../digger/intake/blocks.js";
import { sectionBlock } from "../digger/intake/sectioning.js";
import { storedSource } from "../ground/workspace/source.js";
import { actionEvents, cardPeople } from "./canon.js";
import type { FlowBlock, FlowResult } from "./flow.js";

/** A workspace's book as the flow reads it: its blocks (chapter by chapter) and their sentences, ids as at ingest. */
export async function loadBlocks(novelDir: string): Promise<FlowBlock[]> {
  const bound = await storedSource(novelDir);
  const files = bound ? [bound.file] : (await readdir(join(novelDir, "source"))).filter((name) => !name.startsWith("."));
  if (files.length !== 1) throw new Error("The flow needs one stored source.");
  const text = await readFile(join(novelDir, "source", files[0]), "utf8");
  return (bound ? cutBlocks(text, bound.blockSize) : cutBlocks(text)).map((block) => ({ id: block.id, chapter: block.chapterIndex, sentences: sectionBlock(block.text, block.index).sentences }));
}

/** An entity's names, its proper names first (the first is its label). */
const namesOf = (entity: { names: string[]; proper: string[] }) => [...entity.proper, ...entity.names.filter((name) => !entity.proper.includes(name))];
const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

/**
 * The world loop's base layer (experiments/world-first/base.mjs's shape) from the flow, so the world engine runs on it as
 * it is: a scene's events are its action cards (who takes part: who acts, then who the card names or describes), its
 * dialogues the exchange cards (who speaks, who is spoken to), its monologues the monologue cards, its facts the fact cards;
 * new beside them, its environment cards and its composed context (`v2`: the people the recommender expects, the scene
 * before's cards of each world kind), and when it takes place (its story periods and a caption from the calendar). Unnamed people and crowds (EM²'s slots) ride along as `extras`, the things and places
 * that act as `things` (with the scene's unnamed vehicles and weapons), and an action that goes back in time is marked. The
 * roster is the chart: people as characters, places as places, things apart (named things, vehicles and weapons, and the
 * unnamed vehicles and weapons of a scene), concepts with their owners, and the unnamed people and crowds as extras.
 */
export function worldBase(result: FlowResult, text: (sentence: string) => string) {
  const cardText = (card: { sentences: string[] }) => card.sentences.map(text).join("");
  const sceneOf = new Map(result.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id])));
  const bySceneCards = new Map<string, FlowResult["cards"]>();
  for (const card of result.cards) { const scene = sceneOf.get(card.first); if (scene) bySceneCards.set(scene, [...(bySceneCards.get(scene) ?? []), card]); }
  const people = (card: FlowResult["cards"][number]) => cardPeople(result, card).people, extras = (card: FlowResult["cards"][number]) => cardPeople(result, card).extras;
  const backInTime = (card: FlowResult["cards"][number]) => card.sentences.some((id) => result.roles[id]?.who.answer === "time");
  const contextOf = new Map(result.contexts.map((context) => [context.scene, context]));
  const timeOf = new Map((result.time?.scenes ?? []).map((entry) => [entry.scene, entry]));
  const eventId = new Map(actionEvents(result).map(({ id, card }) => [card.id, id]));
  const facts = result.cards.filter((card) => card.kind === "fact").map((card) => ({ scene: sceneOf.get(card.first) ?? null, first: card.first, text: cardText(card) })).filter((fact) => fact.scene);
  const scenes = result.scenes.map((scene) => {
    const cards = bySceneCards.get(scene.id) ?? [], of = (kind: string) => cards.filter((card) => card.kind === kind);
    const context = contextOf.get(scene.id);
    const body = scene.sentences.map(text).join("");
    return {
      id: scene.id, index: scene.index, chapter: scene.chapter, summary: clip(body.replace(/\s+/g, " "), 120), text: body,
      events: of("action").map((card) => ({ id: eventId.get(card.id) ?? card.id, first: card.first, summary: clip(cardText(card), 140), evidence: cardText(card), actors: people(card), extras: extras(card), things: cardPeople(result, card).things, ...(backInTime(card) ? { backInTime: true } : {}) })),
      dialogues: of("dialogue").map((card) => ({ id: card.id, first: card.first, text: cardText(card), people: people(card), extras: extras(card) })),
      monologues: of("monologue").map((card) => ({ id: card.id, first: card.first, text: cardText(card), people: people(card) })),
      facts: of("fact").map((card) => ({ first: card.first, text: cardText(card) })),
      environment: of("environment").map((card) => ({ id: card.id, first: card.first, text: cardText(card) })),
      time: (() => { const when = timeOf.get(scene.id); return when ? { when: when.when, periods: when.periods, flashback: when.flashback } : { when: "time not stated", periods: [], flashback: false }; })(),
      v2: { recommended: context?.recommended ?? [], before: Object.fromEntries(Object.entries(context?.before ?? {}).map(([kind, ids]) => [kind, (ids ?? []).map((id) => { const card = result.cards.find((entry) => entry.id === id); return card ? clip(cardText(card), 160) : ""; })])) },
    };
  });
  const entities = [...result.chart.entities.values()];
  const roster = {
    characters: entities.filter((entity) => entity.category === "person").map((entity) => ({ id: entity.id, names: namesOf(entity) })),
    places: entities.filter((entity) => entity.category === "place").map((entity) => ({ id: entity.id, names: namesOf(entity), type: entity.type, scale: result.places?.places.find((entry) => entry.id === entity.id)?.scale ?? null, parent: result.places?.places.find((entry) => entry.id === entity.id)?.parent ?? null })),
    things: [
      ...entities.filter((entity) => entity.category === "thing").map((entity) => ({ id: entity.id, names: namesOf(entity), type: entity.type as string })),
      ...result.slots.filter((slot) => slot.kind === "vehicle" || slot.kind === "weapon").map((slot) => ({ id: slot.id, names: slot.names, type: slot.kind as string, scene: slot.scene })),
    ],
    concepts: entities.filter((entity) => entity.category === "concept").map((entity) => ({ id: entity.id, names: namesOf(entity), owners: entity.owners ?? [] })),
    extras: result.slots.filter((slot) => slot.kind === "person" || slot.kind === "crowd").map((slot) => ({ id: slot.id, kind: slot.kind, scene: slot.scene, names: slot.names })),
  };
  return { scenes, roster, facts, periods: result.time?.periods ?? [], states: [] as unknown[] };
}
