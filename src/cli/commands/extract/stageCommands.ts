import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv, type DecisionModel } from "../../../ground/connectors/jev.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { cachedDecisions } from "../../../digger/timeplace/cache.js";
import { storyStrands, strandProjection } from "../../../digger/timeplace/strandQuestions.js";
import { latestStrandAnswers } from "../../../digger/timeplace/strandView.js";
import { forkTimeline, type TimelineScene } from "../../../digger/stage/environment.js";
import { detectObjects, namedThings, objectIdentities, objectProposals, objectSceneInputs, type ObjectScene, type ObjectScenePlace, type ObjectsReport } from "../../../digger/stage/objects.js";
import { listChangeSets, saveChangeSet } from "../../../solidifier/merge/changesetStore.js";
import { timePlaceReviewSource } from "../../../digger/timeplace/afterApply.js";
import { castScope } from "../../../solidifier/identity/cast.js";
import { loadThings } from "../../../solidifier/identity/things.js";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import { loadEmbedder } from "../../../ground/connectors/embeddings.js";
import { loadConfig } from "../../config.js";
import { cachedWork } from "../../../digger/timeplace/cache.js";
import { architectureFingerprint, architecturePictures, pickArchitecture, type ArchitecturePlace, type ArchitectureReport } from "../../../digger/stage/architecture.js";
import { askMovement, movementFingerprint, pairsCallLimit, sceneCallEstimate, sceneCallLimit, sceneInputs, type MovementReport, type MovementScene } from "../../../digger/stage/movement.js";
import { prepareStage, prepFingerprint, type StagePlan } from "../../../digger/stage/prep.js";
import { pickScales, scaleFingerprint, SCALES, type ScalePlace, type ScaleReport } from "../../../digger/stage/scale.js";
import { landscapeFingerprint, landscapeProposal, OPEN_SCALES, pickLandscapes, type LandscapePlace, type LandscapeReport } from "../../../digger/stage/landscape.js";
import { firstLandscape, type Landscape } from "../../../ground/stage/landscape.js";
import { loadWorkspaceSentences, pendingTreeLinks } from "./timeplaceCommands.js";

/**
 * `novel stage scale|architecture|objects|movement|prep|show` — what read mode replays.
 * Four faculties and a last step, each writing a report under <book>/stage/
 * (view inputs, nothing written to canon directly; only the objects
 * faculty proposes facts, through a review packet). They run on request,
 * apart from the book's analysis (`novel checklist` lists them under
 * `stage`), and read reviewed canon only: a place or cast still awaiting
 * review is never paid for.
 *
 *   scale         how big each place in the tree is, region to room (Jev),
 *                 which decides how the stage builds it;
 *   architecture  each place's building, a sub-kind of place (names
 *                 shortlist, Jev picks among pictures) — after story time
 *                 and the place tree, beside strands and causality;
 *   objects       the buildings and large things each staged scene names;
 *                 the named ones, after the identity check, proposed to the
 *                 ontology (a building as a place of the tree, a thing as an
 *                 Item named in its scenes) for review — after architecture;
 *   movement      who moves where inside each scene's building, how (Jev) —
 *                 once the whole file is extracted (the full character list
 *                 feeds the cast-candidate scorer) and the buildings are
 *                 picked;
 *   prep          the animation prep: every chain checked physically, one
 *                 movement plan per place — only once every other faculty
 *                 of the book is done and the objects packet reviewed
 *                 (novel checklist), no model calls.
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
const stageFile = (novelDir: string, name: "scale" | "landscape" | "architecture" | "movement" | "plan" | "objects") => join(novelDir, "stage", `${name}.json`);
const readJson = async <T>(path: string): Promise<T | null> => readFile(path, "utf8").then((text) => JSON.parse(text) as T, () => null);
async function writeReport(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 1), { mode: 0o600 });
}

/** The world script of a world-first workspace (stage/world/script.json, from the world-first loop), or null. */
interface WorldScript { places: Record<string, { label: string; scale?: string | null }>; scenes: { id: string; place: string | null; clock: number[] | null; present: string[]; stayed: string[]; fragment?: boolean; context?: string }[] }
async function worldScript(novelDir: string): Promise<WorldScript | null> {
  const manifest = await readJson<{ worldFirst?: boolean }>(join(novelDir, "ontology", "manifest.json"));
  return manifest?.worldFirst ? readJson<WorldScript>(join(novelDir, "stage", "world", "script.json")) : null;
}
/**
 * A world-first workspace stages the world, not the reviewed presence (docs/world-first-design.md): each scene's cast is
 * who the world has there (present, and those who stayed unseen), its place is the world's (an unnamed place becomes a
 * place of its own), and a scene the world has in the past is a flashback. Places and names are added for the unnamed.
 */
