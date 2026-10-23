import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionModel } from "../connectors/jev.js";
import type { EventSink } from "../events/types.js";
import { mergeEntities } from "../maintenance/fixes.js";
import type { Entity, OntEvent, Relation, Scene } from "../ontology/types.js";
import { checkMatches, type MatchCandidate } from "./entityMatch.js";
import {
  nominateStructuralCandidates,
  type DistinctRecord,
} from "./structuralMatch.js";

/**
 * The EM faculty (sector 04): entity matching as a standing pass,
 * not a cleanup chore.
 *
 *  - Per block: pairs touching entities the block introduced or
 *    changed (new x registry, new x new).
 *  - At chapter completion: the old x old sweep.
 *  - Nomination is STRUCTURAL and strict (see structuralMatch.ts);
 *    pairs already sharing a name form are excluded — alias-at-birth
 *    and form nomination own those.
 *  - Jev reviews ONE batch per pass (the entityMatch checklist);
 *    only CONFIDENT verdicts merge, through the audited maintenance
 *    path (mergeEntities). DISTINCT verdicts are remembered in
 *    <novelDir>/matching.json and skipped until their shared
 *    evidence grows materially. Everything else is reported, never
 *    silently acted on.
 */

export interface EmDistinctMemory {
  distinct: DistinctRecord[];
}

/** A fragment-at-birth decline: this form was considered against
 * this entity at birth and not attached. Suppresses only the birth
 * question; the pair stays eligible for EM / `novel match`. */
export interface FragmentDecline {
  form: string;
  entityId: string;
  ts: string;
}

export interface MatchMemory {
  distinct: DistinctRecord[];
  fragmentDeclines: FragmentDecline[];
}

export async function loadMatchMemory(novelDir: string): Promise<MatchMemory> {
  try {
    const parsed = JSON.parse(await readFile(join(novelDir, "matching.json"), "utf8")) as Partial<MatchMemory>;
    return {
      distinct: Array.isArray(parsed.distinct) ? parsed.distinct : [],
      fragmentDeclines: Array.isArray(parsed.fragmentDeclines) ? parsed.fragmentDeclines : [],
    };
  } catch {
    return { distinct: [], fragmentDeclines: [] };
  }
}

export async function saveMatchMemory(novelDir: string, memory: MatchMemory): Promise<void> {
  await mkdir(novelDir, { recursive: true });
  await writeFile(join(novelDir, "matching.json"), JSON.stringify(memory, null, 1) + "\n");
}

export async function loadDistinctMemory(novelDir: string): Promise<DistinctRecord[]> {
  return (await loadMatchMemory(novelDir)).distinct;
}

export async function saveDistinctMemory(novelDir: string, distinct: DistinctRecord[]): Promise<void> {
  const memory = await loadMatchMemory(novelDir);
  await saveMatchMemory(novelDir, { ...memory, distinct });
}

export interface EmGraphData {
  entities: Entity[];
  events: OntEvent[];
  scenes: Scene[];
  relations: Relation[];
}

export interface EmSummary {
  nominated: number;
  merged: { keepId: string; dropId: string; score: number }[];
  distinct: { aId: string; bId: string }[];
  uncertain: { aId: string; bId: string; score: number }[];
  rejected: number;
}

export async function runEntityMatching(input: {
  novelDir: string;
  decisions: DecisionModel;
  data: EmGraphData;
  /** Per-block pass: only pairs touching these ids. Omit for the chapter sweep. */
  touchedIds?: Set<string> | null;
  minScore?: number;
  /** Live-theater sink: a confident merge emits `entity.merged`
   * (the playground's join animation) and a remembered DISTINCT
   * verdict emits `entity.distinct`. Optional — CLI packets and
   * tests run silently without it. */
  events?: EventSink;
}): Promise<EmSummary> {
  const distinct = await loadDistinctMemory(input.novelDir);
  const structural = nominateStructuralCandidates(
    input.data.entities, input.data.events, input.data.scenes, input.data.relations,
    { touchedIds: input.touchedIds ?? null, distinct, minScore: input.minScore },
  );
  const summary: EmSummary = { nominated: structural.length, merged: [], distinct: [], uncertain: [], rejected: 0 };
  if (structural.length === 0) return summary;
  const byId = new Map(input.data.entities.map((e) => [e.id, e]));
  const candidates: MatchCandidate[] = structural.map((c) => ({
    aId: c.aId,
    bId: c.bId,
    kind: c.kind,
    aForms: byId.get(c.aId)?.names.map((n) => n.text) ?? [],
    bForms: byId.get(c.bId)?.names.map((n) => n.text) ?? [],
    reasons: c.reasons,
    codeScore: c.features.score,
  }));
  const verdicts = await checkMatches(input.decisions, candidates, input.data.entities, input.data.events);
  const featuresByPair = new Map(structural.map((c) => [[c.aId, c.bId].sort().join("|"), c.features]));
  let memoryDirty = false;
  // Verdicts are batched, merges apply sequentially: a later verdict
  // can name a record an earlier merge in this same pass dropped.
  // Resolve both endpoints through this pass's merge chain first;
  // a pair that resolves to one record has already been joined.
  const mergedInto = new Map<string, string>();
  const resolveKept = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (mergedInto.has(current) && !seen.has(current)) {
      seen.add(current);
      current = mergedInto.get(current)!;
    }
    return current;
  };
  for (const v of verdicts) {
    const f = featuresByPair.get([v.aId, v.bId].sort().join("|"))!;
    if (v.verdict === "confident") {
      const keepId = resolveKept(v.keepId);
      const dropId = resolveKept(v.dropId);
      if (keepId === dropId) continue;
      await mergeEntities(input.novelDir, keepId, dropId,
        `em-faculty: Jev same=${v.checklist.same.toFixed(2)}; ${v.reasons.join("; ")}`);
      mergedInto.set(dropId, keepId);
      summary.merged.push({ keepId, dropId, score: v.score });
      await input.events?.({ type: "entity.merged", keepId, dropId });
    } else if (v.verdict === "distinct") {
      summary.distinct.push({ aId: v.aId, bId: v.bId });
      await input.events?.({ type: "entity.distinct", aId: v.aId, bId: v.bId });
      const key = [v.aId, v.bId].sort();
      const existing = distinct.findIndex((d) => [d.a, d.b].sort().join("|") === key.join("|"));
      const record: DistinctRecord = {
        a: key[0], b: key[1],
        sharedScenes: f.sharedScenes, sharedNeighbors: f.sharedNeighbors,
        ts: new Date().toISOString(),
      };
      if (existing >= 0) distinct[existing] = record; else distinct.push(record);
      memoryDirty = true;
    } else if (v.verdict === "uncertain") {
      summary.uncertain.push({ aId: v.aId, bId: v.bId, score: v.score });
    } else {
      summary.rejected++;
    }
  }
  if (memoryDirty) await saveDistinctMemory(input.novelDir, distinct);
  return summary;
}
