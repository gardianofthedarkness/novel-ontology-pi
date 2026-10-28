import { createHash } from "node:crypto";
import { parentMap, placePath } from "../../../ground/ontology/placeTree.js";
import { sweepPlaceTree, type PlaceTreeMemory } from "../../../digger/timeplace/placeTreeSweep.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import { EventLog } from "../../../ground/events/log.js";
import { observeDecisions, observeWork } from "../../../ground/events/observe.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { storedSource } from "../../../ground/workspace/source.js";
import { cutBlocks } from "../../../digger/intake/blocks.js";
import { sectionBlock, type Sentence } from "../../../digger/intake/sectioning.js";
import { runTimePlace, timePlaceProposals, type TimePlaceResult, type VocabularyMode } from "../../../digger/timeplace/faculty.js";
import { saveChangeSet } from "../../../solidifier/merge/changesetStore.js";
import { cachedDecisions, cachedWork } from "../../../digger/timeplace/cache.js";
import { timePlaceAttempted, timePlaceForNewScenes, timePlaceReviewSource } from "../../../digger/timeplace/afterApply.js";
import type { ChangeSet } from "../../../solidifier/merge/changeset.js";
import { listChangeSets } from "../../../solidifier/merge/changesetStore.js";
import { askStrandQuestions, planStrandQuestions, scenePassage, storyStrands, strandProjection, STRAND_QUESTION_DEFAULTS } from "../../../digger/timeplace/strandQuestions.js";
import { castCandidates } from "../../../digger/processing/castCandidates.js";
import type { StrandAnswers } from "../../../../apps/playground/src/data/storyStrands.js";

/**
 * `novel timeplace run|tree|show` — the time-place faculty over a
 * workspace's existing scenes. `run` writes a full report and, with
 * --propose, a pending_review ChangeSet for the merge gate; `tree` is the
 * place-tree sweep (phase 2), proposing PART_OF parents for stored places;
 * neither writes canon. `show` reads applied time/place facts back in story
 * order, places as paths through the place tree.
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
  const emit = new EventLog(novelDir).emit;
  const models = () => ({
    work: mode === "programmatic" ? undefined : observeWork(options.cache ? cachedWork(workModelFromEnv(env), options.cache) : workModelFromEnv(env), emit, { faculty: "timeplace" }),
    decisions: options.jev === false ? undefined : observeDecisions(options.cache ? cachedDecisions(jevFromEnv(env), options.cache) : jevFromEnv(env), emit),
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
  const proposals = timePlaceProposals(result, { entityIds: new Set(entities.map((entity) => entity.id)), relationKeys: new Set(relations.map((relation) => `${relation.type}:${relation.fromId}:${relation.toId}`)), anchorSentences, parents: parentMap(relations) });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? join(novelDir, "timeplace", `run-${stamp}.json`);
  await mkdir(join(out, ".."), { recursive: true, mode: 0o700 });
  await writeFile(out, JSON.stringify({ novelDir, scenes: selected.length, seconds: (Date.now() - started) / 1000, ...result, proposals: proposals.length }, null, 1), { mode: 0o600 });
  let changesetId: string | null = null;
  if (options.propose && proposals.length) {
    // The reviewability filter (tools/pi-review/timeplace-access.mjs) requires a
    // trailing _<digits> suffix, as at-birth packets already carry; a bare ISO
    // stamp ends in "Z" and would never be listed for hosted-Pi review.
    changesetId = `cs_timeplace_${stamp}_${Date.now()}`;
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
  const attempted = await timePlaceAttempted(novelDir);
  let wanted = scenes.filter((scene) => !timed.has(scene.id) && !attempted.has(scene.id) && (options.chapter === undefined || scene.chapterIndex === options.chapter));
  if (options.limit !== undefined) wanted = wanted.slice(0, options.limit);
  if (!wanted.length) return { scenes: 0, proposals: 0, changesetId: null, note: "Every selected scene already has time facts or was already processed (held facts stay held); nothing to do (use --force to re-run from scratch)." };
  const started = Date.now();
  const output = await timePlaceForNewScenes({ novelDir, sentences: await loadWorkspaceSentences(novelDir), mode: options.mode, ...models, sceneIds: wanted.map((scene) => scene.id), provenanceBlockId: options.chapter === undefined ? "time-place" : `time-place-ch${options.chapter}`, budget: { maxWorkCalls: options.maxCalls, maxDecisionQuestions: options.maxQuestions }, remember: !!options.propose });
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
  const emit = new EventLog(novelDir).emit;
  const work = env.WORK_LLM_API_KEY?.trim() ? observeWork(workModelFromEnv(env), emit, { blockId: approved.blockId, faculty: "timeplace" }) : undefined;
  const output = await timePlaceForNewScenes({ novelDir, sentences: await loadWorkspaceSentences(novelDir), mode: work ? "hybrid" : "programmatic", work, decisions: observeDecisions(jevFromEnv(env), emit, { blockId: approved.blockId }), sceneIds, provenanceBlockId: approved.blockId, remember: true });
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
  const parents = parentMap(relations);
  const path = (id: string) => placePath(id, parents).map((step) => names.get(step) ?? step).join(" › ");
  return {
    scenes: scenes.length,
    placedScenes: new Set(during.map((relation) => relation.fromId)).size,
    timeline: times.map((time) => `${time.properties.storyIndex}. ${time.properties.flashback ? "↶ " : ""}${names.get(time.id)} [${time.properties.gloss ?? ""}] ×${during.filter((relation) => relation.toId === time.id).length}`),
    places: [...new Set(located.map((relation) => relation.toId))].map((id) => `${path(id)} ×${new Set(located.filter((relation) => relation.toId === id).map((relation) => relation.fromId)).size}`),
    tree: [...parents].map(([child, parent]) => `${names.get(child) ?? child} ⊂ ${names.get(parent) ?? parent}`),
  };
}

export interface TimeplaceTreeOptions { propose?: boolean; jev?: boolean; maxQuestions?: number; cache?: string; out?: string; env?: NodeJS.ProcessEnv }

/**
 * Place-tree sweep over a workspace's stored places: nominate pairs, let Jev
 * judge containment, and (with --propose) write a pending `place-tree`
 * ChangeSet of PART_OF links for the shared review gate. Confident
 * "neither" verdicts are remembered in timeplace/place-tree.json.
 */
