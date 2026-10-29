import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { storyStrands } from "../../../digger/timeplace/strandQuestions.js";
import { forkTimeline, type TimelineScene } from "../../../digger/stage/environment.js";
import { stageInputs } from "./stageCommands.js";

/**
 * `novel sim strands|run|show` — the stage simulation as a product step: the
 * engine (playground/export-strand-demo.mjs: places composed from the place
 * tree, the per-fork walk, the path-integral sampler, placed things, damage)
 * run on a book's story lines, each run kept with the book as a versioned
 * run (stage/simulation/: the record, the player's data, what it was made
 * from, the engine version, the accepted run). No model calls: Jev's answers
 * the engine reads (movement spots, placements, impacts) come from the stage
 * reports, and where none exist it uses its stand-ins. Derived view data,
 * never canon (docs/stage-simulation-records.md). The host plays a book's
 * accepted runs (the viewer's `play/` page).
 */
interface SimStrand { id: string; from: string; to: string; fork: string; title?: string }
interface KeptRun { strand: string; run: string; fresh: boolean; accepted: string; note?: string }
interface StrandData { title: string; notes: { hits?: number }; things: unknown[]; places: Record<string, unknown>; scenes: { events: { moves: unknown[] }[] }[] }
interface Engine {
  ENGINE: string;
  runStrand(novelDir: string, strand: Omit<SimStrand, "id">): Promise<StrandData>;
  simulationRecord(data: StrandData, strand: Omit<SimStrand, "title">): { strand: { title: string } };
  simulationInputs(novelDir: string): Promise<string>;
  keepRun(folder: string, strand: Omit<SimStrand, "title">, record: unknown, options: { inputs: string; accept?: boolean; page?: unknown }): Promise<KeptRun>;
}
interface SimIndex { version?: number; strands: Record<string, { title?: string; from?: string; to?: string; fork?: string | null; accepted?: string; runs?: { id: string; inputs: string | null; engine: string | null; page?: string; scenes: number; hits: number; things: number; exportedAt: string }[] }> }

/** The repository this CLI runs from (the engine is its playground script, on the compiled modules beside it). */
async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    if (pkg?.name === "novel-ontology-pi") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The simulation engine is not installed beside this CLI (playground/export-strand-demo.mjs).");
    directory = parent;
  }
}
const engine = async (): Promise<Engine> => import(pathToFileURL(join(await repository(), "playground", "export-strand-demo.mjs")).href) as Promise<Engine>;
const simulationFolder = (novelDir: string) => join(novelDir, "stage", "simulation");
const readIndex = async (novelDir: string): Promise<SimIndex> => readFile(join(simulationFolder(novelDir), "index.json"), "utf8").then((text) => JSON.parse(text) as SimIndex, () => ({ strands: {} }));

/**
 * The book's story lines as the engine walks them (each a fork of the
 * timeline), with the scenes it would simulate on each (scenes in a place
 * with a building and events), ranked: the most simulated scenes first,
 * then the most people.
 */
export async function simStrandList(novelDir: string) {
  const inputs = await stageInputs(novelDir);
  if (!inputs.data.available) throw new Error(`The simulation follows story time, which ${novelDir} does not have yet. See novel checklist.`);
  const strands = storyStrands(inputs.data, inputs.answers ?? {});
  const staged = new Map(inputs.movementScenes.map((scene) => [scene.id, scene]));
  // As the engine builds its timeline: a staged scene at its stage place with its stage cast, any other at its first place with its answered or recorded cast.
  const scenes: TimelineScene[] = inputs.data.scenes.map((scene) => { const stage = staged.get(scene.id); return { id: scene.id, index: scene.index, placeId: stage?.placeId ?? scene.placeIds[0] ?? null, flashback: scene.flashback, cast: stage?.cast ?? inputs.answers?.presence.get(scene.id) ?? scene.characterIds }; });
  const index = new Map(inputs.data.scenes.map((scene) => [scene.id, scene.index]));
  const name = (id: string) => inputs.names[id] ?? id;
  return forkTimeline(scenes, strands).forks.map((fork) => {
    const simulated = fork.scenes.filter((id) => staged.get(id)?.events.length).sort((first, second) => index.get(first)! - index.get(second)!);
    const places = [...new Set(simulated.map((id) => staged.get(id)!.placeId))];
    return { id: fork.id, scenes: fork.scenes.length, simulated: simulated.length, people: fork.people.length, from: simulated[0] ?? null, to: simulated.at(-1) ?? null, places: places.map(name), firstPerson: fork.people.slice(0, 4).map(name) };
  }).filter((line) => line.simulated > 0).sort((first, second) => second.simulated - first.simulated || second.people - first.people || first.id.localeCompare(second.id));
}

