/**
 * Causality search units and the novel-sequence timeline.
 *
 * Events and dialogue cards are UNIFORM search units: a spoken line can cause
 * an event, an event can cause a line, and two lines can stand in a causal
 * relation, exactly as two events can. Each unit carries the fields the
 * candidate generator and the Jev checklist need: search text, actors,
 * location, and a position on the novel sequence.
 *
 * Timeline (ratified): the novel sequence IS the timeline for now — chapter
 * order, scene order, and `chronologicalOrder` within it. A universe timeline
 * faculty arrives in a later PR and upgrades this ordering; it is NOT built
 * here. Cause must precede effect on this sequence. `compareOrder` returns
 * null when the sequence cannot order a pair; the Jev checklist then decides
 * (the pair is flagged order-ambiguous in its dossier) instead of the code
 * guessing a direction.
 */

import { join } from "node:path";
import type { OntEvent, Relation, Scene, StateChange, Entity } from "../../ground/ontology/types.js";
import { loadStrandView, type StrandView } from "../../digger/timeplace/strandView.js";
import { BundleStore } from "../../ground/connectors/bundle.js";

export type CausalUnitKind = "event" | "dialogue";

export interface CausalUnit {
  origin?: { sourceId: string; title: string; continuityId: string; seriesId: string | null; readingOrder: number | null };
  id: string;
  kind: CausalUnitKind;
  /** Owning scene id (dialogue cards) or null (events resolve via evidence). */
  sceneId: string | null;
  chapterIndex: number;
  /** Search text: event summary + evidence quote; dialogue summary + spoken lines. */
  text: string;
  summary: string;
  /** Actors (events) or participants (dialogue cards), as entity ids. */
  actors: string[];
  locationId: string | null;
  sentenceIds: string[];
  /** Position inside its scene for same-scene ordering, or null. */
  scenePosition: number | null;
}

export interface CausalityUniverse {
  /**
   * Story strands (time, place and who is present): which scene happens
   * before which. A cause comes first; scenes in parallel strands are not
   * ordered. Preferred over `storyIndex`, which only orders scenes in
   * different story periods.
   */
  strands?: StrandView | null;
  storyIndex?: Map<string, number>;
  units: CausalUnit[];
  byId: Map<string, CausalUnit>;
  scenes: Scene[];
  events: OntEvent[];
  relations: Relation[];
  stateChanges: StateChange[];
  /** Scene id -> index within its chapter (novel-sequence scene order). */
  sceneIndexInChapter: Map<string, number>;
  /** Scene id -> the events whose evidence sentences fall inside the scene. */
  sceneEvents: Map<string, OntEvent[]>;
  /** Event id -> owning scene id, when evidence sentences fall inside one scene. */
  eventScene: Map<string, string>;
}

export interface UniverseExtras {
  events?: OntEvent[];
  scenes?: Scene[];
  stateChanges?: StateChange[];
  /** Sentence id -> text, for enriching dialogue search text on per-block passes. */
  sentenceTexts?: Map<string, string>;
  /** Entity id -> canonical name, for enriching dialogue search text. */
  entityNames?: Map<string, string>;
}

function sentenceIndexOf(sentenceIds: string[], sentenceId: string): number {
  return sentenceIds.indexOf(sentenceId);
}

const currentRecords = <Record extends { id: string }>(records: Record[]): Record[] => [...new Map(records.map(record => [record.id, record])).values()];