function worldFirstScenes(data: ReturnType<typeof strandProjection>, world: WorldScript) {
  const byId = new Map(world.scenes.map((scene) => [scene.id, scene]));
  for (const scene of data.scenes) {
    const entry = byId.get(scene.id);
    if (!entry || entry.fragment) continue;
    scene.placeIds = entry.place ? [entry.place] : [];
    scene.placeCarried = false;
    scene.characterIds = [...new Set([...entry.present, ...entry.stayed])];
    scene.flashback = !entry.clock;
  }
  const known = new Set(data.places.map((place) => place.id));
  for (const [id, place] of Object.entries(world.places)) {
    const sceneIds = data.scenes.filter((scene) => scene.placeIds.includes(id)).map((scene) => scene.id);
    if (known.has(id)) { const stored = data.places.find((entry) => entry.id === id)!; stored.sceneIds = sceneIds; continue; }
    if (!sceneIds.length) continue;
    data.places.push({ id, label: place.label, sceneIds, statedScenes: sceneIds.length, characterIds: [], parentId: null, depth: 0, path: [id] });
    data.names[id] = place.label;
  }
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
  const world = await worldScript(novelDir);
  if (world) worldFirstScenes(data, world);
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
  // A world-first book's unnamed places go by the world's labels for them.
  if (world) for (const [id, place] of Object.entries(world.places)) names[id] ??= place.label;
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
  // The ontology's place tree: the strands' places, and every other place the ontology names, under the first place it
  // puts each in (as the strands view does). The stage's central build lays out every area of it before a scene runs.
  const projected = new Set(data.places.map((place) => place.id)), isLocation = (id: string) => byId.get(id)?.kind === "Location";
  const parentOf = new Map<string, string>();
  for (const relation of relations) if (relation.type === "PART_OF" && isLocation(relation.fromId) && isLocation(relation.toId) && !parentOf.has(relation.fromId)) parentOf.set(relation.fromId, relation.toId);
  const treePath = (id: string) => { const path: string[] = [], seen = new Set<string>(); for (let at: string | undefined = id; at && !seen.has(at); at = parentOf.get(at)) { seen.add(at); path.unshift(at); } return path; };
  // A parent the place-tree repair proposed for review (a pending PART_OF), for a place the reviewed tree puts in nothing:
  // never canon, and no stage step reads it; the simulation's central build lets the place dwell there until review decides.
  const proposedParent = new Map<string, string>();
  for (const link of await pendingTreeLinks(novelDir)) if (isLocation(link.fromId) && isLocation(link.toId) && !parentOf.has(link.fromId) && !proposedParent.has(link.fromId)) proposedParent.set(link.fromId, link.toId);
  const placeTree = [...data.places.map((place) => ({ id: place.id, label: place.label, parentId: place.parentId, proposedParentId: place.parentId ? null : proposedParent.get(place.id) ?? null, path: place.path ?? [place.id], sceneIds: place.sceneIds })),
    ...entities.filter((entity) => entity.kind === "Location" && !projected.has(entity.id)).map((entity) => ({ id: entity.id, label: names[entity.id] ?? entity.id, parentId: parentOf.get(entity.id) ?? null, proposedParentId: parentOf.has(entity.id) ? null : proposedParent.get(entity.id) ?? null, path: treePath(entity.id), sceneIds: [] as string[] }))];
  const within = (id: string) => placeTree.filter((place) => place.parentId === id).map((place) => place.id);
  // Scale: every place in the tree, with scenes of its own or not (the stage's map draws them all).
  const scalePlaces: ScalePlace[] = placeTree.map((place) => {
    const forms = byId.get(place.id)?.names ?? [], canonical = names[place.id] ?? place.label;
    return { id: place.id, label: place.label, aliases: [...new Set(forms.map((form) => form.text).filter((text) => text && text !== canonical))], path: place.path, contains: within(place.id) };
  });
  const scale = await readJson<ScaleReport>(stageFile(novelDir, "scale"));
  const scaleCurrent = scale?.inputs === scaleFingerprint(scalePlaces);
  // A world-first book stages every scene: a place no building picture fits is an office building when its scale is a
  // building or a room, and open city ground otherwise (an area, or an unnamed place).
  const kindOf = (placeId: string) => { const kind = architecture?.places[placeId]?.kind; if (kind && kind !== "none") return kind; if (!world) return null; return ["building", "room"].includes(scale?.places[placeId]?.scale ?? "") ? "office" : "city"; };
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
    const present = world ? scene.characterIds : answers?.presence.get(scene.id) ?? scene.characterIds;
    const appearances = new Map<string, number>();
    for (const event of moving) for (const id of event.actors) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    const cast = [...new Set([...present, ...appearances.keys()])].filter(isCharacter)
      .sort((first, second) => (appearances.get(second) ?? 0) - (appearances.get(first) ?? 0)).slice(0, CAST_LIMIT);
    const castSet = new Set(cast);
    // A world-first scene opens with its composed context (the world as it stands, the story so far, its full text).
    const composed = world?.scenes.find((entry) => entry.id === scene.id)?.context;
    movementScenes.push({ id: scene.id, placeId, placeLabel: names[placeId] ?? world?.places[placeId]?.label ?? placeId, kind: kindOf(placeId)!, opening: composed ?? `${clip(scene.label, 160)}${text(scene.id) ? `（开头：${clip(text(scene.id), 200)}）` : ""}`, cast,
      events: moving.map((event) => ({ ...event, actors: event.actors.filter((id) => castSet.has(id)) })) });
  }
  const movement = await readJson<MovementReport>(stageFile(novelDir, "movement"));
  // Current once every scene also has who goes together (asked after the other questions; older answers get only that).
  const movementCurrent = !!movement?.complete && movement.inputs === movementFingerprint(movementScenes, names) && movementScenes.every((scene) => movement.scenes[scene.id]?.pairs);
  const objects = await readJson<ObjectsReport>(stageFile(novelDir, "objects"));
  const objectsCurrent = !!objects?.complete && movementScenes.every((scene) => objects.scenes[scene.id]?.inputs === objectSceneInputs(objectScene(scene)));
  const plan = await readJson<StagePlan>(stageFile(novelDir, "plan"));
  const planCurrent = architectureCurrent && movementCurrent && plan?.inputs === prepFingerprint(architecture!.inputs, movement!.inputs);
  // What movement would still ask: the usual cost, and the most it can cost (what --max-calls must allow to finish in one run).
  const toAsk = movementScenes.filter((scene) => movement?.scenes[scene.id]?.inputs !== sceneInputs(scene, names));
  const toPair = movementScenes.filter((scene) => movement?.scenes[scene.id]?.inputs === sceneInputs(scene, names) && !movement.scenes[scene.id].pairs);
  // Landscape: every city, district and street by its scale, with what the text shows of it.
  const objectsAt = new Map<string, string[]>();
  for (const [sceneId, found] of Object.entries(objects?.scenes ?? {})) objectsAt.set(sceneId, found.objects.filter((object) => object.kind === "building" && !object.room).map((object) => object.name));
  const sentenceList = [...sentences.entries()];
  const landscapePlaces: LandscapePlace[] = placeTree.filter((place) => OPEN_SCALES.has(scale?.places[place.id]?.scale ?? "")).map((place) => {
    const label = names[place.id] ?? place.label, naming = sentenceList.filter(([, sentence]) => sentence.text.includes(label) && sentence.text.length >= label.length + 8).slice(0, 3);
    return { id: place.id, label, scale: scale!.places[place.id].scale, path: place.path, contains: within(place.id), scenes: place.sceneIds.map((id) => (sceneLabel.get(id) ?? "").split("（原文：")[0]).filter((text) => text && !/^scene_\d+$/.test(text)).map((text) => clip(text, 110)),
      buildings: [...new Set(place.sceneIds.flatMap((id) => objectsAt.get(id) ?? []))], sentences: naming.map(([, sentence]) => clip(sentence.text, 110)), sentenceIds: naming.map(([id]) => id) };
  });
  const landscape = await readJson<LandscapeReport>(stageFile(novelDir, "landscape"));
  const landscapeCurrent = !!landscape?.complete && landscape.inputs === landscapeFingerprint(landscapePlaces);
  return { data, places, placeTree, worldFirst: !!world, world, scalePlaces, scale, scaleCurrent, landscapePlaces, landscape, landscapeCurrent, architecture, architectureCurrent, movementScenes, names, movement, movementCurrent, objects, objectsCurrent, plan, planCurrent, answers,
    estimate: Math.ceil(toAsk.reduce((sum, scene) => sum + sceneCallEstimate(scene), 0) + toPair.reduce((sum, scene) => sum + pairsCallLimit(scene) * 0.5, 0)), limit: toAsk.reduce((sum, scene) => sum + sceneCallLimit(scene), 0) + toPair.reduce((sum, scene) => sum + pairsCallLimit(scene), 0) };
}

