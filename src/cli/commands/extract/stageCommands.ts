import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv, type DecisionModel } from "../../../ground/connectors/jev.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { cachedDecisions } from "../../../digger/timeplace/cache.js";
import { storyStrands, strandProjection } from "../../../digger/timeplace/strandQuestions.js";
import { latestStrandAnswers } from "../../../digger/timeplace/strandView.js";
import { forkTimeline, type TimelineScene } from "../../../digger/stage/environment.js";
import { detectObjects, type ObjectScene, type ObjectsReport } from "../../../digger/stage/objects.js";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import { loadEmbedder } from "../../../ground/connectors/embeddings.js";
import { loadConfig } from "../../config.js";
import { cachedWork } from "../../../digger/timeplace/cache.js";
import { architectureFingerprint, architecturePictures, pickArchitecture, type ArchitecturePlace, type ArchitectureReport } from "../../../digger/stage/architecture.js";
import { askMovement, movementFingerprint, sceneCallEstimate, sceneCallLimit, sceneInputs, type MovementReport, type MovementScene } from "../../../digger/stage/movement.js";
import { prepareStage, prepFingerprint, type StagePlan } from "../../../digger/stage/prep.js";
import { pickScales, scaleFingerprint, SCALES, type ScalePlace, type ScaleReport } from "../../../digger/stage/scale.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";

/**
 * `novel stage scale|architecture|movement|prep|show` — what read mode replays.
 * Three faculties and a last step, each writing a report under <book>/stage/
 * (view inputs: no review packet, nothing written to canon). They run on
 * request, apart from the book's analysis (`novel checklist` lists them
 * under `stage`), and read reviewed canon only: a place or cast still
 * awaiting review is never paid for.
 *
 *   scale         how big each place in the tree is, region to room (Jev),
 *                 which decides how the stage builds it;
 *   architecture  each place's building, a sub-kind of place (names
 *                 shortlist, Jev picks among pictures) — after story time
 *                 and the place tree, beside strands and causality;
 *   movement      who moves where inside each scene's building, how (Jev) —
 *                 once the whole file is extracted (the full character list
 *                 feeds the cast-candidate scorer) and the buildings are
 *                 picked;
 *   prep          the animation prep: every chain checked physically, one
 *                 movement plan per place — only once every other faculty
 *                 of the book is done (novel checklist), no model calls.
 *
 * Each keeps its answers per place or scene and reuses them while their
 * inputs stay the same, so a later run asks only about what changed.
 */
const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];
const order = (id = "") => { const match = /^b(\d+)_s(\d+)$/.exec(id); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : Number.MAX_SAFE_INTEGER; };
const clip = (text: string, length: number) => [...text].length > length ? `${[...text].slice(0, length - 1).join("")}…` : text;
/** People a scene's questions are about, at most: the strongest candidates first. */
const CAST_LIMIT = 8;

interface StoredEvent { id: string; summaryEn?: string; summary?: string; primaryActors?: string[]; evidence?: { text?: string; sentenceIds?: string[] } }
const stageFile = (novelDir: string, name: "scale" | "architecture" | "movement" | "plan" | "objects") => join(novelDir, "stage", `${name}.json`);
const readJson = async <T>(path: string): Promise<T | null> => readFile(path, "utf8").then((text) => JSON.parse(text) as T, () => null);
async function writeReport(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 1), { mode: 0o600 });
}

