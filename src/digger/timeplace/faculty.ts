import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { WorkModel } from "../../ground/connectors/llm.js";
import type { Entity, Relation } from "../../ground/ontology/types.js";
import type { ChangeProposal } from "../../solidifier/merge/changeset.js";
import type { Sentence } from "../intake/sectioning.js";
import { describeTime, detectTimeMentions, leadingDateCue, needsRoleCheck, quoteMasks, strongAdvanceCue, type TimeMention } from "./lexicon.js";
import { decideContinuation, decideRoles, heuristicRole, type RoleVerdict, type StoryState } from "./roles.js";
import { extractVocabulary, meterWork, newUsage, type MeteredWorkModel, type PlaceMention, type UsageMeter } from "./vocabulary.js";
import { meterDecisions } from "./cache.js";
import { statedContainment } from "./containment.js";
import { mostSpecific, treeViolation } from "../../ground/ontology/placeTree.js";
import { assemblePeriods, dateFor, isMicroJump, periodIdFor, type AnchoredMention, type PeriodSeed, type SceneTime, type StoryPeriod } from "./periods.js";

/**
 * Time-place faculty, phase 1 (2026-10-26).
 *
 * Granularity is the SCENE. Time and place words become entities that one or
 * more scenes belong to:
 *   1. vocabulary — programmatic detection, an LLM vocabulary pass, or both;
 *   2. roles — Jev decides whether each time word sets the scene's time,
 *      opens a flashback, returns from one, or is only mentioned;
 *   3. assembly — code builds periods (a time anchor until the next one),
 *      the flashback stack and an estimated story order;
 *   4. places — scenes are LOCATED_AT the specific places they happen in.
 * Phase 2 adds the place tree: a place written inside another named place in
 * the same sentence is proposed PART_OF it, and a generic place with a named
 * parent becomes a place scoped under it ("新宿区 › 车站前"); scenes are linked
 * to their most specific place. Places already stored get parents from the
 * place-tree sweep (placeTreeSweep.ts). Spatial relations beyond containment
 * and cross-volume time alignment are later phases. Output is a reviewable
 * ChangeSet; nothing here writes canon.
 */
export type VocabularyMode = "programmatic" | "llm" | "hybrid";

export interface SceneSource {
  id: string;
  chapterIndex: number;
  sentences: Sentence[];
  charactersPresent: string[];
  locationId: string | null;
}

export interface ScenePlace {
  sceneId: string;
  key: string;
  name: string;
  entityId: string | null;
  role: PlaceMention["role"];
  specific: boolean;
  sentenceId: string;
  source: PlaceMention["source"] | "scene";
  /** The place this one is stated to be inside, in the same sentence (phase 2). */
  parent?: { id: string; name: string; known: boolean; sentenceId: string; via: "adjacent" | "llm" };
  /** A generic place ("车站前") kept only as a place inside its stated named parent. */
  scoped?: boolean;
}

export interface TimePlaceResult {
  mode: VocabularyMode;
  usedJev: boolean;
  mentions: AnchoredMention[];
  periods: StoryPeriod[];
  /** Earlier periods whose story position changed (re-proposed with the new order). */
  reordered: StoryPeriod[];
  sceneTimes: SceneTime[];
  places: ScenePlace[];
  usage: UsageMeter;
  notes: string[];
  /** Each scene's opening sentence: the evidence that a scene with no time
   * word of its own continues a period (alongside the period's anchor). */
  sceneOpenings?: Record<string, string>;
}

export interface TimePlaceInput {
  scenes: SceneSource[];
  knownEntities: Entity[];
  mode: VocabularyMode;
  work?: WorkModel;
  decisions?: DecisionModel;
  /** Stop paid calls past these limits; remaining work falls back to rules. */
  budget?: { maxWorkCalls?: number; maxDecisionQuestions?: number };
  concurrency?: number;
  onScene?: (done: number, total: number) => void;
  /** Continue from earlier blocks or runs (stored periods). */
  seed?: PeriodSeed;
}

