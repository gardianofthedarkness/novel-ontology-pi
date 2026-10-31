import type { FlowResult } from "./flow.js";
import { LANGUAGE, type Level } from "./rules/language.js";

/**
 * Spatial words (the user's call, 2026-10-31): 地面, 地下, 街上, 屋顶, 走廊 are no places of their own but where someone or
 * something is, against what is around. Typing says which words are spatial and EM keeps them (outcome "spatial", with
 * the sentences that hold them), never as entities or slots. Each is tied here, with no model call, to who or what acts or
 * speaks in its line (EM²'s role for the line), else to whom its card has acting or speaking there; and given the level
 * of the world it points at, in the engine's own terms (its height slices: underground, the street, inside a building,
 * the roofs, the sky). The world engine's context gives them to Jev at run time with the sentence, for births, moves and
 * terrain's heights; a line with several actors is Jev's to read.
 */
export type { Level };
export interface SpatialMention { text: string; sentence: string; scene: string | null; level: Level | null; who: string[] }
/** The level of the world a spatial word points at (the language's words: rules/language.ts). */
export const levelOf = (text: string): Level | null => LANGUAGE.levels.find(([pattern]) => pattern.test(text))?.[1] ?? null;

export function spatialMentions(result: Pick<FlowResult, "em" | "cards" | "roles" | "scenes">): SpatialMention[] {
  const sceneOf = new Map(result.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id] as const)));
  // A sentence's card: the smallest that holds it (an action inside an exchange is its own card).
  const cardOf = new Map<string, FlowResult["cards"][number]>();
  for (const card of result.cards) for (const id of card.sentences) if (!cardOf.has(id) || cardOf.get(id)!.sentences.length > card.sentences.length) cardOf.set(id, card);
  const mentions: SpatialMention[] = [], seen = new Set<string>();
  for (const entry of result.em.flatMap((batch) => batch.results)) {
    if (entry.outcome !== "spatial") continue;
    for (const sentence of entry.sentences ?? []) {
      if (seen.has(`${entry.text}|${sentence}`)) continue;
      seen.add(`${entry.text}|${sentence}`);
      const role = result.roles[sentence], card = cardOf.get(sentence);
      const who = role?.who?.id ? [role.who.id] : (card?.people ?? []).filter((person) => person.at.includes(sentence) && person.how.some((how) => how === "acts" || how === "speaks")).map((person) => person.id);
      mentions.push({ text: entry.text, sentence, scene: sceneOf.get(sentence) ?? null, level: levelOf(entry.text), who: [...new Set(who)] });
    }
  }
  return mentions;
}
