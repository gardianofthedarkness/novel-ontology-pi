import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutBlocks } from "../src/digger/intake/blocks.js";
import { createZip } from "../src/digger/intake/album/zip.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";

export const KEEPER = `The Lighthouse Keeper

Chapter 1 The Lamp

Mara climbed the stairs before dusk. The lamp had to be lit before the boats turned for home.

"You are late," said Tobin from the gallery.

"The oil was late," she said. "Not me."

Captain Reyes waved from the last boat.

*

Below them the tide came in over the black rocks. Tobin watched the horizon.

Chapter 2 The Storm

The storm arrived at midnight. Mara held the lamp steady.

"There is a boat on the rocks," Tobin said.

Mara ran for the rope.

1

Morning came grey. Mara slept beside the lamp.

"Bring the rope," the stranger shouted.
`;

export const KEEPER_2 = `The Lighthouse Keeper, Book Two

Chapter 1 The Letter

A letter came for Mara in spring. Mara read it twice.

"Who writes to you?" asked the boy.
`;

/** An EPUB of two chapters, for the scan. */
export function tinyEpub(title = "A Small Book"): Buffer {
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  return createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/c1.xhtml", data: "<html><body><h1>Chapter 1 Rain</h1><p>It rained all day. Nobody came.</p></body></html>" },
    { name: "OEBPS/c2.xhtml", data: "<html><body><h1>Chapter 2 Sun</h1><p>The sun came back. Everybody came.</p></body></html>" },
  ]);
}

interface Line { id: string; text: string; chapter: number }
export function linesOfText(text: string): Line[] {
  return cutBlocks(text).flatMap((block) => sectionBlock(block.text, block.index).sentences.map((sentence) => ({ id: sentence.id, text: sentence.text, chapter: block.chapterIndex })));
}

/** A v2 novel folder and reading for a text: scenes cut where `breaks` lines start, people credited as `credits` say. */
export async function writeReading(root: string, name: string, text: string, spec: {
  entities: { id: string; category: string; names: string[] }[];
  breaks: string[];
  credits: { line: string; kind: "spoken" | "action"; who: string; settled?: boolean; confidence?: number; via?: string }[];
}): Promise<{ novel: string; data: string; lines: Line[] }> {
  const novel = join(root, name, "novel"), reading = join(root, name, "reading"), sha256 = createHash("sha256").update(text).digest("hex");
  await mkdir(join(novel, "ontology"), { recursive: true }); await mkdir(join(novel, "source"), { recursive: true }); await mkdir(reading, { recursive: true });
  await writeFile(join(novel, "source", "source.txt"), text, "utf8");
  await writeFile(join(novel, "ontology", "source.json"), JSON.stringify({ version: 1, sourceId: `source_${sha256}`, sha256, file: "source.txt", blockSize: 24000 }), "utf8");
  const lines = linesOfText(text), find = (part: string) => { const line = lines.find((entry) => entry.text.includes(part)); if (!line) throw new Error(`No line holds "${part}".`); return line; };
  const starts = new Set(spec.breaks.map((part) => find(part).id)), scenes: { id: string; index: number; chapter: number; sentences: string[]; type: string }[] = [];
  for (const line of lines) {
    if (!scenes.length || starts.has(line.id)) scenes.push({ id: `scene_${String(scenes.length + 1).padStart(6, "0")}`, index: scenes.length, chapter: line.chapter, sentences: [], type: "routine" });
    scenes[scenes.length - 1].sentences.push(line.id);
  }
  const entities = spec.entities.map((entity) => { const seen = lines.filter((line) => entity.names.some((own) => line.text.includes(own))).map((line) => line.id); return { id: entity.id, category: entity.category, type: entity.category, names: entity.names, proper: [entity.names[0]], first: seen[0], seen }; });
  const cards: Record<string, unknown>[] = [], roles: Record<string, unknown> = {};
  for (const line of lines) {
    const named = entities.filter((entity) => entity.category === "person" && entity.seen.includes(line.id)).map((entity) => ({ id: entity.id, how: ["named"], at: [line.id] }));
    const credit = spec.credits.find((entry) => line.text.includes(entry.line));
    const people = [...named];
    if (credit) {
      const how = credit.kind === "spoken" ? "speaks" : "acts", own = people.find((person) => person.id === credit.who);
      if (credit.settled !== false) { if (own) own.how.push(how); else people.push({ id: credit.who, how: [how], at: [line.id] }); }
      roles[line.id] = { kind: credit.kind, who: { id: credit.settled === false ? null : credit.who, answer: credit.who, confidence: credit.confidence ?? 0.9, ...(credit.via ? { via: credit.via } : {}) } };
    }
    const kind = credit ? (credit.kind === "spoken" ? "spoken" : "action") : "narration";
    cards.push({ id: `${kind}:${line.id}`, kind, first: line.id, last: line.id, sentences: [line.id], entities: entities.filter((entity) => entity.category !== "person" && entity.seen.includes(line.id)).map((entity) => ({ id: entity.id, at: [line.id] })), people });
  }
  const data = join(reading, "data.json");
  await writeFile(data, JSON.stringify({ scenes, cards, roles, chart: { entities }, slots: [] }), "utf8");
  return { novel, data, lines };
}

/** A folder with two books of one world, an EPUB of another and a note, and readings for the two books beside it. */
export async function shelf(): Promise<{ root: string; folder: string; one: { novel: string; data: string; lines: Line[] }; two: { novel: string; data: string; lines: Line[] } }> {
  const root = await mkdtemp(join(tmpdir(), "novel-v3-")), folder = join(root, "shelf");
  await mkdir(join(folder, "downloads"), { recursive: true }); await mkdir(join(folder, ".hidden"), { recursive: true });
  await writeFile(join(folder, "keeper-1.txt"), KEEPER, "utf8");
  await writeFile(join(folder, "downloads", "keeper-2.txt"), KEEPER_2, "utf8");
  await writeFile(join(folder, "downloads", "small.epub"), tinyEpub());
  await writeFile(join(folder, ".hidden", "skipped.txt"), "Not a book.", "utf8");
  await writeFile(join(folder, "cover.png"), Buffer.from([1, 2, 3]));
  const people = [{ id: "char_000001", category: "person", names: ["Mara"] }, { id: "char_000002", category: "person", names: ["Tobin"] }, { id: "char_000003", category: "person", names: ["Captain Reyes", "Reyes"] }, { id: "loc_000001", category: "place", names: ["gallery"] }];
  const one = await writeReading(root, "lib-1", KEEPER, {
    entities: people,
    breaks: ["Mara climbed", "Below them", "The storm arrived", "Morning came"],
    credits: [
      { line: "You are late", kind: "spoken", who: "char_000002" },
      { line: "The oil was late", kind: "spoken", who: "char_000001", via: "she", confidence: 0.8 },
      { line: "There is a boat", kind: "spoken", who: "char_000002" },
      { line: "ran for the rope", kind: "action", who: "char_000001" },
      { line: "Bring the rope", kind: "spoken", who: "char_000003", via: "the stranger", confidence: 0.4 },
    ],
  });
  const two = await writeReading(root, "lib-2", KEEPER_2, {
    entities: [{ id: "char_000009", category: "person", names: ["Mara"] }, { id: "char_000010", category: "person", names: ["the boy"] }],
    breaks: ["A letter came"],
    credits: [{ line: "Who writes to you", kind: "spoken", who: "char_000010", settled: false, confidence: 0.4 }],
  });
  return { root, folder, one, two };
}
