import type { WorkModel } from "../ground/connectors/llm.js";
import type { Sentence } from "../digger/intake/sectioning.js";
import { detectTimeMentions } from "../digger/timeplace/lexicon.js";

/**
 * Entity listing (the user's v2 flow, 2026-10-30; System 2): a batch of sentences goes to the work model, not an agent: fixed
 * instructions and a structured output, a list of strings. Each string is an important name as the passage writes it: a
 * person, an object, a weapon or a vehicle, a place, a building or a room, or a time. What each one is, is Jev's (typing.ts);
 * who or what it is, EM's (em.ts). A string the passage does not hold, word for word, is dropped: from here on everything
 * finds it by string match.
 */
export const LISTING_SYSTEM = [
  "You list the important names in a passage of a novel. Reply with JSON: {\"names\": [\"...\", ...]}.",
  "List every string, exactly as the passage writes it, that names or refers to:",
  "- a person: a name, a surname, a nickname, or a title or description used for one person (e.g. \"the boy with spiky hair\");",
  "- an object, a weapon or a vehicle (also a mech) that matters to what happens;",
  "- a place, a building or a room;",
  "- a time: a date, a day, an hour, a part of the day, \"the next morning\".",
  "Each string once, in the passage's own words and language, as short as still names it. No pronouns, no explanations.",
].join("\n");

export const LISTING_SCHEMA = { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] };

export type Lister = (batch: Sentence[]) => Promise<string[]>;

/** The work model as the lister: one call a batch. */
export function modelLister(model: WorkModel): Lister {
  return async (batch) => {
    const reply = await model.generate({ system: LISTING_SYSTEM, prompt: batch.map((sentence) => `${sentence.id}: ${sentence.text}`).join("\n"), jsonSchema: LISTING_SCHEMA, maxTokens: 1200 });
    let names: unknown;
    try { names = (JSON.parse(reply) as { names?: unknown }).names; } catch { names = []; }
    return keep(batch, Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []);
  };
}

/**
 * System 0's stand-in for the lister, for runs without the work model: the forms of a known list found in the batch (string
 * match), and the times the time lexicon finds. It never finds a name the list does not have.
 */
export function lexiconLister(forms: string[]): Lister {
  const sorted = [...new Set(forms.map((form) => form.trim()).filter((form) => form.length >= 2))].sort((a, b) => b.length - a.length);
  return async (batch) => {
    const text = batch.map((sentence) => sentence.text).join("\n");
    return keep(batch, [...sorted.filter((form) => text.includes(form)), ...detectTimeMentions(batch).map((mention) => mention.text)]);
  };
}

/** Pronouns and words that never name one thing: dropped even when the model lists them. */
const NEVER = new Set(["他", "她", "它", "他们", "她们", "它们", "我", "你", "您", "我们", "你们", "咱们", "自己", "大家", "别人", "人家", "对方", "这个", "那个", "这里", "那里", "这边", "那边", "现在", "这时", "那时", "某人", "谁"]);

/** The strings the batch holds word for word, each once, trimmed; at least two characters, no pronouns. */
function keep(batch: Sentence[], names: string[]): string[] {
  const text = batch.map((sentence) => sentence.text).join("\n");
  return [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2 && name.length <= 40 && !NEVER.has(name) && text.includes(name)))];
}

/** The batch's sentences that hold a string (string match), in order. */
export function sentencesWith(batch: Sentence[], text: string): string[] {
  return batch.filter((sentence) => sentence.text.includes(text)).map((sentence) => sentence.id);
}