/** Everything the stage reads (no model calls): its places, its scenes with cast and events, and the fingerprints. Shared with `novel checklist`. */
export async function stageInputs(novelDir: string) {
  const bundle = new BundleStore(join(novelDir, "ontology"));
  const scenes = fold(await bundle.loadFile<Scene>("scenes.jsonl"));
  const entities = fold(await bundle.loadFile<Entity>("entities.jsonl"));
  const relations = await bundle.loadFile<Relation>("relations.jsonl");
  const events = fold(await bundle.loadFile<StoredEvent>("events.jsonl"));
  // Reviewed canon only: time-place proposals still awaiting review are not staged (the strands view shows them; nothing here pays for them).
  const data = strandProjection({ scenes, entities, relations });
  const sceneLabel = new Map(data.scenes.map((scene) => [scene.id, scene.label]));

  // Architecture: every place a scene happens in.
  const inside = (id: string) => data.places.filter((place) => place.parentId === id).map((place) => place.id);
  const places: ArchitecturePlace[] = data.places.filter((place) => place.sceneIds.length).map((place) => ({ id: place.id, label: place.label, path: place.path ?? [place.id], contains: inside(place.id), sceneLabels: place.sceneIds.map((id) => sceneLabel.get(id) ?? "").filter((label) => label && !/^scene_\d+$/.test(label)).slice(0, 3) }));
  const architecture = await readJson<ArchitectureReport>(stageFile(novelDir, "architecture"));
  const architectureCurrent = architecture?.inputs === architectureFingerprint(places);

  // Movement: scenes in a place with a building, who is present in them and their events.
  const sentences = await loadWorkspaceSentences(novelDir).catch(() => new Map<string, { text: string }>());
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const isCharacter = (id: string) => byId.get(id)?.kind === "Character";
  const names: Record<string, string> = Object.fromEntries(entities.filter((entity) => entity.kind === "Character" || entity.kind === "Location").map((entity) => [entity.id, entity.names?.find((form) => form.kind === "canonical")?.text ?? entity.names?.[0]?.text ?? entity.id]));
  const stored = new Map(scenes.map((scene) => [scene.id, scene]));
  const text = (sceneId: string) => (stored.get(sceneId)?.sentenceIds ?? []).map((id) => sentences.get(id)?.text ?? "").join("");
  const answers = await latestStrandAnswers(novelDir);
  const sceneOf = new Map(scenes.flatMap((scene) => scene.sentenceIds.map((id) => [id, scene.id] as const)));
  const participants = new Map<string, Set<string>>();
  for (const relation of relations) if (relation.type === "PARTICIPATES_IN" && isCharacter(relation.fromId)) participants.set(relation.toId, (participants.get(relation.toId) ?? new Set()).add(relation.fromId));
  const eventsByScene = new Map<string, StoredEvent[]>();
  for (const event of events.sort((first, second) => order(first.evidence?.sentenceIds?.[0]) - order(second.evidence?.sentenceIds?.[0]))) {
    const sceneId = sceneOf.get(event.evidence?.sentenceIds?.[0] ?? "");
    if (sceneId) eventsByScene.set(sceneId, [...eventsByScene.get(sceneId) ?? [], event]);
  }
  // Scale: every place in the tree, with scenes of its own or not (the stage's map draws them all).
  const scalePlaces: ScalePlace[] = data.places.map((place) => {
    const forms = byId.get(place.id)?.names ?? [], canonical = names[place.id] ?? place.label;
    return { id: place.id, label: place.label, aliases: [...new Set(forms.map((form) => form.text).filter((text) => text && text !== canonical))], path: place.path ?? [place.id], contains: inside(place.id) };
  });
  const scale = await readJson<ScaleReport>(stageFile(novelDir, "scale"));
  const scaleCurrent = scale?.inputs === scaleFingerprint(scalePlaces);
  const kindOf = (placeId: string) => { const kind = architecture?.places[placeId]?.kind; return kind && kind !== "none" ? kind : null; };
  const movementScenes: MovementScene[] = [];
  for (const scene of data.scenes) {
    const placeId = scene.placeIds.find((id) => kindOf(id));
    const sceneEvents = eventsByScene.get(scene.id) ?? [];
    if (!placeId || !sceneEvents.length) continue;
    // An event's actors are the people canon records taking part in it; a name in its evidence (said, thought of, on the phone) is not one.
    const moving = sceneEvents.map((event) => {
      const evidence = event.evidence?.text ?? "";
      const actors = new Set([...(participants.get(event.id) ?? []), ...(event.primaryActors ?? []).filter(isCharacter)]);
      return { id: event.id, text: `${clip(event.summaryEn ?? event.summary ?? "", 160)}${evidence ? `（原文：${clip(evidence, 140)}）` : ""}`, actors: [...actors] };
    });
    // The cast: who is present, as the strands view and causality read it (the answered cast where "who is present?" was asked,
    // else the recorded one), and whoever its events record taking part; the busiest first. Someone only mentioned is not on stage.
    const present = answers?.presence.get(scene.id) ?? scene.characterIds;
    const appearances = new Map<string, number>();
    for (const event of moving) for (const id of event.actors) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    const cast = [...new Set([...present, ...appearances.keys()])].filter(isCharacter)
      .sort((first, second) => (appearances.get(second) ?? 0) - (appearances.get(first) ?? 0)).slice(0, CAST_LIMIT);
    const castSet = new Set(cast);
    movementScenes.push({ id: scene.id, placeId, placeLabel: names[placeId] ?? placeId, kind: kindOf(placeId)!, opening: `${clip(scene.label, 160)}${text(scene.id) ? `（开头：${clip(text(scene.id), 200)}）` : ""}`, cast,
      events: moving.map((event) => ({ ...event, actors: event.actors.filter((id) => castSet.has(id)) })) });
  }
  const movement = await readJson<MovementReport>(stageFile(novelDir, "movement"));
  const movementCurrent = !!movement?.complete && movement.inputs === movementFingerprint(movementScenes, names);
  const plan = await readJson<StagePlan>(stageFile(novelDir, "plan"));
  const planCurrent = architectureCurrent && movementCurrent && plan?.inputs === prepFingerprint(architecture!.inputs, movement!.inputs);
  // What movement would still ask: the usual cost, and the most it can cost (what --max-calls must allow to finish in one run).
  const toAsk = movementScenes.filter((scene) => movement?.scenes[scene.id]?.inputs !== sceneInputs(scene, names));
  return { data, places, scalePlaces, scale, scaleCurrent, architecture, architectureCurrent, movementScenes, names, movement, movementCurrent, plan, planCurrent, answers,
    estimate: Math.ceil(toAsk.reduce((sum, scene) => sum + sceneCallEstimate(scene), 0)), limit: toAsk.reduce((sum, scene) => sum + sceneCallLimit(scene), 0) };
}

