import { parentMap } from "../../ground/ontology/placeTree.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { WorkModel } from "../../ground/connectors/llm.js";
import type { Entity, Relation, Scene } from "../../ground/ontology/types.js";
import type { ChangeProposal, ChangeSet } from "../../solidifier/merge/changeset.js";
import type { Sentence } from "../intake/sectioning.js";
import { periodFromEntity, seedFrom } from "./periods.js";
import { runTimePlace, timePlaceProposals, type TimePlaceResult, type VocabularyMode } from "./faculty.js";

/**
 * Time-place for newly applied scenes (at birth, after a block's merge, and
 * for incremental `novel timeplace run`): continue from the book's stored
 * periods, run the faculty on scenes without time facts, and return a
 * reviewable ChangeSet. Nothing is applied here.
 */
const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];
const order = (id: string) => { const match = /^b(\d+)_s(\d+)$/.exec(id); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };

export interface TimePlaceRunOutput { changeset: ChangeSet | null; result: TimePlaceResult; scenes: number }

/** Scenes a proposing time-place run already covered (`<dir>/timeplace/attempted.json`). A scene
 * whose facts were held, or that states no time, stays without a period; incremental runs skip it
 * (no paid re-asking) and the analysis checklist does not count it as missing. --force redoes all. */
const attemptedPath = (novelDir: string) => join(novelDir, "timeplace", "attempted.json");
export async function timePlaceAttempted(novelDir: string): Promise<Set<string>> {
  try { return new Set((JSON.parse(await readFile(attemptedPath(novelDir), "utf8")) as { sceneIds: string[] }).sceneIds); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
}
export async function rememberTimePlaceAttempt(novelDir: string, sceneIds: string[]): Promise<void> {
  if (!sceneIds.length) return;
  const known = await timePlaceAttempted(novelDir);
  await mkdir(join(novelDir, "timeplace"), { recursive: true, mode: 0o700 });
  await writeFile(attemptedPath(novelDir), JSON.stringify({ sceneIds: [...new Set([...known, ...sceneIds])] }), { mode: 0o600 });
}

/**
 * The original sentences a time-place packet's proposals cite, in reading
 * order. Carried in the packet (`reviewSource`) so the shared semantic gate
 * can show each period, place and relation with its evidence — the same
 * contract as block packets; no faculty-specific approval path.
 */
export function timePlaceReviewSource(proposals: ChangeProposal[], sentences: Map<string, Sentence>): Sentence[] {
  const wanted = new Set(proposals.flatMap((proposal) => proposal.provenance.sentenceIds));
  const found = [...sentences.values()].filter((sentence) => wanted.has(sentence.id));
  if (found.length !== wanted.size) throw new Error("Time-place proposal cites sentences missing from the stored source.");
  return found;
}

export async function timePlaceForNewScenes(input: {
  novelDir: string;
  sentences: Map<string, Sentence>;
  mode: VocabularyMode;
  work?: WorkModel;
  decisions?: DecisionModel;
  /** Limit to these scenes (default: every scene without time facts). */
  sceneIds?: string[];
  provenanceBlockId: string;
  budget?: { maxWorkCalls?: number; maxDecisionQuestions?: number };
  /** Carry the cited sentences for the shared semantic gate (default). Off only
   * for hosts still on legacy direct approval. */
  reviewSource?: boolean;
  /** Record the processed scenes as attempted (runs whose packet is kept). */
  remember?: boolean;
}): Promise<TimePlaceRunOutput> {
  const bundle = new BundleStore(join(input.novelDir, "ontology"));
  const scenes = fold(await bundle.loadFile<Scene>("scenes.jsonl")).sort((first, second) => order(first.sentenceIds[0] ?? "") - order(second.sentenceIds[0] ?? ""));
  const entities = fold(await bundle.loadFile<Entity>("entities.jsonl"));
  const relations = await bundle.loadFile<Relation>("relations.jsonl");
  const timed = new Set(relations.filter((relation) => relation.type === "OCCURS_DURING").map((relation) => relation.fromId));
  const wanted = input.sceneIds ? new Set(input.sceneIds) : null;
  const selected = scenes.filter((scene) => !timed.has(scene.id) && (!wanted || wanted.has(scene.id)) && scene.sentenceIds.every((id) => input.sentences.has(id)));
  const stored = entities.filter((entity) => entity.kind === "TimePoint").map(periodFromEntity);
  const firstIndex = selected[0] ? scenes.findIndex((scene) => scene.id === selected[0].id) : -1;
  const before = firstIndex > 0 ? scenes[firstIndex - 1].id : null;
  const seed = seedFrom(stored, before ? relations.filter((relation) => relation.type === "OCCURS_DURING" && relation.fromId === before).map((relation) => relation.toId) : []);
  const result = await runTimePlace({
    scenes: selected.map((scene) => ({ id: scene.id, chapterIndex: scene.chapterIndex, sentences: scene.sentenceIds.map((id) => input.sentences.get(id)!), charactersPresent: scene.charactersPresent ?? [], locationId: scene.locationId ?? null })),
    knownEntities: entities, mode: input.mode, work: input.work, decisions: input.decisions, seed, budget: input.budget,
  });
  const anchorSentences = new Map(entities.filter((entity) => entity.kind === "TimePoint" && typeof entity.properties?.sentenceId === "string").map((entity) => [entity.id, entity.properties.sentenceId as string]));
  const proposals = timePlaceProposals(result, { entityIds: new Set(entities.map((entity) => entity.id)), relationKeys: new Set(relations.map((relation) => `${relation.type}:${relation.fromId}:${relation.toId}`)), anchorSentences, parents: parentMap(relations) }, input.provenanceBlockId);
  if (input.remember) await rememberTimePlaceAttempt(input.novelDir, selected.map((scene) => scene.id));
  if (!proposals.length) return { changeset: null, result, scenes: selected.length };
  const flashbacks = result.periods.filter((period) => period.flashback).length;
  const changeset: ChangeSet = {
    id: `cs_timeplace_${input.provenanceBlockId.replace(/[^A-Za-z0-9_-]/g, "_")}_${Date.now()}`,
    blockId: "time-place", proposals, status: "pending_review", ...(input.reviewSource === false ? {} : { reviewSource: timePlaceReviewSource(proposals, input.sentences) }),
    reviewNotes: { "time-place": `Time-place faculty (phase 1, ${input.mode}${result.usedJev ? ", Jev roles" : ", rule roles"}) for ${selected.length} scene(s): ${result.periods.length} new period(s)${flashbacks ? ` (${flashbacks} flashback)` : ""}${result.reordered.length ? `, ${result.reordered.length} earlier period(s) re-ordered` : ""}, ${new Set(result.places.filter((place) => place.specific && place.role === "setting").map((place) => place.key)).size} named setting place(s). Story order is estimated; derived dates come only from stated words.${result.notes.length ? ` Notes: ${result.notes.slice(0, 3).join(" ")}` : ""}` },
    createdAt: new Date().toISOString(),
  };
  return { changeset, result, scenes: selected.length };
}