/** Merge rule and LLM mentions: one per span; the rule's normalised value wins. */
function mergeTimes(rule: TimeMention[], llm: TimeMention[]): TimeMention[] {
  const merged = [...rule];
  for (const mention of llm) {
    const overlap = merged.findIndex((kept) => kept.sentenceId === mention.sentenceId && kept.start < mention.end && mention.start < kept.end);
    if (overlap < 0) { merged.push(mention); continue; }
    const kept = merged[overlap];
    // A longer LLM span that covers the rule's match keeps the LLM wording
    // and the rule's normalised value ("十二月二十四日凌晨" ⊃ "十二月二十四日").
    if (mention.end - mention.start > kept.end - kept.start && mention.start <= kept.start && mention.end >= kept.end) merged[overlap] = { ...mention, value: kept.value, family: kept.family };
  }
  return merged.sort((first, second) => first.sentenceId.localeCompare(second.sentenceId) || first.start - second.start);
}

/** Place key: no spaces/dots, no leading demonstrative ("这座城市" = "城市"). */
const normalisePlace = (text: string) => text.replace(/[\s·・]/g, "").replace(/^(?:这个|那个|这座|那座|这家|那家|这所|那所|该|此)(?=..)/, "");

/** The story date as Jev sees it ("12-24 (christmas-eve)"); same text in full and seeded runs. */
const storyDateText = (date: StoryPeriod["date"], holiday?: string) => date?.month && date.day ? `${date.year ? `${date.year}-` : ""}${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}${holiday ? ` (${holiday})` : ""}` : null;

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await run(items[index], index); }
  }));
  return results;
}

