import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { storedSource } from "../../../ground/workspace/source.js";
import { cutBlocks } from "../../../digger/intake/blocks.js";
import { sectionBlock, type Sentence } from "../../../digger/intake/sectioning.js";
import { runTimePlace, timePlaceProposals, type TimePlaceResult, type VocabularyMode } from "../../../digger/timeplace/faculty.js";
import { saveChangeSet } from "../../../solidifier/merge/changesetStore.js";
import { cachedDecisions, cachedWork } from "../../../digger/timeplace/cache.js";
import { timePlaceForNewScenes, timePlaceReviewSource } from "../../../digger/timeplace/afterApply.js";
import type { ChangeSet } from "../../../solidifier/merge/changeset.js";

/**
 * `novel timeplace run|show` — the time-place faculty over a workspace's
 * existing scenes (phase 1). `run` writes a full report and, with
 * --propose, a pending_review ChangeSet for the merge gate; it never writes
 * canon. `show` reads applied time/place facts back in story order.
 */

const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];
const order = (id: string) => { const match = /^b(\d+)_s(\d+)$/.exec(id); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };

/** Every source sentence of a workspace, keyed by id (bound or single legacy source). */
export async function loadWorkspaceSentences(novelDir: string): Promise<Map<string, Sentence>> {
  const bound = await storedSource(novelDir);
  const files = bound ? [bound.file] : (await readdir(join(novelDir, "source"))).filter((name) => !name.startsWith("."));
  if (files.length !== 1) throw new Error("Time-place needs one unambiguous stored source; explicit source migration required.");
  const text = await readFile(join(novelDir, "source", files[0]), "utf8");
  const sentences = new Map<string, Sentence>();
  for (const block of bound ? cutBlocks(text, bound.blockSize) : cutBlocks(text)) for (const sentence of sectionBlock(block.text, block.index).sentences) sentences.set(sentence.id, sentence);
  return sentences;
}

async function loadBundle(novelDir: string) {
  const bundle = new BundleStore(join(novelDir, "ontology"));
  const scenes = fold(await bundle.loadFile<Scene>("scenes.jsonl")).sort((first, second) => order(first.sentenceIds[0] ?? "") - order(second.sentenceIds[0] ?? ""));
  const entities = fold(await bundle.loadFile<Entity>("entities.jsonl"));
  const relations = await bundle.loadFile<Relation>("relations.jsonl");
  return { scenes, entities, relations };
}

export interface TimeplaceRunOptions {
  mode?: VocabularyMode;
  jev?: boolean;
  chapter?: number;
  limit?: number;
  out?: string;
  propose?: boolean;
  force?: boolean;
  maxCalls?: number;
  maxQuestions?: number;
  /** Reuse identical model replies from this folder (re-runs pay only for what changed). */
  cache?: string;
  env?: NodeJS.ProcessEnv;
}

