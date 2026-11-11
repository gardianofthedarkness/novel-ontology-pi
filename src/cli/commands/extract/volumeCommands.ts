import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * A whole volume, step by step (engine/volume/volume.mjs; the user, 2026-11-10: "Let's run a full volume 2 by asking
 * pi agent to do so"): each step's status, a step or the steps up to one started in the background, a step's log, and the
 * agent's own step (the look pass) marked done. Each is the engine's, loaded from the repository this CLI runs from.
 */
interface VolumeModule {
  status(novelDir: string): Promise<Record<string, unknown>>;
  run(novelDir: string, options: { step?: string | null; until?: string | null }): Promise<Record<string, unknown>>;
  logOf(novelDir: string, step: string, lines?: number): Promise<Record<string, unknown>>;
  markDone(novelDir: string, step: string, why: string): Promise<Record<string, unknown>>;
}
async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    if (pkg?.name === "novel-ontology-pi") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The world engine is not installed beside this CLI (engine/volume/volume.mjs).");
    directory = parent;
  }
}
const volume = async () => import(pathToFileURL(join(await repository(), "engine", "volume", "volume.mjs")).href) as Promise<VolumeModule>;

export async function volumeStatus(novelDir: string): Promise<Record<string, unknown>> { return (await volume()).status(novelDir); }
export async function volumeRun(novelDir: string, options: { step?: string; until?: string }): Promise<Record<string, unknown>> { return (await volume()).run(novelDir, { step: options.step ?? null, until: options.until ?? null }); }
export async function volumeLog(novelDir: string, step: string, lines?: number): Promise<Record<string, unknown>> { return (await volume()).logOf(novelDir, step, lines); }
export async function volumeDone(novelDir: string, step: string, why: string): Promise<Record<string, unknown>> { return (await volume()).markDone(novelDir, step, why); }
