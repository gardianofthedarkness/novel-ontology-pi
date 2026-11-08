import { LANGUAGE } from "./language.js";

/** Typing's code rules (layer 1): what code says of a typed string without asking again. */

/** A place word with a locative after it (街上, 马路上, 店里, 楼下, 门外, 路边), not a proper name, is spatial, not a place. */
export const isLocative = (text: string, isPlace: boolean, proper: number) => isPlace && proper < 0.5 && LANGUAGE.locative.test(text);

/** A part of a building (高墙, 大厦墙壁, 混凝土支柱) or a floor as a whole word (最上层, 第四十四层), not a proper name, is spatial, not a place. */
export const isPartOrFloor = (text: string, isPlace: boolean, proper: number) => isPlace && proper < 0.5 && (LANGUAGE.part.test(text) || LANGUAGE.floor.test(text));

/** The type most batches gave the same words; on a tie, a type that is no place (a place needs most of the votes). */
export function usualType(votes: Map<string, number>, isPlace: (type: string) => boolean): string | undefined {
  return [...votes].sort((a, b) => b[1] - a[1] || Number(isPlace(a[0])) - Number(isPlace(b[0])) || a[0].localeCompare(b[0]))[0]?.[0];
}

/**
 * A named entity's category, settled once EM is done: the one most of its typings gave it (魔法侧, a region in one batch and
 * a concept in another, is no place). Null when the usual type has no category of an entity.
 */
export function settledCategory<C extends string>(votes: Map<string, number>, categoryOf: (type: string) => C | null): { type: string; category: C } | null {
  const type = usualType(votes, (entry) => categoryOf(entry) === "place"), category = type ? categoryOf(type) : null;
  return type && category ? { type, category } : null;
}