export async function simStrands(novelDir: string): Promise<Record<string, unknown>> {
  const lines = await simStrandList(novelDir);
  return { lines: lines.length, list: lines.map(({ firstPerson, ...line }) => ({ ...line, people: firstPerson })), note: lines.length ? "novel sim run <dir> --auto N simulates the first N; --strand <id> one of them." : "No story line has a scene in a place with a building and events yet: run the stage steps first (novel checklist)." };
}

/** What the simulation needs first: the analysis complete, and the stage reports it reads current (scale, buildings, objects reviewed, movement). */
async function requireStage(novelDir: string) {
  const { bookChecklist } = await import("./checklistCommands.js");
  const checklist = await bookChecklist(novelDir);
  const waiting = [...checklist.items, ...(checklist.stage?.items ?? [])].filter((item) => item.id !== "stage" && item.id !== "simulation" && !["done", "optional"].includes(item.status));
  if (waiting.length) throw new Error(`The simulation waits for every other step: ${waiting.map((item) => `${item.id} (${item.status})`).join(", ")}. See novel checklist.`);
}

/**
 * `novel sim run`: the engine on the chosen story lines (`--strand` one, `--auto N` the first N of `novel sim strands`), each
 * kept as a run. The first run of a line is its accepted one; a later run is kept beside it and accepted only with --accept.
 */
export async function simRun(novelDir: string, options: { strand?: string; auto?: number; accept?: boolean } = {}): Promise<Record<string, unknown>> {
  await requireStage(novelDir);
  const lines = await simStrandList(novelDir);
  const chosen = options.strand ? lines.filter((line) => line.id === options.strand) : lines.slice(0, Math.max(1, options.auto ?? 1));
  if (options.strand && !chosen.length) throw new Error(`No story line ${options.strand} with a simulated scene. Lines: ${lines.map((line) => line.id).join(", ") || "none"}.`);
  const sim = await engine(), inputs = await sim.simulationInputs(novelDir), runs = [];
  for (const line of chosen) {
    const started = Date.now(), strand = { id: line.id.replace(/[^A-Za-z0-9_-]/g, "_"), from: line.from!, to: line.to!, fork: line.id };
    const data = await sim.runStrand(novelDir, { from: strand.from, to: strand.to, fork: strand.fork });
    const kept = await sim.keepRun(simulationFolder(novelDir), strand, sim.simulationRecord(data, strand), { inputs, accept: options.accept, page: data });
    runs.push({ ...kept, title: data.title, places: Object.keys(data.places).length, scenes: data.scenes.length, moves: data.scenes.reduce((sum, scene) => sum + scene.events.reduce((count, event) => count + event.moves.length, 0), 0), hits: data.notes.hits ?? 0, things: data.things.length, seconds: (Date.now() - started) / 1000 });
  }
  return { engine: sim.ENGINE, inputs, runs, note: "Derived view data, never canon. The viewer plays each line's accepted run (play/ beside the app)." };
}

/** A book's simulation as kept: per story line its accepted run, how many runs, and whether the accepted run was made from the book as it is now. */
export async function simStatus(novelDir: string) {
  const index = await readIndex(novelDir), current = await (await engine()).simulationInputs(novelDir);
  const lines = Object.entries(index.strands).map(([id, entry]) => {
    const accepted = entry.runs?.find((run) => run.id === entry.accepted) ?? null, latest = entry.runs?.at(-1) ?? null;
    return { id, title: entry.title ?? id, runs: entry.runs?.length ?? 1, accepted: accepted?.id ?? entry.accepted ?? null, playable: !!accepted?.page,
      current: accepted?.inputs === current, newerCurrent: !!latest && latest !== accepted && latest.inputs === current,
      ...(accepted ? { scenes: accepted.scenes, hits: accepted.hits, things: accepted.things, engine: accepted.engine, exportedAt: accepted.exportedAt } : {}) };
  });
  return { inputs: current, lines };
}

export async function simShow(novelDir: string): Promise<Record<string, unknown>> {
  const status = await simStatus(novelDir);
  return { ...status, ...(status.lines.some((line) => line.newerCurrent) ? { note: "A newer run made from the book as it is now is kept but not accepted; the user accepts it (novel sim run … --accept)." } : {}) };
}

/** Whether the simulation is current for the checklist: every kept line has a playable run made from the book as it is now, and at least one line is kept. */
export async function simCurrent(novelDir: string): Promise<{ current: boolean; lines: number }> {
  if (!(await stat(join(simulationFolder(novelDir), "index.json")).then(() => true, () => false))) return { current: false, lines: 0 };
  const status = await simStatus(novelDir);
  return { current: status.lines.length > 0 && status.lines.every((line) => line.playable && (line.current || line.newerCurrent)), lines: status.lines.length };
}

export const SIM_USAGE = "novel sim strands <novel-dir> | novel sim run <novel-dir> [--auto N] [--strand <id>] [--accept] | novel sim show <novel-dir>";
