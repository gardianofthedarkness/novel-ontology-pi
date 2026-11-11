/**
 * Worlds in a folder (docs/v3/console.md §7; the user, 2026-11-10: "Let's continue with the rest of p3", the plan's "World ·
 * Live's page as the interim world view"): a world is a v2 library (docs/v2/universe-snapshots.md): `universe/` with its
 * books' workspaces in `vol-<n>/novel`, each with the director's runs under `stage/director/runs`. One the console did not
 * make (a library from the Pi hosts) is opened read only: its page shows everything and changes nothing.
 *
 * Found in the folder itself and up to two levels below it (hidden folders and packages skipped), so adding a folder of
 * libraries shows each of them.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface WorldBook {
  /** The book's folder in the library, vol-<n>. */
  book: string;
  volume: number;
  /** The book's workspace (vol-<n>/novel). */
  workspace: string;
  /** The director's runs, oldest first (d<yyyymmddhhmmss>). */
  runs: string[];
  /** The run the book's page plays (the simulation's accepted director run), if any. */
  accepted: string | null;
  /** Its title, from the library's job.json when it names one, else from its reading's metadata. */
  title: string | null;
}
export interface World {
  root: string;
  name: string;
  books: WorldBook[];
  /** A library the console did not make (anything outside a folder's .novel/worlds): opened read only. */
  readOnly: boolean;
}

const SKIP = new Set(["node_modules", "dist", "snapshots", "runtime", "inputs", "universe"]);
const BOOK = /^vol-(\d+)$/;
const json = (file: string): Promise<any> => readFile(file, "utf8").then(JSON.parse, () => null);

/** Whether a directory is a library: a universe and at least one book with a stage. */
async function isLibrary(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, "universe"))) return false;
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.some((name) => BOOK.test(name) && existsSync(join(dir, name, "novel", "stage")));
}

/** A library's books, in volume order, with their runs. */
export async function worldOf(root: string): Promise<World> {
  const dir = resolve(root), job = await json(join(dir, "job.json"));
  const titles = new Map<string, string>();
  for (const entry of job?.volumes ?? []) if (entry?.id && typeof entry.label === "string") titles.set(`vol-${entry.id}`, entry.label);
  const books: WorldBook[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const match = BOOK.exec(name), workspace = join(dir, name, "novel");
    if (!match || !existsSync(join(workspace, "stage"))) continue;
    const runs = (await readdir(join(workspace, "stage", "director", "runs")).catch(() => [] as string[])).filter((run) => /^d\d{14}$/.test(run)).sort();
    const index = await json(join(workspace, "stage", "simulation", "index.json"));
    const meta = await json(join(dir, name, "reading", "data.json")).then((data) => data?.meta ?? data?.metadata ?? null, () => null);
    books.push({ book: name, volume: Number(match[1]), workspace, runs, accepted: index?.strands?.director?.accepted ?? null, title: titles.get(name) ?? (typeof meta?.title === "string" ? meta.title : null) });
  }
  books.sort((a, b) => a.volume - b.volume);
  return { root: dir, name: basename(dir), books, readOnly: !dir.split("/").includes(".novel") };
}

/** The worlds in a folder: the folder itself if it is one, else those in it, up to two levels down. */
export async function findWorlds(folder: string, depth = 2): Promise<World[]> {
  const dir = resolve(folder);
  if (await isLibrary(dir)) return [await worldOf(dir)];
  const found: World[] = [];
  const walk = async (at: string, left: number): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const child = join(at, entry.name);
      if (await isLibrary(child)) { found.push(await worldOf(child)); continue; }
      if (left > 1) await walk(child, left - 1);
    }
  };
  await walk(dir, depth);
  // The worlds the console builds for a folder's universes (.novel/worlds/<universe>).
  for (const name of await readdir(join(dir, ".novel", "worlds")).catch(() => [] as string[])) {
    const child = join(dir, ".novel", "worlds", name);
    if ((await stat(child).catch(() => null))?.isDirectory() && await isLibrary(child) && !found.some((world) => world.root === child)) found.push(await worldOf(child));
  }
  return found.sort((a, b) => a.root.localeCompare(b.root));
}
