import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPool, writePool } from "./worldCommands.js";

/**
 * The cast's commands (engine/review/cast.mjs; the user, 2026-11-06: "Add the missing commands, and have the agent
 * review in batches"): a person and their sheet, two entries made one person, one person's ability sheet, a pair raised
 * for the agent, and the cast's questions in batches in the world's review pool. And the story sky (engine/casts/run/sky.mjs)
 * as a command. Each is the engine's, loaded from the repository this CLI runs from.
 */
interface CastModule {
  readingsOf(novelDir: string, extra?: string[]): Promise<string[]>;
  mergePeople(novelDir: string, options: { keep: string; merged: string; reason: string; by?: string; readings?: string[] | null; dry?: boolean }): Promise<Record<string, unknown>>;
  setSheet(novelDir: string, options: { who: string; sheet?: unknown; none?: boolean; reason: string; evidence?: string[]; by?: string }): Promise<Record<string, unknown>>;
  askedItem(reading: unknown, a: string, b: string, why: string): { id: string } & Record<string, unknown>;
  castReview(novelDir: string, options: { size?: number; least?: number }): Promise<Record<string, unknown>>;
  showPerson(novelDir: string, who?: string | null): Promise<Record<string, unknown>>;
}

async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    if (pkg?.name === "novel-ontology-pi") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The world engine is not installed beside this CLI (engine/review/cast.mjs).");
    directory = parent;
  }
}
const cast = async () => import(pathToFileURL(join(await repository(), "engine", "review", "cast.mjs")).href) as Promise<CastModule>;

/** `novel cast show <dir> [<char_…>]`: the cast with their cards and sheets, or one person with what the cast log did to them. */
export async function castShow(novelDir: string, who?: string): Promise<Record<string, unknown>> {
  return (await cast()).showPerson(novelDir, who ?? null);
}

/** `novel cast merge <dir> <keep> <merged> --reason <t> [--reading <data.json>]… [--dry]`: two entries made one person everywhere. */
export async function castMerge(novelDir: string, keep: string, merged: string, options: { reason?: string; readings?: string[]; dry?: boolean }): Promise<Record<string, unknown>> {
  const module = await cast(), readings = await module.readingsOf(novelDir, options.readings ?? []);
  return module.mergePeople(novelDir, { keep, merged, reason: options.reason ?? "", readings, dry: !!options.dry });
}

/** `novel cast sheet <dir> <char_…> --sheet '<JSON>' | --none --reason <t> [--evidence <id,id>]`: one person's ability sheet. */
export async function castSheet(novelDir: string, who: string, options: { sheet?: string; none?: boolean; reason?: string; evidence?: string; by?: string }): Promise<Record<string, unknown>> {
  let sheet: unknown = null;
  if (options.sheet !== undefined) { try { sheet = JSON.parse(options.sheet); } catch { throw new Error("--sheet is JSON: '{\"move\":{\"flight\":{\"height\":80}},\"attack\":{\"line\":{\"range\":100}}}'."); } }
  return (await cast()).setSheet(novelDir, { who, sheet, none: !!options.none, reason: options.reason ?? "", evidence: (options.evidence ?? "").split(",").map((id) => id.trim()).filter(Boolean), by: options.by ?? "hand" });
}

/** `novel cast ask <dir> <a> <b> --why <t>`: two people raised as one, a question for the next cast batch. */
export async function castAsk(novelDir: string, a: string, b: string, why?: string): Promise<Record<string, unknown>> {
  if (!why?.trim()) throw new Error("--why is required: what makes them one person, citing sentence ids.");
  const module = await cast(), [path] = await module.readingsOf(novelDir);
  const reading = path ? JSON.parse(await readFile(path, "utf8")) : null;
  if (!reading) throw new Error(`No reading for ${novelDir}.`);
  const item = module.askedItem(reading, a, b, why.trim());
  const known = (await loadPool(novelDir)).find((entry) => entry.id === item.id);
  if (known) return { item: item.id, status: known.status, note: "Asked before: it stays as it is." };
  await writePool(novelDir, [item as never]);
  return { item: item.id, status: "open", next: `novel cast review ${novelDir}` };
}

/** `novel cast review <dir> [--size N] [--least-cards N] [--send <console-dir>]`: the cast's questions into the pool, in batches for the agent. */
export async function castReview(novelDir: string, options: { size?: number; least?: number; send?: string }): Promise<Record<string, unknown>> {
  const result = await (await cast()).castReview(novelDir, { size: options.size, least: options.least });
  if (!options.send) return result;
  const review = await import(pathToFileURL(join(await repository(), "engine", "review", "review.mjs")).href) as { sendToAgent(novelDir: string, consoleDir: string): Promise<Record<string, unknown>> };
  return { ...result, sent: await review.sendToAgent(novelDir, options.send) };
}

/**
 * `novel sky build|show <dir> [--dry] [--cache <dir>]`: the story sky (each unit's time of day and weather, Jev at a few
 * cents, cached) into sky.json beside the reading the director plays; `--dry` counts what would be asked.
 */
export async function sky(novelDir: string, sub: string, options: { dry?: boolean; cache?: string }): Promise<Record<string, unknown>> {
  const [reading] = await (await cast()).readingsOf(novelDir);
  if (!reading) throw new Error(`No reading for ${novelDir}.`);
  const file = join(dirname(reading), "sky.json");
  if (sub === "show") {
    type Unit = { daypart?: { value?: string }; weather?: { value?: string }; strength?: string; lying?: boolean; conflict?: string[] };
    const built = JSON.parse(await readFile(file, "utf8").catch(() => "null")) as { at?: string; units?: Record<string, Unit>; sequences?: unknown[] } | null;
    if (!built) return { file, built: false, next: `novel sky build ${novelDir} --dry` };
    const units = Object.values(built.units ?? {}), tally = (key: (unit: Unit) => string | undefined) => units.reduce<Record<string, number>>((out, unit) => { const value = key(unit) ?? "unknown"; out[value] = (out[value] ?? 0) + 1; return out; }, {});
    return { file, built: built.at ?? true, units: units.length, dayparts: tally((unit) => unit.daypart?.value), weather: tally((unit) => `${unit.strength ?? "moderate"} ${unit.weather?.value ?? "unknown"}`), lyingSnow: units.filter((unit) => unit.lying).length, conflicts: units.filter((unit) => unit.conflict?.length).length };
  }
  const script = join(await repository(), "engine", "casts", "run", "sky.mjs"), args = [script, novelDir, reading, ...(options.dry ? ["--dry"] : []), ...(options.cache ? ["--cache", options.cache] : [])];
  const output = await new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "", errors = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("close", (code) => (code === 0 ? done(text) : fail(new Error(`sky.mjs ended with ${code}: ${errors.slice(-600)}`))));
  });
  let parsed: unknown = output.trim();
  try { parsed = JSON.parse(output); } catch { /* the script's own words */ }
  return { reading, file, dry: !!options.dry, result: parsed };
}
