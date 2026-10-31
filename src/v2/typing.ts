import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../ground/connectors/jev.js";
import type { Sentence } from "../digger/intake/sectioning.js";
import { sentencesWith } from "./listing.js";

/**
 * What each listed string is (the user's v2 flow, 2026-10-30; System 1): one structured request a batch. The state holds the
 * types defined once, the batch's sentences keyed by id and the strings keyed by a short key with the sentences that hold
 * them; each question names its string by path and chooses a type. Types fall into EM's categories: a person, a crowd (a
 * group of people who are there: never a name, EM² places it), a thing (a named object, a weapon, a vehicle), a place
 * by its scale (region, city, district, street, building, room: the user's call, 2026-10-31, scale is EM's, read where
 * the name stands, so no stage step asks it again), a concept (an ability, a network, a plan: someone's, EM asks whose),
 * and a time (EM for times is the calendar's). An everyday thing (a phone, a bag, a cleaning robot at its work) is
 * routine: no category, never an entity (the user's rule, 2026-10-30: only important named things, vehicles and
 * weapons). A spatial word (on the ground, underground, on the roof, in the corridor) is no place at all but where
 * someone or something is: no category, kept as evidence of who is where (src/v2/spatial.ts).
 */
export const ENTITY_TYPES = {
  person: "a person, or a being who acts like one: by name, surname, nickname, title or a description used for them",
  crowd: "a crowd or a group of people who are there and act together: officers, a crowd, the students, a gang (an organisation as such is none)",
  object: "an important thing the story names or singles out: a named device, artifact, book or machine (天空之眼)",
  routine: "an everyday thing: a phone, a bag, food, clothes, furniture (a bed, a cradle), a door, a wall or a pillar (a part of a building), a tree or a plant, a machine at its routine work (a cleaning robot)",
  weapon: "a weapon",
  vehicle: "a vehicle or a mech: something people ride, drive or move in (a car, a train, a ship, an aircraft carrier)",
  region: "a region: a country, a state or a province, a wide natural area (a forest, a desert, an ocean), bigger than a city",
  city: "a city or a town",
  district: "a part of a city: a ward, a school district, a downtown, a neighbourhood",
  street: "an open place in a district: a street, a road, an alley, a square, a park, a bridge, a river bank, a crossing (but 街上, on the street, is spatial)",
  building: "a building or a structure: a school, a dormitory, a shop, a station, a tower",
  room: "a room inside a building: a classroom, an office, a ward, a hall, a karaoke box",
  spatial: "no place of its own but where someone or something is, against what is around: on the ground (the asphalt, the earth), underground, on the street or the road (街上, 马路上), on a roof, in a corridor, at an exit, on the stairs, on a wall, in the air, beside or under something",
  concept: "a concept the story names: an ability, a power, a technique or a spell, a network or a system, a project or a plan (幻想杀手, 御坂网络); something someone has, uses or runs, not a thing in the hand",
  time: "a time: a date, a day, an hour, a part of the day, a season",
  none: "none of these: an organisation as such, an ordinary word",
} as const;
/** "place": an open place of an earlier reading, before EM said its scale. */
export type EntityType = keyof typeof ENTITY_TYPES | "place";
export type Category = "person" | "crowd" | "thing" | "place" | "concept" | "time";
export const CATEGORY_OF: Record<EntityType, Category | null> = { person: "person", crowd: "crowd", object: "thing", routine: null, weapon: "thing", vehicle: "thing", region: "place", city: "place", district: "place", street: "place", place: "place", building: "place", room: "place", spatial: null, concept: "concept", time: "time", none: null };
/** The scale of places, smallest first (a place's scale is its type); a parent is larger than what it holds. */
export const PLACE_SCALES = ["room", "building", "street", "district", "city", "region"] as const;
const TYPE_LABELS: Record<keyof typeof ENTITY_TYPES, string> = {
  person: "a person", crowd: "a crowd or a group of people", object: "an important named thing", routine: "an everyday thing", weapon: "a weapon", vehicle: "a vehicle or a mech",
  region: "a region, bigger than a city", city: "a city or a town", district: "a part of a city", street: "a street or an open place in a district", building: "a building", room: "a room inside a building",
  spatial: "where someone is (on the ground, underground, on a roof): no place", concept: "an ability, a network or a plan (a concept)", time: "a time", none: "none of these",
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

/**
 * A place word with a locative after it (街上, 马路上, 店里, 楼下, 门外, 路边): where someone is against that place, so spatial,
 * not a place (rule zero: code says it exactly). Only for a word that is not a proper name.
 */
const LOCATIVE = /^.+[上下里中内外边旁]$/;
export const locative = (text: string, type: string, proper: number) => CATEGORY_OF[type as EntityType] === "place" && proper < 0.5 && LOCATIVE.test(text);

export async function typeNames(decide: Decide, batch: Sentence[], names: string[]): Promise<Detected[]> {
  if (!names.length) return [];
  const answers = await decide(typingDocument(batch, names), names.flatMap((_, index) => [
    { key: `type:n${index + 1}`, primitive: "choice" as const, instructions: `What is names.n${index + 1}?`, options: Object.keys(ENTITY_TYPES), optionHints: { ...TYPE_LABELS } },
    { key: `proper:n${index + 1}`, primitive: "noul" as const, instructions: `Is names.n${index + 1} a proper name?`, noulCriteria: PROPER },
  ]));
  return names.map((text, index) => {
    const answer = answers.find((entry) => entry.key === `type:n${index + 1}`);
    const proper = Number(answers.find((entry) => entry.key === `proper:n${index + 1}`)?.value ?? 0);
    const typed = (answer?.value && String(answer.value) in ENTITY_TYPES ? String(answer.value) : "none") as EntityType, type: EntityType = locative(text, typed, proper) ? "spatial" : typed;
    return { key: nameKey(index), text, type, category: CATEGORY_OF[type], confidence: Number(answer?.distribution?.[type] ?? answer?.confidence ?? 0), proper, sentences: sentencesWith(batch, text) };
  });
}
