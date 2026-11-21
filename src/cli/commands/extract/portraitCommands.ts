import { spawn } from "node:child_process";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cutBlocks } from "story-graph/dist/src/reading/text/blocks.js";
import { loadPortraits } from "story-graph/dist/src/reading/album/portraits.js";
import { sourceHash, storedSource } from "story-graph/dist/src/ground/workspace/source.js";
import type { Entity } from "story-graph/dist/src/ground/ontology/types.js";
import { albumPortraits } from "./albumCommands.js";

async function rows(path: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// v1's portrait cropper lives with the album in story-graph (src/reading/album/cropper.ts, tools/album-portraits).
export { cropper } from "story-graph/dist/src/reading/album/cropper.js";
import { cropper } from "story-graph/dist/src/reading/album/cropper.js";

export async function portraitReadiness(novelDir: string) {
  const source = await storedSource(novelDir);
  if (!source) return { ready: false as const, reason: "source_binding_required" };
  const text = await readFile(join(novelDir, "source", source.file), "utf8");
  if (sourceHash(text) !== source.sha256) throw new Error("Stored source changed; restore before portrait assignment");
  const blocks = cutBlocks(text, source.blockSize);
  // A v2 book's characters come from its v2 reading (the canon it wrote), not from reviewed v1 packets per block: the
  // reading done is the volume's extraction finished (docs/v3/design.html#universe-snapshots; src/reading/album/inReading.ts).
  const manifest = JSON.parse(await readFile(join(novelDir, "ontology", "manifest.json"), "utf8").catch(() => "{}"));
  if (manifest.v2Reading) return readinessAfterExtraction(novelDir, blocks.length);
  const audit = await rows(join(novelDir, "events.jsonl"));
  const applied = new Set(audit.flatMap((row) => {
    const event = row.event as { type?: string; changesetId?: string } | undefined;
    return event?.type === "changeset.applied" ? [event.changesetId] : [];
  }));
  let unfinished = 0;
  for (const block of blocks) {
    let packet;
    try { packet = JSON.parse(await readFile(join(novelDir, "changesets", `cs_${block.id}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (packet?.status !== "approved" || !applied.has(`cs_${block.id}`)) unfinished++;
  }
  if (!blocks.length || unfinished) return { ready: false as const, reason: "finish_volume_extraction_and_review", unfinishedBlocks: unfinished };
  return readinessAfterExtraction(novelDir, blocks.length);
}

async function readinessAfterExtraction(novelDir: string, blocks: number) {
  if (!blocks) return { ready: false as const, reason: "finish_volume_extraction_and_review", unfinishedBlocks: 0 };
  const illustrations = await rows(join(novelDir, "ontology", "illustrations.jsonl"));
  if (!illustrations.length) return { ready: false as const, reason: "album_missing_use_matching_epub_intake" };
  const byId = new Map<string, Entity>();
  for (const entity of await rows(join(novelDir, "ontology", "entities.jsonl"))) byId.set(entity.id as string, entity as unknown as Entity);
  const characters = [...byId.values()].filter((entity) => entity.kind === "Character");
  const portraits = await loadPortraits(novelDir);
  const bound = new Set(portraits.map((portrait) => portrait.entityId));
  return { ready: true as const, characters: characters.length, pictures: illustrations.length, withoutPortrait: characters.filter((character) => !bound.has(character.id)).length };
}

export async function albumAssign(novelDir: string, check = false, env: NodeJS.ProcessEnv = process.env) {
  const workspace = await realpath(resolve(novelDir));
  if (await realpath(join(workspace, "ontology")) !== join(workspace, "ontology")) throw new Error("Portrait metadata directory must not be a symlink");
  const lockPath = join(workspace, "ontology", ".portrait-assignment.lock");
  const lock = check ? null : await open(lockPath, "wx", 0o600);
  try {
    const readiness = await portraitReadiness(workspace);
    if (!readiness.ready) return { status: "blocked", ...readiness };
    if (readiness.characters === 0) return { status: check ? "ready" : "complete", ...readiness, bound: 0, pendingCharacters: 0, reason: "no_canonical_characters" };
    const dependencies = await cropper(workspace, true, env);
    const available = dependencies.ready === true;
    if (check || !available) return { ...readiness, ready: available, status: available ? "ready" : "setup_required", dependencies };
    await albumPortraits(workspace, env);
    const generation = await cropper(workspace, false, env);
    const finalization = await albumPortraits(workspace, env);
    const portraits = await loadPortraits(workspace);
    return {
      status: "complete", generation,
      bound: portraits.filter((portrait) => portrait.entityId !== null).length,
      pendingCharacters: finalization.unboundCharacters.length,
      pending: finalization.unboundCharacters.slice(0, 20),
      visualFallbackAvailable: finalization.tasks.some((task) => task.hostSupportsVisualInput === true),
      metadata: "ontology/portraits.jsonl",
    };
  } finally {
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