export async function timeplaceTree(novelDir: string, options: TimeplaceTreeOptions = {}): Promise<Record<string, unknown>> {
  const env = options.env ?? process.env;
  const { scenes, entities, relations } = await loadBundle(novelDir);
  const sentences = await loadWorkspaceSentences(novelDir);
  const memoryPath = join(novelDir, "timeplace", "place-tree.json");
  const memory = JSON.parse(await readFile(memoryPath, "utf8").catch(() => '{"distinct":[]}')) as PlaceTreeMemory;
  const decisions = options.jev === false ? undefined : observeDecisions(options.cache ? cachedDecisions(jevFromEnv(env), options.cache) : jevFromEnv(env), new EventLog(novelDir).emit);
  const started = Date.now();
  const result = await sweepPlaceTree({ entities, relations, scenes, sentences, decisions, maxQuestions: options.maxQuestions, memory });
  await mkdir(join(novelDir, "timeplace"), { recursive: true, mode: 0o700 });
  await writeFile(memoryPath, JSON.stringify(result.memory, null, 1), { mode: 0o600 });
  const names = new Map(entities.map((entity) => [entity.id, entity.names.find((form) => form.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id]));
  const out = options.out ?? join(novelDir, "timeplace", `tree-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify({ novelDir, seconds: (Date.now() - started) / 1000, candidates: result.candidates, asked: result.asked, verdicts: result.verdicts, proposals: result.proposals.length, notes: result.notes }, null, 1), { mode: 0o600 });
  let changesetId: string | null = null;
  if (options.propose && result.proposals.length) {
    changesetId = `cs_timeplace_place-tree_${Date.now()}`;
    await saveChangeSet(novelDir, {
      id: changesetId, blockId: "place-tree", proposals: result.proposals, status: "pending_review", reviewSource: timePlaceReviewSource(result.proposals, sentences),
      reviewNotes: { "place-tree": `Place-tree sweep (phase 2${decisions ? ", Jev judged each pair" : ", name prefixes only (no Jev)"}): ${result.candidates} candidate pair(s), ${result.asked} asked, ${result.proposals.length} PART_OF link(s) proposed (child ⊂ parent; one parent per place; the deepest judged parent kept). Accept a link only if its sentences show the child lies within the parent.${result.notes.length ? ` Notes: ${result.notes.slice(0, 4).join(" ")}` : ""}` },
      createdAt: new Date().toISOString(),
    });
  }
  return {
    candidates: result.candidates, asked: result.asked, proposals: result.proposals.length, changesetId, report: out, seconds: (Date.now() - started) / 1000,
    links: result.proposals.map((proposal) => { const relation = proposal.payload as Relation; return `${names.get(relation.fromId) ?? relation.fromId} ⊂ ${names.get(relation.toId) ?? relation.toId} (${Number(proposal.confidence).toFixed(2)})`; }),
    neither: result.verdicts.filter((verdict) => verdict.choice === "NEITHER").length, unsure: result.verdicts.filter((verdict) => verdict.choice !== "NEITHER" && verdict.probability < 0.7).length,
    notes: result.notes.slice(0, 10),
  };
}

export interface TimeplaceStrandsOptions { ask?: boolean; maxQuestions?: number; minImpact?: number; cache?: string; out?: string; env?: NodeJS.ProcessEnv }

/**
 * Story strands over the stored story time (and time-place proposals awaiting
 * review): which scenes run in parallel, where strands split and meet, and
 * the place checks. Plans "who is present?" questions only where a borrowed
 * cast creates a strand link; asks them (work model, within --max-questions)
 * only with --ask. Writes a report; nothing is written to canon.
 */
/**
 * What the strands step works from (no model calls): the story-time view of a
 * workspace, its strands before any question, every scene's cast candidates
 * and the planned "who is present?" questions. Shared with `novel checklist`.
 */
export async function strandInputs(novelDir: string, limits: { maxQuestions?: number; minImpact?: number } = {}) {
  const { scenes, entities, relations } = await loadBundle(novelDir);
  const pending = (await listChangeSets(novelDir)).filter((changeset) => changeset.status === "pending_review" && changeset.id.startsWith("cs_timeplace")).flatMap((changeset) => changeset.proposals as unknown as { kind: string; payload: Record<string, unknown> }[]);
  const data = strandProjection({ scenes, entities, relations, pending });
  const before = storyStrands(data);
  // Cast candidates for every scene: names found in its text, its record, its neighbours, chapter and volume.
  const sentences = await loadWorkspaceSentences(novelDir);
  const byScene = new Map(scenes.map((scene) => [scene.id, scene]));
  const lines = (sceneId: string) => (byScene.get(sceneId)?.sentenceIds ?? []).map((id) => sentences.get(id)?.text ?? "").filter(Boolean);
  const characters = entities.filter((entity) => entity.kind === "Character").map((entity) => ({ id: entity.id, forms: [...new Set((entity.names ?? []).map((name) => name.text).filter(Boolean))] }));
  const candidates = castCandidates(data.scenes.map((scene) => ({ id: scene.id, chapterIndex: scene.chapterIndex, index: scene.index, text: lines(scene.id).join("\n"), present: byScene.get(scene.id)?.charactersPresent ?? [], mentioned: byScene.get(scene.id)?.charactersMentioned ?? [] })), characters);
  const names = { ...Object.fromEntries(entities.filter((entity) => entity.kind === "Character").map((entity) => [entity.id, entity.names?.find((name) => name.kind === "canonical")?.text ?? entity.names?.[0]?.text ?? entity.id])), ...data.names };
  const plan = data.available ? planStrandQuestions(data, before, { ...limits, candidates }) : { questions: [], belowThreshold: 0, overBudget: 0, estimate: { questions: 0, calls: 0 } };
  // What the strands read, and nothing else (a new causal link or event must not make the report stale).
  const fingerprint = createHash("sha256").update(JSON.stringify({
    scenes: data.scenes.map((scene) => [scene.id, scene.chapterIndex, scene.index, scene.times, scene.flashback, scene.placeIds, scene.placeCarried, scene.characterIds]),
    times: data.times.map((time) => [time.id, time.storyIndex, time.date, time.partOfDay, time.flashback]),
    places: data.places.map((place) => [place.id, place.parentId]),
    candidates: [...candidates].map(([sceneId, list]) => [sceneId, list.map((candidate) => [candidate.id, candidate.score])]),
  })).digest("hex").slice(0, 16);
  return { data, before, plan, lines, characters, names, fingerprint };
}

export async function timeplaceStrands(novelDir: string, options: TimeplaceStrandsOptions = {}): Promise<Record<string, unknown>> {
  const env = options.env ?? process.env;
  const limits = { maxQuestions: options.maxQuestions ?? STRAND_QUESTION_DEFAULTS.maxQuestions, minImpact: options.minImpact ?? STRAND_QUESTION_DEFAULTS.minImpact };
  const { data, before, plan, lines, characters, names, fingerprint } = await strandInputs(novelDir, limits);
  if (!data.available) throw new Error("No story time yet: run `novel timeplace run` first (strands build on its periods).");
  let asked: Awaited<ReturnType<typeof askStrandQuestions>>["asked"] = [];
  let answers: StrandAnswers = {};
  let strands = before;
  const usage = { workCalls: 0 };
  if (options.ask && plan.questions.length) {
    const passage = (sceneId: string, nameForms: string[]) => scenePassage(lines(sceneId), nameForms);
    const forms = Object.fromEntries(characters.map((character) => [character.id, character.forms]));
    const work = options.cache ? cachedWork(workModelFromEnv(env), options.cache) : workModelFromEnv(env);
    const metered = { modelId: work.modelId, generate: async (request: Parameters<typeof work.generate>[0]) => { usage.workCalls++; return work.generate(request); } };
    const result = await askStrandQuestions({ work: metered, plan, names, forms, passage, options: limits });
    asked = result.asked;
    answers = result.answers;
    strands = storyStrands(data, answers);
  }
  const summary = (value: typeof strands) => ({ lanes: value.lanes, layers: value.layers, parallelPairs: value.parallelPairs, splits: value.forks.size, meetings: value.merges.size, guessedCasts: value.carried.size,     checks: Object.fromEntries([...new Set(value.checks.map((check) => `${check.kind}:${check.status}`))].map((label) => [label, value.checks.filter((check) => `${check.kind}:${check.status}` === label).length])) });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = options.out ?? join(novelDir, "timeplace", `strands-${stamp}.json`);
  await mkdir(join(out, ".."), { recursive: true, mode: 0o700 });
  const report = {
    novelDir, inputs: fingerprint, before: summary(before), after: options.ask ? summary(strands) : null,
    plan: { limits, estimate: plan.estimate, belowThreshold: plan.belowThreshold, overBudget: plan.overBudget, questions: plan.questions.map((question) => ({ key: question.key, impact: question.impact, characters: question.characterIds.length })) },
    asked, usage,
    // The casts the answers set (character ids), for scoring against a presence key.
    casts: Object.fromEntries(answers.presence ?? []),
    // Scenes answered as "none of the listed characters, someone else": they stand alone.
    alone: [...(answers.alone ?? [])],
    // For `novel eval story-order`: the happens-before graph.
    prediction: { kind: "dag", edges: strands.edges.map((edge) => [edge.from, edge.to]) },
  };
  await writeFile(out, JSON.stringify(report, null, 1), { mode: 0o600 });
  return { ...summary(strands), plan: report.plan.estimate, belowThreshold: plan.belowThreshold, overBudget: plan.overBudget, asked: asked.length, applied: asked.filter((entry) => entry.applied).length, usage, report: out,
    ...(options.ask ? {} : { note: plan.questions.length ? `Planned ${plan.questions.length} "who is present?" question(s) in ${plan.estimate.calls} work-model call(s); add --ask to ask them.` : "Nothing worth asking above the impact threshold." }) };
}

export const TIMEPLACE_USAGE = "novel timeplace run <novel-dir> [--mode hybrid|llm|programmatic] [--no-jev] [--chapter N] [--limit N] [--max-calls N] [--max-questions N] [--cache dir] [--out file] [--propose] [--force] | novel timeplace tree <novel-dir> [--no-jev] [--max-questions N] [--cache dir] [--out file] [--propose] | novel timeplace show <novel-dir> | novel timeplace strands <novel-dir> [--ask] [--max-questions N] [--min-impact N] [--cache dir] [--out file]";
