import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jevFromEnv, type DecisionModel } from "../../../ground/connectors/jev.js";
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
 *
 * `novel sim pick` simulates each story line live first, event by event in
 * story time: on a picture of the event as it begins (headless Chrome), Jev
 * decides where the people go, where the things it mentions stand and where
 * its fight hits and how big (playground/sim-jev.mjs), and the next event
 * begins from what those answers made. Answers are kept in the stage reports
 * the engine reads, so the runs made after it play them. While either command runs, it writes what it
 * is doing to stage/simulation/live.json for the host's `play/live` page.
 */
interface SimStrand { id: string; from: string; to: string; fork: string; title?: string }
interface KeptRun { strand: string; run: string; fresh: boolean; accepted: string; note?: string }
interface StrandData { title: string; notes: { hits?: number; impacts?: { sphere: number; none: number } }; things: unknown[]; places: Record<string, unknown>; scenes: { events: { moves: unknown[] }[] }[] }
interface Engine {
  ENGINE: string;
  ENGINE_VERSION: number;
  runStrand(novelDir: string, strand: Omit<SimStrand, "id">, options?: { until?: { scene: string; event: number }; live?: (snapshot: unknown, page: unknown) => unknown; pace?: number }): Promise<StrandData>;
  simulationRecord(data: StrandData, strand: Omit<SimStrand, "title">): { strand: { title: string } };
  simulationInputs(novelDir: string): Promise<string>;
  keepRun(folder: string, strand: Omit<SimStrand, "title">, record: unknown, options: { inputs: string; accept?: boolean; page?: unknown }): Promise<KeptRun>;
}
interface LiveLine { id: string; title: string }
interface Live { line(index: number, patch: Record<string, unknown>): Promise<void>; phase(name: string): Promise<void>; world(snapshot: unknown, page?: unknown): Promise<void>; finish(status: "done" | "failed", extra?: Record<string, unknown>): Promise<void>; watch(jev: DecisionModel): DecisionModel }
interface PickCount { asked: number; reused: number; left: number; failed?: number }
interface Pickers {
  PICKER_MODEL: string;
  simulateLine(novelDir: string, strand: Omit<SimStrand, "id" | "title">, options: { jev: DecisionModel; budget: number; live?: Live }): Promise<{ calls: number; models: { picked: number; left: number }; events: PickCount; placements: PickCount; fights: PickCount; left: number; stepped: number }>;
  createLive(novelDir: string, options: { command: string; lines: LiveLine[]; budget?: number | null; model?: string | null }): Promise<Live>;
}
/** What `novel sim pick` last left (stage/simulation/picks.json): the book it asked on (`inputs`), the lines, and how many questions it did not get to. */
interface Picks { inputs: string; lines: string[]; left: number; complete: boolean; pickedAt: string }
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
const pickers = async (): Promise<Pickers> => import(pathToFileURL(join(await repository(), "playground", "sim-jev.mjs")).href) as Promise<Pickers>;
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

/** The story lines a command works on: `--strand` one, or `--auto N` the first N of `novel sim strands`. */
async function chooseLines(novelDir: string, options: { strand?: string; auto?: number }) {
  const lines = await simStrandList(novelDir);
  const chosen = options.strand ? lines.filter((line) => line.id === options.strand) : lines.slice(0, Math.max(1, options.auto ?? 1));
  if (options.strand && !chosen.length) throw new Error(`No story line ${options.strand} with a simulated scene. Lines: ${lines.map((line) => line.id).join(", ") || "none"}.`);
  return chosen.map((line) => ({ ...line, strand: { id: line.id.replace(/[^A-Za-z0-9_-]/g, "_"), from: line.from!, to: line.to!, fork: line.id }, title: line.places.join(" → ") }));
}

/**
 * `novel sim pick`: the chosen story lines simulated live, event by event, Jev deciding on a picture of each event as it
 * begins where the people go, where the things it mentions stand and where its fight hits (simulateLine), within
 * `--max-calls` (questions stop being started once that many calls are spent; what was decided is kept, so running it
 * again continues). Records what it left in stage/simulation/picks.json, which the checklist reads.
 */
export async function simPick(novelDir: string, options: { strand?: string; auto?: number; maxCalls?: number; env?: NodeJS.ProcessEnv } = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(options.maxCalls) || options.maxCalls! < 1) throw new Error("novel sim pick asks Jev: give --max-calls N, the most calls it may spend.");
  await requireStage(novelDir);
  const chosen = await chooseLines(novelDir, options), pick = await pickers(), sim = await engine(), budget = options.maxCalls!;
  const jev = jevFromEnv({ ...(options.env ?? process.env), JEV_MODEL: pick.PICKER_MODEL });
  const live = await pick.createLive(novelDir, { command: "pick", budget, model: jev.modelId, lines: chosen.map((line) => ({ id: line.strand.id, title: line.title })) });
  const watched = live.watch(jev), lines = [];
  let calls = 0;
  try {
    for (const [index, line] of chosen.entries()) {
      await live.line(index, { status: "asking" });
      const started = Date.now(), result = await pick.simulateLine(novelDir, { from: line.strand.from, to: line.strand.to, fork: line.strand.fork }, { jev: watched, budget: budget - calls, live });
      calls += result.calls;
      lines.push({ strand: line.strand.id, title: line.title, ...result, seconds: (Date.now() - started) / 1000 });
      await live.line(index, { status: result.left ? "unfinished" : "answered", calls: result.calls, left: result.left, events: result.events, placements: result.placements, fights: result.fights, stepped: result.stepped });
    }
  } catch (error) {
    await live.finish("failed", { error: String((error as Error).message).slice(0, 300) });
    throw error;
  }
  const left = lines.reduce((sum, line) => sum + line.left, 0);
  const picks: Picks = { inputs: await sim.simulationInputs(novelDir), lines: chosen.map((line) => line.strand.id), left, complete: left === 0, pickedAt: new Date().toISOString() };
  await replaceFile(join(simulationFolder(novelDir), "picks.json"), JSON.stringify(picks, null, 1));
  await live.finish("done", { left });
  return { model: jev.modelId, calls, budget, lines, left, complete: picks.complete,
    note: left ? `Stopped at --max-calls with about ${left} event(s) or question(s) left; run it again to continue (decisions so far are kept).` : "Every event on these lines is decided: where people go, where things stand, where fights hit. Next: novel sim run (the runs use them)." };
}

