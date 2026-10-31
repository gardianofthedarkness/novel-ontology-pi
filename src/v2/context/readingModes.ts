import type { DecisionQuestion } from "../../ground/connectors/jev.js";
import { SENTENCE_CHANGE, SENTENCE_KINDS, tilingDocument, type TilingRequest } from "../../digger/autostep/segmentation.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import { continuationDocument } from "../../digger/timeplace/roles.js";
import type { Chart } from "../em.js";
import { sentencesWith } from "../listing.js";
import type { Role, Slot } from "../roles.js";
import { ROLES } from "../time.js";
import { ENTITY_TYPES, type Detected } from "../typing.js";
import type { Item, Mode, Source } from "./engine.js";

/**
 * The context engine's reading modes (docs/v2/context-engine.md; layer 3 of docs/v2/world-model.md): the documents of the
 * reading's Jev requests — scene tiling, sentence kinds, typing, EM and whose a concept is, story time and a flashback's
 * continuation, and EM² — composed by the engine, as place EM's (placeModes.ts) and terrain's (terrainModes.ts) are (the user's call,
 * 2026-10-31: the engine serves every Jev request). What each request offers (EM's candidates, EM²'s cast, the facts) is
 * the step's recommender's, and comes in the focus; the questions and how their answers are read are the step's (layer 4)
 * and come in the focus too. The engine writes the document from them, in the order the steps wrote it, so the answer cache
 * keeps every answer; it records every request's manifest.
 */
const BUDGET = 120_000;
const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
/** A source that is the focus itself: never cut, in its own order. */
function given<F, S>(name: string, collect: (focus: F, stores: S) => [string, unknown][], always = false): Source<F, S> {
  return { name, key: name, quota: 0, keep: true, always, collect: (focus, stores) => collect(focus, stores).map(([id, fields]): Item => ({ id, score: 1, fields })) };
}
const sentences = (list: { id: string; text: string }[]): [string, unknown][] => list.map((sentence) => [sentence.id, sentence.text]);
interface Asked { questions: DecisionQuestion[] }

