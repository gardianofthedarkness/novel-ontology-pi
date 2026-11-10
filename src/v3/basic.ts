/**
 * The basic layer: what a book is, read from its file with no model asked (docs/v3/basic.md; the user, 2026-11-10: "a basic
 * layer no model call scans the basic layer of that real folder"). For every book the scan finds: its title, author and
 * language; its series and volume number, read from the title; its chapters, paragraphs and lines (the reading's own
 * sentence cutter); how many lines are in quotes; its pictures; the spans that look like names by fixed patterns (honorifics
 * and speech verbs, in Chinese and in Japanese). Kept in <folder>/.novel/books/<file id>/basic.json, one per book's bytes.
 *
 * Series: books whose titles, the volume taken out, share most of their character pairs are one series; the console
 * offers each series of books not yet arranged as a universe, its books in volume order.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cutBlocks } from "../digger/intake/blocks.js";
import { sectionBlock } from "../digger/intake/sectioning.js";
import { unzipAll } from "../digger/intake/album/zip.js";
import { STATE_DIR, findFile, loadState, readBook, type FolderFile, type FolderState } from "./folder.js";

export interface BasicLayer {
  version: 1; file: string; title: string; author: string | null; language: string | null;
  /** The title with its volume taken out, and the volume when the title says it. */
  series: string; seriesKey: string; volume: number | null;
  chars: number; chapters: number; chapterTitles: string[]; paragraphs: number; lines: number;
  /** Lines inside quotes (corner brackets, white corner brackets, curly double quotes). */
  spoken: number;
  pictures: number;
  /** Spans that look like names, by fixed patterns, with how often and by which pattern. */
  names: { name: string; count: number; how: string }[];
  ms: number;
}

const basicPath = (folder: string, id: string) => join(resolve(folder), STATE_DIR, "books", id, "basic.json");
export async function readBasic(folder: string, id: string): Promise<BasicLayer | null> { return readFile(basicPath(folder, id), "utf8").then((text) => JSON.parse(text) as BasicLayer, () => null); }

