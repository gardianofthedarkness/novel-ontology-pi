import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../src/digger/intake/album/zip.js";
import {
  importEpubAlbum,
  locateAnchor,
  picturesByBlock,
  resolveAnchors,
  type IllustrationRecord,
} from "../src/digger/intake/album/album.js";
import { cutBlocks } from "../src/digger/intake/blocks.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import {
  bindPortraitsAtBirth,
  finalizePortraits,
  followPortraitMerges,
  type PortraitRecord,
} from "../src/digger/intake/album/portraits.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { projectEvent, type ProcessingEvent } from "../src/ground/events/types.js";
import { emitAlbumAnchors } from "../src/cli/commands/extract/albumCommands.js";
import { placePictures } from "../apps/playground/src/data/pictureNodes.js";
import { projectProcessingEvent } from "../apps/playground/src/events/project.js";
import type { Entity } from "../src/ground/ontology/types.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test("image anchors in whitespace stay with preceding prose instead of drifting into the next scene", () => {
  const text = "第一章\n\n戦いが終わった。\n\n\n\n行間\n\n百年前の出来事だった。\n\n\n次の話。";
  const blocks = cutBlocks(text);
  const block = blocks[0];
  const sentences = sectionBlock(block.text, block.index).sentences;
  const ending = sentences.find(sentence => sentence.text === "戦いが終わった。")!;
  const interlude = sentences.find(sentence => sentence.text === "行間")!;
  const offset = text.indexOf("戦いが終わった。") + "戦いが終わった。".length + 2;
  const located = locateAnchor(blocks, offset);
  assert.equal(located.sentenceId, ending.id);
  assert.equal(locateAnchor(blocks, text.indexOf("行間")).sentenceId, interlude.id);
  const pictures = [{ id: "illustration", asset: "assets/example.jpg", kind: "story", sentenceId: located.sentenceId }];
  const placed = placePictures([{ id: "battle", chrono: 0, sentenceIds: [ending.id] }, { id: "history", chrono: 1, sentenceIds: [interlude.id] }], pictures)[0];
  assert.equal(placed.prevSceneId, "battle");
  assert.equal(placed.nextSceneId, "history");
});

function fixtureEpub(): Buffer {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>小説</dc:title></metadata>
  <manifest>
    <item id="s1" href="Images/story1.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const ch1 = `<html><body><h1>第一章</h1><p>彼はドアを開けた。部屋は暗かった。</p><p><img src="Images/story1.jpg"/></p><p>手紙が机の上にあった。</p></body></html>`;
  return createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/ch1.xhtml", data: ch1 },
    { name: "OEBPS/Images/story1.jpg", data: JPEG },
  ], true);
}

async function novelWithAlbum(context: { after: (fn: () => Promise<void>) => void }): Promise<{ parent: string; novelDir: string }> {
  const parent = await mkdtemp(join(tmpdir(), "novel-album-v2-"));
  context.after(async () => { const { rm } = await import("node:fs/promises"); await rm(parent, { recursive: true, force: true }); });
  const novelDir = join(parent, "novel");
  await initWorkspace(novelDir);
  const epubPath = join(parent, "fixture.epub");
  await writeFile(epubPath, fixtureEpub());
  await importEpubAlbum(novelDir, epubPath);
  return { parent, novelDir };
}

test("v2: import stores sentence identities, and resolveAnchors keeps them", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const raw = await readFile(join(novelDir, "ontology", "illustrations.jsonl"), "utf8");
  const records = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IllustrationRecord);
  assert.equal(records.length, 1);
  assert.ok(records[0].sentenceId, "import must store a sentence identity");
  assert.ok(records[0].blockId, "import must store a block identity");
  assert.match(records[0].sentenceId as string, /^b\d{4}_s\d{4}$/);
  const { illustrations } = await resolveAnchors(novelDir);
  assert.equal(illustrations[0].sentenceId, records[0].sentenceId);
  assert.equal(illustrations[0].blockId, records[0].blockId);
  assert.equal(illustrations[0].sceneId, null); // nothing ingested yet
});

test("v2: legacy records without sentence identities still resolve via charOffset", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const raw = await readFile(join(novelDir, "ontology", "illustrations.jsonl"), "utf8");
  const records = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IllustrationRecord);
  const legacy = { ...records[0] };
  delete (legacy as Partial<IllustrationRecord>).sentenceId;
  delete (legacy as Partial<IllustrationRecord>).blockId;
  await writeFile(join(novelDir, "ontology", "illustrations.jsonl"), JSON.stringify(legacy) + "\n", "utf8");
  const { illustrations } = await resolveAnchors(novelDir);
  assert.equal(illustrations[0].sentenceId, records[0].sentenceId);
  assert.equal(illustrations[0].blockId, records[0].blockId);
});

