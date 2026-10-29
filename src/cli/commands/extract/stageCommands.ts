import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv, type DecisionModel } from "../../../ground/connectors/jev.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { cachedDecisions } from "../../../digger/timeplace/cache.js";
import { storyStrands, strandProjection } from "../../../digger/timeplace/strandQuestions.js";
import { latestStrandAnswers } from "../../../digger/timeplace/strandView.js";
import { forkTimeline, type TimelineScene } from "../../../digger/stage/environment.js";
import { castCandidates, namedInText } from "../../../digger/processing/castCandidates.js";
import { listChangeSets } from "../../../solidifier/merge/changesetStore.js";
import { architectureFingerprint, architecturePictures, pickArchitecture, type ArchitecturePlace, type ArchitectureReport } from "../../../digger/stage/architecture.js";
import { askMovement, movementFingerprint, sceneCallEstimate, sceneInputs, type MovementReport, type MovementScene } from "../../../digger/stage/movement.js";
import { prepareStage, prepFingerprint, type StagePlan } from "../../../digger/stage/prep.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";

/**
 * `novel stage architecture|movement|prep|show` — what read mode replays.
 * Two faculties and a last step, each writing a report under <book>/stage/
 * (view inputs: no review packet, nothing written to canon):
 *
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
const stageFile = (novelDir: string, name: "architecture" | "movement" | "plan") => join(novelDir, "stage", `${name}.json`);
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
  const pending = (await listChangeSets(novelDir).catch(() => [])).filter((changeset) => changeset.status === "pending_review" && changeset.id.startsWith("cs_timeplace")).flatMap((changeset) => changeset.proposals as unknown as { kind: string; payload: Record<string, unknown> }[]);
  const data = strandProjection({ scenes, entities, relations, pending });
  const sceneLabel = new Map(data.scenes.map((scene) => [scene.id, scene.label]));

  // Architecture: every place a scene happens in.
  const inside = (id: string) => data.places.filter((place) => place.parentId === id).map((place) => place.id);
  const places: ArchitecturePlace[] = data.places.filter((place) => place.sceneIds.length).map((place) => ({ id: place.id, label: place.label, path: place.path ?? [place.id], contains: inside(place.id), sceneLabels: place.sceneIds.map((id) => sceneLabel.get(id) ?? "").filter((label) => label && !/^scene_\d+$/.test(label)).slice(0, 3) }));
  const architecture = await readJson<ArchitectureReport>(stageFile(novelDir, "architecture"));
  const architectureCurrent = architecture?.inputs === architectureFingerprint(places);

  // Movement: scenes in a place with a building, their cast (the cast-candidate scorer over the full character list) and events.
  const sentences = await loadWorkspaceSentences(novelDir).catch(() => new Map<string, { text: string }>());
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const characters = entities.filter((entity) => entity.kind === "Character").map((entity) => ({ id: entity.id, forms: [...new Set((entity.names ?? []).map((form) => form.text).filter(Boolean))] }));
  const names: Record<string, string> = Object.fromEntries(entities.filter((entity) => entity.kind === "Character" || entity.kind === "Location").map((entity) => [entity.id, entity.names?.find((form) => form.kind === "canonical")?.text ?? entity.names?.[0]?.text ?? entity.id]));
  const stored = new Map(scenes.map((scene) => [scene.id, scene]));
  const text = (sceneId: string) => (stored.get(sceneId)?.sentenceIds ?? []).map((id) => sentences.get(id)?.text ?? "").join("");
  const candidates = castCandidates(data.scenes.map((scene) => ({ id: scene.id, chapterIndex: scene.chapterIndex, index: scene.index, text: text(scene.id), present: stored.get(scene.id)?.charactersPresent ?? [], mentioned: stored.get(scene.id)?.charactersMentioned ?? [] })), characters);
  const strands = await latestStrandCasts(novelDir);
  const sceneOf = new Map(scenes.flatMap((scene) => scene.sentenceIds.map((id) => [id, scene.id] as const)));
  const participants = new Map<string, Set<string>>();
  for (const relation of relations) if (relation.type === "PARTICIPATES_IN" && byId.get(relation.fromId)?.kind === "Character") participants.set(relation.toId, (participants.get(relation.toId) ?? new Set()).add(relation.fromId));
  const eventsByScene = new Map<string, StoredEvent[]>();
  for (const event of events.sort((first, second) => order(first.evidence?.sentenceIds?.[0]) - order(second.evidence?.sentenceIds?.[0]))) {
    const sceneId = sceneOf.get(event.evidence?.sentenceIds?.[0] ?? "");
    if (sceneId) eventsByScene.set(sceneId, [...eventsByScene.get(sceneId) ?? [], event]);
  }
  const kindOf = (placeId: string) => { const kind = architecture?.places[placeId]?.kind; return kind && kind !== "none" ? kind : null; };
  const movementScenes: MovementScene[] = [];
  for (const scene of data.scenes) {
    const placeId = scene.placeIds.find((id) => kindOf(id));
    const sceneEvents = eventsByScene.get(scene.id) ?? [];
    if (!placeId || !sceneEvents.length) continue;
    const moving = sceneEvents.map((event) => {
      const evidence = event.evidence?.text ?? "";
      const actors = new Set([...(participants.get(event.id) ?? []), ...(event.primaryActors ?? []).filter((id) => byId.get(id)?.kind === "Character"), ...namedInText(evidence, characters).unique]);
      return { id: event.id, text: `${clip(event.summaryEn ?? event.summary ?? "", 160)}${evidence ? `（原文：${clip(evidence, 140)}）` : ""}`, actors: [...actors] };
    });
    // The cast: who the scorer finds named or recorded in the scene, whom the strands answered present, and whoever its events name.
    const scored = new Map((candidates.get(scene.id) ?? []).filter((candidate) => candidate.score >= 1).map((candidate) => [candidate.id, candidate.score]));
    const appearances = new Map<string, number>();
    for (const event of moving) for (const id of event.actors) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    const cast = [...new Set([...scored.keys(), ...(strands?.[scene.id] ?? []), ...appearances.keys()])].filter((id) => byId.get(id)?.kind === "Character")
      .sort((first, second) => (appearances.get(second) ?? 0) - (appearances.get(first) ?? 0) || (scored.get(second) ?? 0) - (scored.get(first) ?? 0)).slice(0, CAST_LIMIT);
    const castSet = new Set(cast);
    movementScenes.push({ id: scene.id, placeId, placeLabel: names[placeId] ?? placeId, kind: kindOf(placeId)!, opening: `${clip(scene.label, 160)}${text(scene.id) ? `（开头：${clip(text(scene.id), 200)}）` : ""}`, cast,
      events: moving.map((event) => ({ ...event, actors: event.actors.filter((id) => castSet.has(id)) })) });
  }
  const movement = await readJson<MovementReport>(stageFile(novelDir, "movement"));
  const movementCurrent = !!movement?.complete && movement.inputs === movementFingerprint(movementScenes, names);
  const plan = await readJson<StagePlan>(stageFile(novelDir, "plan"));
  const planCurrent = architectureCurrent && movementCurrent && plan?.inputs === prepFingerprint(architecture!.inputs, movement!.inputs);
  return { data, places, architecture, architectureCurrent, movementScenes, names, movement, movementCurrent, plan, planCurrent,
    estimate: Math.ceil(movementScenes.reduce((sum, scene) => sum + (movement?.scenes[scene.id]?.inputs === sceneInputs(scene, names) ? 0 : sceneCallEstimate(scene)), 0)) };
}

/** Who the latest answered strands report says is present, per scene (`novel timeplace strands --ask`). */
async function latestStrandCasts(novelDir: string): Promise<Record<string, string[]> | null> {
  const names = (await readdir(join(novelDir, "timeplace")).catch(() => [] as string[])).filter((name) => /^strands-.+\.json$/.test(name)).sort().reverse();
  for (const name of names) {
    const report = await readJson<{ after?: unknown; casts?: Record<string, string[]> }>(join(novelDir, "timeplace", name));
    if (report?.after) return report.casts ?? {};
  }
  return null;
}

