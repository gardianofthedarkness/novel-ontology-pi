/**
 * A book's reading made in the workspace with one click (docs/v3/reading.md; the user, 2026-11-10: "I need to be able to
 * browse any novels on the mac ... When I enter the work model api and jev api, the reading phase work for a book is
 * automatically run by one click. You don't get involved, no agent is involved.")
 *
 * The keys are kept in the Mac's secure store (~/.config/novel-ontology/secrets.json, mode 600; src/ground/connectors/
 * secrets.ts): Jev's under "typesafe" (as `novel jev login` keeps it), the work model's under "work-llm". Nothing here
 * returns a key; only whether each is set and where from.
 *
 * A reading runs in a process of its own (detached, so it outlives the editor, a phone that disconnects, or the language
 * server): it stores the book's text in <folder>/.novel/books/<file id>/novel (the stored source the reading's sentence
 * ids cite), runs the v2 reading (experiments/v2/read.mjs; its EPUB too: the album and the introduction) into
 * .../reading, and links the result to the book. What it is doing is kept in .../reading.json and its log in
 * .../reading.log. Jev's and the work model's answers are cached, so a stopped or failed reading started again pays only
 * for what it had not asked.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NovelError } from "../ground/errors.js";
import { getStoredSecret, resolveJevKey, setStoredSecret } from "../ground/connectors/secrets.js";
import { STATE_DIR, findFile, linkReading, loadState, putBook, readBook, universeAdd } from "./folder.js";

export const WORK_SECRET_NAME = "work-llm";
const BLOCK_SIZE = 24000;
/** Dollars a character, from volume 1 (~$0.35 for ~125,000 characters, off-peak). */
const DOLLARS_PER_CHAR = 0.35 / 125000;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface ReadingStep { step: string; requests: number; ms: number }
export interface ReadingState {
  file: string; title: string; path: string;
  state: "running" | "done" | "failed" | "stopped";
  started: string; ended?: string; pid?: number;
  chars: number; estimate: number;
  steps: ReadingStep[];
  /** The step the reading is in, as its log names it. */
  now?: string;
  error?: string;
  /** Requests that were not cached (paid). */
  paid?: { jev: number; work: number };
}

export const placesOf = (folder: string, id: string) => {
  const book = join(resolve(folder), STATE_DIR, "books", id);
  return { book, novel: join(book, "novel"), reading: join(book, "reading"), data: join(book, "reading", "v2", "data.json"), state: join(book, "reading.json"), log: join(book, "reading.log") };
};

/** Whether each key is set and where from; never a value. */
export function keyStatus(env: NodeJS.ProcessEnv = process.env): { jev: string | null; work: string | null } {
  const jev = resolveJevKey(env)?.source ?? null;
  const work = env.WORK_LLM_API_KEY?.trim() ? "env" : getStoredSecret(WORK_SECRET_NAME, env) ? "store" : null;
  return { jev, work };
}
/** Keeps a key in the secure store. */
export function setKey(which: string, value: string, env: NodeJS.ProcessEnv = process.env): { jev: string | null; work: string | null } {
  if (which !== "jev" && which !== "work") throw new NovelError(`No key is called "${which}"; the keys are jev and work.`, { aspect: "usage", code: "INVALID_ARGUMENT" });
  if (!value?.trim()) throw new NovelError("The key is empty.", { aspect: "usage", code: "INVALID_ARGUMENT" });
  setStoredSecret(which === "jev" ? "typesafe" : WORK_SECRET_NAME, value.trim(), env);
  return keyStatus(env);
}

const pidAlive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
async function readState(path: string): Promise<ReadingState | null> { return readFile(path, "utf8").then((text) => JSON.parse(text) as ReadingState, () => null); }
async function writeState(path: string, state: ReadingState): Promise<void> { const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path); }

/** A book's reading as it stands: running, done, failed or stopped (a process that died without saying is failed). */
export async function readingStatus(folder: string, name: string): Promise<ReadingState | null> {
  const state = await loadState(resolve(folder)), file = findFile(state, name), at = placesOf(folder, file.id), now = await readState(at.state);
  if (now?.state === "running" && !pidAlive(now.pid)) { now.state = "failed"; now.error = "The reading's process ended without finishing; start it again (what it asked is cached)."; now.ended = new Date().toISOString(); await writeState(at.state, now); }
  return now;
}

/** Starts a book's reading in a process of its own and returns at once. */
export async function startReading(folder: string, name: string, options: { env?: NodeJS.ProcessEnv; standIn?: string } = {}): Promise<ReadingState> {
  const env = options.env ?? process.env, root = resolve(folder), state = await loadState(root), file = findFile(state, name), at = placesOf(root, file.id);
  if (file.missing || file.unread) throw new NovelError(`${file.path} cannot be read (${file.missing ? "it is gone" : file.unread}).`, { aspect: "path", code: "FOLDER_CANNOT_READ" });
  const now = await readState(at.state);
  if (now?.state === "running" && pidAlive(now.pid)) return now;
  const running = (await Promise.all(state.files.map(async (other) => readState(placesOf(root, other.id).state)))).find((other) => other?.state === "running" && pidAlive(other.pid));
  if (running) throw new NovelError(`${running.title} is being read; one reading runs at a time.`, { aspect: "conflict", code: "FOLDER_READING_RUNNING" });
  if (!options.standIn) {
    const keys = keyStatus(env), missing = [...(keys.jev ? [] : ["Jev's"]), ...(keys.work ? [] : ["the work model's"])];
    if (missing.length) throw new NovelError(`${missing.join(" and ")} key ${missing.length > 1 ? "are" : "is"} not set: enter ${missing.length > 1 ? "them" : "it"} first (Novel: Enter API Keys, or novel folder keys).`, { aspect: "model", code: "FOLDER_KEYS_MISSING" });
  }
  await mkdir(at.book, { recursive: true, mode: 0o700 });
  const started: ReadingState = { file: file.id, title: file.title, path: file.path, state: "running", started: new Date().toISOString(), chars: file.chars, estimate: Math.round(file.chars * DOLLARS_PER_CHAR * 100) / 100, steps: [], now: "starting" };
  const log = await open(at.log, "a", 0o600);
  await log.write(`\n== ${started.started} reading ${file.path}${options.standIn ? " (stand-in models)" : ""}\n`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), root, file.id, ...(options.standIn ? ["--stand-in", resolve(options.standIn)] : [])], { detached: true, stdio: ["ignore", log.fd, log.fd], env, cwd: repository });
  child.unref(); await log.close();
  started.pid = child.pid;
  await writeState(at.state, started);
  return started;
}