/** A staged scene as object detection reads it: its place and its events' summaries (without the quoted source). */
const objectScene = (scene: MovementScene): ObjectScene => ({ id: scene.id, placeLabel: scene.placeLabel, events: scene.events.map((event) => ({ id: event.id, text: event.text.split("（原文：")[0] })) });
/** The named buildings and things reviewed into the book (stage objects): how many of each, and their names (at most 40). */
async function objectsInOntology(novelDir: string): Promise<{ buildings: number; things: number; names: string[] }> {
  const records = fold(await new BundleStore(join(novelDir, "ontology")).loadFile<Entity>("entities.jsonl")).filter((entity) => entity.properties.source === "stage-objects");
  return { buildings: records.filter((entity) => entity.kind === "Location").length, things: records.filter((entity) => entity.kind === "Item").length, names: records.slice(0, 40).map((entity) => entity.names[0]?.text ?? entity.id) };
}
/** A stage-objects packet still awaiting review (one at a time). */
export const objectsPacketsOpen = async (novelDir: string) => (await listChangeSets(novelDir)).filter((changeset) => changeset.id.startsWith("cs_stage_objects_") && ["pending_review", "held", "revision_requested"].includes(changeset.status));

/** The analysis steps a stage step builds on must be done first (reviews included), unless forced: the stage never pays for unreviewed or unfinished input. */
async function requireAnalysis(novelDir: string, step: string, needs: string[] | "all", force?: boolean) {
  const { bookChecklist } = await import("./checklistCommands.js");
  const waiting = (await bookChecklist(novelDir, { stage: false })).items.filter((item) => (needs === "all" || needs.includes(item.id)) && !["done", "optional"].includes(item.status));
  if (waiting.length && !force) throw new Error(`${step} waits for ${needs === "all" ? "every other step" : "the steps it builds on"}: ${waiting.map((item) => `${item.id} (${item.status})`).join(", ")}. See novel checklist.`);
  return waiting;
}