/** Scene tiling (the digger's prompts of plain text): a window of sentences, or a seam between two batches. */
type Window = Extract<TilingRequest, { kind: "window" }>;
type Seam = Extract<TilingRequest, { kind: "seam" }>;
const lines = (state: Record<string, unknown>, key: string) => Object.entries((state[key] ?? {}) as Record<string, string>).map(([id, text]) => ({ id, text }));
export const tilingWindowMode: Mode<Window, null> = {
  name: "tiling-window",
  task: (focus) => focus.summary,
  sources: [given("context", (focus: Window) => sentences(focus.context), true)],
  render: (state) => tilingDocument({ kind: "window", summary: String(state.task), context: lines(state, "context"), questions: [] }),
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};
export const tilingSeamMode: Mode<Seam, null> = {
  name: "tiling-seam",
  task: (focus) => focus.summary,
  definitions: (focus) => ({ open: focus.open }),
  sources: [given("tail", (focus: Seam) => sentences(focus.tail), true), given("head", (focus: Seam) => sentences(focus.head), true)],
  render: (state) => tilingDocument({ kind: "seam", summary: String(state.task), open: String(state.open), tail: lines(state, "tail"), head: lines(state, "head"), questions: [] }),
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface KindsFocus extends Asked { summary: string; before: Sentence[]; asked: Sentence[] }
export const kindsMode: Mode<KindsFocus, null> = {
  name: "sentence-kinds",
  task: (focus) => `${focus.summary} Classify every sentence of the passage (sentences keyed by id, in reading order).`.trim(),
  definitions: () => ({ kinds: { ...SENTENCE_KINDS }, change: SENTENCE_CHANGE }),
  sources: [given("before", (focus: KindsFocus) => sentences(focus.before)), given("passage", (focus: KindsFocus) => sentences(focus.asked))],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface TypingFocus extends Asked { batch: Sentence[]; names: string[] }
export const typingMode: Mode<TypingFocus, null> = {
  name: "typing",
  task: "Strings from a passage of a novel, each with the sentences that hold it. Say what each one is (the types are defined in types).",
  definitions: () => ({ types: { ...ENTITY_TYPES } }),
  sources: [given("passage", (focus: TypingFocus) => sentences(focus.batch)), given("names", (focus: TypingFocus) => focus.names.map((text, index) => ["n" + (index + 1), { text, in: sentencesWith(focus.batch, text) }]))],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface EmStores { chart: Chart; text: (sentence: string) => string; label: (id: string) => string }
export interface EmFocus extends Asked { batch: Sentence[]; group: { detected: Detected; candidates: string[] }[]; facts: Record<string, { about: string[]; text: string }> }
export const emMode: Mode<EmFocus, EmStores> = {
  name: "em",
  task: "Names found in a passage of a novel. For each, say who or what it is: one of its candidates (the people, things and places the story has had so far), the same as another name of this passage, or new. The facts are what the book has stated so far about the candidates and the names (each says what it is about): they are the truth, trust them over how the names look.",
  sources: [
    given("passage", (focus: EmFocus) => sentences(focus.batch)),
    given("names", (focus: EmFocus) => focus.group.map(({ detected }) => [detected.key, { text: detected.text, type: detected.type, in: detected.sentences }])),
    // The candidates of the group's names, as the matter recommender ranked them.
    given("candidates", (focus: EmFocus, stores: EmStores) => [...new Set(focus.group.flatMap((entry) => entry.candidates))].map((id) => {
      const entity = stores.chart.entities.get(id)!, last = entity.seen[entity.seen.length - 1];
      return [id, { names: entity.names, type: entity.type, ...(entity.owners?.length ? { of: stores.label(entity.owners[entity.owners.length - 1].id) } : {}), seen: entity.seen.length, last: last ? stores.text(last).slice(0, 160) : "" }];
    }), true),
    given("facts", (focus: EmFocus) => Object.entries(focus.facts)),
  ],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface OwnersFocus extends Asked { batch: Sentence[]; concepts: { id: string; name: string; in: string[] }[]; people: { id: string; name: string }[]; facts: Record<string, { about: string[]; text: string }> }
export const ownersMode: Mode<OwnersFocus, null> = {
  name: "owners",
  task: "Concepts a passage of a novel names: abilities, powers, techniques, networks, systems, plans. For each, say whose it is: the person who has it, uses it or runs it; many people or a group; or no one's (it is general, or the passage does not say). The facts are what the book has stated so far about them: trust them.",
  sources: [
    given("passage", (focus: OwnersFocus) => sentences(focus.batch)),
    given("concepts", (focus: OwnersFocus) => focus.concepts.map((concept) => [concept.id, { name: concept.name, in: concept.in }])),
    given("people", (focus: OwnersFocus) => focus.people.map((person) => [person.id, person.name]), true),
    given("facts", (focus: OwnersFocus) => Object.entries(focus.facts)),
  ],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface StoryTimeFocus extends Asked { story: Record<string, string>; passage: { id: string; text: string }[]; times: { key: string; text: string; means: string; in: string }[] }
export const storyTimeMode: Mode<StoryTimeFocus, null> = {
  name: "story-time",
  task: "Time words in a passage of a novel. For each, say what it does to WHEN the narrated scene happens (the roles are defined in roles). The story's time so far is in story.",
  definitions: () => ({ roles: { ...ROLES } }),
  sources: [
    given("story", (focus: StoryTimeFocus) => Object.entries(focus.story)),
    given("passage", (focus: StoryTimeFocus) => sentences(focus.passage)),
    given("times", (focus: StoryTimeFocus) => focus.times.map(({ key, ...time }) => [key, time])),
  ],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

/** After a flashback: the end of the scene before and the new scene's opening, sent as the digger's prompt of plain text. */
export interface ContinuationFocus extends Asked { previousTail: { id: string; text: string }[]; opening: { id: string; text: string }[] }
export const continuationMode: Mode<ContinuationFocus, null> = {
  name: "continuation",
  task: "Whether a new scene continues a flashback.",
  sources: [given("tail", (focus: ContinuationFocus) => sentences(focus.previousTail), true), given("opening", (focus: ContinuationFocus) => sentences(focus.opening), true)],
  render: (state) => continuationDocument(lines(state, "tail"), lines(state, "opening")),
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};

export interface RolesStores { chart: Chart; label: (id: string) => string; text: (sentence: string) => string; named: Map<string, string[]>; roles: Record<string, Role>; meantBefore: (name: string) => string }
export interface RolesFocus extends Asked {
  scene: string; passage: string[]; cast: string[]; offered: Slot[]; namedThings: string[]; offeredThings: Slot[]; concepts: string[];
  facts: Record<string, { about: string[]; text: string }>; before: string[]; descs: { key: string; text: string; type: string; sentences: string[] }[];
}
const slotFields = (focus: RolesFocus, slot: Slot) => ({ name: `(unnamed ${slot.kind}) ${slot.label}`, ...(slot.names.length > 1 ? { also: slot.names.slice(1, 4) } : {}), from: slot.scene === focus.scene ? "this scene" : "the scene before" });
export const rolesMode: Mode<RolesFocus, RolesStores> = {
  name: "roles",
  task: "A passage of a novel and its cast: the people of this scene and around it, keyed by id (an unnamed one is a person or a crowd the story has not named), and the named things, vehicles, weapons and places it names. For each sentence asked about, say who says it or who or what acts in it, and who a spoken line is said to; for each description of a person or a crowd, say who it means here, and of a vehicle or a weapon, which one it is here. The facts are what the book has stated so far about the cast and the descriptions: they are the truth, trust them.",
  sources: [
    // The cast as EM²'s recommender ranked it, then the scene's slots.
    given("cast", (focus: RolesFocus, stores: RolesStores) => [
      ...focus.cast.map((id): [string, unknown] => {
        const entity = stores.chart.entities.get(id)!, there = focus.passage.filter((sentence) => stores.named.get(sentence)?.includes(id));
        return [id, { name: stores.label(id), ...(entity.proper.length > 1 ? { also: entity.proper.slice(1, 4) } : {}), ...(there.length ? { named: there } : {}) }];
      }),
      ...focus.offered.map((slot): [string, unknown] => [slot.id, slotFields(focus, slot)]),
    ], true),
    given("things", (focus: RolesFocus, stores: RolesStores) => [
      ...focus.namedThings.map((id): [string, unknown] => [id, { name: stores.label(id), is: stores.chart.entities.get(id)!.type }]),
      ...focus.offeredThings.map((slot): [string, unknown] => [slot.id, slotFields(focus, slot)]),
    ]),
    given("concepts", (focus: RolesFocus, stores: RolesStores) => focus.concepts.map((id) => { const owner = stores.chart.entities.get(id)!.owners?.at(-1)?.id; return [id, { name: stores.label(id), ...(owner ? { of: owner === "many" ? "many people, or a group" : stores.label(owner) } : {}) }]; })),
    given("facts", (focus: RolesFocus) => Object.entries(focus.facts)),
    // The lines answered just before, carried into this batch.
    given("before", (focus: RolesFocus, stores: RolesStores) => focus.before.map((id) => { const role = stores.roles[id]; return [id, { text: clip(stores.text(id), 60), who: role.who.id ? stores.label(role.who.id) : role.who.answer === "time" ? "a flashback" : "no one", ...(role.to ? { to: role.to.id ? stores.label(role.to.id) : "no one" } : {}) }]; })),
    given("passage", (focus: RolesFocus, stores: RolesStores) => focus.passage.map((id) => [id, stores.text(id)])),
    given("descriptions", (focus: RolesFocus, stores: RolesStores) => focus.descs.map((desc) => { const meant = stores.meantBefore(desc.text); return [desc.key, { text: desc.text, type: desc.type, in: desc.sentences, ...(meant ? { meant } : {}) }]; })),
  ],
  cutOrder: [], questions: (focus) => focus.questions, budget: BUDGET,
};
