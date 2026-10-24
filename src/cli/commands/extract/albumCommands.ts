/** `novel album` — EPUB illustration import + anchor listing + portrait finalization. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  importEpubAlbum,
  picturesByBlock,
  resolveAnchors,
  type IllustrationRecord,
} from "../../../digger/intake/album/album.js";
import {
  finalizePortraits,
  hostVisionFromEnv,
} from "../../../digger/intake/album/portraits.js";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import type { EventSink } from "../../../ground/events/types.js";
import type { Block } from "../../../digger/intake/blocks.js";
import type { Entity } from "../../../ground/ontology/types.js";

export async function albumImport(novelDir: string, epubPath: string) {
  return importEpubAlbum(novelDir, epubPath);
}

export async function albumList(novelDir: string, blockSize?: number) {
  return resolveAnchors(novelDir, blockSize);
}

/**
 * Album pre-process emission, called by `novel ingest` at intake: one
 * album.anchored event per picture-bearing block, from intake data
 * alone (offsets + sectioning — no canon). Blocks already anchored by
 * an earlier run are skipped, so gate-mode re-runs never duplicate.
 * Returns zeros (no reads beyond the missing file) when the workspace
 * has no album.
 */
export async function emitAlbumAnchors(
  novelDir: string,
  allBlocks: Block[],
  processingLog: string,
  emit: EventSink,
): Promise<{ emitted: number; blocks: string[] }> {
  const raw = await readFile(join(novelDir, "ontology", "illustrations.jsonl"), "utf8").catch(() => null);
  if (raw === null) return { emitted: 0, blocks: [] };
  const illustrations = raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as IllustrationRecord);
  if (illustrations.length === 0) return { emitted: 0, blocks: [] };
  const alreadyAnchored = new Set(processingLog.split("\n").filter(Boolean)
    .map((line) => { try { return JSON.parse(line) as { event?: { type?: string; blockId?: string } }; } catch { return null; } })
    .filter((r): r is { event: { type: string; blockId: string } } => !!r && r.event?.type === "album.anchored" && !!r.event.blockId)
    .map((r) => r.event.blockId));
  const byBlock = picturesByBlock(illustrations, allBlocks);
  const emittedBlocks: string[] = [];
  for (const block of allBlocks) {
    const pictures = byBlock.get(block.id);
    if (pictures && pictures.length > 0 && !alreadyAnchored.has(block.id)) {
      await emit({ type: "album.anchored", blockId: block.id, pictures });
      emittedBlocks.push(block.id);
    }
  }
  return { emitted: emittedBlocks.length, blocks: emittedBlocks };
}

/**
 * `novel album portraits` — end-of-run portrait finalization, also run
 * automatically at the end of `novel ingest`: EM-merge follow, birth
 * fold-match binding, then reviewer tasks for characters still without
 * a portrait (skipped when the host is known not to support visual
 * input — those portraits stay unbound and hidden).
 */
export async function albumPortraits(novelDir: string, env: NodeJS.ProcessEnv = process.env) {
  const bundle = new BundleStore(join(novelDir, "ontology"));
  const rows = await bundle.loadFile<Entity>("entities.jsonl");
  const byId = new Map<string, Entity>();
  for (const e of rows) byId.set(e.id, e);
  const entities = [...byId.values()];

  const mergedPairs: { keepId: string; dropId: string }[] = [];
  const logRaw = await readFile(join(novelDir, "events.jsonl"), "utf8").catch(() => "");
  for (const line of logRaw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { event?: { type?: string; keepId?: string; dropId?: string } };
      if (rec.event?.type === "entity.merged" && rec.event.keepId && rec.event.dropId) {
        mergedPairs.push({ keepId: rec.event.keepId, dropId: rec.event.dropId });
      }
    } catch { /* a malformed log line must not break portrait finalization */ }
  }

  return finalizePortraits(novelDir, {
    entities,
    mergedPairs,
    hostSupportsVisualInput: hostVisionFromEnv(env),
  });
}
