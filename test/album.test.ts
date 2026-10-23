import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../src/album/zip.js";
import { importEpubAlbum, resolveAnchors } from "../src/album/album.js";
import { initWorkspace } from "../src/workspace/init.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function fixtureEpub(): Buffer {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>テスト小説</dc:title>
    <meta name="cover" content="coverimg"/>
  </metadata>
  <manifest>
    <item id="coverimg" href="Images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="plate" href="Images/plate.jpg" media-type="image/jpeg"/>
    <item id="s1" href="Images/story1.jpg" media-type="image/jpeg"/>
    <item id="s2" href="Images/story2.jpg" media-type="image/jpeg"/>
    <item id="extra" href="Images/extra.jpg" media-type="image/jpeg"/>
    <item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="front"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const front = `<html><body><p>扉</p><p><img src="Images/plate.jpg"/></p></body></html>`;
  const ch1 = `<html><body><h1>第一章</h1><p>彼はドアを開けた。部屋は暗かった。</p><p><img src="Images/story1.jpg"/></p><p>手紙が机の上にあった。彼は手紙を取った。</p></body></html>`;
  const ch2 = `<html><body><h1>第二章</h1><p>朝になった。彼女は笑った。</p><p><img src="Images/story2.jpg"/></p><p>二人は歩き出した。</p></body></html>`;
  return createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/front.xhtml", data: front },
    { name: "OEBPS/ch1.xhtml", data: ch1 },
    { name: "OEBPS/ch2.xhtml", data: ch2 },
    { name: "OEBPS/Images/cover.jpg", data: JPEG },
    { name: "OEBPS/Images/plate.jpg", data: JPEG },
    { name: "OEBPS/Images/story1.jpg", data: JPEG },
    { name: "OEBPS/Images/story2.jpg", data: JPEG },
    { name: "OEBPS/Images/extra.jpg", data: JPEG },
  ], true);
}

test("album import: spine walk anchors every image into the extracted text", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-album-"));
  context.after(async () => { const { rm } = await import("node:fs/promises"); await rm(parent, { recursive: true, force: true }); });
  const novelDir = join(parent, "novel");
  await initWorkspace(novelDir);
  const epubPath = join(parent, "fixture.epub");
  await writeFile(epubPath, fixtureEpub());

  const result = await importEpubAlbum(novelDir, epubPath);
  assert.equal(result.title, "テスト小説");
  assert.equal(result.illustrations, 5);
  assert.deepEqual(result.byKind, { cover: 1, plate: 1, story: 2, paratext: 1 });

  const text = await readFile(join(novelDir, result.sourceText), "utf8");
  assert.ok(text.includes("第一章") && text.includes("第二章"));

  const { illustrations } = await resolveAnchors(novelDir);
  assert.equal(illustrations.length, 5);
  const bySource = new Map(illustrations.map((i) => [i.sourcePath, i]));
  const story1 = bySource.get("OEBPS/Images/story1.jpg")!;
  const story2 = bySource.get("OEBPS/Images/story2.jpg")!;
  assert.equal(story1.kind, "story");
  assert.equal(story1.chapterIndex, 1);
  assert.equal(story2.chapterIndex, 2);
  // The anchor sits exactly where the <img> sat: the next prose is the letter.
  assert.ok(text.slice(story1.charOffset, story1.charOffset + 12).includes("手紙"));
  assert.ok(text.slice(story2.charOffset, story2.charOffset + 12).includes("二人"));
  assert.equal(bySource.get("OEBPS/Images/cover.jpg")!.kind, "cover");
  assert.equal(bySource.get("OEBPS/Images/plate.jpg")!.kind, "plate");
  assert.equal(bySource.get("OEBPS/Images/extra.jpg")!.kind, "paratext");
  for (const ill of illustrations) {
    assert.equal(ill.sceneId, null); // nothing ingested yet
    const info = await stat(join(novelDir, ill.asset));
    assert.equal(info.size, JPEG.length);
  }
  // Blocks are cut per chapter: front matter, ch1, ch2 → b0001..b0003,
  // and sentence ids carry the block's 0-based section index.
  assert.equal(bySource.get("OEBPS/Images/plate.jpg")!.blockId, "b0001");
  assert.equal(story1.blockId, "b0002");
  assert.match(story1.sentenceId ?? "", /^b0001_s\d{4}$/);
  assert.equal(story2.blockId, "b0003");
  assert.match(story2.sentenceId ?? "", /^b0002_s\d{4}$/);

  // Once a scene covers the anchored sentence, the anchor resolves to it.
  await writeFile(
    join(novelDir, "ontology", "scenes.jsonl"),
    JSON.stringify({ id: "scn_test", chapterIndex: 1, sentenceIds: [story1.sentenceId], charactersPresent: [], charactersMentioned: [], turns: [], locationId: null }) + "\n",
    "utf8",
  );
  const resolved = await resolveAnchors(novelDir);
  assert.equal(resolved.illustrations.find((i) => i.id === story1.id)!.sceneId, "scn_test");
});

test("album import refuses a non-workspace directory", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-album-bad-"));
  context.after(async () => { const { rm } = await import("node:fs/promises"); await rm(parent, { recursive: true, force: true }); });
  const epubPath = join(parent, "fixture.epub");
  await writeFile(epubPath, fixtureEpub());
  await assert.rejects(() => importEpubAlbum(join(parent, "nope"), epubPath), /novel init/);
});
