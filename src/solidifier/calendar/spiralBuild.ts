import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { Entity, Relation, Scene } from "../../ground/ontology/types.js";
import { listChangeSets } from "../merge/changesetStore.js";
import type { CastScope } from "../identity/cast.js";
import { storyStrands, strandProjection } from "../../digger/timeplace/strandQuestions.js";
import { latestStrandAnswers } from "../../digger/timeplace/strandView.js";
import { solveSpiral, spiralTracks, stretchTime, SPIRAL, type SpiralRun, type SpiralTrack } from "../../digger/timeplace/spiral.js";
import { calendarBooks, loadCalendar } from "./calendar.js";

/**
 * The precomputed spiral timeline of a universe (or a standalone book): per
 * continuity, its books in reading order on one time axis, each strand run
 * a coil around its own axis, solved offline (spiral.ts) and stored next to
 * the calendar. The view only draws this geometry, at one uniform scale;
 * nothing is optimised at render time. Scene and run ids are `<sourceId>::<id>`.
 */
export interface SpiralFile {
  version: 3;
  universeId: string;
  builtAt: string;
  /** Hash of the runs and the calendar it was solved from: a different hash means it is out of date. */
  inputs: string;
  /** x units per quiet story layer and the scene radius (the same units across and along). */
  scale: { dx: number; knot: number };
  continuities: {
    id: string | null;
    /** The floor box this continuity's strands were laid out in (y from 0 to height, z within ±width/2). */
    frame: { width: number; height: number };
    books: { sourceId: string; title: string; from: number; to: number }[];
    runs: (SpiralTrack & { from?: string; into?: string })[];
    /** A character crossing between strands mid-way (scene to scene). */
    links: { from: string; to: string }[];
    /** Calendar days on this axis: where each starts and ends. */
    days: { key: string; label: string; from: number; to: number }[];
    metrics: { knots: number; pairs: number; crowding: [number, number]; overlap: [number, number] };
  }[];
}

