import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { Entity, Relation, Scene } from "../../ground/ontology/types.js";
import { listChangeSets } from "../../solidifier/merge/changesetStore.js";
import { storyStrands, strandProjection } from "./strandQuestions.js";

/**
 * The story strands of a workspace as other faculties read them (causality):
 * which scene happens before which, which run in parallel, and who is in each
 * scene. Built from stored story time and places (plus time-place proposals
 * awaiting review) and the casts of the latest answered strands report
 * (`novel timeplace strands --ask`), the same way the story view draws them.
 * Null when the book has no story time yet.
 */
export interface StrandView {
  /** a happens before b. */
  before(a: string, b: string): boolean;
  /** The scene is on the strands (has a place in story time). */
  has(sceneId: string): boolean;
  /** Who is in the scene: the answered cast where "who is present?" was asked, else the recorded one. */
  cast(sceneId: string): string[];
}

const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];

/** The latest answered strands report's casts and lone scenes. */
export async function latestStrandAnswers(novelDir: string): Promise<{ presence: Map<string, string[]>; alone: Set<string> } | null> {
  const folder = join(novelDir, "timeplace");
  for (const name of (await readdir(folder).catch(() => [] as string[])).filter((entry) => /^strands-[\w-]+\.json$/.test(entry)).sort().reverse()) {
    const report = JSON.parse(await readFile(join(folder, name), "utf8").catch(() => "null")) as { after?: unknown; casts?: Record<string, unknown>; alone?: unknown } | null;
    if (!report?.after) continue;
    const presence = new Map(Object.entries(report.casts ?? {}).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])).map(([id, ids]) => [id, ids.filter((value) => typeof value === "string")]));
    return { presence, alone: new Set(Array.isArray(report.alone) ? report.alone.filter((value): value is string => typeof value === "string") : []) };
  }
  return null;
}

export async function loadStrandView(novelDir: string): Promise<StrandView | null> {
  const bundle = new BundleStore(join(novelDir, "ontology"));
  const [scenes, entities, relations] = [fold(await bundle.loadFile<Scene>("scenes.jsonl")), fold(await bundle.loadFile<Entity>("entities.jsonl")), await bundle.loadFile<Relation>("relations.jsonl")];
  const pending = (await listChangeSets(novelDir).catch(() => [])).filter((changeset) => changeset.status === "pending_review" && changeset.id.startsWith("cs_timeplace")).flatMap((changeset) => changeset.proposals as unknown as { kind: string; payload: Record<string, unknown> }[]);
  const data = strandProjection({ scenes, entities, relations, pending });
  if (!data.available) return null;
  const answers = await latestStrandAnswers(novelDir);
  const strands = storyStrands(data, answers ?? {});
  const recorded = new Map(data.scenes.map((scene) => [scene.id, scene.characterIds]));
  return {
    before: (a, b) => strands.before(a, b),
    has: (sceneId) => strands.layer.has(sceneId),
    cast: (sceneId) => answers?.presence.get(sceneId) ?? recorded.get(sceneId) ?? [],
  };
}