const CJK_DIGITS: Record<string, number> = { "\u3007": 0, "\u96f6": 0, "\u4e00": 1, "\u4e8c": 2, "\u4e24": 2, "\u4e09": 3, "\u56db": 4, "\u4e94": 5, "\u516d": 6, "\u4e03": 7, "\u516b": 8, "\u4e5d": 9, "\u5341": 10 };
/** A number written in digits or in Chinese numerals up to ninety-nine. */
export function numberOf(text: string): number | null {
  const plain = text.normalize("NFKC").trim();
  if (/^\d+$/.test(plain)) return Number(plain);
  if (!/^[\u3007\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+$/.test(plain)) return null;
  if (!plain.includes("\u5341")) return plain.split("").reduce((sum, ch) => sum * 10 + (CJK_DIGITS[ch] ?? 0), 0);
  const [tens, ones] = plain.split("\u5341");
  return (tens ? CJK_DIGITS[tens] ?? 1 : 1) * 10 + (ones ? CJK_DIGITS[ones] ?? 0 : 0);
}
const VOLUME = [
  /\u7b2c\s*([0-9\u3007\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+)\s*[\u5377\u5dfb\u518c\u518a\u90e8\u96c6]/u,
  /[\uff08(]\s*([0-9\u3007\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+)\s*[\uff09)]/u,
  /\b(?:vol(?:ume)?\.?)\s*(\d+)/iu,
  /(\d+)\s*(?=[\s\u3000]|$)/u,
];
/** A title's series (the volume taken out) and its volume, when it says one. */
export function seriesOf(title: string): { series: string; key: string; volume: number | null } {
  const normal = title.normalize("NFKC").replace(/\s+/g, " ").trim();
  let volume: number | null = null, rest = normal;
  for (const pattern of VOLUME) {
    const match = pattern.exec(normal);
    if (match) { volume = numberOf(match[1]); rest = (normal.slice(0, match.index) + normal.slice(match.index + match[0].length)).trim(); break; }
  }
  const series = rest.replace(/[\u300a\u300b\u300c\u300d\u3010\u3011]/g, "").replace(/\s*case\..*$/iu, "").replace(/[\s\u00b7\u30fb:\uff1a?\uff1f]+$/u, "").trim() || normal;
  const key = series.toLowerCase().replace(/ii/g, "\u4e8c").replace(/[^\p{L}\p{N}]+/gu, "");
  return { series, key, volume };
}
const pairs = (key: string) => { const out = new Set<string>(); for (let i = 0; i + 1 < key.length; i++) out.add(key.slice(i, i + 2)); return out; };
/** How much of the shorter key's character pairs the longer one holds (1: one contains the other). */
export function overlap(a: string, b: string): number {
  const first = pairs(a), second = pairs(b);
  if (!first.size || !second.size) return a === b ? 1 : 0;
  let shared = 0; for (const pair of first) if (second.has(pair)) shared++;
  return shared / Math.min(first.size, second.size);
}

// Names by fixed patterns: honorifics and speech verbs (Chinese, as the reading's name detector nominates them), and
// Japanese honorifics and speech.
const NAME_PATTERNS: { how: string; pattern: RegExp }[] = [
  { how: "honorific", pattern: /([\u4e00-\u9fff]{1,4}?)(\u5c0f\u59d0|\u5148\u751f|\u5973\u58eb|\u8001\u5e08|\u961f\u957f|\u6851|\u9171|\u541b|\u5927\u4eba|\u6bbf\u4e0b|\u9601\u4e0b|\u5e08\u5085|\u533b\u751f)/gu },
  { how: "speech", pattern: /([\u4e00-\u9fff]{2,4})(\u8bf4\u9053|\u95ee\u9053|\u7b54\u9053|\u7b11\u9053|\u558a\u9053|\u53eb\u9053|\u4f4e\u58f0\u9053|\u8f7b\u58f0\u9053|\u5f00\u53e3\u9053)/gu },
  { how: "honorific", pattern: /([\p{Script=Han}\p{Script=Katakana}\u30fc]{2,8})(\u3055\u3093|\u304f\u3093|\u3061\u3083\u3093|\u69d8|\u3055\u307e|\u5148\u751f|\u5148\u8f29|\u6bbf)/gu },
  { how: "speech", pattern: /([\p{Script=Han}\p{Script=Katakana}\u30fc]{2,8})(\u306f\u8a00\u3063\u305f|\u304c\u8a00\u3063\u305f|\u306f\u7b54\u3048\u305f|\u304c\u7b54\u3048\u305f)/gu },
];
const GENERIC = new Set(["\u59d0\u59d0", "\u54e5\u54e5", "\u59b9\u59b9", "\u5f1f\u5f1f", "\u5927\u5bb6", "\u6211\u4eec", "\u4f60\u4eec", "\u4ed6\u4eec", "\u8fd9\u65f6", "\u6b64\u65f6", "\u4e8e\u662f", "\u7136\u540e", "\u7b11\u7740", "\u60f3\u4e86\u60f3", "\u90a3\u4f4d", "\u8fd9\u4f4d", "\u90a3\u4e2a", "\u8fd9\u4e2a"]);

/** The basic layer of one book's bytes. */
export function basicLayer(bytes: Buffer, file: Pick<FolderFile, "id" | "kind" | "path">): BasicLayer {
  const started = Date.now(), book = readBook(bytes, file.kind, file.path);
  let author: string | null = null, language: string | null = null, pictures = 0;
  if (file.kind === "epub") {
    const files = unzipAll(bytes), opfPath = (files.get("META-INF/container.xml")?.toString("utf8") ?? "").match(/full-path\s*=\s*"([^"]+)"/)?.[1] ?? "";
    const opf = files.get(opfPath)?.toString("utf8") ?? "", tag = (name: string) => opf.match(new RegExp(`<dc:${name}[^>]*>([\\s\\S]*?)</dc:${name}>`, "i"))?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
    author = tag("creator"); language = tag("language");
    pictures = [...opf.matchAll(/<item\s[^>]*media-type\s*=\s*"image\/[^"]+"/gi)].length;
  }
  let lines = 0, spoken = 0, paragraphs = 0;
  const chapterTitles: string[] = [], counts = new Map<string, { count: number; how: string }>();
  for (const block of cutBlocks(book.text)) {
    const sentences = sectionBlock(block.text, block.index).sentences;
    lines += sentences.length; paragraphs += new Set(sentences.map((sentence) => sentence.paragraphIndex)).size;
    for (const sentence of sentences) if (/[\u300c\u300e\u201c"]/.test(sentence.text)) spoken++;
    for (const { how, pattern } of NAME_PATTERNS) for (const match of block.text.matchAll(pattern)) {
      const name = match[1];
      if (name.length < 2 || GENERIC.has(name) || /[\u7740\u4e86\u7684\u662f\u5728]$/.test(name)) continue;
      const entry = counts.get(name) ?? { count: 0, how }; entry.count++; counts.set(name, entry);
    }
  }
  const text = book.text, heads = cutBlocks(text).map((block) => block.chapterIndex);
  const { series, key, volume } = seriesOf(book.title);
  // Chapters as the scan reads them (splitChapters through the workspace's chapter list is the folder's; here the titles).
  const chapterCount = new Set(heads).size;
  for (const line of text.split("\n")) { const trimmed = line.trim(); if (/^(\u7b2c[0-9\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+[\u7ae0\u8bdd\u8a71\u56de]|\u5e8f\u7ae0|\u7ec8\u7ae0|\u7d42\u7ae0|\u5e8f|\u5c3e\u58f0|\u5f8c\u66f8\u304d|\u540e\u8bb0|\u3042\u3068\u304c\u304d|Chapter\s+\d+)/u.test(trimmed) && trimmed.length < 40) chapterTitles.push(trimmed); }
  const names = [...counts].filter(([, entry]) => entry.count >= 3).sort((a, b) => b[1].count - a[1].count).slice(0, 24).map(([name, entry]) => ({ name, count: entry.count, how: entry.how }));
  return { version: 1, file: file.id, title: book.title, author, language, series, seriesKey: key, volume, chars: text.length, chapters: Math.max(chapterCount, chapterTitles.length ? 1 : 0), chapterTitles: chapterTitles.slice(0, 60), paragraphs, lines, spoken, pictures, names, ms: Date.now() - started };
}

/** The basic layer of up to `most` books that have none yet; how many are left. */
export async function basicStep(folder: string, most = 3): Promise<{ done: string[]; left: number; total: number; failed: { path: string; why: string }[] }> {
  const root = resolve(folder), state = await loadState(root), books = state.files.filter((file) => !file.missing && !file.unread);
  const missing: FolderFile[] = [];
  for (const file of books) if (!(await readBasic(root, file.id))) missing.push(file);
  const done: string[] = [], failed: { path: string; why: string }[] = [];
  for (const file of missing.slice(0, most)) {
    try {
      const layer = basicLayer(await readFile(join(root, file.path)), file);
      await mkdir(join(root, STATE_DIR, "books", file.id), { recursive: true });
      await writeFile(basicPath(root, file.id), `${JSON.stringify(layer)}\n`, "utf8");
      done.push(file.path);
    } catch (error) {
      failed.push({ path: file.path, why: (error as Error).message });
      await mkdir(join(root, STATE_DIR, "books", file.id), { recursive: true });
      await writeFile(basicPath(root, file.id), `${JSON.stringify({ version: 1, file: file.id, title: file.title, failed: (error as Error).message })}\n`, "utf8");
    }
  }
  return { done, left: Math.max(0, missing.length - done.length - failed.length), total: books.length, failed };
}

export interface SeriesSuggestion { name: string; key: string; books: { file: string; path: string; title: string; volume: number | null }[] }
/** Books not arranged yet, grouped into series by their titles, each in volume order (two or more books a series). */
export async function seriesSuggestions(folder: string, state?: FolderState): Promise<SeriesSuggestion[]> {
  const root = resolve(folder), own = state ?? await loadState(root);
  const placed = new Set(own.universes.flatMap((universe) => universe.books.map((book) => book.file)));
  const layers: (BasicLayer & { path: string })[] = [];
  for (const file of own.files) {
    if (file.missing || file.unread || placed.has(file.id)) continue;
    const layer = await readBasic(root, file.id);
    if (layer?.seriesKey) layers.push({ ...layer, path: file.path });
  }
  // One series: books whose keys share most of their character pairs (union by overlap).
  const parent = layers.map((_, n) => n), find = (n: number): number => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  for (let a = 0; a < layers.length; a++) for (let b = a + 1; b < layers.length; b++) if (overlap(layers[a].seriesKey, layers[b].seriesKey) >= 0.7) parent[find(a)] = find(b);
  const groups = new Map<number, typeof layers>();
  layers.forEach((layer, n) => { const root = find(n); (groups.get(root) ?? groups.set(root, []).get(root)!).push(layer); });
  return [...groups.values()].filter((group) => group.length > 1).map((group) => {
    const names = new Map<string, number>(); for (const layer of group) names.set(layer.series, (names.get(layer.series) ?? 0) + 1);
    const name = [...names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    const books = [...group].sort((a, b) => (a.volume ?? 1e6) - (b.volume ?? 1e6) || a.title.localeCompare(b.title)).map((layer) => ({ file: layer.file, path: layer.path, title: layer.title, volume: layer.volume }));
    return { name, key: group[0].seriesKey, books };
  }).sort((a, b) => b.books.length - a.books.length);
}

export const basicOf = (folder: string, name: string) => loadState(resolve(folder)).then((state) => readBasic(folder, findFile(state, name).id));