test("v2: resolving stale cached image anchors uses exact offsets without changing album records", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const path = join(novelDir, "ontology", "illustrations.jsonl");
  const original = JSON.parse((await readFile(path, "utf8")).trim()) as IllustrationRecord;
  const stale = JSON.stringify({ ...original, sentenceId: "b0000_s9999" }) + "\n";
  await writeFile(path, stale);
  const { illustrations } = await resolveAnchors(novelDir);
  assert.equal(illustrations[0].sentenceId, original.sentenceId);
  assert.equal(illustrations[0].id, original.id);
  assert.equal(illustrations[0].asset, original.asset);
  assert.equal(illustrations[0].charOffset, original.charOffset);
  assert.equal(await readFile(path, "utf8"), stale);
});

test("v2: picturesByBlock maps intake pictures to blocks by anchor sentence", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const sidecar = JSON.parse(await readFile(join(novelDir, "ontology", "album.json"), "utf8")) as { sourceText: string };
  const text = await readFile(join(novelDir, sidecar.sourceText), "utf8");
  const blocks = cutBlocks(text);
  const raw = await readFile(join(novelDir, "ontology", "illustrations.jsonl"), "utf8");
  const records = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IllustrationRecord);
  const byBlock = picturesByBlock(records, blocks);
  assert.equal(byBlock.size, 1);
  const pictures = [...byBlock.values()][0];
  assert.equal(pictures[0].id, records[0].id);
  assert.equal(pictures[0].sentenceId, records[0].sentenceId);
});

test("v2: picture placement sits between the anchor scene and the next", () => {
  const scenes = [
    { id: "scn_a", chrono: 0, sentenceIds: ["b0000_s0000", "b0000_s0001"] },
    { id: "scn_b", chrono: 10, sentenceIds: ["b0000_s0002", "b0000_s0003"] },
  ];
  const placed = placePictures(scenes, [
    { id: "ill_0001", asset: "assets/ill_0001.jpg", kind: "story", sentenceId: "b0000_s0001" },
    { id: "ill_0002", asset: "assets/ill_0002.jpg", kind: "story", sentenceId: "b0000_s0003" },
    { id: "ill_0003", asset: "assets/ill_0003.jpg", kind: "plate", sentenceId: null },
    { id: "ill_0004", asset: "assets/ill_0004.jpg", kind: "story", sentenceId: "b0000_s9999" },
  ]);
  const [first, last, noSentence, unknown] = placed;
  assert.equal(first.placed, true);
  if (first.placed) {
    assert.equal(first.prevSceneId, "scn_a");
    assert.equal(first.nextSceneId, "scn_b");
    assert.ok(first.chrono > 0 && first.chrono < 10, "orbit slot strictly between neighbors");
  }
  assert.equal(last.placed, true);
  if (last.placed) {
    assert.equal(last.prevSceneId, "scn_b");
    assert.equal(last.nextSceneId, null);
    assert.ok(last.chrono > 10, "past the last scene, never forced into it");
  }
  assert.equal(noSentence.placed, false);
  assert.equal(unknown.placed, false);
});

test("v2: portrait birth binding needs an exact single fold match", () => {
  const entity = (id: string, forms: string[]): Entity => ({
    id, kind: "Character",
    names: forms.map((text) => ({ text, lang: "zh", kind: "canonical" as const })),
    properties: {}, confidence: 1,
  });
  const portrait = (name: string): PortraitRecord => ({
    entityId: null, name, portrait: `assets/portraits/${name}.png`,
    sourceIllustration: "ill_0001", sourceAsset: "assets/ill_0001.jpg",
    ocrText: name, ocrConfidence: 0.9, matchKind: "exact-line",
  });
  const portraits = [portrait("御坂美琴"), portrait("白井黒子"), portrait("佐天涙子")];
  const bound = bindPortraitsAtBirth(
    [entity("char_a", ["御坂美琴"]), entity("char_b", ["白井黒子"])],
    portraits,
  );
  assert.equal(bound, 2);
  assert.equal(portraits[0].entityId, "char_a");
  assert.equal(portraits[1].entityId, "char_b");
  assert.equal(portraits[2].entityId, null, "no entity, no invention");

  // Ambiguous: two entities share the folded name — nobody auto-binds.
  const ambiguous = [portrait("御坂美琴")];
  assert.equal(bindPortraitsAtBirth(
    [entity("char_a", ["御坂美琴"]), entity("char_c", ["御坂美琴", "美琴"])],
    ambiguous,
  ), 0);
  assert.equal(ambiguous[0].entityId, null);
});