/** Build a uniform unit list from canon bundle data plus proposed extras. */
export async function loadCausalityUniverse(
  novelDir: string,
  extras: UniverseExtras = {},
): Promise<CausalityUniverse> {
  const bundle = new BundleStore(join(novelDir, "ontology"));
  const canonEvents = currentRecords(await bundle.loadFile<OntEvent>("events.jsonl"));
  const canonScenes = currentRecords(await bundle.loadFile<Scene>("scenes.jsonl"));
  const canonRelations = await bundle.loadFile<Relation>("relations.jsonl");
  const canonStateChanges = currentRecords(await bundle.loadFile<StateChange>("state-changes.jsonl"));
  const entities = currentRecords(await bundle.loadFile<Entity>("entities.jsonl"));
  const timePoints = new Map(entities.filter(entity => entity.kind === "TimePoint" && typeof entity.properties.storyIndex === "number" && Number.isFinite(entity.properties.storyIndex)).map(entity => [entity.id, Number(entity.properties.storyIndex)]));
  const sceneTimes = new Map<string, Set<number>>();
  for (const relation of canonRelations) {
    if (relation.type !== "OCCURS_DURING" || !timePoints.has(relation.toId)) continue;
    const values = sceneTimes.get(relation.fromId) ?? new Set<number>();
    values.add(timePoints.get(relation.toId)!);
    sceneTimes.set(relation.fromId, values);
  }
  const storyIndex = new Map([...sceneTimes].filter(([, values]) => values.size === 1).map(([id, values]) => [id, [...values][0]]));

  const events = [...canonEvents];
  for (const event of extras.events ?? []) if (!events.some((e) => e.id === event.id)) events.push(event);
  const scenes = [...canonScenes];
  for (const scene of extras.scenes ?? []) if (!scenes.some((s) => s.id === scene.id)) scenes.push(scene);
  const stateChanges = [...canonStateChanges];
  for (const change of extras.stateChanges ?? []) if (!stateChanges.some((c) => c.id === change.id)) stateChanges.push(change);

  const entityNames = new Map<string, string>(extras.entityNames ?? []);
  for (const entity of entities) {
    if (!entityNames.has(entity.id)) {
      entityNames.set(entity.id, entity.names.find((name) => name.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id);
    }
  }

  const sceneIndexInChapter = new Map<string, number>();
  const scenesByChapter = new Map<number, Scene[]>();
  for (const scene of scenes) {
    const list = scenesByChapter.get(scene.chapterIndex) ?? [];
    list.push(scene);
    scenesByChapter.set(scene.chapterIndex, list);
  }
  for (const list of scenesByChapter.values()) {
    list.forEach((scene, index) => sceneIndexInChapter.set(scene.id, index));
  }

  const sceneEvents = new Map<string, OntEvent[]>();
  const eventScene = new Map<string, string>();
  for (const scene of scenes) {
    const sentenceSet = new Set(scene.sentenceIds);
    const members = events.filter(
      (event) => event.chapterIndex === scene.chapterIndex && event.evidence.sentenceIds.some((id) => sentenceSet.has(id)),
    );
    sceneEvents.set(scene.id, members);
    for (const event of members) if (!eventScene.has(event.id)) eventScene.set(event.id, scene.id);
  }

  const units: CausalUnit[] = [];
  for (const event of events) {
    const sceneId = eventScene.get(event.id) ?? null;
    const scene = sceneId ? scenes.find((s) => s.id === sceneId) : undefined;
    const scenePosition = scene && event.evidence.sentenceIds.length
      ? scene.sentenceIds.findIndex((id) => event.evidence.sentenceIds.includes(id))
      : null;
    units.push({
      id: event.id,
      kind: "event",
      sceneId,
      chapterIndex: event.chapterIndex,
      text: [event.summaryEn, event.evidence.text].filter(Boolean).join(" "),
      summary: event.summaryEn,
      actors: [...(event.primaryActors ?? []), ...(event.affectedCharacters ?? [])],
      locationId: scene?.locationId ?? null,
      sentenceIds: event.evidence.sentenceIds,
      scenePosition: scenePosition !== null && scenePosition >= 0 ? scenePosition : null,
    });
  }
  for (const scene of scenes) {
    for (const card of scene.dialogues ?? []) {
      const spoken = (extras.sentenceTexts
        ? card.sentenceIds.map((id) => extras.sentenceTexts!.get(id)).filter((t): t is string => !!t)
        : []);
      const participantNames = card.participantIds.map((id) => entityNames.get(id) ?? id);
      units.push({
        id: card.id,
        kind: "dialogue",
        sceneId: scene.id,
        chapterIndex: scene.chapterIndex,
        text: [card.summary ?? "", ...spoken, participantNames.length ? `Participants: ${participantNames.join(", ")}` : ""]
          .filter(Boolean)
          .join(" "),
        summary: card.summary ?? "",
        actors: [...card.participantIds],
        locationId: scene.locationId,
        sentenceIds: card.sentenceIds,
        scenePosition: (() => {
          if (!card.sentenceIds.length) return null;
          const position = scene.sentenceIds.findIndex((id) => card.sentenceIds.includes(id));
          return position >= 0 ? position : null;
        })(),
      });
    }
  }

  const byId = new Map<string, CausalUnit>();
  for (const unit of units) {
    const previous = byId.get(unit.id);
    if (previous && previous.kind !== unit.kind) throw new Error("Causal event/dialogue ID collision inside one book.");
    byId.set(unit.id, previous ? { ...unit, sentenceIds: [...new Set([...previous.sentenceIds, ...unit.sentenceIds])], actors: [...new Set([...previous.actors, ...unit.actors])],
      text: [...new Set([previous.text, unit.text])].join("\n"), summary: [...new Set([previous.summary, unit.summary])].filter(Boolean).join("\n"),
      sceneId: previous.sceneId === unit.sceneId ? unit.sceneId : null, scenePosition: previous.sceneId === unit.sceneId ? previous.scenePosition : null } : unit);
  }
  return {
    strands: await loadStrandView(novelDir).catch(() => null),
    storyIndex,
    units: [...byId.values()],
    byId,
    scenes,
    events,
    relations: canonRelations,
    stateChanges,
    sceneIndexInChapter,
    sceneEvents,
    eventScene,
  };
}

/** Two units in different scenes that run in parallel strands: story time orders neither before the other. */
export function inParallelStrands(a: CausalUnit, b: CausalUnit, universe: CausalityUniverse): boolean {
  const strands = universe.strands;
  return !!strands && !!a.sceneId && !!b.sceneId && a.sceneId !== b.sceneId && strands.has(a.sceneId) && strands.has(b.sceneId)
    && !strands.before(a.sceneId, b.sceneId) && !strands.before(b.sceneId, a.sceneId);
}

/** The order the book tells them in (reading order), ignoring story time. */
export function tellingOrder(a: CausalUnit, b: CausalUnit, universe: CausalityUniverse): -1 | 1 | null {
  return compareOrder(a, b, { ...universe, strands: null, storyIndex: undefined });
}

/**
 * Story order: -1 when a precedes b, 1 when a follows b, null when nothing
 * orders the pair. With strands, scenes are ordered by story time (null for
 * scenes in parallel strands); without, by story period, then by the novel
 * sequence (cross-scene event vs dialogue in the same chapter with no shared
 * scene anchor, or same-scene ties, stay null).
 */
export function compareOrder(a: CausalUnit, b: CausalUnit, universe: CausalityUniverse): -1 | 1 | null {
  if (a.id === b.id) return null;
  if (a.origin && b.origin && a.origin.sourceId !== b.origin.sourceId) return null;
  // Strands order whole scenes: by the same person's continuity, flashbacks and stated times.
  if (universe.strands && a.sceneId && b.sceneId && a.sceneId !== b.sceneId && universe.strands.has(a.sceneId) && universe.strands.has(b.sceneId)) {
    if (universe.strands.before(a.sceneId, b.sceneId)) return -1;
    if (universe.strands.before(b.sceneId, a.sceneId)) return 1;
    return null;
  }
  if (universe.storyIndex?.size && a.sceneId !== b.sceneId) {
    const first = a.sceneId ? universe.storyIndex.get(a.sceneId) : undefined;
    const second = b.sceneId ? universe.storyIndex.get(b.sceneId) : undefined;
    if (first === undefined || second === undefined || first === second) return null;
    return first < second ? -1 : 1;
  }
  if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex < b.chapterIndex ? -1 : 1;
  if (a.sceneId && b.sceneId && a.sceneId === b.sceneId) {
    if (a.scenePosition !== null && b.scenePosition !== null && a.scenePosition !== b.scenePosition) {
      return a.scenePosition < b.scenePosition ? -1 : 1;
    }
    // Same scene, no sentence anchor: fall back to event chrono when both are events.
    if (a.kind === "event" && b.kind === "event") {
      const ea = universe.events.find((e) => e.id === a.id);
      const eb = universe.events.find((e) => e.id === b.id);
      if (ea && eb && ea.chronologicalOrder !== eb.chronologicalOrder) {
        return ea.chronologicalOrder < eb.chronologicalOrder ? -1 : 1;
      }
    }
    return null;
  }
  const aSceneIndex = a.sceneId ? universe.sceneIndexInChapter.get(a.sceneId) : undefined;
  const bSceneIndex = b.sceneId ? universe.sceneIndexInChapter.get(b.sceneId) : undefined;
  if (aSceneIndex !== undefined && bSceneIndex !== undefined && aSceneIndex !== bSceneIndex) {
    return aSceneIndex < bSceneIndex ? -1 : 1;
  }
  // One side unanchored to a scene: compare against the other side's scene
  // event range when both are events.
  if (a.kind === "event" && b.kind === "event") {
    const ea = universe.events.find((e) => e.id === a.id);
    const eb = universe.events.find((e) => e.id === b.id);
    if (ea && eb && ea.chronologicalOrder !== eb.chronologicalOrder) {
      return ea.chronologicalOrder < eb.chronologicalOrder ? -1 : 1;
    }
  }
  return null;
}

/** True when the pair is already linked by a CAUSES relation in either direction. */
export function alreadyLinked(universe: CausalityUniverse, fromId: string, toId: string): boolean {
  return universe.relations.some(
    (relation) =>
      ["CAUSES", "CAUSED_BY"].includes(relation.type) &&
      ((relation.fromId === fromId && relation.toId === toId) || (relation.fromId === toId && relation.toId === fromId)),
  );
}

/** Human-readable dossier line for one unit, for the Jev checklist packet. */
export function unitDossier(unit: CausalUnit): string {
  const kind = unit.kind === "dialogue" ? "Dialogue card" : "Event";
  const scene = unit.sceneId ? ` (scene ${unit.sceneId})` : "";
  const origin = unit.origin ? ` [${unit.origin.title}; continuity ${unit.origin.continuityId}; reading order ${unit.origin.readingOrder ?? "unknown"} is NOT an actual-time assertion]` : "";
  return `${kind} ${unit.id}${scene}${origin}: ${unit.text || unit.summary || "(no text)"}`;
}