export async function timeplaceRun(novelDir: string, options: TimeplaceRunOptions = {}): Promise<Record<string, unknown>> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? "hybrid";
  if (!["programmatic", "llm", "hybrid"].includes(mode)) throw new Error("--mode must be programmatic, llm or hybrid.");
  const models = () => ({
    work: mode === "programmatic" ? undefined : options.cache ? cachedWork(workModelFromEnv(env), options.cache) : workModelFromEnv(env),
    decisions: options.jev === false ? undefined : options.cache ? cachedDecisions(jevFromEnv(env), options.cache) : jevFromEnv(env),
  });
  if (!options.force) return timeplaceIncremental(novelDir, { ...options, mode }, models());
  const { scenes, entities, relations } = await loadBundle(novelDir);
  const processed = new Set(relations.filter((relation) => relation.type === "OCCURS_DURING").map((relation) => relation.fromId));
  let selected = scenes.filter((scene) => options.chapter === undefined || scene.chapterIndex === options.chapter);
  if (options.limit !== undefined) selected = selected.slice(0, options.limit);
  const sentences = await loadWorkspaceSentences(novelDir);
  const missing = selected.flatMap((scene) => scene.sentenceIds.filter((id) => !sentences.has(id)));
  if (missing.length) throw new Error(`Source provenance mismatch: ${missing.length} scene sentence(s) not found in the stored source.`);
  const started = Date.now();
  const result = await runTimePlace({
    scenes: selected.map((scene) => ({ id: scene.id, chapterIndex: scene.chapterIndex, sentences: scene.sentenceIds.map((id) => sentences.get(id)!), charactersPresent: scene.charactersPresent ?? [], locationId: scene.locationId ?? null })),
    knownEntities: entities,
    mode,
    ...models(),
    budget: { maxWorkCalls: options.maxCalls, maxDecisionQuestions: options.maxQuestions },
  });
  const anchorSentences = new Map(entities.filter((entity) => entity.kind === "TimePoint" && typeof entity.properties?.sentenceId === "string").map((entity) => [entity.id, entity.properties.sentenceId as string]));
  const proposals = timePlaceProposals(result, { entityIds: new Set(entities.map((entity) => entity.id)), relationKeys: new Set(relations.map((relation) => `${relation.type}:${relation.fromId}:${relation.toId}`)), anchorSentences });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? join(novelDir, "timeplace", `run-${stamp}.json`);
  await mkdir(join(out, ".."), { recursive: true, mode: 0o700 });
  await writeFile(out, JSON.stringify({ novelDir, scenes: selected.length, seconds: (Date.now() - started) / 1000, ...result, proposals: proposals.length }, null, 1), { mode: 0o600 });
  let changesetId: string | null = null;
  if (options.propose && proposals.length) {
    changesetId = `cs_timeplace_${stamp}`;
    await saveChangeSet(novelDir, {
      id: changesetId, blockId: "time-place", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences),
      reviewNotes: { "time-place": `Time-place faculty (phase 1, mode ${mode}${result.usedJev ? ", Jev roles" : ", rule roles"}): ${result.periods.length} time periods (${result.periods.filter((period) => period.flashback).length} flashback), ${new Set(result.places.filter((place) => place.specific && place.role === "setting").map((place) => place.key)).size} setting places over ${selected.length} scenes. Story order is estimated; derived dates come only from stated words.${result.notes.length ? ` Notes: ${result.notes.slice(0, 5).join(" ")}` : ""}` },
      createdAt: new Date().toISOString(),
    });
  }
  return summarize(result, { scenes: selected.length, proposals: proposals.length, changesetId, report: out, seconds: (Date.now() - started) / 1000 });
}

/**
 * Default run: only scenes without time facts, continuing from the book's
 * stored periods — the same path as at-birth runs after each block.
 */
