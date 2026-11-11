import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * What a book carries into the next, per strand (world-engine/world/carry.mjs; docs/v3/design.html#borrow-and-spawn §4.5;
 * milestones M16; the user, 2026-11-09: "At the reading stage of each book, we need to determine if we are inheriting any
 * strands from last book or not. If inherit, we preserve the destructions. If not, we close the strand, and destruction
 * is recovered for the new book"). Each is the engine's, loaded from the repository this CLI runs from.
 */
interface CarryModule {
  register(novelDir: string, options: { run?: string | null; reading?: unknown; write?: boolean }): Promise<Record<string, unknown>>;
  inherit(novelDir: string, options: { reading?: unknown; work?: unknown; write?: boolean }): Promise<Record<string, unknown>>;
  setDecision(novelDir: string, key: string, inherited: boolean, why: string, options?: { into?: string | null }): Promise<Record<string, unknown>>;
  keep(novelDir: string, options: { run: string; write?: boolean }): Promise<Record<string, unknown>>;
  damageInForce(novelDir: string, options?: { as?: string | null }): Promise<{ book: string; entries: unknown[]; kept: number }>;
}

async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    if (pkg?.name === "novel-ontology-pi") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The world engine is not installed beside this CLI (world-engine/world/carry.mjs).");
    directory = parent;
  }
}
const carry = async () => import(pathToFileURL(join(await repository(), "world-engine", "world", "carry.mjs")).href) as Promise<CarryModule>;
const readingAt = async (path?: string) => (path ? JSON.parse(await readFile(resolve(path), "utf8")) as unknown : null);

/** `novel strands register <dir> [--run <id>]`: the book's strands at its end into the universe's registry. */
export async function strandsRegister(novelDir: string, options: { run?: string; reading?: string; dry?: boolean }): Promise<Record<string, unknown>> {
  return (await carry()).register(novelDir, { run: options.run ?? null, reading: await readingAt(options.reading), write: !options.dry });
}
/** `novel strands inherit <dir> [--work]`: at this book's reading, each open strand of the last book inherited or closed. */
export async function strandsInherit(novelDir: string, options: { reading?: string; work?: boolean; dry?: boolean }): Promise<Record<string, unknown>> {
  let work: unknown = null;
  if (options.work) { const { workModelFromEnv } = await import("../../../ground/connectors/workModel.js"); work = workModelFromEnv(process.env); }
  return (await carry()).inherit(novelDir, { reading: await readingAt(options.reading), work, write: !options.dry });
}
/** `novel strands set <dir> <strand key> inherited|closed --why <text> [--into <key>]`: the main agent's override. */
export async function strandsSet(novelDir: string, key: string, state: string, why: string, into?: string): Promise<Record<string, unknown>> {
  if (state !== "inherited" && state !== "closed") throw new Error("novel strands set: the state is inherited or closed");
  return (await carry()).setDecision(novelDir, key, state === "inherited", why, { into: into ?? null });
}
/** `novel strands keep <dir> --run <id>`: the run's damage into the universe, building by building, by strand. */
export async function strandsKeep(novelDir: string, options: { run: string; dry?: boolean }): Promise<Record<string, unknown>> {
  return (await carry()).keep(novelDir, { run: options.run, write: !options.dry });
}
/** `novel strands show <dir>`: the registry, the decisions and the damage in force in this book. */
export async function strandsShow(novelDir: string): Promise<Record<string, unknown>> {
  const module = await carry(), universe = join(resolve(novelDir), "..", "..", "universe");
  const registry = JSON.parse(await readFile(join(universe, "strands.json"), "utf8").catch(() => "null")) as { books?: Record<string, { from: string; strands: { key: string; scenes: string[]; open: boolean; into?: string }[] }>; decisions?: unknown } | null;
  const forced = await module.damageInForce(novelDir);
  return {
    books: Object.fromEntries(Object.entries(registry?.books ?? {}).map(([book, entry]) => [book, { from: entry.from, strands: entry.strands.map((strand) => ({ key: strand.key, scenes: strand.scenes.length, open: strand.open, ...(strand.into ? { into: strand.into } : {}) })) }])),
    decisions: registry?.decisions ?? {}, inForce: { book: forced.book, buildings: forced.entries.length, of: forced.kept },
  };
}