/** The analysis steps a stage step builds on must be done first (reviews included), unless forced: the stage never pays for unreviewed or unfinished input. */
async function requireAnalysis(novelDir: string, step: string, needs: string[] | "all", force?: boolean) {
  const { bookChecklist } = await import("./checklistCommands.js");
  const waiting = (await bookChecklist(novelDir, { stage: false })).items.filter((item) => (needs === "all" || needs.includes(item.id)) && !["done", "optional"].includes(item.status));
  if (waiting.length && !force) throw new Error(`${step} waits for ${needs === "all" ? "every other step" : "the steps it builds on"}: ${waiting.map((item) => `${item.id} (${item.status})`).join(", ")}. See novel checklist.`);
  return waiting;
}

export interface StageOptions { jev?: boolean; cache?: string; maxCalls?: number; force?: boolean; env?: NodeJS.ProcessEnv }
const decisionsFor = (options: StageOptions): DecisionModel | undefined => options.jev === false ? undefined : options.cache ? cachedDecisions(jevFromEnv(options.env ?? process.env), options.cache) : jevFromEnv(options.env ?? process.env);

/** `novel stage scale`: one Jev choice per place in the tree, region to room; kept per place and reused while its name, path and children stay the same. */
export async function stageScale(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  const report = await pickScales(inputs.scalePlaces, { decisions: decisionsFor(options), names: inputs.names, previous: inputs.scale });
  await writeReport(stageFile(novelDir, "scale"), report);
  const scales: Record<string, number> = {};
  for (const pick of Object.values(report.places)) scales[pick.scale] = (scales[pick.scale] ?? 0) + 1;
  const unsure = Object.values(report.places).filter((pick) => pick.by === "jev" && (pick.confidence ?? 1) < 0.6).map((pick) => `${pick.label}: ${pick.scale} (${pick.confidence})`);
  return { places: inputs.scalePlaces.length, scales: Object.fromEntries([...SCALES, "none"].filter((scale) => scales[scale]).map((scale) => [scale, scales[scale]])), byJev: Object.values(report.places).filter((pick) => pick.by === "jev").length, ...(unsure.length ? { unsure } : {}), usage: report.usage, report: stageFile(novelDir, "scale") };
}