/** A stage-landscape packet still awaiting review (one at a time). */
export const landscapePacketsOpen = async (novelDir: string) => (await listChangeSets(novelDir)).filter((changeset) => changeset.id.startsWith("cs_stage_landscape_") && ["pending_review", "held", "revision_requested"].includes(changeset.status));

/**
 * `novel stage landscape`: one Jev choice per city, district and street (by its scale) of what its ground looks like
 * from above; kept per place and asked again only when what the text shows of it changes. Each place's landscape (its
 * first patch, at its centre) is then proposed into the ontology as the place's `landscape` property, through the
 * shared review gate; the buildings it is filled with never are.
 */
export async function stageLandscape(novelDir: string, options: StageOptions = {}): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  if (!inputs.scaleCurrent) throw new Error(`Landscape needs each place's scale first: run \`novel stage scale ${novelDir}\`.`);
  const report = await pickLandscapes(inputs.landscapePlaces, { decisions: decisionsFor(options), names: inputs.names, previous: inputs.landscape });
  const types: Record<string, number> = {};
  for (const pick of Object.values(report.places)) types[pick.type] = (types[pick.type] ?? 0) + 1;
  // Into the ontology, through the shared review gate: a place whose landscape is new or of another type.
  const open = await landscapePacketsOpen(novelDir);
  let ontology: Record<string, unknown>;
  if (open.length) ontology = { packet: open[0].id, note: `A stage-landscape packet awaits review (${open[0].id}): review it (novel review show ${novelDir} ${open[0].id} --scope book --offset 0 --limit 20) before anything more is proposed.` };
  else {
    const entities = new Map(fold(await new BundleStore(join(novelDir, "ontology")).loadFile<Entity>("entities.jsonl")).map((entity) => [entity.id, entity]));
    const proposed = new Set(report.proposed ?? []), sentences = await loadWorkspaceSentences(novelDir);
    const proposals = inputs.landscapePlaces.flatMap((place) => {
      const pick = report.places[place.id], entity = entities.get(place.id), kept = entity?.properties.landscape as Landscape | undefined;
      if (!pick || pick.type === "none" || !entity || !place.sentenceIds?.length || kept?.patches?.[0]?.type === pick.type) return [];
      const proposal = landscapeProposal(entity, firstLandscape(place.id, pick.type), place.sentenceIds);
      return proposed.has(proposal.id) ? [] : [proposal];
    });
    let packet: string | null = null;
    if (proposals.length) {
      packet = `cs_stage_landscape_${Date.now()}`;
      await saveChangeSet(novelDir, { id: packet, blockId: "stage-landscape", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences), createdAt: new Date().toISOString(),
        reviewNotes: { "stage-landscape": `Stage landscape: ${proposals.length} place(s) with what its ground looks like from above (${Object.entries(types).map(([type, count]) => `${type} ${count}`).join(", ")}), each kept as the place's landscape property (its first patch, at its centre; the buildings it is filled with are never canon). Accept one only if its sentences show that kind of place (its era, what stands there).` } });
      report.proposed = [...proposed, ...proposals.map((proposal) => proposal.id)];
    }
    ontology = { packet, proposals: proposals.length, ...(packet ? { next: `novel review show ${novelDir} ${packet} --scope book --offset 0 --limit 20` } : {}) };
  }
  await writeReport(stageFile(novelDir, "landscape"), report);
  const unsure = Object.values(report.places).filter((pick) => (pick.confidence ?? 1) < 0.5).map((pick) => `${pick.label}: ${pick.type} (${pick.confidence})`);
  return { places: inputs.landscapePlaces.length, types, ...(unsure.length ? { unsure } : {}), usage: report.usage, complete: report.complete, report: stageFile(novelDir, "landscape"), ontology,
    ...(report.complete ? {} : { note: "Without Jev nothing is asked; places not asked before are left for a run with Jev." }) };
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
  const objectsOpen = await objectsPacketsOpen(novelDir);
  const stale = [...inputs.architectureCurrent ? [] : ["architecture (todo)"], ...inputs.objectsCurrent ? [] : ["objects (todo)"], ...objectsOpen.length ? ["objects (review)"] : [], ...inputs.movementCurrent ? [] : ["movement (todo)"]];
  if (stale.length && !options.force) throw new Error(`Animation prep waits for every other step: ${stale.join(", ")}. See novel checklist.`);
  const plan = prepareStage(inputs.architecture, inputs.movement);
  await writeReport(stageFile(novelDir, "plan"), plan);
  const behind = [...waiting.map((item) => item.id), ...stale];
  return { ...plan.counts, inputs: plan.inputs, report: stageFile(novelDir, "plan"), ...(behind.length ? { note: `Prepared with --force while ${behind.join(", ")} were not done.` } : {}) };
}

