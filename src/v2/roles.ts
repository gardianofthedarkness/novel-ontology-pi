import type { DecisionQuestion } from "../ground/connectors/jev.js";
import { mentions, type Chart } from "./em.js";
import { factEvidence, type FactLedger } from "./facts.js";
import type { Decide } from "./typing.js";

/**
 * EM² — who is this, here (the user's call, 2026-10-30; docs/v2/world-engine-v2.md §2.0.1). EM says once which entity a name
 * is. A pronoun, 我 and 你, a description (少女, 那个刺猬头, 姐姐大人), a crowd (警备员们) or no word at all point at someone
 * only where they stand, so none of them enters the chart. Scene by scene in reading order, one Jev request a ROLE_BATCH
 * sentences asks:
 * - of a spoken line, who says it and who it is said to; of an action, who or what acts (a person, a crowd, a named thing,
 *   a vehicle or a weapon, a building or a place), or whether the story goes back in time, and whether it matters to the
 *   story or is background (an everyday thing is never an actor: the user's rule, 2026-10-30);
 * - of each description of a person or a crowd, who it means here; of each unnamed vehicle or weapon (那辆车, 手枪), which
 *   one it is here: a named one of the passage, or one of the scene's (a slot of its own, as an unnamed person's).
 * The choices are the scene's cast: the people named in the passage, the scene and the one before, the people the
 * recommender expects, the world engine's present people when it has them, the people a description has meant before
 * (habits), and the scene's slots. A description that means someone not in the cast opens a slot: an unnamed person or an
 * unnamed crowd of the scene (小混混, 追击者, 警备员们), never a name of anyone; one that means people in general (学生 as
 * students at large) is no one. A line may point at whoever a description of the passage means, at someone unnamed, or at
 * no one. A habit (what a description has meant, in whose lines) is shown with it next time: a prior, never an exact match.
 * The concepts the passage names (an ability, a network) come along with whose they are, as context: a concept never acts,
 * its owner does. The facts (facts.ts, the source of truth) come along: the latest ones about the cast, and the ones that hold each
 * description; a description resolved to a person in a fact makes that fact about the person from then on.
 */
/** Sentences a request asks about; answers below ROLE_ACCEPT are no one sure (a description: an unnamed person). */
export const ROLE_BATCH = 12, ROLE_ACCEPT = 0.5;
/** People and slots a request offers, things and places an action may offer, and the cast members facts are fetched for. */
export const CAST_SIZE = 16, CAST_SLOTS = 6, CAST_THINGS = 8, CAST_FACTS = 8;
/** Sentences shown before a batch's first, and answered lines carried into the next batch. */
export const ROLE_CONTEXT = 3, ROLE_BEFORE = 4;

const ROLE_KINDS = new Set(["spoken", "action"]);
const DESCRIPTION = "\u0000description";
const UNNAMED = "someone the passage does not name or describe";
/** The user's rule for actions (2026-10-30): only someone or something that matters acting or moving, or a flashback. */
const MATTERS = {
  true: "it matters to the story: a person, a crowd, a vehicle, a weapon, a thing with a name of its own, a building or a place acts, moves or changes; or the story goes back in time",
  false: "background: a passer-by, an everyday thing (a phone, a door, a machine at its routine work), the weather, the sounds and lights of the scene; nothing that matters acts",
};
/** What a description is of: a person or a crowd (the cast), or an unnamed vehicle or weapon (the things). */
export type DescriptionType = "person" | "crowd" | "vehicle" | "weapon" | "place" | "building" | "room";
const OF_THINGS = new Set<string>(["vehicle", "weapon"]);
/** Descriptions of places (the user's call, 2026-10-31): which place each means where it stands, and which named place holds it. */
const OF_PLACES = new Set<string>(["place", "building", "room"]);
/** Named places a place question offers (the passage's, the scene's, the scene before's), and the environment cards shown as the scene's setting. */
export const CAST_PLACES = 10, SETTING_CARDS = 3;
const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);

/**
 * One answer: `id` is the person, slot, thing or place it settles on (null: no one, or no one sure); `answer` is what it
 * settled to — an id, unnamed, none, time (the story goes back in time), or for a description general or none; `via` is
 * the description of the passage it went through, if it did.
 */
