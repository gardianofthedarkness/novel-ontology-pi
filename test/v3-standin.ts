/**
 * Stand-in models for a reading in tests (`novel folder read --stand-in dist/test/v3-standin.js`): Jev answered by the
 * mock decision model (the first option, sure), names listed from the book's own capitalised words by string match.
 * Nothing is asked of a model and nothing is paid.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockDecisionModel } from "../src/ground/connectors/jev.js";

export function options(book: { novel: string; text: string }): Record<string, unknown> {
  const words = [...new Set(book.text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])].filter((word) => !["The", "Chapter", "Not", "Who", "Bring", "There", "You", "Below", "Morning", "Captain"].includes(word));
  const roster = join(book.novel, "standin-roster.json");
  writeFileSync(roster, JSON.stringify({ characters: words.map((name) => ({ names: [name] })) }));
  return { decisions: new MockDecisionModel(), lister: "lexicon", lexicon: roster };
}