async function timeplaceIncremental(novelDir: string, options: TimeplaceRunOptions & { mode: VocabularyMode }, models: { work?: import("../../../ground/connectors/llm.js").WorkModel; decisions?: import("../../../ground/connectors/jev.js").DecisionModel }): Promise<Record<string, unknown>> {
  const { scenes, relations } = await loadBundle(novelDir);
  const timed = new Set(relations.filter((relation) => relation.type === "OCCURS_DURING").map((relation) => relation.fromId));
  let wanted = scenes.filter((scene) => !timed.has(scene.id) && (options.chapter === undefined || scene.chapterIndex === options.chapter));
  if (options.limit !== undefined) wanted = wanted.slice(0, options.limit);
  if (!wanted.length) return { scenes: 0, proposals: 0, changesetId: null, note: "Every selected scene already has time facts; nothing to do (use --force to re-run from scratch)." };
  const started = Date.now();
  const output = await timePlaceForNewScenes({ novelDir, sentences: await loadWorkspaceSentences(novelDir), mode: options.mode, ...models, sceneIds: wanted.map((scene) => scene.id), provenanceBlockId: options.chapter === undefined ? "time-place" : `time-place-ch${options.chapter}`, budget: { maxWorkCalls: options.maxCalls, maxDecisionQuestions: options.maxQuestions } });
  const out = options.out ?? join(novelDir, "timeplace", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await mkdir(join(out, ".."), { recursive: true, mode: 0o700 });
  await writeFile(out, JSON.stringify({ novelDir, scenes: output.scenes, seconds: (Date.now() - started) / 1000, ...output.result, proposals: output.changeset?.proposals.length ?? 0 }, null, 1), { mode: 0o600 });
  if (options.propose && output.changeset) await saveChangeSet(novelDir, output.changeset);
  return summarize(output.result, { scenes: output.scenes, proposals: output.changeset?.proposals.length ?? 0, changesetId: options.propose ? output.changeset?.id ?? null : null, report: out, seconds: (Date.now() - started) / 1000, incremental: true });
}

/** After a block ChangeSet is approved: time-place for its new scenes (own pending ChangeSet). */
export async function timeplaceAfterApprove(novelDir: string, approved: ChangeSet, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown> | null> {
  const sceneIds = approved.proposals.filter((proposal) => proposal.kind === "create_scene").map((proposal) => (proposal.payload as Scene).id);
  if (!sceneIds.length) return null;
  const work = env.WORK_LLM_API_KEY?.trim() ? workModelFromEnv(env) : undefined;
  const output = await timePlaceForNewScenes({ novelDir, sentences: await loadWorkspaceSentences(novelDir), mode: work ? "hybrid" : "programmatic", work, decisions: jevFromEnv(env), sceneIds, provenanceBlockId: approved.blockId });
  if (output.changeset) await saveChangeSet(novelDir, output.changeset);
  return { changesetId: output.changeset?.id ?? null, scenes: output.scenes, periods: output.result.periods.length, flashbacks: output.result.periods.filter((period) => period.flashback).length, usage: output.result.usage };
}

/** Compact, readable summary of a run (the full result is in the report file). */
export function summarize(result: TimePlaceResult, extra: Record<string, unknown>): Record<string, unknown> {
  const anchors = result.mentions.filter((mention) => mention.verdict.role !== "REFERENCE");
  const roles: Record<string, number> = {};
  for (const mention of result.mentions) roles[mention.verdict.role] = (roles[mention.verdict.role] ?? 0) + 1;
  const settings = new Map<string, { name: string; scenes: Set<string> }>();
  for (const place of result.places) if (place.specific && place.role === "setting") { const entry = settings.get(place.key) ?? { name: place.name, scenes: new Set() }; entry.scenes.add(place.sceneId); settings.set(place.key, entry); }
  return {
    ...extra,
    mode: result.mode, jev: result.usedJev,
    mentions: result.mentions.length, anchors: anchors.length, roles,
    unplacedScenes: result.sceneTimes.filter((scene) => !scene.periodIds.length).length,
    periods: [...result.periods].sort((first, second) => first.storyIndex - second.storyIndex).map((period) => `${period.storyIndex}. ${period.flashback ? "↶ " : ""}${period.label} [${period.gloss}${period.date ? ` = ${[period.date.year, period.date.month, period.date.day].filter(Boolean).join("-")}${period.date.derived ? " derived" : ""}` : ""}] ch${period.chapterIndex} ×${period.sceneIds.length}${period.flashback ? ` p=${period.flashbackProbability.toFixed(2)}` : ""}`),
    places: [...settings.values()].sort((first, second) => second.scenes.size - first.scenes.size).slice(0, 25).map((place) => `${place.name} ×${place.scenes.size}`),
    usage: result.usage,
    notes: result.notes.slice(0, 10),
  };
}

export async function timeplaceShow(novelDir: string): Promise<Record<string, unknown>> {
  const { scenes, entities, relations } = await loadBundle(novelDir);
  const times = entities.filter((entity) => entity.kind === "TimePoint").sort((first, second) => Number(first.properties.storyIndex ?? 0) - Number(second.properties.storyIndex ?? 0));
  const during = relations.filter((relation) => relation.type === "OCCURS_DURING");
  const located = relations.filter((relation) => relation.type === "LOCATED_AT");
  const names = new Map(entities.map((entity) => [entity.id, entity.names.find((form) => form.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id]));
  return {
    scenes: scenes.length,
    placedScenes: new Set(during.map((relation) => relation.fromId)).size,
    timeline: times.map((time) => `${time.properties.storyIndex}. ${time.properties.flashback ? "↶ " : ""}${names.get(time.id)} [${time.properties.gloss ?? ""}] ×${during.filter((relation) => relation.toId === time.id).length}`),
    places: [...new Set(located.map((relation) => relation.toId))].map((id) => `${names.get(id) ?? id} ×${new Set(located.filter((relation) => relation.toId === id).map((relation) => relation.fromId)).size}`),
  };
}

export const TIMEPLACE_USAGE = "novel timeplace run <novel-dir> [--mode hybrid|llm|programmatic] [--no-jev] [--chapter N] [--limit N] [--max-calls N] [--max-questions N] [--cache dir] [--out file] [--propose] [--force] | novel timeplace show <novel-dir>";