export async function stageArchitecture(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  await requireAnalysis(novelDir, "Picking buildings", ["time-place", "place-tree"], options.force);
  const inputs = await stageInputs(novelDir);
  const decisions = decisionsFor(options);
  const report = await pickArchitecture(inputs.places, { decisions, pictures: decisions ? await architecturePictures() : {}, names: inputs.names, previous: inputs.architecture });
  await writeReport(stageFile(novelDir, "architecture"), report);
  const kinds: Record<string, number> = {};
  for (const pick of Object.values(report.places)) kinds[pick.kind] = (kinds[pick.kind] ?? 0) + 1;
  return { places: inputs.places.length, kinds, byJev: Object.values(report.places).filter((pick) => pick.by === "jev").length, usage: report.usage, report: stageFile(novelDir, "architecture") };
}

export async function stageMovement(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  await requireAnalysis(novelDir, "Movement", ["blocks", "strands"], options.force);
  const inputs = await stageInputs(novelDir);
  if (!inputs.architectureCurrent) throw new Error(`Movement needs each place's building first: run \`novel stage architecture ${novelDir}\`.`);
  const decisions = decisionsFor(options);
  const started = Date.now();
  const report = await askMovement(inputs.movementScenes, { decisions, names: inputs.names, previous: inputs.movement, maxCalls: options.maxCalls });
  await writeReport(stageFile(novelDir, "movement"), report);
  const moves = Object.values(report.scenes).flatMap((scene) => Object.values(scene.events).flatMap((answers) => Object.values(answers).filter((answer) => answer.to))).length;
  return { scenes: inputs.movementScenes.length, asked: Object.keys(report.scenes).length - report.usage.reused, moves, complete: report.complete, usage: { ...report.usage, seconds: Math.round((Date.now() - started) / 100) / 10 }, report: stageFile(novelDir, "movement"),
    ...(report.complete ? {} : { note: report.model ? `Stopped at --max-calls: ${report.usage.skipped} scene(s) left; run it again to continue (answers so far are kept).` : "Without Jev nothing is asked; the scenes are left for a run with Jev." }) };
}

export async function stagePrep(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  // The animation prep comes last: every analysis step of the book done, every packet reviewed, and both stage reports current.
  const waiting = await requireAnalysis(novelDir, "Animation prep", "all", options.force);
  const inputs = await stageInputs(novelDir);
  if (!inputs.architecture || !inputs.movement) throw new Error("Animation prep needs the stage faculties' reports: novel stage architecture, then novel stage movement.");
  const stale = [...inputs.architectureCurrent ? [] : ["architecture"], ...inputs.movementCurrent ? [] : ["movement"]];
  if (stale.length && !options.force) throw new Error(`Animation prep waits for every other step: ${stale.map((id) => `${id} (todo)`).join(", ")}. See novel checklist.`);
  const plan = prepareStage(inputs.architecture, inputs.movement);
  await writeReport(stageFile(novelDir, "plan"), plan);
  const behind = [...waiting.map((item) => item.id), ...stale];
  return { ...plan.counts, inputs: plan.inputs, report: stageFile(novelDir, "plan"), ...(behind.length ? { note: `Prepared with --force while ${behind.join(", ")} were not done.` } : {}) };
}