export interface Pick { id: string | null; answer: string; confidence: number; via?: string }
/** A line's people: who says it or acts in it, and who a spoken line is said to; an action's `matters`: 0..1, whether it matters to the story or is background. */
export interface Role { kind: "spoken" | "action"; who: Pick; to?: Pick; matters?: number }
/** A description of a person, a crowd, a vehicle or a weapon where it stands, and who or what it means there (an entity, a slot, or none). */
export interface Reference { text: string; type: DescriptionType; scene: string; sentences: string[]; entity: string | null; answer: string; confidence: number; unsure?: string; facts?: string[] }
/** An unnamed person, crowd, vehicle or weapon of a scene, known by the descriptions that meant it. Never a name of anything. */
/** `scale`: an unnamed open place's, as typing said it (a street, a district, …). */
export interface Slot { id: string; kind: DescriptionType; scene: string; label: string; names: string[]; sentences: string[]; in?: string | null; scale?: string }
/** What EM² said holds a place where a description of it stood: a named place, with how sure. */
export interface PlaceLink { child: string; parent: string; scene: string; confidence: number; via: string }
/** What a description has meant: how often, and in whose lines. */
export interface Habit { text: string; entity: string; count: number; speakers: Record<string, number> }
export interface RolesResult { roles: Record<string, Role>; references: Reference[]; slots: Slot[]; habits: Habit[]; placeLinks: PlaceLink[] }

export interface RolesInput {
  scenes: { id: string; sentences: string[] }[];
  kinds: Record<string, { kind: string }>;
  chart: Chart;
  /** The entities named in each sentence (the card scan). */
  named: Map<string, string[]>;
  /** Every string typed as a description of a person, a crowd, or an unnamed vehicle or weapon (EM's description outcome). */
  descriptions: { text: string; type: DescriptionType; scale?: string }[];
  /** Each scene's people the recommender expects. */
  recommended: Map<string, { id: string; score: number }[]>;
  facts: FactLedger;
  text: (sentence: string) => string;
  position: (sentence: string) => number;
  /** Each scene's present people, from the world engine's view, when it has one. */
  present?: Map<string, string[]>;
}