export interface StageOptions { jev?: boolean; cache?: string; maxCalls?: number; force?: boolean; env?: NodeJS.ProcessEnv }
const decisionsFor = (options: StageOptions): DecisionModel | undefined => options.jev === false ? undefined : options.cache ? cachedDecisions(jevFromEnv(options.env ?? process.env), options.cache) : jevFromEnv(options.env ?? process.env);

export async function stageArchitecture(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  const decisions = decisionsFor(options);
  const report = await pickArchitecture(inputs.places, { decisions, pictures: decisions ? await architecturePictures() : {}, names: inputs.names, previous: inputs.architecture });
  await writeReport(stageFile(novelDir, "architecture"), report);
  const kinds: Record<string, number> = {};
  for (const pick of Object.values(report.places)) kinds[pick.kind] = (kinds[pick.kind] ?? 0) + 1;
  return { places: inputs.places.length, kinds, byJev: Object.values(report.places).filter((pick) => pick.by === "jev").length, usage: report.usage, report: stageFile(novelDir, "architecture") };
}

export async function stageMovement(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
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
  // The animation prep comes last: every other faculty of the book done, every packet reviewed.
  const { bookChecklist } = await import("./checklistCommands.js");
  const waiting = (await bookChecklist(novelDir)).items.filter((item) => item.id !== "stage" && !["done", "optional"].includes(item.status));
  if (waiting.length && !options.force) throw new Error(`Animation prep waits for every other step: ${waiting.map((item) => `${item.id} (${item.status})`).join(", ")}. See novel checklist.`);
  const inputs = await stageInputs(novelDir);
  if (!inputs.architecture || !inputs.movement) throw new Error("Animation prep needs the stage faculties' reports: novel stage architecture, then novel stage movement.");
  const plan = prepareStage(inputs.architecture, inputs.movement);
  await writeReport(stageFile(novelDir, "plan"), plan);
  return { ...plan.counts, inputs: plan.inputs, report: stageFile(novelDir, "plan"), ...(waiting.length ? { note: `Prepared with --force while ${waiting.map((item) => item.id).join(", ")} were not done.` } : {}) };
}