export async function stageShow(novelDir: string): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  return {
    scale: { places: inputs.scalePlaces.length, picked: Object.keys(inputs.scale?.places ?? {}).length, current: inputs.scaleCurrent, picks: Object.fromEntries(Object.values(inputs.scale?.places ?? {}).map((pick) => [pick.label, `${pick.scale} (${pick.by})`])) },
    architecture: { places: inputs.places.length, picked: Object.keys(inputs.architecture?.places ?? {}).length, current: inputs.architectureCurrent, picks: Object.fromEntries(Object.values(inputs.architecture?.places ?? {}).map((pick) => [pick.label, `${pick.kind} (${pick.by})`])) },
    movement: { scenes: inputs.movementScenes.length, asked: Object.keys(inputs.movement?.scenes ?? {}).length, current: inputs.movementCurrent, estimatedRequests: inputs.estimate, maxRequests: inputs.limit },
    plan: { current: inputs.planCurrent, ...(inputs.plan ? { preparedAt: inputs.plan.preparedAt, ...inputs.plan.counts } : {}) },
  };
}

/**
 * The timeline as story lines for the stage's simulation (no model calls):
 * each scene's own cast and where each person comes from (environment.ts,
 * where a line is a fork of the timeline — not a `novel fork` branch).
 * `line` lists one line's scenes, by the id of the scene it starts at.
 */
export async function stageLines(novelDir: string, options: { line?: string } = {}): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  if (!inputs.data.available) throw new Error(`The story lines follow story time, which ${novelDir} does not have yet. See novel checklist.`);
  const answers = inputs.answers;
  const strands = storyStrands(inputs.data, answers ?? {});
  const staged = new Map(inputs.movementScenes.map((scene) => [scene.id, scene]));
  // A staged scene walks its stage cast; any other scene still passes people on, with its answered or recorded cast (never a borrowed one),
  // at its place with a building as the stage picks it, so "the same place" means the same stage.
  const scenes: TimelineScene[] = inputs.data.scenes.map((scene) => {
    const stage = staged.get(scene.id);
    return { id: scene.id, index: scene.index, placeId: stage?.placeId ?? scene.placeIds.find((id) => inputs.architecture?.places[id]?.kind && inputs.architecture.places[id].kind !== "none") ?? scene.placeIds[0] ?? null, flashback: scene.flashback, cast: stage?.cast ?? answers?.presence.get(scene.id) ?? scene.characterIds, events: stage?.events };
  });
  const timeline = forkTimeline(scenes, strands);
  const label = new Map(inputs.data.scenes.map((scene) => [scene.id, scene.label === scene.id ? null : scene.label])), byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const name = (id: string) => inputs.names[id] ?? id;
  if (options.line) {
    const fork = timeline.forks.find((entry) => entry.id === options.line);
    if (!fork) throw new Error(`No story line starts at ${options.line}. Lines start at: ${timeline.forks.map((entry) => entry.id).join(", ")}.`);
    return { line: fork.id, from: fork.from, to: fork.to, people: fork.people.map(name), scenes: fork.scenes.map((id) => {
      const scene = byId.get(id)!;
      return { id, label: label.get(id), place: scene.placeId ? name(scene.placeId) : null, events: scene.events?.length ?? 0,
        cast: Object.fromEntries((timeline.handoffs.get(id) ?? []).map((handoff) => [name(handoff.person), handoff.from ? `${handoff.samePlace ? "stays on from" : "arrives from"} ${handoff.from}` : "starts here"])) };
    }) };
  }
  const handoffs = [...timeline.handoffs.values()].flat();
  // What carrying people through a place from the start of the timeline would hold: everyone ever there.
  const stacked = new Map<string, Set<string>>();
  for (const scene of scenes) if (scene.placeId) for (const person of scene.cast) stacked.set(scene.placeId, (stacked.get(scene.placeId) ?? new Set()).add(person));
  return {
    scenes: scenes.length, staged: staged.size, lines: timeline.forks.length, splits: strands.forks.size, merges: strands.merges.size,
    people: { perSceneMax: Math.max(0, ...scenes.map((scene) => scene.cast.length)), perLineMax: Math.max(0, ...timeline.forks.map((fork) => fork.people.length)), perPlaceIfStackedMax: Math.max(0, ...[...stacked.values()].map((people) => people.size)) },
    handoffs: { staysAtPlace: handoffs.filter((handoff) => handoff.samePlace).length, arrivesFromElsewhere: handoffs.filter((handoff) => handoff.from && !handoff.samePlace).length, startsFresh: handoffs.filter((handoff) => !handoff.from).length },
    list: timeline.forks.map((fork) => ({ id: fork.id, starts: label.get(fork.scenes[0]), scenes: fork.scenes.length, people: fork.people.length, from: fork.from, to: fork.to })),
  };
}

