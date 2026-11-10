import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, scanFolder } from "../src/v3/folder.js";
import { keyStatus, placesOf, readingStatus, setKey, startReading, stopReading } from "../src/v3/reading.js";
import { readerBook } from "../src/v3/reader.js";
import { NovelWorkspace } from "../src/v3/workspace.js";
import { shelf } from "./v3-fixture.js";

const standIn = join(dirname(fileURLToPath(import.meta.url)), "v3-standin.js");
const secrets = async () => { const dir = await mkdtemp(join(tmpdir(), "novel-secrets-")); return { ...process.env, NOVEL_SECRETS_DIR: dir, TYPESAFE_API_KEY: "", WORK_LLM_API_KEY: "", JEV_API_KEY_ENV: "" } as NodeJS.ProcessEnv; };
const until = async <T>(probe: () => Promise<T | null | undefined>, most = 90000): Promise<T> => { for (const start = Date.now(); ;) { const value = await probe(); if (value) return value; if (Date.now() - start > most) throw new Error("timed out"); await new Promise((done) => setTimeout(done, 200)); } };

test("the keys are kept in the secure store and only their state is ever answered", async () => {
  const env = await secrets();
  assert.deepEqual(keyStatus(env), { jev: null, work: null });
  const after = setKey("jev", " jev-key-123 ", env);
  assert.deepEqual(after, { jev: "store", work: null });
  assert.deepEqual(setKey("work", "work-key-456", env), { jev: "store", work: "store" });
  const file = join(env.NOVEL_SECRETS_DIR!, "secrets.json");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { typesafe: "jev-key-123", "work-llm": "work-key-456" });
  assert.doesNotMatch(JSON.stringify(after), /key-123/);
  assert.throws(() => setKey("other", "x", env), /jev and work/);
  assert.throws(() => setKey("work", "  ", env), /empty/);
});

test("a reading needs both keys before it starts", async () => {
  const { folder } = await shelf(), env = await secrets();
  await scanFolder(folder);
  await assert.rejects(startReading(folder, "keeper-2.txt", { env }), /Jev's and the work model's key are not set/);
  setKey("jev", "k", env);
  await assert.rejects(startReading(folder, "keeper-2.txt", { env }), /the work model's key is not set/);
});

test("one click reads a book in a process of its own: the stored source, the reading, the link", async () => {
  const { folder } = await shelf(), env = await secrets();
  await scanFolder(folder);
  const started = await startReading(folder, "keeper-2.txt", { env, standIn });
  assert.equal(started.state, "running"); assert.ok(started.pid); assert.ok(started.estimate >= 0);
  const done = await until(async () => { const now = await readingStatus(folder, "keeper-2.txt"); return now && now.state !== "running" ? now : null; });
  const at = placesOf(folder, started.file);
  assert.equal(done.state, "done", `${done.error ?? ""}\n${await readFile(at.log, "utf8").catch(() => "")}`);
  assert.ok(done.steps.length > 3, "the reading's steps are kept as they come");
  assert.ok(done.paid && done.paid.jev > 0 && done.paid.work === 0, "the questions went to the stand-in, the names to the roster");
  // The stored source the sentence ids cite, and the book linked; a book in no universe got one of its own.
  const source = JSON.parse(await readFile(join(at.novel, "ontology", "source.json"), "utf8"));
  assert.equal(source.blockSize, 24000); assert.equal(source.file, `${started.file}.txt`);
  const state = await loadState(folder), universe = state.universes.find((entry) => entry.books.some((book) => book.file === started.file));
  assert.ok(universe, "the book is in a universe"); assert.match(universe!.why ?? "", /read/);
  const link = universe!.books.find((book) => book.file === started.file)!.reading!;
  assert.equal(link.sameText, true); assert.match(link.data, /^\.novel\/books\/f_[0-9a-f]+\/reading\/v2\/data\.json$/);
  // The workspace and the reader take it as any reading.
  const open = await new NovelWorkspace(folder).book("keeper-2.txt");
  assert.ok(open.index && open.index.scenes.length > 0);
  assert.equal((await readerBook(new NovelWorkspace(folder), "keeper-2.txt")).mode, "reading");
  // The scan does not take the stored text for a book.
  const rescan = await scanFolder(folder) as unknown as { files: number };
  assert.equal(rescan.files, (await loadState(folder)).files.length);
  assert.ok(!(await loadState(folder)).files.some((file) => file.path.startsWith(".novel")));
});

test("one reading at a time; a stopped reading says so; a reading whose process died is failed", async () => {
  const { folder } = await shelf(), env = await secrets();
  await scanFolder(folder);
  const state = await loadState(folder), one = state.files.find((file) => file.path === "keeper-1.txt")!, at = placesOf(folder, one.id);
  // A reading that is running (its process alive).
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
  await mkdir(at.book, { recursive: true });
  await writeFile(at.state, JSON.stringify({ file: one.id, title: one.title, path: one.path, state: "running", started: new Date().toISOString(), pid: sleeper.pid, chars: 1, estimate: 0, steps: [] }));
  await assert.rejects(startReading(folder, "keeper-2.txt", { env, standIn }), /keeper-1 is being read/);
  assert.equal((await startReading(folder, "keeper-1.txt", { env, standIn })).pid, sleeper.pid, "starting it again follows the one running");
  const stopped = await stopReading(folder, "keeper-1.txt");
  assert.equal(stopped?.state, "stopped");
  await until(async () => { try { process.kill(sleeper.pid!, 0); return null; } catch { return true; } }, 5000);
  // A reading whose process is gone without saying.
  await writeFile(at.state, JSON.stringify({ file: one.id, title: one.title, path: one.path, state: "running", started: new Date().toISOString(), pid: 999999, chars: 1, estimate: 0, steps: [] }));
  const failed = await readingStatus(folder, "keeper-1.txt");
  assert.equal(failed?.state, "failed"); assert.match(failed?.error ?? "", /start it again/);
});
