/**
 * The album in a v2 book (the user, 2026-11-05: "the picture detection and portrait system never wired in in v2").
 *
 * v1's album (src/digger/intake/album/album.ts) anchors each EPUB picture on a sentence by its character offset in the
 * album's own extraction of the text, which is the workspace's text in v1. A v2 book's text came from elsewhere (vol 1:
 * the host's extraction, 124,716 characters against the album's 129,322), so offsets do not carry over and v1's import
 * refuses it. Here each picture is anchored by its words instead: the text right after it in the EPUB (else right before
 * it), found in the book's own sentences, in reading order, the shortest run of characters that occurs once. Records
 * keep v1's shape (ontology/illustrations.jsonl, assets/ill_NNNN.*, ontology/album.json), so v1's portrait cropper
 * (tools/album-portraits/portraits.py) and binding (album/portraits.ts) work on a v2 book as they are.
 */
import { mkdir, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { cutBlocks, splitChapters } from "../digger/intake/blocks.js";
import { sectionBlock } from "../digger/intake/sectioning.js";
import { walkEpub } from "../digger/intake/album/epub.js";
import { unzipAll } from "../digger/intake/album/zip.js";
import { classifyKind, type IllustrationKind, type IllustrationRecord } from "../digger/intake/album/album.js";
import { storedSource } from "../ground/workspace/source.js";

/** A picture's anchor: the sentence its words were found in, and how. */
export interface TextAnchor { sentenceId: string | null; by: "after" | "before" | "front" | "end" | null; chars: number }

/** The run lengths tried, shortest first: the shortest that occurs once from where the last picture was found. */
const RUNS = [10, 14, 20, 28, 40];
const squeeze = (text: string): string => text.replace(/\s+/g, "");

/** The book's sentences in order, as one squeezed string with each sentence's start in it. */
export function sentenceIndex(sentences: { id: string; text: string }[]): { text: string; starts: number[]; ids: string[] } {
  let text = "";
  const starts: number[] = [], ids: string[] = [];
  for (const sentence of sentences) { starts.push(text.length); ids.push(sentence.id); text += squeeze(sentence.text); }
  return { text, starts, ids };
}

function sentenceAt(index: { starts: number[]; ids: string[] }, at: number): string | null {
  let low = 0, high = index.starts.length - 1, found = -1;
  while (low <= high) { const mid = (low + high) >> 1; if (index.starts[mid] <= at) { found = mid; low = mid + 1; } else high = mid - 1; }
  return found < 0 ? null : index.ids[found];
}

/** Where `run` first occurs from `from`, and whether it occurs only once from there. */
function once(haystack: string, run: string, from: number): { at: number; unique: boolean } {
  const at = haystack.indexOf(run, from);
  return { at, unique: at >= 0 && haystack.indexOf(run, at + 1) < 0 };
}

/**
 * Anchor the picture at `offset` of the album's text in the book's sentences: the words after it found from `from`
 * (the sentence they start in), else the words before it (the sentence they end in). Null when neither is in the book
 * (front matter the book's text does not have).
 */
export function anchorByText(albumText: string, offset: number, index: ReturnType<typeof sentenceIndex>, from = 0): TextAnchor & { at: number } {
  const after = squeeze(albumText.slice(offset, offset + 600)), before = squeeze(albumText.slice(Math.max(0, offset - 600), offset));
  for (const [side, words] of [["after", after], ["before", before]] as const) {
    let fallback: { at: number; chars: number } | null = null;
    for (const chars of RUNS) {
      if (words.length < chars) break;
      const run = side === "after" ? words.slice(0, chars) : words.slice(-chars), found = once(index.text, run, from);
      if (found.at < 0) break;
      const at = side === "after" ? found.at : found.at + chars - 1;
      if (found.unique) return { sentenceId: sentenceAt(index, at), by: side, chars, at };
      fallback = { at, chars };
    }
    if (fallback) return { sentenceId: sentenceAt(index, fallback.at), by: side, chars: fallback.chars, at: fallback.at };
  }
  return { sentenceId: null, by: null, chars: 0, at: from };
}

export interface V2IllustrationRecord extends IllustrationRecord { anchor: { by: TextAnchor["by"]; chars: number } }

/** The book's front and back matter: the EPUB's text before the book's first sentence and after its last, in paragraphs. */
export interface BookMatter { before: string[]; after: string[] }

function matterOf(albumText: string, sentences: { id: string; text: string }[]): BookMatter {
  const raw: number[] = [];
  let squeezed = "";
  for (let at = 0; at < albumText.length; at++) if (!/\s/.test(albumText[at])) { squeezed += albumText[at]; raw.push(at); }
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map(part => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const first = squeeze(sentences[0]?.text ?? "").slice(0, 12), last = squeeze(sentences.at(-1)?.text ?? "").slice(-12);
  const from = first ? squeezed.indexOf(first) : -1, to = last ? squeezed.lastIndexOf(last) : -1;
  return { before: from > 0 ? paragraphs(albumText.slice(0, raw[from])) : [], after: to >= 0 && to + last.length < raw.length ? paragraphs(albumText.slice(raw[to + last.length - 1] + 1)) : [] };
}

/** The album of a book: each EPUB picture with its kind and its anchor on the book's sentences, and the book's front and back matter. */
export function albumOf(sentences: { id: string; text: string }[], epubBytes: Buffer) {
  const index = sentenceIndex(sentences), walk = walkEpub(epubBytes), archive = unzipAll(epubBytes), chapters = splitChapters(walk.text);
  const byKind: Record<IllustrationKind, number> = { cover: 0, plate: 0, story: 0, paratext: 0 }, records: V2IllustrationRecord[] = [];
  let from = 0;
  walk.images.forEach((ref, i) => {
    const chapter = [...chapters].reverse().find(entry => ref.charOffset >= entry.startOffset) ?? chapters[0];
    const kind = classifyKind({ isCover: ref.isCover, inSpine: ref.inSpine, spineIndex: ref.spineIndex, bookHasMarkedCover: walk.hasMarkedCover, chapterTitle: chapter?.title ?? null, docTextChars: ref.docTextChars });
    byKind[kind]++;
    // The front matter (the cover, plates, pages before the first chapter) hangs on the book's first sentence: its words
    // are a teaser quoting a later page (vol 1's fifth picture) or not in the book's text at all. A story picture whose
    // words are not found is past the book's last found words (the back cover after the afterword): its last sentence.
    const front = kind !== "story";
    const found = front ? null : anchorByText(walk.text, ref.charOffset, index, from);
    const anchor: TextAnchor = front ? { sentenceId: index.ids[0] ?? null, by: "front", chars: 0 } : found!.sentenceId ? found! : { sentenceId: index.ids.at(-1) ?? null, by: "end", chars: 0 };
    if (found?.sentenceId) from = found.at;
    const id = `ill_${String(i + 1).padStart(4, "0")}`, ext = extname(ref.sourcePath).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    records.push({ id, asset: `assets/${id}.${ext}`, sourcePath: ref.sourcePath, charOffset: ref.charOffset, sentenceId: anchor.sentenceId, blockId: anchor.sentenceId?.split("_")[0] ?? null, chapterIndex: chapter?.index ?? 0, kind, spineIndex: ref.spineIndex, anchor: { by: anchor.by, chars: anchor.chars } });
  });
  for (const record of records) if (!archive.get(record.sourcePath)) throw new Error(`EPUB image missing from archive: ${record.sourcePath}`);
  return { records, byKind, title: walk.title, archive, matter: matterOf(walk.text, sentences) };
}

/** An album written in v1's shape under `dir`: assets/ill_NNNN.*, ontology/illustrations.jsonl and ontology/album.json. */
async function writeAlbum(dir: string, album: ReturnType<typeof albumOf>, epubPath: string, sourceText: string | null) {
  await mkdir(join(dir, "assets"), { recursive: true, mode: 0o700 }); await mkdir(join(dir, "ontology"), { recursive: true, mode: 0o700 });
  for (const record of album.records) await writeFile(join(dir, record.asset), album.archive.get(record.sourcePath)!, { mode: 0o600 });
  await writeFile(join(dir, "ontology", "illustrations.jsonl"), album.records.map(record => JSON.stringify(record)).join("\n") + (album.records.length ? "\n" : ""), { mode: 0o600 });
  await writeFile(join(dir, "ontology", "album.json"), JSON.stringify({ epubFile: basename(epubPath), title: album.title, sourceText, importedAt: new Date().toISOString(), imageCount: album.records.length, anchoredBy: "text" }, null, 2), { mode: 0o600 });
}

const anchoredCount = (records: V2IllustrationRecord[]) => records.filter(record => record.anchor.by === "after" || record.anchor.by === "before").length;
const unanchoredOf = (records: V2IllustrationRecord[]) => records.filter(record => !(record.anchor.by === "after" || record.anchor.by === "before")).map(record => `${record.id} (${record.kind}, ${record.anchor.by})`);

/**
 * The EPUB's pictures into a v2 book: assets/ill_NNNN.*, ontology/illustrations.jsonl anchored on the book's own
 * sentence ids by their words, ontology/album.json. The book's text is never changed.
 */
export async function importV2Album(novelDir: string, epubPath: string): Promise<{ illustrations: number; byKind: Record<IllustrationKind, number>; anchored: number; unanchored: string[] }> {
  const bound = await storedSource(novelDir);
  const files = bound ? [bound.file] : (await readdir(join(novelDir, "source"))).filter(name => !name.startsWith("."));
  if (files.length !== 1) throw new Error("the book needs one stored text (source/) to anchor its pictures on");
  const text = await readFile(join(novelDir, "source", files[0]), "utf8");
  const sentences = (bound ? cutBlocks(text, bound.blockSize) : cutBlocks(text)).flatMap(block => sectionBlock(block.text, block.index).sentences);
  const album = albumOf(sentences, await readFile(epubPath));
  const lock = join(novelDir, "ontology", ".album.lock");
  await mkdir(lock);
  try { await writeAlbum(novelDir, album, epubPath, `source/${files[0]}`); }
  finally { await rmdir(lock); }
  return { illustrations: album.records.length, byKind: album.byKind, anchored: anchoredCount(album.records), unanchored: unanchoredOf(album.records) };
}

/**
 * The reading's album (the user, 2026-11-05: "first make it part of the reading pipeline"): the book's pictures anchored on
 * the sentences the reading read, written in v1's shape under <reading>/v2/album with the chart's people as its characters
 * (ontology/entities.jsonl, so the portrait cropper binds faces to the reading's own ids), and the book's front and back
 * matter (the synopsis, the character introductions, the afterword: what the book's text starts after and ends before) in
 * <reading>/v2/front.json. The workspace made from the reading takes both (experiments/v2/workspace.mjs).
 */
export async function readingAlbum(v2Dir: string, sentences: { id: string; text: string }[], epubPath: string, people: { id: string; names: string[] }[]) {
  const album = albumOf(sentences, await readFile(epubPath)), dir = join(v2Dir, "album");
  await writeAlbum(dir, album, epubPath, null);
  await writeFile(join(dir, "ontology", "entities.jsonl"), people.map(person => JSON.stringify({ id: person.id, kind: "Character", names: person.names.map((text, k) => ({ text, kind: k ? "alias" : "canonical" })) })).join("\n") + (people.length ? "\n" : ""), { mode: 0o600 });
  await writeFile(join(v2Dir, "front.json"), JSON.stringify({ version: 1, epubFile: basename(epubPath), ...album.matter, pictures: album.records.filter(record => record.anchor.by === "front").map(record => ({ id: record.id, kind: record.kind })) }, null, 1), { mode: 0o600 });
  return { dir, illustrations: album.records.length, byKind: album.byKind, anchored: anchoredCount(album.records), unanchored: unanchoredOf(album.records), front: { before: album.matter.before.length, after: album.matter.after.length, chars: [...album.matter.before, ...album.matter.after].join("").length } };
}
