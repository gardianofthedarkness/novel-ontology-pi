import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { cutBlocks, DEFAULT_BLOCK_SIZE, type Block } from "../../digger/intake/blocks.js";

export interface WorkspaceSource {
  version: 1;
  sourceId: string;
  sha256: string;
  file: string;
  blockSize: number;
}

export const sourceHash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

export async function storedSource(novelDir: string): Promise<WorkspaceSource | null> {
  let raw: string;
  try { raw = await readFile(join(novelDir, "ontology", "source.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as WorkspaceSource;
  if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.sha256)
    || value.sourceId !== `source_${value.sha256}` || typeof value.file !== "string"
    || value.file !== basename(value.file) || value.file === "." || value.file === ".."
    || !Number.isInteger(value.blockSize) || value.blockSize < 100) {
    throw new Error("Invalid workspace source binding; inspect it before continuing.");
  }
  return value;
}

async function legacySources(novelDir: string): Promise<string[]> {
  const entries = await readdir(join(novelDir, "source"), { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) throw new Error("Source directory contains non-regular entries; explicit source migration required.");
  return entries.map((entry) => entry.name).sort();
}

export async function bindWorkspaceSource(novelDir: string, input: string, blockSize?: number): Promise<WorkspaceSource> {
  const text = await readFile(input, "utf8");
  const hash = sourceHash(text);
  const lock = join(novelDir, "ontology", ".source.lock");
  await mkdir(lock);
  try {
    const bound = await storedSource(novelDir);
    if (bound) {
      const stored = await readFile(join(novelDir, "source", bound.file), "utf8");
      if (sourceHash(stored) !== bound.sha256) throw new Error("Stored source changed; restore it before ingest or recall.");
      if (hash !== bound.sha256) throw new Error("A different source cannot share this workspace. Use novel library for separate series volumes; source migration is required for replacement.");
      if (blockSize !== undefined && blockSize !== bound.blockSize) throw new Error("Changing --block-size would change source identities; source migration required.");
      return bound;
    }
    const names = await legacySources(novelDir);
    if (names.length > 1) throw new Error("Ambiguous legacy sources; explicit source migration required before ingest or recall.");
    if (names.length === 1 && sourceHash(await readFile(join(novelDir, "source", names[0]), "utf8")) !== hash) {
      throw new Error("A different source cannot share this workspace. Use novel library for separate series volumes.");
    }
    if (names.length === 0) {
      const packets = await readdir(join(novelDir, "changesets"));
      const events = await readFile(join(novelDir, "events.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return "";
      });
      if (packets.length || events.trim()) throw new Error("Existing processing history has no stored source; explicit source migration required.");
    }
    const binding: WorkspaceSource = {
      version: 1, sourceId: `source_${hash}`, sha256: hash,
      file: names[0] ?? basename(input), blockSize: blockSize ?? DEFAULT_BLOCK_SIZE,
    };
    if (!Number.isInteger(binding.blockSize) || binding.blockSize < 100) throw new Error("Invalid block size.");
    if (!names.length) await writeFile(join(novelDir, "source", binding.file), text, { flag: "wx" });
    const target = join(novelDir, "ontology", "source.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(binding, null, 2) + "\n", { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    return binding;
  } finally { await rmdir(lock); }
}

export async function recallSourceBlock(novelDir: string, blockId: string): Promise<Block> {
  const bound = await storedSource(novelDir);
  if (bound) {
    const text = await readFile(join(novelDir, "source", bound.file), "utf8");
    if (sourceHash(text) !== bound.sha256) throw new Error("Stored source changed; restore it before recall.");
    const found = cutBlocks(text, bound.blockSize).find((block) => block.id === blockId);
    if (!found) throw new Error(`Block ${blockId} not found in the bound source.`);
    return found;
  }
  const names = await legacySources(novelDir);
  if (names.length !== 1) throw new Error("Recall requires one unambiguous stored source; explicit source migration required.");
  const text = await readFile(join(novelDir, "source", names[0]), "utf8");
  const found = cutBlocks(text).find((block) => block.id === blockId);
  if (!found) throw new Error(`Block ${blockId} not found in the stored source.`);
  return found;
}
