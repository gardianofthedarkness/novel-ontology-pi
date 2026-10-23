import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionModel } from "../connectors/jev.js";
import { BundleStore } from "../connectors/bundle.js";
import { mergeEntities } from "../maintenance/fixes.js";
import type { ChangeSet } from "../merge/changeset.js";
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
  /** Canon changed (a block applied) since the last chapter sweep;
   * the sweep consumes and clears this. Lets the cadence survive
   * gate mode, where applies happen outside the ingest run. */
  sweepPending?: boolean;
}

export async function loadMatchMemory(novelDir: string): Promise<MatchMemory> {
  try {
    const parsed = JSON.parse(await readFile(join(novelDir, "matching.json"), "utf8")) as Partial<MatchMemory>;
    return {
      distinct: Array.isArray(parsed.distinct) ? parsed.distinct : [],
      fragmentDeclines: Array.isArray(parsed.fragmentDeclines) ? parsed.fragmentDeclines : [],
      sweepPending: parsed.sweepPending === true,
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
  for (const v of verdicts) {
    const f = featuresByPair.get([v.aId, v.bId].sort().join("|"))!;
    if (v.verdict === "confident") {
      await mergeEntities(input.novelDir, v.keepId, v.dropId,
        `em-faculty: Jev same=${v.checklist.same.toFixed(2)}; ${v.reasons.join("; ")}`);
      summary.merged.push({ keepId: v.keepId, dropId: v.dropId, score: v.score });
    } else if (v.verdict === "distinct") {
      summary.distinct.push({ aId: v.aId, bId: v.bId });
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

/**
 * The per-block EM pass, homed on the APPLY rather than on any one
 * caller: BlockProcessor runs it when a changeset is approved
 * in-process, and `novel changeset approve` runs it when the gate
 * applies a changeset externally (the default semantic-gate flow —
 * without this port the cadence silently never fires in gate mode).
 * Advisory by contract: any failure returns null and leaves the
 * applied block untouched; the chapter sweep or `novel match`
 * retries. A successful call also marks the chapter sweep pending,
 * since canon identity evidence changed.
 */
export async function runEmPassAfterApply(input: {
  novelDir: string;
  decisions: DecisionModel;
  changeset: ChangeSet;
}): Promise<EmSummary | null> {
  try {
    const memory = await loadMatchMemory(input.novelDir);
    if (!memory.sweepPending && input.changeset.proposals.length > 0) {
      await saveMatchMemory(input.novelDir, { ...memory, sweepPending: true });
    }
    const touchedIds = new Set(
      input.changeset.proposals
        .filter((p) => p.kind === "upsert_entity")
        .map((p) => (p.payload as Entity).id),
    );
    if (touchedIds.size === 0) return null;
    const bundle = new BundleStore(join(input.novelDir, "ontology"));
    const rows = await bundle.loadFile<Entity>("entities.jsonl");
    const byId = new Map<string, Entity>();
    for (const e of rows) byId.set(e.id, e);
    return await runEntityMatching({
      novelDir: input.novelDir,
      decisions: input.decisions,
      touchedIds,
      data: {
        entities: [...byId.values()],
        events: await bundle.loadFile<OntEvent>("events.jsonl"),
        scenes: await bundle.loadFile<Scene>("scenes.jsonl"),
        relations: await bundle.loadFile<Relation>("relations.jsonl"),
      },
    });
  } catch {
    return null;
  }
}
