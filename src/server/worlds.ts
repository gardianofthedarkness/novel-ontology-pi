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

/**
 * An editable copy of a world in the folder's own `.novel/worlds/` (docs/v3/console.md §7): its latest finished state (the
 * newest `after`, `manual` or `imported` snapshot, or `snapshot`) packed by v2's export, run pages included, and brought in
 * by v2's import, each book's text checked against the hash the snapshot names. The world it copies is only read.
 */
export async function copyWorld(folder: string, root: string, { snapshot = null }: { snapshot?: string | null } = {}): Promise<World & { copiedFrom: { root: string; snapshot: string } }> {
  const universe = await import("../ground/workspace/universe.js");
  const source = resolve(root), index = await universe.readIndex(source) as unknown as { snapshots?: Array<{ id: string; kind: string }> } | Array<{ id: string; kind: string }>;
  const list = Array.isArray(index) ? index : index.snapshots ?? [];
  const id = snapshot ?? [...list].reverse().find((entry) => ["after", "manual", "imported"].includes(entry.kind))?.id;
  if (!id) throw new Error(`${basename(source)} has no finished run to copy (no after, manual or imported snapshot).`);
  const chosen = await universe.readSnapshot(source, id);
  const worlds = join(resolve(folder), ".novel", "worlds"), name = `${basename(source)}-${id.replace(/[^\w-]+/g, "-")}`, target = join(worlds, name);
  if (existsSync(target)) { await cloneLive(source, target, Object.keys(chosen.books)); return { ...(await worldOf(target)), copiedFrom: { root: source, snapshot: id } }; }
  const { mkdir: makeDir, rm } = await import("node:fs/promises");
  await makeDir(worlds, { recursive: true });
  const bundle = join(worlds, `.copy-${process.pid}-${Date.now()}`);
  try {
    await universe.exportSnapshot(source, id, bundle, { pages: true });
    const sources: Record<string, string> = {};
    for (const book of Object.keys(chosen.books)) { const text = join(source, book, "novel", "source", "source.txt"); if (existsSync(text)) sources[book] = text; }
    await universe.importBundle(bundle, target, { sources });
  } finally { await rm(bundle, { recursive: true, force: true }); }
  await cloneLive(source, target, Object.keys(chosen.books));
  return { ...(await worldOf(target)), copiedFrom: { root: source, snapshot: id } };
}

/**
 * World · Live plays a run's live record (stage/simulation/live.json and live/: the world as it stood, the frames, Jev's
 * pictures), which snapshots do not carry: each book's is cloned (APFS: no space taken) when it is the run the copy plays.
 */
async function cloneLive(source: string, target: string, books: string[]): Promise<void> {
  const { constants } = await import("node:fs");
  const { cp } = await import("node:fs/promises");
  for (const book of books) {
    const from = join(source, book, "novel", "stage", "simulation"), to = join(target, book, "novel", "stage", "simulation");
    const live = await json(join(from, "live.json")), index = await json(join(to, "index.json"));
    const started = typeof live?.startedAt === "string" ? `d${live.startedAt.replace(/\D/g, "").slice(0, 14)}` : null;
    if (!started || started !== index?.strands?.director?.accepted || existsSync(join(to, "live.json"))) continue;
    // macOS clones with cp -c (Node's copy writes the bytes); elsewhere a plain copy.
    if (process.platform === "darwin") {
      const { execFile } = await import("node:child_process");
      const run = (args: string[]) => new Promise<void>((done, fail) => execFile("/bin/cp", args, (error) => (error ? fail(error) : done())));
      await run(["-Rc", join(from, "live"), join(to, "live")]);
      await run(["-c", join(from, "live.json"), join(to, "live.json")]);
    } else {
      await cp(join(from, "live"), join(to, "live"), { recursive: true, mode: constants.COPYFILE_FICLONE });
      await cp(join(from, "live.json"), join(to, "live.json"), { mode: constants.COPYFILE_FICLONE });
    }
  }
}

/** One item of a book's review as the console shows it. */
export interface ReviewItem {
  item: string; kind: string; scene: string | null; card: string | null; question: string; options: string[]; evidence: string[];
  status: string; batch: string | null; names: string[];
  answer?: { verdict: string; reason: string; at: string };
}
/**
 * A world book's review (docs/world-first-design.md §11; the console's Review view): the director's held items in its pool,
 * the batches waiting for an answer, the answers given and whether they were applied. Read only.
 */
export async function reviewOf(workspace: string, { most = 400 }: { most?: number } = {}): Promise<{ counts: Record<string, number>; batches: Array<{ batch: string; items: ReviewItem[] }>; open: ReviewItem[]; answered: ReviewItem[]; worldFirst: boolean }> {
  const W = await import("../cli/commands/extract/worldCommands.js");
  const manifest = await json(join(workspace, "ontology", "manifest.json"));
  if (!manifest?.worldFirst) return { counts: {}, batches: [], open: [], answered: [], worldFirst: false };
  const items = await W.loadPool(workspace), answers = await W.loadAnswers(workspace);
  const lastAnswer = new Map(answers.map((answer) => [answer.item, answer]));
  const shown = (item: (typeof items)[number]): ReviewItem => {
    const answer = lastAnswer.get(item.id);
    return { item: item.id, kind: item.kind, scene: item.scene, card: item.card ?? null, question: item.question, options: item.options, evidence: (item.evidence ?? []).slice(0, 6), status: item.status, batch: item.batch ?? null, names: item.names ?? [],
      ...(answer && (item.status === "answered" || item.status === "applied" || item.status === "failed") ? { answer: { verdict: answer.verdict, reason: answer.reason, at: answer.at } } : {}) };
  };
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const waiting = [...new Set(items.filter((item) => item.status === "batched" && item.batch).map((item) => item.batch!))];
  return {
    counts,
    batches: waiting.map((batch) => ({ batch, items: items.filter((item) => item.batch === batch && item.status === "batched").map(shown) })),
    open: items.filter((item) => item.status === "open").slice(0, most).map(shown),
    answered: items.filter((item) => item.status === "answered" || item.status === "applied" || item.status === "failed").slice(-most).reverse().map(shown),
    worldFirst: true,
  };
}

/** A free step on a world book's review: `held` (a run's held items into batches, one per scene) or `apply` (the answers into pins, under the laws). */
export async function reviewStep(workspace: string, step: "held" | "apply", { run = null }: { run?: string | null } = {}): Promise<Record<string, unknown>> {
  const R = await import("../cli/commands/extract/worldReviewCommands.js");
  if (step === "held") return R.worldHeld(workspace, { run: run ?? undefined });
  if (step === "apply") return R.worldApply(workspace);
  throw new Error(`No review step ${String(step)}.`);
}
