import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { BundleManifest } from "../connectors/bundle.js";

const RECORDS = ["entities.jsonl", "relations.jsonl", "events.jsonl", "scenes.jsonl", "timelines.jsonl", "branches.jsonl"];
/** What a library-prepared book may already hold in `ontology/`: its manifest, empty record files and empty bookkeeping. */
const PREPARED = new Set([...RECORDS, "manifest.json", "causality.json", "graph.lbug", "graph.lbug.wal"]);

/**
 * A book the library prepared but nobody set up: a real folder holding only
 * `ontology/` with its manifest (nothing processed) and empty record files.
 * Returns its manifest, or null for anything else.
 */
async function preparedBook(novelDir: string): Promise<BundleManifest | null> {
  const folder = await lstat(novelDir).catch(() => null);
  if (!folder?.isDirectory() || folder.isSymbolicLink()) return null;
  const entries = await readdir(novelDir);
  if (entries.length !== 1 || entries[0] !== "ontology") return null;
  const ontology = join(novelDir, "ontology");
  const inside = await lstat(ontology);
  if (!inside.isDirectory() || inside.isSymbolicLink()) return null;
  for (const name of await readdir(ontology)) {
    const entry = await lstat(join(ontology, name));
    if (!PREPARED.has(name) || !entry.isFile() || entry.isSymbolicLink() || (name.endsWith(".jsonl") && entry.size > 0)) return null;
  }
  const manifest = JSON.parse(await readFile(join(ontology, "manifest.json"), "utf8").catch(() => "null")) as BundleManifest | null;
  return manifest && typeof manifest.novelId === "string" && manifest.blocksProcessed === 0 ? manifest : null;
}

/**
 * Create a fresh workspace; existing paths (including symlinks) are refused,
 * except a book the library prepared but never set up, which is adopted: its
 * manifest (with the book's title) is kept and the missing layout created.
 */
export async function initWorkspace(path: string): Promise<{
  status: "initialized";
  novelDir: string;
  manifest: BundleManifest;
  adopted?: true;
}> {
  const novelDir = resolve(path);
  // Recursive creation is only for parents. Exclusive target creation also
  // prevents two initializers from writing into the same workspace.
  await mkdir(dirname(novelDir), { recursive: true });
  const prepared = await preparedBook(novelDir);
  if (prepared) {
    for (const dir of ["source", "branches", "changesets"]) await mkdir(join(novelDir, dir));
    for (const file of RECORDS) await writeFile(join(novelDir, "ontology", file), "", { flag: "a" });
    return { status: "initialized", novelDir, manifest: prepared, adopted: true };
  }
  await mkdir(novelDir);

  const manifest: BundleManifest = {
    novelId: `novel_${randomUUID()}`,
    title: basename(novelDir),
    schemaVersion: 1,
    sourceLanguages: [],
    embeddingModel: null,
    embeddingDimension: null,
    decisionModel: process.env.JEV_MODEL?.trim() || "jev-1.13.0",
    blocksProcessed: 0,
  };

  for (const dir of ["source", "ontology", "branches", "changesets"]) {
    await mkdir(join(novelDir, dir));
  }
  const ontologyDir = join(novelDir, "ontology");
  for (const file of RECORDS) {
    await writeFile(join(ontologyDir, file), "", { flag: "wx" });
  }
  // Write the manifest last so it only appears after the layout is complete.
  await writeFile(
    join(ontologyDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return { status: "initialized", novelDir, manifest };
}