export async function runTimePlace(raw: TimePlaceInput): Promise<TimePlaceResult> {
  const usage = newUsage();
  const input: TimePlaceInput = { ...raw, work: raw.work && meterWork(raw.work as MeteredWorkModel, usage), decisions: raw.decisions && meterDecisions(raw.decisions, usage) };
  const notes: string[] = [];
  const knownPlaces = input.knownEntities.filter((entity) => entity.kind === "Location");
  const placeForms = new Map<string, Entity>();
  for (const place of knownPlaces) for (const form of place.names) if (form.text.length >= 2) placeForms.set(normalisePlace(form.text), place);
  const workAllowed = () => input.mode !== "programmatic" && !!input.work && (input.budget?.maxWorkCalls === undefined || usage.workCalls < input.budget.maxWorkCalls);
  const jevAllowed = (questions: number) => !!input.decisions && (input.budget?.maxDecisionQuestions === undefined || usage.decisionQuestions + questions <= input.budget.maxDecisionQuestions);
  let budgetNoted = false;

  // 1. Vocabulary per scene (rule pass always runs: it is free and gives values).
  const perScene = await mapLimit(input.scenes, input.concurrency ?? 4, async (scene, index) => {
    const masks = quoteMasks(scene.sentences);
    const quoteOf = (sentenceId: string, start: number, end: number) => (masks.get(sentenceId) ?? []).slice(start, end).some(Boolean);
    const rule = input.mode === "llm" ? [] : detectTimeMentions(scene.sentences);
    const rulePlaces: PlaceMention[] = [];
    if (input.mode !== "llm") {
      for (const [index, sentence] of scene.sentences.entries()) for (const [form] of placeForms) {
        const start = sentence.text.indexOf(form);
        if (start >= 0) rulePlaces.push({ text: form, sentenceId: sentence.id, start, end: start + form.length, role: index < 3 && !quoteOf(sentence.id, start, start + form.length) ? "setting" : "mentioned", specific: true, inQuote: quoteOf(sentence.id, start, start + form.length), source: "lexicon" });
      }
    }
    let llmTimes: TimeMention[] = [], llmPlaces: PlaceMention[] = [];
    if (workAllowed()) {
      try {
        const vocabulary = await extractVocabulary({ model: input.work!, sentences: scene.sentences, knownPlaces: [...placeForms.keys()], hints: input.mode === "hybrid" ? [...new Set(rule.map((mention) => mention.text))] : [], quoteOf });
        llmTimes = vocabulary.times; llmPlaces = vocabulary.places;
        if (vocabulary.rejected) notes.push(`${scene.id}: ${vocabulary.rejected} vocabulary item(s) failed validation and were dropped.`);
      } catch { notes.push(`${scene.id}: vocabulary pass unavailable; rule detection only.`); }
    } else if (input.mode !== "programmatic" && input.work && !budgetNoted) { budgetNoted = true; notes.push("Work-model budget reached; remaining scenes used rule detection only."); }
    input.onScene?.(index + 1, input.scenes.length);
    const times = input.mode === "llm" ? llmTimes : mergeTimes(rule, llmTimes);
    // LLM places win on role; registry matches it missed are kept.
    const places = [...llmPlaces];
    for (const place of rulePlaces) if (!places.some((kept) => kept.sentenceId === place.sentenceId && kept.start < place.end && place.start < kept.end)) places.push(place);
    return { scene, times, places };
  });

  // 2. Roles, in reading order (each scene sees the story state so far).
  const mentions: AnchoredMention[] = [];
  const anchorsByScene = new Map<string, AnchoredMention[]>();
  const seededPresent = input.seed?.present ?? null;
  const lastDated = [...(input.seed?.periods ?? [])].sort((first, second) => first.narrativeIndex - second.narrativeIndex).reverse().find((period) => !period.flashback && period.date);
  let storyDate: StoryPeriod["date"] = lastDated?.date ?? null;
  const state: StoryState = {
    current: seededPresent ? { text: seededPresent.label, gloss: seededPresent.gloss } : null,
    flashback: input.seed?.flashback ? { text: input.seed.flashback.label } : null,
    date: lastDated ? storyDateText(storyDate, lastDated.anchor.value.holiday) : null,
  };
  for (const { scene, times } of perScene) {
    const indexOf = new Map(scene.sentences.map((sentence, index) => [sentence.id, index]));
    const located = times.map((mention) => ({ mention, sentenceIndexInScene: indexOf.get(mention.sentenceId) ?? 0 }));
    let verdicts = new Map<TimeMention, RoleVerdict>();
    // Programmatic first: unambiguous "it is now <time>" cues need no model.
    const beforeStoryDate = (mention: TimeMention) => {
      const date = dateFor(mention, { date: storyDate, partOfDay: undefined });
      return !!(date?.month && date.day && storyDate?.month && storyDate.day) && date!.month! * 100 + date!.day! < storyDate!.month! * 100 + storyDate!.day!;
    };
    for (const { mention, sentenceIndexInScene } of located) {
      const text = scene.sentences[sentenceIndexInScene]?.text ?? "";
      if (strongAdvanceCue(mention, text) || leadingDateCue(mention, text) && !beforeStoryDate(mention)) verdicts.set(mention, { role: "ADVANCE", flashback: 0, confidence: null, decidedBy: "rule" });
    }
    const checkable = located.filter(({ mention, sentenceIndexInScene }) => !verdicts.has(mention) && needsRoleCheck(mention, sentenceIndexInScene, scene.sentences[sentenceIndexInScene]?.text ?? ""));
    if (input.decisions && checkable.length && jevAllowed(checkable.length)) {
      try {
        const answers = await decideRoles({ decisions: input.decisions, mentions: checkable.map(({ mention }) => mention), sentences: scene.sentences, state });
        checkable.forEach(({ mention }, index) => verdicts.set(mention, answers[index]));
      } catch { notes.push(`${scene.id}: Jev role check unavailable; rule roles used.`); for (const { mention } of checkable) verdicts.delete(mention); }
    } else if (input.decisions && checkable.length && !budgetNoted) { budgetNoted = true; notes.push("Jev budget reached; remaining roles used rules."); }
    const anchored = located.map(({ mention, sentenceIndexInScene }) => ({
      ...mention, sceneId: scene.id, sentenceIndexInScene,
      verdict: verdicts.get(mention) ?? (input.decisions && !checkable.some((entry) => entry.mention === mention) ? { role: "REFERENCE" as const, flashback: 0, confidence: null, decidedBy: "default" as const } : heuristicRole(mention, sentenceIndexInScene)),
    }));
    mentions.push(...anchored);
    anchorsByScene.set(scene.id, anchored);
    for (const anchor of anchored) {
      if (anchor.verdict.role === "FLASHBACK") state.flashback = { text: anchor.text };
      else if (anchor.verdict.role === "RETURN") state.flashback = null;
      if ((anchor.verdict.role === "ADVANCE" || anchor.verdict.role === "RETURN") && !state.flashback && !isMicroJump(anchor)) {
        state.current = { text: anchor.text, gloss: describeTime(anchor) };
        const date = dateFor(anchor, { date: storyDate });
        if (date) storyDate = date;
        if (date) state.date = storyDateText(storyDate, anchor.value.holiday);
      }
    }
  }

  // 3. Periods; Jev settles whether a flashback continues past its scene.
  const byId = new Map(input.scenes.map((scene, index) => [scene.id, index]));
  const assembled = await assemblePeriods(
    input.scenes.map((scene) => ({ id: scene.id, chapterIndex: scene.chapterIndex, sentenceCount: scene.sentences.length })),
    anchorsByScene,
    input.decisions ? async (scene, flashback) => {
      if (!jevAllowed(1)) return { continues: false, probability: 0 };
      const index = byId.get(scene.id)!;
      try {
        return await decideContinuation({ decisions: input.decisions!, opening: input.scenes[index].sentences.slice(0, 4), previousTail: index > 0 ? input.scenes[index - 1].sentences.slice(-3) : [], flashbackText: flashback.label });
      } catch { notes.push(`${scene.id}: continuation check unavailable; the flashback ends at its scene.`); return { continues: false, probability: 0 }; }
    } : undefined,
    input.seed,
  );

  // 4. Places: specific settings resolve to known Location entities by name
  //    form. Stated containment gives a place its parent; a generic place is
  //    kept only under a stated named parent ("新宿区 › 车站前").
  const places: ScenePlace[] = [];
  const sentenceText = new Map(input.scenes.flatMap((scene) => scene.sentences.map((sentence) => [sentence.id, sentence.text] as const)));
  const resolved = (mention: PlaceMention) => {
    const key = normalisePlace(mention.text);
    const known = placeForms.get(key);
    return { key: known ? `entity:${known.id}` : `text:${key}`, name: known ? known.names.find((form) => form.kind === "canonical")?.text ?? mention.text : key, entityId: known?.id ?? null };
  };
  for (const { scene, places: found } of perScene) {
    const stated = new Map(statedContainment(found, (id) => sentenceText.get(id)).map((entry) => [entry.child, entry]));
    for (const raw of found) {
      // Speech rarely names where the scene itself is: a quoted place is a mention.
      if (raw.inQuote) continue;
      const own = resolved(raw);
      const ownId = own.entityId ?? placeIdFor(own.key);
      const containment = stated.get(raw);
      const parentOf = containment ? resolved(containment.parent) : null;
      const parent = parentOf && (parentOf.entityId ?? placeIdFor(parentOf.key)) !== ownId ? { id: parentOf.entityId ?? placeIdFor(parentOf.key), name: parentOf.name, known: !!parentOf.entityId, sentenceId: raw.sentenceId, via: containment!.via } : undefined;
      const specific = raw.specific || !!own.entityId;
      if (!specific && parent) {
        places.push({ sceneId: scene.id, key: `in:${parent.id}/${own.name}`, name: own.name, entityId: null, role: raw.role, specific: true, sentenceId: raw.sentenceId, source: raw.source, parent, scoped: true });
        continue;
      }
      places.push({ sceneId: scene.id, key: own.key, name: own.name, entityId: own.entityId, role: raw.role, specific, sentenceId: raw.sentenceId, source: raw.source, ...(parent && specific ? { parent } : {}) });
    }
    if (scene.locationId && !places.some((place) => place.sceneId === scene.id && place.entityId === scene.locationId)) {
      const known = input.knownEntities.find((entity) => entity.id === scene.locationId);
      if (known) places.push({ sceneId: scene.id, key: `entity:${known.id}`, name: known.names[0]?.text ?? known.id, entityId: known.id, role: "setting", specific: true, sentenceId: scene.sentences[0]?.id ?? "", source: "scene" });
    }
  }
  const sceneOpenings = Object.fromEntries(input.scenes.flatMap((scene) => scene.sentences[0] ? [[scene.id, scene.sentences[0].id]] : []));
  return { mode: input.mode, usedJev: !!input.decisions, mentions, periods: assembled.periods, reordered: assembled.reordered, sceneTimes: assembled.scenes, places, usage, notes, sceneOpenings };
}

