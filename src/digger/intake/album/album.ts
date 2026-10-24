/**
 * The album: an EPUB's illustrations inside a novel workspace.
 *
 * Layout (all paths relative to the novel dir):
 * - `assets/ill_0001.jpg` …          the image bytes, in spine order
 * - `source/<epub-name>.txt`         the extracted text (ingest THIS file)
 * - `ontology/illustrations.jsonl`   one anchor record per image
 * - `ontology/album.json`            import sidecar (epub, title, text path)
 *
 * Anchor identity (v2, owner's decision 2026-10-24): the anchor IS a
 * sentence identity, carried through sectioning — never a raw character
 * offset. The record keeps `charOffset` as the exact source position
 * (and the fallback for legacy records), but placement keys on
 * `sentenceId`: sectioning is deterministic, so the same text cut with
 * the same block size yields the same sentence ids in the album and in
 * the ingest run. The album blends into the Digger as a PRE-PROCESS at
 * intake: anchors are known before any model decision, and the
 * playground resolves them positionally at render (see
 * apps/playground/src/data/pictureNodes.ts) — pictures are a node type
 * projected from the album store, not canon entities and not gate
 * proposals. Records are data, not graph nodes: the graph stays the
 * ontology, the album hangs off it by sentence.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { splitChapters, cutBlocks, type Block } from "../blocks.js";
import { sectionBlock } from "../sectioning.js";
import { walkEpub } from "./epub.js";
import { unzipAll } from "./zip.js";

export type IllustrationKind = "cover" | "plate" | "story" | "paratext";

export interface IllustrationRecord {
  id: string;
  /** Asset path relative to the novel dir, e.g. "assets/ill_0003.jpg". */
  asset: string;
  /** Path of the image inside the source EPUB. */
  sourcePath: string;
  /** Character offset into the extracted source text (exact position; fallback for legacy records). */
  charOffset: number;
  /** Sentence identity of the anchor (v2): the placement key. Null only for legacy records not yet re-resolved. */
  sentenceId: string | null;
  /** Block holding the anchor sentence (v2). */
  blockId: string | null;
  chapterIndex: number;
  kind: IllustrationKind;
  spineIndex: number;
}

export interface AlbumSidecar {
  epubFile: string;
  title: string | null;
  /** Extracted text path relative to the novel dir. */
  sourceText: string;
  importedAt: string;
  imageCount: number;
}

function sanitizeBase(name: string): string {
  const base = basename(name, extname(name)).replace(/[^\p{L}\p{N}_-]+/gu, "_");
  return base.length > 0 ? base : "epub";
}

function assetExt(sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.length > 0 ? ext : "bin";
}

/**
 * Kind by position (deterministic; the record keeps spineIndex and
 * charOffset, so reclassification later is cheap):
 * - the OPF cover is `cover`;
 * - inside a titled chapter → `story` (in-story illustrations sit in
 *   their own image-only documents mid-chapter — position decides,
 *   not the referencing document's text volume);
 * - before the first titled chapter (front matter): image-dominated
 *   document → `plate`, otherwise `paratext`.
 */
export function classifyKind(input: {
  isCover: boolean;
  inSpine: boolean;
  spineIndex: number;
  bookHasMarkedCover: boolean;
  chapterTitle: string | null;
  docTextChars: number;
}): IllustrationKind {
  if (input.isCover) return "cover";
  if (!input.inSpine) return "paratext";
  // No OPF-marked cover anywhere: an image-dominated FIRST spine
  // document is the cover page by EPUB convention.
  if (!input.bookHasMarkedCover && input.spineIndex === 0 && input.docTextChars < 50) return "cover";
  if (input.chapterTitle !== null) return "story";
  return input.docTextChars < 50 ? "plate" : "paratext";
}

/**
 * Locate a character offset's block + sentence with the same
 * deterministic sectioning the ingest run uses (cutBlocks, then
 * sectionBlock with the block's 0-based index — so sentence ids match
 * the ingest run's exactly when the block size matches). Blocks are
 * trimmed slices: inter-paragraph whitespace between blocks belongs to
 * no block, so the anchor's block is the one in effect at the offset —
 * the last block that starts at or before it.
 */
export function locateAnchor(
  blocks: Block[],
  charOffset: number,
): { block: Block | null; sentenceId: string | null } {
  const block = [...blocks].reverse().find((b) => charOffset >= b.startOffset) ?? blocks[0] ?? null;
  if (!block) return { block: null, sentenceId: null };
  const local = charOffset - block.startOffset;
  const { sentences } = sectionBlock(block.text, block.index);
  const sentence = sentences.find((s) => local >= s.startOffset && local < s.endOffset)
    ?? [...sentences].reverse().find((s) => s.startOffset <= local)
    ?? sentences[0]
    ?? null;
  return { block, sentenceId: sentence?.id ?? null };
}

/**
 * Pictures per block, from intake data only (offsets + sectioning — no
 * canon): the pre-process hook the ingest run calls. Each picture
 * carries its anchor sentence identity for the block it lands in.
 */
export function picturesByBlock(
  illustrations: IllustrationRecord[],
  blocks: Block[],
): Map<string, { id: string; asset: string; kind: IllustrationKind; sentenceId: string | null }[]> {
  const byBlock = new Map<string, { id: string; asset: string; kind: IllustrationKind; sentenceId: string | null }[]>();
  for (const ill of illustrations) {
    const { block, sentenceId } = locateAnchor(blocks, ill.charOffset);
    if (!block) continue;
    const list = byBlock.get(block.id) ?? [];
    list.push({ id: ill.id, asset: ill.asset, kind: ill.kind, sentenceId });
    byBlock.set(block.id, list);
  }
  return byBlock;
}