export async function stageShow(novelDir: string): Promise<Record<string, unknown>> {
  const inputs = await stageInputs(novelDir);
  return {
    landscape: { places: inputs.landscapePlaces.length, picked: Object.keys(inputs.landscape?.places ?? {}).length, current: inputs.landscapeCurrent, picks: Object.fromEntries(Object.values(inputs.landscape?.places ?? {}).map((pick) => [pick.label, pick.type])) },
    scale: { places: inputs.scalePlaces.length, picked: Object.keys(inputs.scale?.places ?? {}).length, current: inputs.scaleCurrent, picks: Object.fromEntries(Object.values(inputs.scale?.places ?? {}).map((pick) => [pick.label, `${pick.scale} (${pick.by})`])) },
    architecture: { places: inputs.places.length, picked: Object.keys(inputs.architecture?.places ?? {}).length, current: inputs.architectureCurrent, picks: Object.fromEntries(Object.values(inputs.architecture?.places ?? {}).map((pick) => [pick.label, `${pick.kind} (${pick.by})`])) },
    // Named buildings and things: detected per staged scene, proposed for review, and those now in the ontology.
    objects: { scenes: inputs.movementScenes.length, detected: Object.keys(inputs.objects?.scenes ?? {}).length, current: inputs.objectsCurrent, proposed: inputs.objects?.proposed?.length ?? 0, awaitingReview: (await objectsPacketsOpen(novelDir)).map((changeset) => changeset.id),
      inOntology: await objectsInOntology(novelDir) },
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
 *
 * What the book says about the named ones then goes to the ontology: each
 * name passes the identity check (this book's records and the universe's
 * things; Jev for names that are not full proper names, unless --no-jev),
 * and one review packet proposes the new records, a building's place in the
 * tree, a thing's scenes and new name forms, each citing the sentences of
 * the event that names it. While a packet awaits review no other is made.
 */
export async function stageObjects(novelDir: string, options: StageOptions & { work?: boolean } = {}): Promise<Record<string, unknown>> {
  await requireAnalysis(novelDir, "Object detection", ["blocks", "strands", "time-place", "place-tree"], options.force);
  const env = options.env ?? process.env, inputs = await stageInputs(novelDir);
  const scenes = inputs.movementScenes.map(objectScene);
  const work = options.work === false || !env.WORK_LLM_API_KEY?.trim() ? undefined : options.cache ? cachedWork(workModelFromEnv(env), options.cache) : workModelFromEnv(env);
  let embedder = null;
  try { const cfg = loadConfig(env); embedder = loadEmbedder({ provider: cfg.embeddings.provider, model: cfg.embeddings.model, dimension: cfg.embeddings.dimension, baseUrl: cfg.embeddings.baseUrl, apiKey: env.EMBEDDING_API_KEY?.trim() || null }); } catch { embedder = null; }
  const previous = await readJson<ObjectsReport>(stageFile(novelDir, "objects"));
  const report: ObjectsReport = { ...await detectObjects(scenes, { work, embedder, previous, maxCalls: options.maxCalls }), proposed: previous?.proposed ?? [] };
  const all = Object.values(report.scenes).flatMap((scene) => scene.objects);
  const byMatch: Record<string, number> = {};
  for (const object of all) byMatch[object.match.id] = (byMatch[object.match.id] ?? 0) + 1;

  // Into the ontology, through the shared review gate.
  const open = await objectsPacketsOpen(novelDir);
  let ontology: Record<string, unknown>;
  if (open.length) ontology = { packet: open[0].id, note: `A stage-objects packet awaits review (${open[0].id}): review it (novel review show ${novelDir} ${open[0].id} --scope book --offset 0 --limit 20) before anything more is proposed.` };
  else {
    const bundle = new BundleStore(join(novelDir, "ontology"));
    const entities = fold(await bundle.loadFile<Entity>("entities.jsonl")), relations = await bundle.loadFile<Relation>("relations.jsonl");
    const evidence = new Map(fold(await bundle.loadFile<StoredEvent>("events.jsonl")).map((event) => [event.id, event.evidence?.sentenceIds ?? []]));
    const sentences = await loadWorkspaceSentences(novelDir);
    const staged: ObjectScenePlace[] = inputs.movementScenes.map((scene) => ({ id: scene.id, placeId: scene.placeId, placeLabel: scene.placeLabel, events: objectScene(scene).events.map((event) => ({ ...event, sentenceIds: evidence.get(event.id) ?? [] })) }));
    const placeLabels = entities.filter((entity) => entity.kind === "Location" && entity.properties.source !== "stage-objects").flatMap((entity) => entity.names.map((form) => form.text));
    const things = namedThings(report, staged, placeLabels);
    const scope = await castScope(novelDir, env);
    const identities = await objectIdentities(things, { entities, things: await loadThings(scope), sourceId: scope.sourceId, books: scope.books, decisions: decisionsFor(options) });
    const proposals = objectProposals(things, identities, { entities, relations, proposed: new Set(report.proposed), sourceHas: (text, ids) => ids.some((id) => sentences.get(id)?.text.includes(text)) });
    const resolved = [...identities.values()], count = (method: string) => resolved.filter((identity) => identity.method === method).length;
    let packet: string | null = null;
    if (proposals.length) {
      packet = `cs_stage_objects_${Date.now()}`;
      const records = proposals.filter((proposal) => proposal.kind === "upsert_entity").length;
      await saveChangeSet(novelDir, { id: packet, blockId: "stage-objects", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences), createdAt: new Date().toISOString(),
        reviewNotes: { "stage-objects": `Stage objects: ${things.length} named building(s) and thing(s) in ${scenes.length} staged scene(s); ${records} new record(s) (a building is a place inside its scene's place, a thing an Item named in its scenes). Identity check: ${count("full-name")} bound by full name, ${count("jev")} by Jev, ${count("new")} new${resolved.some((identity) => identity.possible) ? `, ${resolved.filter((identity) => identity.possible).length} with a likely match (see possiblySame)` : ""}. Accept a fact only if its sentences show the thing, where it is and that it is the one named.` } });
      report.proposed = [...new Set([...report.proposed ?? [], ...proposals.map((proposal) => proposal.id)])];
    }
    ontology = { packet, proposals: proposals.length, named: things.length, identity: { fullName: count("full-name"), jev: count("jev"), new: count("new"), possible: resolved.filter((identity) => identity.possible).length },
      ...(packet ? { next: `novel review show ${novelDir} ${packet} --scope book --offset 0 --limit 20` } : {}) };
  }
  await writeReport(stageFile(novelDir, "objects"), report);
  return { scenes: scenes.length, withObjects: Object.values(report.scenes).filter((scene) => scene.objects.length).length, objects: all.length, rejected: Object.values(report.scenes).reduce((sum, scene) => sum + scene.rejected, 0), byMatch, ranking: report.embedder ? `embedding (${report.embedder})` : "words", usage: report.usage, complete: report.complete, report: stageFile(novelDir, "objects"), ontology,
    ...(work ? {} : { note: "No work model configured (WORK_LLM_API_KEY): nothing was asked; scenes are left for a run with one." }) };
}

export const STAGE_USAGE = "novel stage objects <novel-dir> [--max-calls N] [--cache dir] [--no-work] [--no-jev] [--force] | novel stage show <novel-dir> | novel stage lines <novel-dir> [--line <scene-id>] | novel stage scale <novel-dir> [--no-jev] [--cache dir] | novel stage landscape <novel-dir> [--no-jev] [--cache dir] | novel stage architecture <novel-dir> [--no-jev] [--cache dir] [--force] | novel stage movement <novel-dir> [--no-jev] [--max-calls N] [--cache dir] [--force] | novel stage prep <novel-dir> [--force]";
