import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../ground/connectors/jev.js";
import type { Sentence } from "../digger/intake/sectioning.js";
import { sentencesWith } from "./listing.js";

/**
 * What each listed string is (the user's v2 flow, 2026-10-30; System 1): one structured request a batch. The state holds the
 * types defined once, the batch's sentences keyed by id and the strings keyed by a short key with the sentences that hold
 * them; each question names its string by path and chooses a type. Types fall into EM's categories: a person, a crowd (a
 * group of people who are there: never a name, EM² places it), a thing (a named object, a weapon, a vehicle), a place
 * (place, building, room), and a time (EM for times is the calendar's). An everyday thing (a phone, a bag, a cleaning robot
 * at its work) is routine: no category, never an entity (the user's rule, 2026-10-30: only important named things,
 * vehicles and weapons).
 */
export const ENTITY_TYPES = {
  person: "a person, or a being who acts like one: by name, surname, nickname, title or a description used for them",
  crowd: "a crowd or a group of people who are there and act together: officers, a crowd, the students, a gang (an organisation as such is none)",
  object: "an important thing the story names or singles out: a named device, artifact, book or machine (天空之眼)",
  routine: "an everyday thing: a phone, a bag, food, clothes, furniture, a door or a wall, a machine at its routine work (a cleaning robot)",
  weapon: "a weapon",
  vehicle: "a vehicle or a mech: something people ride, drive or move in",
  place: "a place in the open: a city, a district, a street, a park, a bridge, a region",
  building: "a building or a structure: a school, a dormitory, a shop, a station, a tower",
  room: "a room or a part inside a building: a classroom, a corridor, a roof, a hall",
  time: "a time: a date, a day, an hour, a part of the day, a season",
  none: "none of these: an organisation as such, a power or an ability, a concept, an ordinary word",
} as const;
export type EntityType = keyof typeof ENTITY_TYPES;
export type Category = "person" | "crowd" | "thing" | "place" | "time";
export const CATEGORY_OF: Record<EntityType, Category | null> = { person: "person", crowd: "crowd", object: "thing", routine: null, weapon: "thing", vehicle: "thing", place: "place", building: "place", room: "place", time: "time", none: null };
const TYPE_LABELS: Record<EntityType, string> = {
  person: "a person", crowd: "a crowd or a group of people", object: "an important named thing", routine: "an everyday thing", weapon: "a weapon", vehicle: "a vehicle or a mech",
  place: "a place in the open", building: "a building", room: "a room or a part of a building", time: "a time", none: "none of these",
};

/**
 * Whether a string is a proper name. Only a proper name is an alias anywhere in the book (EM's exact match, the card scan); a
 * description or a common word (少女, 那个刺猬头, 屋顶, 车站) is who or what EM said only where it said it.
 */
const PROPER = {
  true: "a name of its own for one person, thing or place (御坂美琴, 上条, 常盘台中学, 第七学区)",
  false: "a description or a common word that could mean someone or something else elsewhere (少女, 那个刺猬头, 老师, 屋顶, 车站, 手机)",
};

export interface Detected { key: string; text: string; type: EntityType; category: Category | null; confidence: number; proper: number; sentences: string[] }

/** A listed string's key in its batch's documents (n1, n2, …). */
const nameKey = (index: number) => "n" + (index + 1);

export type Decide = (state: DecisionState, questions: DecisionQuestion[]) => Promise<DecisionAnswer[]>;

/** The structured document a batch's typing questions are about. */
export function typingDocument(batch: Sentence[], names: string[]) {
  return {
    task: "Strings from a passage of a novel, each with the sentences that hold it. Say what each one is (the types are defined in types).",
    types: { ...ENTITY_TYPES },
    passage: Object.fromEntries(batch.map((sentence) => [sentence.id, sentence.text])),
    names: Object.fromEntries(names.map((text, index) => [nameKey(index), { text, in: sentencesWith(batch, text) }])),
  };
}

export async function typeNames(decide: Decide, batch: Sentence[], names: string[]): Promise<Detected[]> {
  if (!names.length) return [];
  const answers = await decide(typingDocument(batch, names), names.flatMap((_, index) => [
    { key: `type:n${index + 1}`, primitive: "choice" as const, instructions: `What is names.n${index + 1}?`, options: Object.keys(ENTITY_TYPES), optionHints: { ...TYPE_LABELS } },
    { key: `proper:n${index + 1}`, primitive: "noul" as const, instructions: `Is names.n${index + 1} a proper name?`, noulCriteria: PROPER },
  ]));
  return names.map((text, index) => {
    const answer = answers.find((entry) => entry.key === `type:n${index + 1}`);
    const type = (answer?.value && String(answer.value) in ENTITY_TYPES ? String(answer.value) : "none") as EntityType;
    const proper = Number(answers.find((entry) => entry.key === `proper:n${index + 1}`)?.value ?? 0);
    return { key: nameKey(index), text, type, category: CATEGORY_OF[type], confidence: Number(answer?.distribution?.[type] ?? answer?.confidence ?? 0), proper, sentences: sentencesWith(batch, text) };
  });
}