export async function importEpubAlbum(novelDir: string, epubPath: string): Promise<{
  novelDir: string;
  epubFile: string;
  title: string | null;
  textChars: number;
  sourceText: string;
  illustrations: number;
  byKind: Record<IllustrationKind, number>;
}> {
  const manifestPath = join(novelDir, "ontology", "manifest.json");
  const manifest = await readFile(manifestPath, "utf8").catch(() => null);
  if (manifest === null) {
    throw new Error(`not a novel workspace (missing ${manifestPath}) — run \`novel init ${novelDir}\` first`);
  }
  const epubBytes = await readFile(epubPath);
  const files = unzipAll(epubBytes);
  const walk = walkEpub(epubBytes);
  const chapters = splitChapters(walk.text);
  const blocks = cutBlocks(walk.text);

  const assetsDir = join(novelDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await mkdir(join(novelDir, "source"), { recursive: true });
  await mkdir(join(novelDir, "ontology"), { recursive: true });

  const byKind: Record<IllustrationKind, number> = { cover: 0, plate: 0, story: 0, paratext: 0 };
  const records: IllustrationRecord[] = [];
  walk.images.forEach((ref, i) => {
    const chapter = [...chapters].reverse().find((c) => ref.charOffset >= c.startOffset) ?? chapters[0];
    const kind = classifyKind({
      isCover: ref.isCover,
      inSpine: ref.inSpine,
      spineIndex: ref.spineIndex,
      bookHasMarkedCover: walk.hasMarkedCover,
      chapterTitle: chapter?.title ?? null,
      docTextChars: ref.docTextChars,
    });
    byKind[kind]++;
    const id = `ill_${String(i + 1).padStart(4, "0")}`;
    const anchor = locateAnchor(blocks, ref.charOffset);
    records.push({
      id,
      asset: `assets/${id}.${assetExt(ref.sourcePath)}`,
      sourcePath: ref.sourcePath,
      charOffset: ref.charOffset,
      sentenceId: anchor.sentenceId,
      blockId: anchor.block?.id ?? null,
      chapterIndex: chapter?.index ?? 0,
      kind,
      spineIndex: ref.spineIndex,
    });
  });

  for (const record of records) {
    const bytes = files.get(record.sourcePath);
    if (!bytes) throw new Error(`EPUB image missing from archive: ${record.sourcePath}`);
    await writeFile(join(novelDir, record.asset), bytes);
  }

  const sourceTextRel = `source/${sanitizeBase(epubPath)}.txt`;
  await writeFile(join(novelDir, sourceTextRel), walk.text, "utf8");
  await writeFile(
    join(novelDir, "ontology", "illustrations.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""),
    "utf8",
  );
  const sidecar: AlbumSidecar = {
    epubFile: basename(epubPath),
    title: walk.title,
    sourceText: sourceTextRel,
    importedAt: new Date().toISOString(),
    imageCount: records.length,
  };
  await writeFile(join(novelDir, "ontology", "album.json"), JSON.stringify(sidecar, null, 2), "utf8");

  return {
    novelDir,
    epubFile: sidecar.epubFile,
    title: walk.title,
    textChars: walk.text.length,
    sourceText: sourceTextRel,
    illustrations: records.length,
    byKind,
  };
}

export interface ResolvedIllustration extends IllustrationRecord {
  blockId: string | null;
  sentenceId: string | null;
  sceneId: string | null;
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return [];
  return raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as T);
}

/**
 * Resolve every illustration anchor to its block, sentence and (when
 * the block has been ingested) scene. Scene resolution is by sentence
 * id — the scene whose `sentenceIds` contain the anchored sentence.
 * The sentence identity is recomputed from the exact charOffset with
 * the caller's block size (so a run with a different block size still
 * resolves); the stored sentence identity is the fallback for records
 * whose offset cannot be located.
 */
export async function resolveAnchors(
  novelDir: string,
  blockSize = 24000,
): Promise<{ novelDir: string; blockSize: number; illustrations: ResolvedIllustration[] }> {
  const records = await readJsonl<IllustrationRecord>(join(novelDir, "ontology", "illustrations.jsonl"));
  if (records.length === 0) {
    throw new Error(`no album in ${novelDir} — run \`novel album import ${novelDir} <epub>\` first`);
  }
  const sidecar = JSON.parse(await readFile(join(novelDir, "ontology", "album.json"), "utf8")) as AlbumSidecar;
  const text = await readFile(join(novelDir, sidecar.sourceText), "utf8");
  const blocks = cutBlocks(text, blockSize);

  const scenes = await readJsonl<{ id: string; sentenceIds: string[] }>(join(novelDir, "ontology", "scenes.jsonl"));
  const sceneBySentence = new Map<string, string>();
  for (const scene of scenes) {
    for (const sid of scene.sentenceIds ?? []) {
      if (!sceneBySentence.has(sid)) sceneBySentence.set(sid, scene.id);
    }
  }

  const illustrations: ResolvedIllustration[] = records.map((record) => {
    const located = locateAnchor(blocks, record.charOffset);
    const blockId = located.block?.id ?? record.blockId ?? null;
    const sentenceId = located.sentenceId ?? record.sentenceId ?? null;
    return {
      ...record,
      blockId,
      sentenceId,
      sceneId: sentenceId ? sceneBySentence.get(sentenceId) ?? null : null,
    };
  });
  return { novelDir, blockSize, illustrations };
}
