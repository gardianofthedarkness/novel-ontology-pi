import { stat } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { EventLog } from "../../../ground/events/log.js";
import { observeDecisions } from "../../../ground/events/observe.js";
import { resolveJevKey } from "../../../ground/connectors/secrets.js";
import { loadChangeSet } from "../../../solidifier/merge/changesetStore.js";
import {
  checkMatches,
  nominateMatchCandidates,
  type MatchCandidate,
  type MatchVerdict,
} from "../../../solidifier/matching/entityMatch.js";
import { nominateStructuralCandidates } from "../../../solidifier/matching/structuralMatch.js";
import { loadDistinctMemory, saveDistinctMemory } from "../../../solidifier/matching/emFaculty.js";
import type { Entity, OntEvent, Relation, Scene } from "../../../ground/ontology/types.js";

export interface MatchPacket {
  status: "ok";
  novelDir: string;
  scope: string;
  candidates: number;
  confident: (MatchVerdict & { suggestedFix: string })[];
  uncertain: (MatchVerdict & { suggestedFix: string })[];
  rejected: MatchVerdict[];
  distinct: MatchVerdict[];
}

/**
 * `novel match <novel-dir> [--changeset <id>]` — the entity-matching
 * review packet for the merge gate: code nominates duplicate pairs,
 * System 1 (Jev) reviews the batch with its checklist, and only the
 * pairs it cannot settle are raised to the main agent.
 */
export async function runMatch(
  novelDir: string,
  opts: { changesetId?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<MatchPacket> {
  const env = opts.env ?? process.env;
  const ontologyDir = join(novelDir, "ontology");
  try {
    await stat(join(ontologyDir, "manifest.json"));
  } catch {
    throw new Error(
      `No novel workspace manifest at ${join(ontologyDir, "manifest.json")}. Run \`novel init ${novelDir}\` first.`,
    );
  }
  if (!resolveJevKey(env)?.key) {
    throw new Error(
      "Jev API key missing — the matching checklist is a System 1 review and needs it. Run `novel jev login`, set TYPESAFE_API_KEY, or set JEV_API_KEY_ENV to the name of an env var that holds it.",
    );
  }

  const bundle = new BundleStore(ontologyDir);
  const rows = await bundle.loadFile<Entity>("entities.jsonl");
  const byId = new Map<string, Entity>();
  for (const e of rows) byId.set(e.id, e);
  let scope = "workspace";
  if (opts.changesetId) {
    scope = `changeset ${opts.changesetId}`;
    const cs = await loadChangeSet(novelDir, opts.changesetId);
    if (!cs) throw new Error(`No changeset ${opts.changesetId} in ${novelDir}.`);
    // At review time the changeset's entities may not be merged yet:
    // they join the matching universe as proposed records.
    for (const p of cs.status === "approved" ? [] : cs.proposals) {
      if (p.kind !== "upsert_entity") continue;
      const payload = p.payload as Partial<Entity>;
      if (payload.id && payload.names && !byId.has(payload.id)) {
        byId.set(payload.id, payload as Entity);
      }
    }
  }
  const entities = [...byId.values()];
  const events = await bundle.loadFile<OntEvent>("events.jsonl");
  const scenes = await bundle.loadFile<Scene>("scenes.jsonl");
  const relations = await bundle.loadFile<Relation>("relations.jsonl");

  let candidates = nominateMatchCandidates(entities);
  // Structural nomination joins the pool (EM faculty): pairs sharing
  // no name form at all — cross-script twins, descriptive records.
  // Pairs already form-nominated are not duplicated.
  const formPairs = new Set(candidates.map((c) => [c.aId, c.bId].sort().join("|")));
  const remembered = await loadDistinctMemory(novelDir);
  const structural = nominateStructuralCandidates(entities, events, scenes, relations, { distinct: remembered });
  const structuralFeatures = new Map<string, (typeof structural)[number]["features"]>();
  for (const c of structural) {
    const key = [c.aId, c.bId].sort().join("|");
    if (formPairs.has(key)) continue;
    structuralFeatures.set(key, c.features);
    candidates.push({
      aId: c.aId, bId: c.bId, kind: c.kind,
      aForms: byId.get(c.aId)?.names.map((n) => n.text) ?? [],
      bForms: byId.get(c.bId)?.names.map((n) => n.text) ?? [],
      reasons: c.reasons, codeScore: c.features.score,
    } satisfies MatchCandidate);
  }
  if (opts.changesetId) {
    const cs = await loadChangeSet(novelDir, opts.changesetId);
    const proposedIds = new Set(
      (cs?.proposals ?? [])
        .filter((p) => p.kind === "upsert_entity")
        .map((p) => (p.payload as Partial<Entity>).id)
        .filter(Boolean),
    );
    candidates = candidates.filter(
      (c) => proposedIds.has(c.aId) || proposedIds.has(c.bId),
    );
  }

  const verdicts = await checkMatches(observeDecisions(jevFromEnv(env), new EventLog(novelDir).emit), candidates, entities, events);
  // Remember structural DISTINCT verdicts so the EM faculty and
  // future sweeps skip the pair until its evidence grows.
  const distinctVerdicts = verdicts.filter((v) => v.verdict === "distinct");
  const newRecords = distinctVerdicts.flatMap((v) => {
    const key = [v.aId, v.bId].sort().join("|");
    const f = structuralFeatures.get(key);
    if (!f) return [];
    const [a, b] = key.split("|");
    return [{ a, b, sharedScenes: f.sharedScenes, sharedNeighbors: f.sharedNeighbors, ts: new Date().toISOString() }];
  });
  if (newRecords.length) {
    const merged = [...remembered];
    for (const r of newRecords) {
      const i = merged.findIndex((d) => [d.a, d.b].sort().join("|") === [r.a, r.b].sort().join("|"));
      if (i >= 0) merged[i] = r; else merged.push(r);
    }
    await saveDistinctMemory(novelDir, merged);
  }
  const withFix = (v: MatchVerdict) => ({
    ...v,
    suggestedFix: `novel fix merge ${novelDir} ${v.keepId} ${v.dropId}`,
  });
  return {
    status: "ok",
    novelDir,
    scope,
    candidates: verdicts.length,
    confident: verdicts.filter((v) => v.verdict === "confident").map(withFix),
    uncertain: verdicts.filter((v) => v.verdict === "uncertain").map(withFix),
    rejected: verdicts.filter((v) => v.verdict === "rejected"),
    distinct: verdicts.filter((v) => v.verdict === "distinct"),
  };
}