test("v2: portrait merge follow moves portraits to the survivor", () => {
  const portrait = (entityId: string | null): PortraitRecord => ({
    entityId, name: "x", portrait: "assets/portraits/x.png",
    sourceIllustration: "ill_0001", sourceAsset: "assets/ill_0001.jpg",
    ocrText: "x", ocrConfidence: 0.9, matchKind: "exact-line",
  });
  const portraits = [portrait("char_drop"), portrait("char_keep"), portrait(null)];
  assert.equal(followPortraitMerges([{ keepId: "char_keep", dropId: "char_drop" }], portraits), 1);
  assert.equal(portraits[0].entityId, "char_keep");
  assert.equal(portraits[1].entityId, "char_keep");
  assert.equal(portraits[2].entityId, null);
});

test("v2: end-of-run fallback writes reviewer tasks unless vision is ruled out", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const entity = (id: string, forms: string[]): Entity => ({
    id, kind: "Character",
    names: forms.map((text) => ({ text, lang: "zh", kind: "canonical" as const })),
    properties: {}, confidence: 1,
  });
  const orphan: PortraitRecord = {
    entityId: null, name: "御坂美琴", portrait: "assets/portraits/mikoto.png",
    sourceIllustration: "ill_0001", sourceAsset: "assets/ill_0001.jpg",
    ocrText: "御坂美琴", ocrConfidence: 0.92, matchKind: "exact-line",
  };
  await writeFile(join(novelDir, "ontology", "portraits.jsonl"), JSON.stringify(orphan) + "\n", "utf8");

  // Unknown host vision: tasks written, marked as requiring the check.
  const result = await finalizePortraits(novelDir, {
    entities: [entity("char_a", ["御坂美琴"]), entity("char_b", ["白井黒子"])],
    mergedPairs: [],
    hostSupportsVisualInput: "unknown",
  });
  assert.equal(result.portraitsFile, true);
  assert.equal(result.bound, 1, "birth fold-match binds the orphan to its single entity");
  assert.equal(result.tasksWritten, true);
  assert.equal(result.unboundCharacters.length, 1);
  assert.equal(result.unboundCharacters[0].id, "char_b");
  const tasksRaw = await readFile(join(novelDir, "ontology", "portrait-tasks.jsonl"), "utf8");
  const tasks = tasksRaw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].characterId, "char_b");
  assert.equal(tasks[0].requiresVisualInput, true);
  assert.equal(tasks[0].hostSupportsVisualInput, "unknown");

  // Known-no-vision host: no tasks, portraits stay hidden.
  await writeFile(join(novelDir, "ontology", "portraits.jsonl"), JSON.stringify(orphan) + "\n", "utf8");
  const skipped = await finalizePortraits(novelDir, {
    entities: [entity("char_a", ["御坂美琴"]), entity("char_b", ["白井黒子"])],
    mergedPairs: [],
    hostSupportsVisualInput: false,
  });
  assert.equal(skipped.visionSkipped, true);
  assert.equal(skipped.tasksWritten, false);
});

test("v2: pre-process emission maps blocks once and never duplicates", async (context) => {
  const { novelDir } = await novelWithAlbum(context);
  const sidecar = JSON.parse(await readFile(join(novelDir, "ontology", "album.json"), "utf8")) as { sourceText: string };
  const text = await readFile(join(novelDir, sidecar.sourceText), "utf8");
  const blocks = cutBlocks(text);
  const seen: ProcessingEvent[] = [];
  const emit = async (event: ProcessingEvent) => { seen.push(event); };
  const first = await emitAlbumAnchors(novelDir, blocks, "", emit);
  assert.equal(first.emitted, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "album.anchored");
  // A gate-mode re-run sees the earlier event in the log and emits nothing.
  const log = seen.map((event) => JSON.stringify({ event })).join("\n");
  const seen2: ProcessingEvent[] = [];
  const second = await emitAlbumAnchors(novelDir, blocks, log, async (event) => { seen2.push(event); });
  assert.equal(second.emitted, 0);
  assert.equal(seen2.length, 0);
});

test("v2: album.anchored events project through both event layers", () => {
  const cli = projectEvent({
    type: "album.anchored",
    blockId: "b0001",
    pictures: [{ id: "ill_0001", asset: "assets/ill_0001.jpg", kind: "story", sentenceId: "b0000_s0001" }],
  });
  assert.equal(cli.type, "album.anchored");
  const playground = projectProcessingEvent(cli);
  assert.equal(playground.length, 1);
  assert.equal(playground[0].type, "album.anchored");
});