const fnv = (text: string) => { let hash = 2166136261; for (const character of text) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0; return hash.toString(36); };
export const placeIdFor = (key: string) => `loc_tp_${fnv(key)}`;

/**
 * Proposals for a reviewable ChangeSet: TimePoint entities (one per period,
 * properties carry role, flashback probability, story order and derived
 * dates), OCCURS_DURING for every scene membership (anchor or inherited),
 * new Location entities for specific places not yet known, and LOCATED_AT
 * for scene settings. Relations already in the bundle are not re-proposed.
 */
export function timePlaceProposals(result: TimePlaceResult, existing: { entityIds: Set<string>; relationKeys: Set<string>; /** Stored periods' anchor sentences (periods from earlier runs). */ anchorSentences?: Map<string, string>; /** Stored place tree (child -> parent). */ parents?: Map<string, string> }, provenanceBlockId = "time-place"): ChangeProposal[] {
  const proposals: ChangeProposal[] = [];
  const relationKey = (relation: Pick<Relation, "fromId" | "toId" | "type">) => `${relation.type}:${relation.fromId}:${relation.toId}`;
  const addRelation = (relation: Relation, sentenceIds: string[]) => {
    const key = relationKey(relation);
    if (existing.relationKeys.has(key) || proposals.some((proposal) => proposal.kind === "add_relation" && relationKey(proposal.payload as Relation) === key)) return;
    proposals.push({ id: `tp_rel_${fnv(key)}`, kind: "add_relation", payload: relation, confidence: relation.confidence, provenance: { blockId: provenanceBlockId, sentenceIds, patchId: "time-place" } } as ChangeProposal);
  };
  for (const period of [...result.periods, ...result.reordered]) {
    const anchor = period.anchor;
    const entity: Entity = {
      id: period.id, kind: "TimePoint", names: [{ text: anchor.text, lang: /[぀-ヿ]/.test(anchor.text) ? "ja" : /[一-鿿]/.test(anchor.text) ? "zh" : "en", kind: "canonical" }],
      properties: {
        expression: anchor.text, family: anchor.family, value: anchor.value, gloss: period.gloss, role: period.role,
        flashback: period.flashback, flashbackProbability: Number(period.flashbackProbability.toFixed(3)), decidedBy: anchor.verdict.decidedBy,
        ...(anchor.verdict.confidence !== null ? { confidence: anchor.verdict.confidence } : {}),
        toldFromId: period.toldFromId, date: period.date, ...(period.partOfDay ? { partOfDay: period.partOfDay } : {}),
        sentenceId: anchor.sentenceId, sceneId: anchor.sceneId, chapterIndex: period.chapterIndex,
        narrativeIndex: period.narrativeIndex, storyIndex: period.storyIndex, source: anchor.source,
      },
      confidence: anchor.verdict.confidence ?? 0.7,
    };
    proposals.push({ id: `tp_ent_${period.id}`, kind: "upsert_entity", payload: entity, confidence: entity.confidence, provenance: { blockId: provenanceBlockId, sentenceIds: [anchor.sentenceId], patchId: "time-place" } } as ChangeProposal);
  }
  const periodById = new Map([...result.periods, ...result.reordered].map((period) => [period.id, period]));
  // An inherited membership cites the period's time word and the scene's opening.
  const inheritedEvidence = (sceneId: string, anchorSentenceId: string | undefined) => [...new Set([anchorSentenceId, result.sceneOpenings?.[sceneId]].filter((id): id is string => !!id))];
  for (const scene of result.sceneTimes) for (const periodId of scene.periodIds) {
    const period = periodById.get(periodId);
    if (!period) {
      // Continues a period from an earlier block or run.
      addRelation({ fromId: scene.sceneId, toId: periodId, type: "OCCURS_DURING", properties: { via: "inherited" }, confidence: 0.6 }, inheritedEvidence(scene.sceneId, existing.anchorSentences?.get(periodId)));
      continue;
    }
    const via = period.anchor.sceneId === scene.sceneId ? "anchor" : "inherited";
    addRelation({ fromId: scene.sceneId, toId: periodId, type: "OCCURS_DURING", properties: { via, flashback: period.flashback }, confidence: via === "anchor" ? period.anchor.verdict.confidence ?? 0.7 : 0.6 }, via === "anchor" ? [period.anchor.sentenceId] : inheritedEvidence(scene.sceneId, period.anchor.sentenceId));
  }
  const minted = new Set<string>();
  const mintPlace = (id: string, name: string, sentenceId: string, sceneId: string, extra: Record<string, unknown> = {}) => {
    if (existing.entityIds.has(id) || minted.has(id)) return;
    minted.add(id);
    const entity: Entity = { id, kind: "Location", names: [{ text: name, lang: /[一-鿿]/.test(name) ? "zh" : "en", kind: "canonical" }], properties: { source: "time-place", firstSceneId: sceneId, ...extra }, confidence: 0.7 };
    proposals.push({ id: `tp_ent_${id}`, kind: "upsert_entity", payload: entity, confidence: 0.7, provenance: { blockId: provenanceBlockId, sentenceIds: [sentenceId], patchId: "time-place" } } as ChangeProposal);
  };
  const idOf = (place: ScenePlace) => place.entityId ?? placeIdFor(place.key);
  const scopedProperties = (place: ScenePlace) => place.scoped && place.parent ? { generic: true, scopedTo: place.parent.id } : {};
  // Containment first (one parent per place, no loops), so each scene can be
  // linked to its most specific place below.
  const parents = new Map(existing.parents ?? []);
  for (const place of result.places) {
    if (!place.parent || !place.specific || !(place.entityId || place.role === "setting")) continue;
    const id = idOf(place);
    if (parents.has(id) || treeViolation([...parents].map(([fromId, toId]) => ({ fromId, toId, type: "PART_OF" as const })), [{ fromId: id, toId: place.parent.id, type: "PART_OF" }])) continue;
    parents.set(id, place.parent.id);
    if (!place.entityId) mintPlace(id, place.name, place.sentenceId, place.sceneId, scopedProperties(place));
    if (!place.parent.known) mintPlace(place.parent.id, place.parent.name, place.parent.sentenceId, place.sceneId);
    addRelation({ fromId: id, toId: place.parent.id, type: "PART_OF", properties: { via: "stated", source: place.parent.via }, confidence: place.parent.via === "adjacent" ? 0.8 : 0.7 }, [place.sentenceId]);
  }
  const settings = new Map<string, ScenePlace[]>();
  for (const place of result.places) if (place.specific && place.role === "setting") settings.set(place.sceneId, [...(settings.get(place.sceneId) ?? []), place]);
  for (const list of settings.values()) {
    const deepest = new Set(mostSpecific(list.map(idOf), parents));
    for (const place of list) {
      const id = idOf(place);
      if (!deepest.has(id)) continue;
      if (!place.entityId) mintPlace(id, place.name, place.sentenceId, place.sceneId, scopedProperties(place));
      addRelation({ fromId: place.sceneId, toId: id, type: "LOCATED_AT", properties: { role: "setting", via: place.source }, confidence: 0.7 }, place.sentenceId ? [place.sentenceId] : []);
    }
  }
  return proposals;
}

export { periodIdFor };
