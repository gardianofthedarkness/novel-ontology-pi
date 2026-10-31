import { LANGUAGE } from "./language.js";

/** Typing's code rules (layer 1): what code says of a typed string without asking again. */

/** A place word with a locative after it (街上, 马路上, 店里, 楼下, 门外, 路边), not a proper name, is spatial, not a place. */
export const isLocative = (text: string, isPlace: boolean, proper: number) => isPlace && proper < 0.5 && LANGUAGE.locative.test(text);

/** The type most batches gave the same words; on a tie, a type that is no place (a place needs most of the votes). */
export function usualType(votes: Map<string, number>, isPlace: (type: string) => boolean): string | undefined {
  return [...votes].sort((a, b) => b[1] - a[1] || Number(isPlace(a[0])) - Number(isPlace(b[0])) || a[0].localeCompare(b[0]))[0]?.[0];
}