/** Whether Jev's answers are complete for the book as it is now: the last pick left nothing and nothing it was made from changed since. */
export async function simPicksDone(novelDir: string): Promise<{ done: boolean; left: number | null }> {
  const picks = await readFile(join(simulationFolder(novelDir), "picks.json"), "utf8").then((text) => JSON.parse(text) as Picks, () => null);
  if (!picks) return { done: false, left: null };
  const current = await (await engine()).simulationInputs(novelDir);
  return { done: picks.complete && picks.inputs === current, left: picks.inputs === current ? picks.left : null };
}

async function replaceFile(file: string, body: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o644 });
  await rename(temporary, file);
}

/** How much of a run Jev placed: placements in Jev's cast, fights hitting where Jev chose (or not at all), each of all. */
const jevShare = (data: StrandData) => {
  const placed = data.things.flatMap((thing) => (thing as { placed?: { boxed?: boolean }[] }).placed ?? []), hits = data.scenes.flatMap((scene) => scene.events.flatMap((event) => (event as { hit?: { sphere?: unknown } | null }).hit ?? []));
  return { placements: { jev: placed.filter((spot) => spot.boxed).length, of: placed.length }, fights: { jev: hits.filter((hit) => hit.sphere).length, none: data.notes.impacts?.none ?? 0, of: hits.length + (data.notes.impacts?.none ?? 0) } };
};

/**
 * `novel sim run`: the engine on the chosen story lines (`--strand` one, `--auto N` the first N of `novel sim strands`), each
 * kept as a run. The first run of a line is its accepted one; a later run is kept beside it and accepted only with --accept.
 */
/**
 * `pace` (seconds): each moment held that long, so the live view of the world shows every event as it plays (a run to watch).
 * `force`: an operator's run on a book whose other steps are not all done (never Pi's: its guard does not allow it).
 * `from` (with `--strand`): the line from that scene on, kept as a run of its own (`<line>_from_<scene>`), not the line's.
 */
export async function simRun(novelDir: string, options: { strand?: string; auto?: number; accept?: boolean; pace?: number; force?: boolean; from?: string } = {}): Promise<Record<string, unknown>> {
  if (!options.force) await requireStage(novelDir);
  if (options.from && !options.strand) throw new Error("--from needs --strand: the line it starts on.");
  const chosen = (await chooseLines(novelDir, options)).map((line) => (options.from ? { ...line, strand: { ...line.strand, id: `${line.strand.id}_from_${options.from.replace(/[^A-Za-z0-9_-]/g, "_")}`, from: options.from } } : line));
  const sim = await engine(), inputs = await sim.simulationInputs(novelDir), runs = [];
  const live = await (await pickers()).createLive(novelDir, { command: "run", lines: chosen.map((line) => ({ id: line.strand.id, title: line.title })) });
  try {
    for (const [index, line] of chosen.entries()) {
      await live.line(index, { status: "running" });
      const started = Date.now(), strand = line.strand;
      const data = await sim.runStrand(novelDir, { from: strand.from, to: strand.to, fork: strand.fork }, { live: (snapshot, page) => live.world(snapshot, page), ...(options.pace ? { pace: options.pace } : {}) });
      const kept = await sim.keepRun(simulationFolder(novelDir), strand, sim.simulationRecord(data, strand), { inputs, accept: options.accept, page: data });
      const run = { ...kept, title: data.title, places: Object.keys(data.places).length, scenes: data.scenes.length, moves: data.scenes.reduce((sum, scene) => sum + scene.events.reduce((count, event) => count + event.moves.length, 0), 0), hits: data.notes.hits ?? 0, things: data.things.length, jev: jevShare(data), seconds: (Date.now() - started) / 1000 };
      runs.push(run);
      await live.line(index, { status: "kept", run: kept.run, accepted: kept.accepted === kept.run, scenes: run.scenes, moves: run.moves, hits: run.hits, things: run.things, jev: run.jev });
    }
  } catch (error) {
    await live.finish("failed", { error: String((error as Error).message).slice(0, 300) });
    throw error;
  }
  await live.finish("done");
  const standIns = runs.some((run) => run.jev.placements.jev < run.jev.placements.of || run.jev.fights.jev + run.jev.fights.none < run.jev.fights.of);
  return { engine: sim.ENGINE, engineVersion: sim.ENGINE_VERSION, inputs, runs, note: `Derived view data, never canon. The viewer plays each line's accepted run (play/ beside the app).${standIns ? " Some placements or fights use stand-ins: novel sim pick asks Jev for them." : ""}` };
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

export const SIM_USAGE = "novel sim strands <novel-dir> | novel sim pick <novel-dir> --max-calls N [--auto N] [--strand <id>] | novel sim run <novel-dir> [--auto N] [--strand <id> [--from <scene-id>]] [--accept] [--pace seconds] [--force] | novel sim show <novel-dir>";
