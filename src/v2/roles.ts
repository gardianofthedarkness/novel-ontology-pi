import type { DecisionQuestion } from "../ground/connectors/jev.js";
import { factsFor, mentions, type Chart, type Fact } from "./em.js";
import type { Decide } from "./typing.js";

/**
 * EM² — who is this, here (the user's call, 2026-10-30; docs/v2/world-engine-v2.md §2.1). EM says once which entity a name
 * is. A pronoun, 我 and 你, a description (少女, 那个刺猬头, 姐姐大人) or no word at all point at someone only where they
 * stand, so none of them enters the chart. Scene by scene in reading order, one Jev request a ROLE_BATCH sentences asks:
 * - of a spoken line, who says it and who it is said to; of an action, who acts;
 * - of each description of a person, who it means here.
 * The choices are the scene's cast: the people named in the passage, the scene and the one before, the people the
 * recommender expects, the world engine's present people when it has them, the people a description has meant before
 * (habits), and the scene's slots. A description that means someone not in the cast opens a slot: an unnamed person of the
 * scene (小混混, 追击者), never a name of anyone; one that means people in general (学生 as students at large) is no one. A line may point at whoever a description of the passage means, at
 * someone unnamed, or at no one. A habit (what a description has meant, in whose lines) is shown with it next time: a
 * prior, never an exact match.
 */
/** Sentences a request asks about; answers below ROLE_ACCEPT are no one sure (a description: an unnamed person). */
export const ROLE_BATCH = 12, ROLE_ACCEPT = 0.5;
/** People and slots a request offers. */
export const CAST_SIZE = 16, CAST_SLOTS = 6;
/** Sentences shown before a batch's first, and answered lines carried into the next batch. */
export const ROLE_CONTEXT = 3, ROLE_BEFORE = 4;

const ROLE_KINDS = new Set(["spoken", "action"]);
const DESCRIPTION = "\u0000description";
const UNNAMED = "someone the passage does not name or describe";
const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

/**
 * One answer: `id` is the person or slot it settles on (null: no one, or no one sure); `answer` is what Jev chose — a
 * person or slot id, a description of the passage (by its text: `id` is whom it meant there), unnamed or none.
 */
export interface Pick { id: string | null; answer: string; confidence: number }
/** A line's people: who says it or acts in it, and who a spoken line is said to. */
export interface Role { kind: "spoken" | "action"; who: Pick; to?: Pick }
/** A description of a person where it stands, and who it means there (a person, a slot, or no one). */
export interface Reference { text: string; scene: string; sentences: string[]; entity: string | null; answer: string; confidence: number; unsure?: string }
/** An unnamed person of a scene, known by the descriptions that meant them. Never a name of anyone. */
export interface Slot { id: string; scene: string; label: string; names: string[]; sentences: string[] }
/** What a description has meant: how often, and in whose lines. */
export interface Habit { text: string; entity: string; count: number; speakers: Record<string, number> }
export interface RolesResult { roles: Record<string, Role>; references: Reference[]; slots: Slot[]; habits: Habit[] }

export interface RolesInput {
  scenes: { id: string; sentences: string[] }[];
  kinds: Record<string, { kind: string }>;
  chart: Chart;
  /** The people named in each sentence (the card scan). */
  named: Map<string, string[]>;
  /** Every string typed as a description of a person (EM's description outcome). */
  descriptions: string[];
  /** Each scene's people the recommender expects. */
  recommended: Map<string, { id: string; score: number }[]>;
  facts: Fact[];
  text: (sentence: string) => string;
  position: (sentence: string) => number;
  /** Each scene's present people, from the world engine's view, when it has one. */
  present?: Map<string, string[]>;
}