export const spiralPath = (scope: Pick<CastScope, "root" | "universeId">) => join(scope.root, "calendar", `${scope.universeId}.spiral.json`);
export async function loadSpiral(scope: Pick<CastScope, "root" | "universeId">): Promise<SpiralFile | null> {
  // An older layout (another version) counts as missing: the next build replaces it.
  try { const file = JSON.parse(await readFile(spiralPath(scope), "utf8")) as SpiralFile; return file?.version === 3 ? file : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];

/** One book's strands as the view draws them: stored story time and places, pending time-place proposals, answered casts. */
async function bookStrands(workspace: string) {
  const bundle = new BundleStore(join(workspace, "ontology"));
  const [scenes, entities, relations] = [fold(await bundle.loadFile<Scene>("scenes.jsonl")), fold(await bundle.loadFile<Entity>("entities.jsonl")), await bundle.loadFile<Relation>("relations.jsonl")];
  const pending = (await listChangeSets(workspace).catch(() => [])).filter((changeset) => changeset.status === "pending_review" && changeset.id.startsWith("cs_timeplace")).flatMap((changeset) => changeset.proposals as unknown as { kind: string; payload: Record<string, unknown> }[]);
  const data = strandProjection({ scenes, entities, relations, pending });
  if (!data.available) return null;
  return { data, strands: storyStrands(data, (await latestStrandAnswers(workspace)) ?? {}) };
}

/** Build (or rebuild) the spiral timeline from every book's strands and the calendar's days. No model calls. */
export async function buildSpiral(scope: CastScope, options: { iterations?: number } = {}): Promise<SpiralFile> {
  const books = await calendarBooks(scope);
  const calendar = await loadCalendar(scope);
  const dayOf = new Map((calendar?.entries ?? []).filter((entry) => entry.placed !== "between" && entry.year !== null).map((entry) => [`${entry.sourceId}::${entry.timeId}`, { key: `${entry.year}-${entry.month}-${entry.day}`, label: `${entry.month}月${entry.day}日` }]));
  const lanes = new Map<string, typeof books>();
  for (const book of books) lanes.set(book.continuityId ?? "", [...(lanes.get(book.continuityId ?? "") ?? []), book]);
  const continuities: SpiralFile["continuities"] = [];
  const hashed: unknown[] = [calendar?.inputs ?? null];
  for (const [continuity, members] of lanes) {
    // Positions are global layers until every book is in; then time is stretched where strands crowd.
    type Layered = { id: string; knots: { id: string; x: number }[]; from?: { run: string; x: number }; into?: { run: string; x: number } };
    const runs = new Map<string, Layered>(), runOf = new Map<string, string>(), links: { from: string; to: string }[] = [];
    const placed: SpiralFile["continuities"][number]["books"] = [];
    const days = new Map<string, { key: string; label: string; from: number; to: number }>();
    let offset = 0;
    for (const book of members) {
      const loaded = await bookStrands(book.workspace);
      if (!loaded) continue;
      const { data, strands } = loaded, qualify = (id: string) => `${book.sourceId}::${id}`;
      const x = (id: string) => offset + strands.layer.get(id)!;
      const root = (id: string): string => { const previous = strands.continues.get(id); return previous ? root(previous) : id; };
      for (const scene of [...data.scenes].filter((entry) => strands.layer.has(entry.id)).sort((first, second) => strands.layer.get(first.id)! - strands.layer.get(second.id)!)) {
        const run = qualify(root(scene.id));
        runOf.set(qualify(scene.id), run);
        const entry = runs.get(run) ?? { id: run, knots: [] };
        entry.knots.push({ id: qualify(scene.id), x: x(scene.id) });
        runs.set(run, entry);
        const day = scene.flashback ? undefined : scene.times.map((time) => dayOf.get(`${book.sourceId}::${time.id}`)).find(Boolean);
        if (day) { const known = days.get(`${book.sourceId}|${day.key}`); days.set(`${book.sourceId}|${day.key}`, { ...day, from: Math.min(known?.from ?? Infinity, x(scene.id)), to: Math.max(known?.to ?? -Infinity, x(scene.id)) }); }
      }
      // Forks and merges: a run starting from another one's scene, or ending into one; other links cross between strands.
      for (const edge of strands.edges) {
        if ((edge.kind !== "worldline" && edge.kind !== "carried") || strands.continues.get(edge.to) === edge.from) continue;
        const from = runOf.get(qualify(edge.from)), to = runOf.get(qualify(edge.to));
        if (!from || !to || from === to) continue;
        const child = runs.get(to)!, parent = runs.get(from)!;
        if (child.knots[0].id === qualify(edge.to)) { if (!child.from || child.from.x < x(edge.from)) child.from = { run: from, x: x(edge.from) }; }
        else if (parent.knots.at(-1)!.id === qualify(edge.from)) { if (!parent.into || parent.into.x > x(edge.to)) parent.into = { run: to, x: x(edge.to) }; }
        else links.push({ from: qualify(edge.from), to: qualify(edge.to) });
      }
      placed.push({ sourceId: book.sourceId, title: book.title, from: offset, to: offset + strands.layers - 1 });
      offset += strands.layers + 2;
    }
    if (!runs.size) continue;
    const layered = [...runs.values()];
    const time = stretchTime(layered.map((run) => [run.from?.x ?? run.knots[0].x, run.into?.x ?? run.knots.at(-1)!.x]), offset);
    const at = (layer: number) => time[layer];
    const list: SpiralRun[] = layered.map((run) => ({ id: run.id, knots: run.knots.map((knot) => ({ id: knot.id, x: at(knot.x) })), ...(run.from ? { from: { run: run.from.run, x: at(run.from.x) } } : {}), ...(run.into ? { into: { run: run.into.run, x: at(run.into.x) } } : {}) }));
    for (const book of placed) { book.from = at(book.from); book.to = at(book.to); }
    for (const day of days.values()) { day.from = at(day.from); day.to = at(day.to); }
    hashed.push(continuity, list.map((run) => [run.id, run.knots.map((knot) => [knot.id, knot.x]), run.from ?? null, run.into ?? null]));
    const solution = solveSpiral(list, { iterations: options.iterations });
    continuities.push({
      id: continuity || null, frame: solution.frame, books: placed,
      runs: spiralTracks(list, solution).map((track) => ({ ...track, ...(runs.get(track.id)!.from ? { from: runs.get(track.id)!.from!.run } : {}), ...(runs.get(track.id)!.into ? { into: runs.get(track.id)!.into!.run } : {}) })),
      links, days: [...days.values()].sort((first, second) => first.from - second.from),
      metrics: { knots: list.reduce((sum, run) => sum + run.knots.length, 0), pairs: solution.pairs, crowding: [solution.initial.visibility, solution.visibility], overlap: [solution.initial.overlap, solution.overlap] },
    });
  }
  const file: SpiralFile = { version: 3, universeId: scope.universeId, builtAt: new Date().toISOString(), inputs: createHash("sha256").update(JSON.stringify(hashed)).digest("hex").slice(0, 16), scale: { dx: SPIRAL.dx, knot: SPIRAL.knot }, continuities };
  const path = spiralPath(scope), temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, JSON.stringify(file), { mode: 0o600 });
  await rename(temporary, path);
  return file;
}