export async function stageShow(novelDir: string): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  return {
    architecture: { places: inputs.places.length, picked: Object.keys(inputs.architecture?.places ?? {}).length, current: inputs.architectureCurrent, picks: Object.fromEntries(Object.values(inputs.architecture?.places ?? {}).map((pick) => [pick.label, `${pick.kind} (${pick.by})`])) },
    movement: { scenes: inputs.movementScenes.length, asked: Object.keys(inputs.movement?.scenes ?? {}).length, current: inputs.movementCurrent, estimatedRequests: inputs.estimate },
    plan: { current: inputs.planCurrent, ...(inputs.plan ? { preparedAt: inputs.plan.preparedAt, ...inputs.plan.counts } : {}) },
  };
}

/**
 * The timeline as forks for the stage's simulation (no model calls): each
 * scene's own cast and where each person comes from (environment.ts).
 * `fork` lists one fork's scenes, by the id of the scene it starts at.
 */
export async function stageForks(novelDir: string, options: { fork?: string } = {}): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  if (!inputs.data.available) throw new Error(`The forks follow story time, which ${novelDir} does not have yet. See novel checklist.`);
  const answers = await latestStrandAnswers(novelDir);
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
  if (options.fork) {
    const fork = timeline.forks.find((entry) => entry.id === options.fork);
    if (!fork) throw new Error(`No fork starts at ${options.fork}. Forks start at: ${timeline.forks.map((entry) => entry.id).join(", ")}.`);
    return { fork: fork.id, from: fork.from, to: fork.to, people: fork.people.map(name), scenes: fork.scenes.map((id) => {
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
    scenes: scenes.length, staged: staged.size, forks: timeline.forks.length, splits: strands.forks.size, merges: strands.merges.size,
    people: { perSceneMax: Math.max(0, ...scenes.map((scene) => scene.cast.length)), perForkMax: Math.max(0, ...timeline.forks.map((fork) => fork.people.length)), perPlaceIfStackedMax: Math.max(0, ...[...stacked.values()].map((people) => people.size)) },
    handoffs: { staysAtPlace: handoffs.filter((handoff) => handoff.samePlace).length, arrivesFromElsewhere: handoffs.filter((handoff) => handoff.from && !handoff.samePlace).length, startsFresh: handoffs.filter((handoff) => !handoff.from).length },
    list: timeline.forks.map((fork) => ({ id: fork.id, starts: label.get(fork.scenes[0]), scenes: fork.scenes.length, people: fork.people.length, from: fork.from, to: fork.to })),
  };
}

export const STAGE_USAGE = "novel stage show <novel-dir> | novel stage forks <novel-dir> [--fork <scene-id>] |novel stage architecture <novel-dir> [--no-jev] [--cache dir] | novel stage movement <novel-dir> [--no-jev] [--max-calls N] [--cache dir] | novel stage prep <novel-dir> [--force]";