export async function resolveRoles(decide: Decide, input: RolesInput): Promise<RolesResult> {
  const { chart, text, position } = input;
  const isPerson = (id: string) => chart.entities.get(id)?.category === "person";
  const roles: Record<string, Role> = {}, references: Reference[] = [], slots: Slot[] = [], slotOf = new Map<string, Slot>();
  const habits = new Map<string, Habit>();
  // The descriptions a sentence holds, a longer name masking the ones inside it (御坂妹妹 is a name, not 妹妹).
  const lexicon: [string, string][] = [...chart.names(), ...input.descriptions.map((name): [string, string] => [name, DESCRIPTION])].sort((a, b) => b[0].length - a[0].length);
  const describedCache = new Map<string, string[]>();
  const describedIn = (id: string) => {
    if (!describedCache.has(id)) describedCache.set(id, [...new Set(mentions(text(id), lexicon).filter((hit) => hit.id === DESCRIPTION).map((hit) => hit.name))]);
    return describedCache.get(id)!;
  };
  const label = (id: string) => slotOf.get(id)?.label ?? chart.entities.get(id)?.proper[0] ?? chart.entities.get(id)?.names[0] ?? id;
  const tally = (counts: Map<string, number>, id: string | null | undefined) => { if (id) counts.set(id, (counts.get(id) ?? 0) + 1); };
  const habitsOf = (name: string) => [...habits.values()].filter((habit) => habit.text === name).sort((a, b) => b.count - a.count);
  const meantBefore = (name: string) => habitsOf(name).slice(0, 2).map((habit) => {
    const [speaker, times] = Object.entries(habit.speakers).sort((a, b) => b[1] - a[1])[0] ?? [];
    return `${label(habit.entity)} ×${habit.count}${speaker ? ` (in lines of ${label(speaker)} ×${times})` : ""}`;
  }).join("; ");
  let previous = new Map<string, number>(), previousSlots: Slot[] = [];
  for (const scene of input.scenes) {
    const named = new Map<string, number>(), here = new Map<string, number>(), sceneSlots: Slot[] = [];
    for (const id of scene.sentences) for (const person of input.named.get(id) ?? []) tally(named, person);
    const asked = scene.sentences.filter((id) => ROLE_KINDS.has(input.kinds[id]?.kind) || describedIn(id).length);
    let before: string[] = [];
    for (let start = 0; start < asked.length; start += ROLE_BATCH) {
      const batch = asked.slice(start, start + ROLE_BATCH);
      const passage = scene.sentences.slice(Math.max(0, scene.sentences.indexOf(batch[0]) - ROLE_CONTEXT), scene.sentences.indexOf(batch[batch.length - 1]) + 1);
      const described = new Map<string, string[]>();
      for (const id of batch) for (const name of describedIn(id)) described.set(name, [...(described.get(name) ?? []), id]);
      const descs = [...described].map(([name, sentences], index) => ({ key: "d" + (index + 1), text: name, sentences }));

      // The cast, most likely first.
      const score = new Map<string, number>(), add = (id: string, value: number) => { if (isPerson(id)) score.set(id, Math.max(score.get(id) ?? 0, value)); };
      for (const id of passage) for (const person of input.named.get(id) ?? []) add(person, 100 + (named.get(person) ?? 0));
      for (const [person, count] of named) add(person, 50 + count);
      for (const [person, count] of here) add(person, 40 + count);
      for (const desc of descs) for (const habit of habitsOf(desc.text).slice(0, 2)) add(habit.entity, 35 + habit.count);
      for (const person of input.present?.get(scene.id) ?? []) add(person, 30);
      for (const [person, count] of previous) add(person, 20 + count);
      for (const entry of input.recommended.get(scene.id) ?? []) add(entry.id, 10 + entry.score);
      const cast = [...score].sort((a, b) => b[1] - a[1]).slice(0, CAST_SIZE).map(([id]) => id);
      const offered = [...previousSlots, ...sceneSlots].slice(-CAST_SLOTS);
      const people = [...cast, ...offered.map((slot) => slot.id)];
      const fact = new Map<string, string>();
      for (const entry of factsFor(chart, cast, input.facts, position(passage[0]), position)) if (!fact.has(entry.about)) fact.set(entry.about, clip(entry.text, 100));

      const state = {
        task: "A passage of a novel and its cast: the people of this scene and around it, keyed by id (an unnamed one is a person the story has not named). For each sentence asked about, say who says it or acts in it, and who a spoken line is said to; for each description of a person, say who it means here.",
        cast: Object.fromEntries([
          ...cast.map((id) => {
            const entity = chart.entities.get(id)!, there = passage.filter((sentence) => input.named.get(sentence)?.includes(id));
            return [id, { name: label(id), ...(entity.proper.length > 1 ? { also: entity.proper.slice(1, 4) } : {}), ...(there.length ? { named: there } : {}), ...(fact.has(id) ? { fact: fact.get(id) } : {}) }];
          }),
          ...offered.map((slot) => [slot.id, { name: `(unnamed) ${slot.label}`, ...(slot.names.length > 1 ? { also: slot.names.slice(1, 4) } : {}), from: slot.scene === scene.id ? "this scene" : "the scene before" }]),
        ]),
        ...(before.length ? { before: Object.fromEntries(before.map((id) => { const role = roles[id]; return [id, { text: clip(text(id), 60), who: role.who.id ? label(role.who.id) : "no one", ...(role.to ? { to: role.to.id ? label(role.to.id) : "no one" } : {}) }]; })) } : {}),
        passage: Object.fromEntries(passage.map((id) => [id, text(id)])),
        ...(descs.length ? { descriptions: Object.fromEntries(descs.map((desc) => { const meant = meantBefore(desc.text); return [desc.key, { text: desc.text, in: desc.sentences, ...(meant ? { meant } : {}) }]; })) } : {}),
      };
      const hints: Record<string, string> = Object.fromEntries([
        ...cast.map((id) => [id, [label(id), ...chart.entities.get(id)!.proper.slice(1, 3)].join(" / ")]),
        ...offered.map((slot) => [slot.id, `the unnamed person ${slot.scene === scene.id ? "this scene" : "the scene before"} called ${slot.label}`]),
        ...descs.map((desc) => [desc.key, `whoever descriptions.${desc.key} (${desc.text}) means here`]),
      ]);
      const line = [...people, ...descs.map((desc) => desc.key), "unnamed", "none"];
      const questions: DecisionQuestion[] = [
        ...descs.map((desc) => ({ key: `ref:${desc.key}`, primitive: "choice" as const, instructions: `Who does descriptions.${desc.key} mean here?`, options: [...people, "new", "general", "none"], optionHints: { ...hints, new: "someone not in the cast: a person or a group the story has not named, who is here", general: "people in general or a kind of person, not anyone here (学生 as students at large)", none: "not a person here" } })),
        ...batch.filter((id) => ROLE_KINDS.has(input.kinds[id]?.kind)).flatMap((id) => input.kinds[id].kind === "spoken" ? [
          { key: `role:who:${id}`, primitive: "choice" as const, instructions: `Who says passage.${id}?`, options: line, optionHints: { ...hints, unnamed: UNNAMED, none: "no one can tell" } },
          { key: `role:to:${id}`, primitive: "choice" as const, instructions: `Who is passage.${id} said to?`, options: line, optionHints: { ...hints, unnamed: UNNAMED, none: "no one in particular: to themself, to everyone, or no one can tell" } },
        ] : [
          { key: `role:who:${id}`, primitive: "choice" as const, instructions: `Who acts in passage.${id} (does what it tells)?`, options: line, optionHints: { ...hints, unnamed: UNNAMED, none: "no person: a thing, an animal, the weather or the scene" } },
        ]),
      ];
      if (!questions.length) continue;
      const replies = await decide(state, questions);
      const answer = (key: string) => {
        const reply = replies.find((entry) => entry.key === key), value = String(reply?.value ?? "none");
        return { value, confidence: Number(reply?.distribution?.[value] ?? reply?.confidence ?? 0) };
      };

      // Descriptions first: a line may point through one.
      const meant = new Map<string, string | null>();
      for (const desc of descs) {
        const { value, confidence } = answer(`ref:${desc.key}`);
        let entity: string | null = null, unsure: string | undefined;
        if (people.includes(value) && confidence >= ROLE_ACCEPT) entity = value;
        else if (value !== "none" && value !== "general") {
          if (people.includes(value)) unsure = value;
          const slot: Slot = { id: `slot_${scene.id.slice(-6)}_${sceneSlots.length + 1}`, scene: scene.id, label: desc.text, names: [], sentences: [] };
          sceneSlots.push(slot); slots.push(slot); slotOf.set(slot.id, slot); entity = slot.id;
        }
        const slot = entity ? slotOf.get(entity) : undefined;
        if (slot) { if (!slot.names.includes(desc.text)) slot.names.push(desc.text); for (const id of desc.sentences) if (!slot.sentences.includes(id)) slot.sentences.push(id); }
        meant.set(desc.key, entity); tally(here, entity);
        references.push({ text: desc.text, scene: scene.id, sentences: desc.sentences, entity, answer: value, confidence: Number(confidence.toFixed(3)), ...(unsure ? { unsure } : {}) });
      }
      const pick = (key: string): Pick => {
        const { value, confidence } = answer(key), sure = confidence >= ROLE_ACCEPT, desc = descs.find((entry) => entry.key === value);
        const id = desc ? (sure ? meant.get(desc.key) ?? null : null) : people.includes(value) && sure ? value : null;
        return { id, answer: desc ? desc.text : value, confidence: Number(confidence.toFixed(3)) };
      };
      for (const id of batch) {
        const kind = input.kinds[id]?.kind;
        if (kind !== "spoken" && kind !== "action") continue;
        const role: Role = { kind, who: pick(`role:who:${id}`), ...(kind === "spoken" ? { to: pick(`role:to:${id}`) } : {}) };
        roles[id] = role; tally(here, role.who.id); tally(here, role.to?.id);
        const slot = role.who.id ? slotOf.get(role.who.id) : undefined;
        if (slot && !slot.sentences.includes(id)) slot.sentences.push(id);
      }
      // Habits: what each description meant here, and in whose lines.
      for (const desc of descs) {
        const entity = meant.get(desc.key);
        if (!entity || !isPerson(entity)) continue;
        const habit = habits.get(`${desc.text}\u0000${entity}`) ?? { text: desc.text, entity, count: 0, speakers: {} };
        habit.count++;
        for (const id of desc.sentences) { const speaker = roles[id]?.kind === "spoken" ? roles[id].who.id : null; if (speaker && speaker !== entity) habit.speakers[speaker] = (habit.speakers[speaker] ?? 0) + 1; }
        habits.set(`${desc.text}\u0000${entity}`, habit);
      }
      before = batch.filter((id) => roles[id]).slice(-ROLE_BEFORE);
    }
    previous = new Map(named);
    for (const [id, count] of here) previous.set(id, (previous.get(id) ?? 0) + count);
    previousSlots = sceneSlots;
  }
  return { roles, references, slots, habits: [...habits.values()].sort((a, b) => b.count - a.count) };
}