/**
 * `novel stage objects`: the buildings and large visible things each staged
 * scene puts in its place (objects.ts), matched to what the stage can draw.
 * Work-model calls, a few scenes per call, bounded by --max-calls; answers
 * are kept per scene and reused while the scene's events stay the same.
 */
export async function stageObjects(novelDir: string, options: StageOptions & { work?: boolean } = {}): Promise<Record<string, unknown>> {
  await requireAnalysis(novelDir, "Object detection", ["blocks", "strands", "time-place", "place-tree"], options.force);
  const env = options.env ?? process.env, inputs = await stageInputs(novelDir);
  const scenes: ObjectScene[] = inputs.movementScenes.map((scene) => ({ id: scene.id, placeLabel: scene.placeLabel, events: scene.events.map((event) => ({ id: event.id, text: event.text.split("（原文：")[0] })) }));
  const work = options.work === false || !env.WORK_LLM_API_KEY?.trim() ? undefined : options.cache ? cachedWork(workModelFromEnv(env), options.cache) : workModelFromEnv(env);
  let embedder = null;
  try { const cfg = loadConfig(env); embedder = loadEmbedder({ provider: cfg.embeddings.provider, model: cfg.embeddings.model, dimension: cfg.embeddings.dimension, baseUrl: cfg.embeddings.baseUrl, apiKey: env.EMBEDDING_API_KEY?.trim() || null }); } catch { embedder = null; }
  const report = await detectObjects(scenes, { work, embedder, previous: await readJson<ObjectsReport>(stageFile(novelDir, "objects")), maxCalls: options.maxCalls });
  await writeReport(stageFile(novelDir, "objects"), report);
  const all = Object.values(report.scenes).flatMap((scene) => scene.objects);
  const byMatch: Record<string, number> = {};
  for (const object of all) byMatch[object.match.id] = (byMatch[object.match.id] ?? 0) + 1;
  return { scenes: scenes.length, withObjects: Object.values(report.scenes).filter((scene) => scene.objects.length).length, objects: all.length, rejected: Object.values(report.scenes).reduce((sum, scene) => sum + scene.rejected, 0), byMatch, ranking: report.embedder ? `embedding (${report.embedder})` : "words", usage: report.usage, complete: report.complete, report: stageFile(novelDir, "objects"),
    ...(work ? {} : { note: "No work model configured (WORK_LLM_API_KEY): nothing was asked; scenes are left for a run with one." }) };
}

export const STAGE_USAGE = "novel stage objects <novel-dir> [--max-calls N] [--cache dir] [--no-work] [--force] | novel stage show <novel-dir> | novel stage lines <novel-dir> [--line <scene-id>] | novel stage scale <novel-dir> [--no-jev] [--cache dir] | novel stage architecture <novel-dir> [--no-jev] [--cache dir] [--force] | novel stage movement <novel-dir> [--no-jev] [--max-calls N] [--cache dir] [--force] | novel stage prep <novel-dir> [--force]";