export async function resolveRoles(decide: Decide, input: RolesInput): Promise<RolesResult> {
  const { chart, text, position } = input;
  const categoryOf = (id: string) => chart.entities.get(id)?.category;
  const isPerson = (id: string) => categoryOf(id) === "person";
  const roles: Record<string, Role> = {}, references: Reference[] = [], slots: Slot[] = [], slotOf = new Map<string, Slot>();
  const habits = new Map<string, Habit>();
  const typeOf = new Map(input.descriptions.map((entry) => [entry.text, entry.type])), scaleOf = new Map(input.descriptions.filter((entry) => entry.scale).map((entry) => [entry.text, entry.scale!]));
  // The descriptions a sentence holds, a longer name masking the ones inside it (御坂妹妹 is a name, not 妹妹).
  const lexicon: [string, string][] = [...chart.names(), ...input.descriptions.map((entry): [string, string] => [entry.text, DESCRIPTION])].sort((a, b) => b[0].length - a[0].length);
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
  let previous = new Map<string, number>(), previousSlots: Slot[] = [], previousPlaces: string[] = [];
  const placeLinks: PlaceLink[] = [];
  const isPlace = (id: string) => categoryOf(id) === "place";
  for (const scene of input.scenes) {
    const named = new Map<string, number>(), here = new Map<string, number>(), sceneSlots: Slot[] = [];
    for (const id of scene.sentences) for (const entity of input.named.get(id) ?? []) if (isPerson(entity)) tally(named, entity);
    const asked = scene.sentences.filter((id) => ROLE_KINDS.has(input.kinds[id]?.kind) || describedIn(id).length);
    let before: string[] = [];
    for (let start = 0; start < asked.length; start += ROLE_BATCH) {
      const batch = asked.slice(start, start + ROLE_BATCH);
      const passage = scene.sentences.slice(Math.max(0, scene.sentences.indexOf(batch[0]) - ROLE_CONTEXT), scene.sentences.indexOf(batch[batch.length - 1]) + 1);
      const described = new Map<string, string[]>();
      for (const id of batch) for (const name of describedIn(id)) described.set(name, [...(described.get(name) ?? []), id]);
      const descs = [...described].map(([name, sentences], index) => ({ key: "d" + (index + 1), text: name, type: typeOf.get(name) ?? "person", sentences }));

      // The cast, most likely first; the things and places the passage names (an action's possible actors).
      const score = new Map<string, number>(), add = (id: string, value: number) => { if (isPerson(id)) score.set(id, Math.max(score.get(id) ?? 0, value)); };
      for (const id of passage) for (const entity of input.named.get(id) ?? []) add(entity, 100 + (named.get(entity) ?? 0));
      for (const [person, count] of named) add(person, 50 + count);
      for (const [person, count] of here) add(person, 40 + count);
      for (const desc of descs) for (const habit of habitsOf(desc.text).slice(0, 2)) add(habit.entity, 35 + habit.count);
      for (const person of input.present?.get(scene.id) ?? []) add(person, 30);
      for (const [person, count] of previous) add(person, 20 + count);
      for (const entry of input.recommended.get(scene.id) ?? []) add(entry.id, 10 + entry.score);
      const cast = [...score].sort((a, b) => b[1] - a[1]).slice(0, CAST_SIZE).map(([id]) => id);
      const offered = [...previousSlots, ...sceneSlots].filter((slot) => !OF_THINGS.has(slot.kind)).slice(-CAST_SLOTS);
      const offeredThings = [...previousSlots, ...sceneSlots].filter((slot) => OF_THINGS.has(slot.kind)).slice(-CAST_SLOTS);
      const people = [...cast, ...offered.map((slot) => slot.id)];
      const namedThings = [...new Set(passage.flatMap((id) => input.named.get(id) ?? []).filter((id) => categoryOf(id) === "thing" || categoryOf(id) === "place"))].slice(0, CAST_THINGS);
      const things = [...namedThings, ...offeredThings.map((slot) => slot.id)];
      // The concepts the passage names (an ability, a network) and whose they are: context, never an actor (its owner acts).
      const concepts = [...new Set(passage.flatMap((id) => input.named.get(id) ?? []).filter((id) => categoryOf(id) === "concept"))];
      // The things a vehicle's or a weapon's description may mean: the named ones of its type, and the scene's unnamed ones.
      const ofType = (type: string) => things.filter((id) => chart.entities.get(id)?.type === type || slotOf.get(id)?.kind === type);
      const lineDescs = descs.filter((desc) => !OF_THINGS.has(desc.type) && !OF_PLACES.has(desc.type));
      // The places a place's description may mean: the named places of the passage, of the scene so far and of the scene
      // before, and the scene's (and the scene before's) unnamed places; its setting, from the scene's environment cards.
      const placeDescs = descs.filter((desc) => OF_PLACES.has(desc.type));
      const upTo = scene.sentences.slice(0, scene.sentences.indexOf(batch[batch.length - 1]) + 1);
      const namedPlaces = [...new Set([...passage, ...upTo].flatMap((id) => input.named.get(id) ?? []).filter(isPlace).concat(previousPlaces))].slice(0, CAST_PLACES);
      const offeredPlaces = [...previousSlots, ...sceneSlots].filter((slot) => OF_PLACES.has(slot.kind)).slice(-CAST_SLOTS);
      const placeOptions = [...namedPlaces, ...offeredPlaces.map((slot) => slot.id)];
      const setting = placeDescs.length ? scene.sentences.filter((id) => input.kinds[id]?.kind === "environment").slice(0, SETTING_CARDS).map((id) => clip(text(id), 140)) : [];
      const at = position(passage[0]);
      const facts = factEvidence([
        ...cast.slice(0, CAST_FACTS).flatMap((id) => input.facts.about(chart, [id], at).map((fact) => ({ fact, for: id }))),
        ...descs.flatMap((desc) => input.facts.holding(desc.text, at).map((fact) => ({ fact, for: `descriptions.${desc.key}` }))),
      ]);

      const state = {
        task: "A passage of a novel and its cast: the people of this scene and around it, keyed by id (an unnamed one is a person or a crowd the story has not named), and the named things, vehicles, weapons and places it names. For each sentence asked about, say who says it or who or what acts in it, and who a spoken line is said to; for each description of a person or a crowd, say who it means here, and of a vehicle or a weapon, which one it is here. The facts are what the book has stated so far about the cast and the descriptions: they are the truth, trust them.",
        cast: Object.fromEntries([
          ...cast.map((id) => {
            const entity = chart.entities.get(id)!, there = passage.filter((sentence) => input.named.get(sentence)?.includes(id));
            return [id, { name: label(id), ...(entity.proper.length > 1 ? { also: entity.proper.slice(1, 4) } : {}), ...(there.length ? { named: there } : {}) }];
          }),
          ...offered.map((slot) => [slot.id, { name: `(unnamed ${slot.kind}) ${slot.label}`, ...(slot.names.length > 1 ? { also: slot.names.slice(1, 4) } : {}), from: slot.scene === scene.id ? "this scene" : "the scene before" }]),
        ]),
        ...(things.length ? { things: Object.fromEntries([
          ...namedThings.map((id) => [id, { name: label(id), is: chart.entities.get(id)!.type }]),
          ...offeredThings.map((slot) => [slot.id, { name: `(unnamed ${slot.kind}) ${slot.label}`, ...(slot.names.length > 1 ? { also: slot.names.slice(1, 4) } : {}), from: slot.scene === scene.id ? "this scene" : "the scene before" }]),
        ]) } : {}),
        ...(placeOptions.length && placeDescs.length ? { places: Object.fromEntries([
          ...namedPlaces.map((id) => [id, { name: label(id), is: chart.entities.get(id)!.type }]),
          ...offeredPlaces.map((slot) => [slot.id, { name: `(unnamed ${slot.kind}) ${slot.label}`, ...(slot.in ? { in: label(slot.in) } : {}), from: slot.scene === scene.id ? "this scene" : "the scene before" }]),
        ]) } : {}),
        ...(setting.length ? { setting } : {}),
        ...(concepts.length ? { concepts: Object.fromEntries(concepts.map((id) => { const owner = chart.entities.get(id)!.owners?.at(-1)?.id; return [id, { name: label(id), ...(owner ? { of: owner === "many" ? "many people, or a group" : label(owner) } : {}) }]; })) } : {}),
        ...(Object.keys(facts).length ? { facts } : {}),
        ...(before.length ? { before: Object.fromEntries(before.map((id) => { const role = roles[id]; return [id, { text: clip(text(id), 60), who: role.who.id ? label(role.who.id) : role.who.answer === "time" ? "a flashback" : "no one", ...(role.to ? { to: role.to.id ? label(role.to.id) : "no one" } : {}) }]; })) } : {}),
        passage: Object.fromEntries(passage.map((id) => [id, text(id)])),
        ...(descs.length ? { descriptions: Object.fromEntries(descs.map((desc) => { const meant = meantBefore(desc.text); return [desc.key, { text: desc.text, type: desc.type, in: desc.sentences, ...(meant ? { meant } : {}) }]; })) } : {}),
      };
      const hints: Record<string, string> = Object.fromEntries([
        ...cast.map((id) => [id, [label(id), ...chart.entities.get(id)!.proper.slice(1, 3)].join(" / ")]),
        ...[...offered, ...offeredThings, ...offeredPlaces].map((slot) => [slot.id, `the unnamed ${slot.kind} ${slot.scene === scene.id ? "this scene" : "the scene before"} called ${slot.label}`]),
        ...namedPlaces.map((id) => [id, `${label(id)} (a named ${chart.entities.get(id)!.type})`]),
        ...namedThings.map((id) => [id, `${label(id)} (${categoryOf(id) === "place" ? "a building or a place" : `a ${chart.entities.get(id)!.type === "object" ? "named thing" : chart.entities.get(id)!.type}`})`]),
        ...descs.map((desc) => [desc.key, `${OF_THINGS.has(desc.type) || OF_PLACES.has(desc.type) ? "whichever" : "whoever"} descriptions.${desc.key} (${desc.text}) means here`]),
      ]);
      const line = [...people, ...lineDescs.map((desc) => desc.key), "unnamed", "none"];
      const acting = [...people, ...things, ...descs.map((desc) => desc.key), "unnamed", "time", "none"];
      const questions: DecisionQuestion[] = [
        ...placeDescs.flatMap((desc): DecisionQuestion[] => [
          { key: `ref:${desc.key}`, primitive: "choice", instructions: `Which place does descriptions.${desc.key} mean here?`, options: [...placeOptions, "new", "general", "none"], optionHints: { ...hints, new: "a place here that is not in places and the story has not named", general: "places of this kind in general, not one here", none: "not a place here: a word for something else" } },
          ...(namedPlaces.length ? [{ key: `within:${desc.key}`, primitive: "choice" as const, instructions: `Which named place is the place descriptions.${desc.key} means in?`, options: [...namedPlaces, "none"], optionHints: { ...hints, none: "none of these, or the passage does not say" } }] : []),
        ]),
        ...descs.filter((desc) => !OF_PLACES.has(desc.type)).map((desc): DecisionQuestion => OF_THINGS.has(desc.type)
          ? { key: `ref:${desc.key}`, primitive: "choice", instructions: `Which ${desc.type} does descriptions.${desc.key} mean here?`, options: [...ofType(desc.type), "new", "general", "none"], optionHints: { ...hints, new: `one ${desc.type} here that is not in things and the story has not named`, general: `${desc.type}s in general or a kind of ${desc.type}, not one here`, none: `not a ${desc.type} here` } }
          : { key: `ref:${desc.key}`, primitive: "choice", instructions: `Who does descriptions.${desc.key} mean here?`, options: [...people, "new", "crowd", "general", "none"], optionHints: { ...hints, new: "one person not in the cast, who is here and the story has not named", crowd: "a crowd or a group of people not in the cast, who are here", general: "people in general or a kind of person, not anyone here (学生 as students at large)", none: "not a person here" } }),
        ...batch.filter((id) => ROLE_KINDS.has(input.kinds[id]?.kind)).flatMap((id): DecisionQuestion[] => input.kinds[id].kind === "spoken" ? [
          { key: `role:who:${id}`, primitive: "choice" as const, instructions: `Who says passage.${id}?`, options: line, optionHints: { ...hints, unnamed: UNNAMED, none: "no one can tell" } },
          { key: `role:to:${id}`, primitive: "choice" as const, instructions: `Who is passage.${id} said to (not the one who says it)?`, options: line, optionHints: { ...hints, unnamed: UNNAMED, none: "no one in particular: to themself, to everyone, or no one can tell" } },
        ] : [
          { key: `role:who:${id}`, primitive: "choice" as const, instructions: `Who or what acts in passage.${id} (does or undergoes what it tells, or moves)?`, options: acting, optionHints: { ...hints, unnamed: UNNAMED, time: "no one acts: the story goes back in time (a flashback)", none: "nothing that matters acts: a passer-by, an everyday thing (a phone, a door, a machine at its routine work), the weather or the scene" } },
          { key: `role:matters:${id}`, primitive: "noul" as const, instructions: `Does passage.${id} matter to the story, or is it background?`, noulCriteria: MATTERS },
        ]),
      ];
      if (!questions.length) continue;
      const replies = await decide(state, questions);
      const answer = (key: string, avoid?: string) => {
        const reply = replies.find((entry) => entry.key === key);
        let value = String(reply?.value ?? "none");
        // A line is not said to the one who says it: the next most likely answer instead.
        if (avoid && value === avoid) value = Object.entries(reply?.distribution ?? {}).sort((a, b) => b[1] - a[1]).find(([option]) => option !== avoid)?.[0] ?? "none";
        return { value, confidence: Number(reply?.distribution?.[value] ?? (value === String(reply?.value) ? reply?.confidence : 0) ?? 0) };
      };

      // Descriptions first: a line may point through one.
      const meant = new Map<string, { entity: string | null; answer: string }>();
      for (const desc of descs) {
        const { value, confidence } = answer(`ref:${desc.key}`);
        let entity: string | null = null, unsure: string | undefined;
        const ofPlaces = OF_PLACES.has(desc.type), pool = OF_THINGS.has(desc.type) ? ofType(desc.type) : ofPlaces ? placeOptions : people;
        // What holds a place: the named place EM² said it is in, else a named place its own words name (第七学区的便利店).
        const held = ofPlaces ? (() => { const { value: holder, confidence: sure } = answer(`within:${desc.key}`); if (namedPlaces.includes(holder) && sure >= ROLE_ACCEPT) return { id: holder, confidence: sure }; const inside = mentions(desc.text, chart.names()).map((hit) => hit.id).find(isPlace); return inside ? { id: inside, confidence: 1 } : null; })() : null;
        if (pool.includes(value) && confidence >= ROLE_ACCEPT) entity = value;
        else if (value !== "none" && value !== "general") {
          if (pool.includes(value)) unsure = value;
          const kind: DescriptionType = OF_THINGS.has(desc.type) || ofPlaces ? desc.type : value === "crowd" || (value !== "new" && desc.type === "crowd") ? "crowd" : "person";
          const slot: Slot = { id: `slot_${scene.id.slice(-6)}_${sceneSlots.length + 1}`, kind, scene: scene.id, label: desc.text, names: [], sentences: [], ...(ofPlaces ? { in: held?.id ?? null, ...(scaleOf.get(desc.text) ? { scale: scaleOf.get(desc.text) } : {}) } : {}) };
          sceneSlots.push(slot); slots.push(slot); slotOf.set(slot.id, slot); entity = slot.id;
        }
        // A named place a description meant, held by another named place: a link for the place tree.
        if (ofPlaces && entity && isPlace(entity) && held && held.id !== entity) placeLinks.push({ child: entity, parent: held.id, scene: scene.id, confidence: Number(held.confidence.toFixed(3)), via: desc.text });
        if (ofPlaces && entity && slotOf.get(entity) && !slotOf.get(entity)!.in && held) slotOf.get(entity)!.in = held.id;
        const slot = entity ? slotOf.get(entity) : undefined;
        if (slot) { if (!slot.names.includes(desc.text)) slot.names.push(desc.text); for (const id of desc.sentences) if (!slot.sentences.includes(id)) slot.sentences.push(id); }
        if (entity && chart.entities.has(entity)) input.facts.link(desc.sentences, entity);
        meant.set(desc.key, { entity, answer: entity ?? value });
        tally(here, entity);
        const evidence = Object.keys(facts).filter((id) => facts[id].about.includes(`descriptions.${desc.key}`));
        references.push({ text: desc.text, type: desc.type, scene: scene.id, sentences: desc.sentences, entity, answer: value, confidence: Number(confidence.toFixed(3)), ...(unsure ? { unsure } : {}), ...(evidence.length ? { facts: evidence } : {}) });
      }
      const pick = (key: string, options: string[], avoid?: string): Pick => {
        const { value, confidence } = answer(key, avoid), sure = confidence >= ROLE_ACCEPT, desc = descs.find((entry) => entry.key === value);
        if (desc) { const settled = meant.get(desc.key)!; return { id: sure ? settled.entity : null, answer: settled.answer, confidence: Number(confidence.toFixed(3)), via: desc.text }; }
        return { id: options.includes(value) && !["unnamed", "time", "none"].includes(value) && sure ? value : null, answer: value, confidence: Number(confidence.toFixed(3)) };
      };
      for (const id of batch) {
        const kind = input.kinds[id]?.kind;
        if (kind !== "spoken" && kind !== "action") continue;
        const who = pick(`role:who:${id}`, kind === "spoken" ? line : acting);
        const reply = replies.find((entry) => entry.key === `role:who:${id}`);
        const matters = replies.find((entry) => entry.key === `role:matters:${id}`)?.value;
        const role: Role = { kind, who, ...(kind === "spoken" ? { to: pick(`role:to:${id}`, line, String(reply?.value ?? "")) } : { matters: Number(Number(matters ?? 1).toFixed(3)) }) };
        if (role.to?.id && role.to.id === role.who.id) role.to = { ...role.to, id: null };
        roles[id] = role; tally(here, role.who.id); tally(here, role.to?.id);
        const slot = role.who.id ? slotOf.get(role.who.id) : undefined;
        if (slot && !slot.sentences.includes(id)) slot.sentences.push(id);
      }
      // Habits: what each description meant here, and in whose lines.
      for (const desc of descs) {
        const entity = meant.get(desc.key)?.entity;
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
    previousPlaces = [...new Set(scene.sentences.flatMap((id) => input.named.get(id) ?? []).filter(isPlace))].slice(0, CAST_PLACES);
  }
  return { roles, references, slots, habits: [...habits.values()].sort((a, b) => b.count - a.count), placeLinks };
}