/** Stops a running reading (its answers so far stay cached). */
export async function stopReading(folder: string, name: string): Promise<ReadingState | null> {
  const now = await readingStatus(folder, name);
  if (!now || now.state !== "running") return now;
  try { process.kill(-now.pid!, "SIGTERM"); } catch { try { process.kill(now.pid!, "SIGTERM"); } catch { /* gone */ } }
  now.state = "stopped"; now.ended = new Date().toISOString(); now.now = undefined;
  await writeState(placesOf(folder, now.file).state, now);
  return now;
}

/** The reading itself, in its own process: the stored source, the v2 reading, the link. */
async function run(folder: string, id: string, standIn: string | null): Promise<void> {
  const root = resolve(folder), at = placesOf(root, id), state = (await readState(at.state))!;
  const save = () => writeState(at.state, state);
  const fail = async (error: unknown) => { state.state = "failed"; state.error = error instanceof Error ? error.message : String(error); state.ended = new Date().toISOString(); state.now = undefined; await save(); console.error(error instanceof Error ? error.stack : error); process.exit(1); };
  process.on("SIGTERM", () => { state.state = "stopped"; state.ended = new Date().toISOString(); state.now = undefined; save().finally(() => process.exit(143)); });
  try {
    const folderState = await loadState(root), file = findFile(folderState, id);
    // The stored source: the book's text as the workspace shows it, where the reading's sentence ids point.
    state.now = "storing the text"; await save();
    const text = readBook(await readFile(join(root, file.path)), file.kind, file.path).text, sha256 = createHash("sha256").update(text).digest("hex");
    await mkdir(join(at.novel, "source"), { recursive: true }); await mkdir(join(at.novel, "ontology"), { recursive: true });
    const name = `${id}.txt`;
    await writeFile(join(at.novel, "source", name), text, "utf8");
    await writeFile(join(at.novel, "ontology", "source.json"), `${JSON.stringify({ version: 1, sourceId: `source_${sha256}`, sha256, file: name, blockSize: BLOCK_SIZE }, null, 2)}\n`, "utf8");
    // The models: the keys from the secure store (Jev's resolves there itself), the models volume 1 was read with.
    process.env.JEV_MODEL ??= "jev-1.14.0"; process.env.WORK_LLM_PROVIDER ??= "deepseek"; process.env.WORK_LLM_MODEL ??= "deepseek-chat";
    if (!process.env.WORK_LLM_API_KEY) { const key = getStoredSecret(WORK_SECRET_NAME); if (key) process.env.WORK_LLM_API_KEY = key; }
    // Each step the reading reports ("tiling: 12 requests, 3400 ms") is kept as it comes.
    const report = console.error;
    console.error = (...args: unknown[]) => {
      report(...args);
      const line = args.map(String).join(" "), step = /^(.{1,60}?): (\d+) requests, (\d+) ms$/u.exec(line);
      if (step) { state.steps.push({ step: step[1], requests: Number(step[2]), ms: Number(step[3]) }); state.now = `after ${step[1]}`; save().catch(() => {}); }
    };
    state.now = "reading"; await save();
    const { read } = await import(pathToFileURL(join(repository, "experiments", "v2", "read.mjs")).href) as { read: (novel: string, out: string, options: Record<string, unknown>) => Promise<{ paidRequests?: { jev: number; work: number } } | undefined> };
    const extra = standIn ? (await import(pathToFileURL(standIn).href) as { options: (book: { novel: string; text: string }) => Record<string, unknown> }).options({ novel: at.novel, text }) : {};
    const result = await read(at.novel, at.reading, { ...(file.kind === "epub" ? { epub: join(root, file.path) } : {}), ...extra });
    console.error = report;
    if (result?.paidRequests) state.paid = result.paidRequests;
    if (!existsSync(at.data)) throw new Error("The reading ended without its data.");
    // Linked to the book; a book in no universe gets one of its own (the agent or the user can arrange it later).
    state.now = "linking"; await save();
    if (!folderState.universes.some((universe) => universe.books.some((book) => book.file === id))) {
      const named = (await loadState(root)).universes.find((universe) => universe.name === file.title.trim());
      const universe = named?.id ?? (await universeAdd(root, file.title, { why: "made when the book was read, before it was arranged" }) as { universe: string }).universe;
      await putBook(root, id, universe);
    }
    await linkReading(root, id, at.novel, at.data);
    state.state = "done"; state.ended = new Date().toISOString(); state.now = undefined; await save();
  } catch (error) { await fail(error); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [folder, id] = process.argv.slice(2), at = process.argv.indexOf("--stand-in");
  run(folder, id, at > 0 ? process.argv[at + 1] : null).then(() => process.exit(0));
}

export const readingFile = (folder: string, id: string) => placesOf(folder, id);
export const isEpub = (path: string) => extname(path).toLowerCase() === ".epub";
