/**
 * An EPUB as published, for the reader (docs/v3/reader.md): one spine document at a time, its headings, paragraphs and
 * pictures kept, with scripts, styles, links and event attributes taken out and each picture inlined as a data URI (a
 * webview or a saved page loads nothing from outside). The same cleaning World · Live's reader used (tools/pi-review/
 * book-epub.mjs), on the workspace's file.
 */
import { readFile, stat } from "node:fs/promises";
import { resolveEpubPath } from "../digger/intake/album/epub.js";
import { unzipAll } from "../digger/intake/album/zip.js";

const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
/** A picture larger than this is left out (a placeholder says so). */
const MOST_BYTES = 6 * 1024 * 1024;

interface OpenEpub { mtimeMs: number; files: Map<string, Buffer>; spine: string[]; title: string | null; canonPath(key: string): string }
const opened = new Map<string, OpenEpub>();

const attr = (tag: string, name: string): string | null =>
  (tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i")))?.[1] ?? null;

async function open(path: string): Promise<OpenEpub> {
  const { mtimeMs } = await stat(path), known = opened.get(path);
  if (known?.mtimeMs === mtimeMs) return known;
  const files = unzipAll(await readFile(path)), canon = new Map([...files.keys()].map((key) => [key.toLowerCase(), key]));
  const canonPath = (key: string) => canon.get(key.toLowerCase()) ?? key;
  const opfPath = canonPath(attr(files.get("META-INF/container.xml")?.toString("utf8") ?? "", "full-path") ?? "");
  const opf = files.get(opfPath)?.toString("utf8") ?? "", opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = new Map([...opf.matchAll(/<item\s+[^>]*>/gi)].map(([tag]) => [attr(tag, "id"), { href: attr(tag, "href"), type: attr(tag, "media-type") ?? "" }]));
  const spine = [...opf.matchAll(/<itemref\s+[^>]*>/gi)].map(([tag]) => manifest.get(attr(tag, "idref")))
    .filter((item): item is { href: string; type: string } => Boolean(item?.href) && (/html|xml/i.test(item!.type) || /\.(x?html?|xml)$/i.test(item!.href!)))
    .map((item) => canonPath(resolveEpubPath(opfDir, item.href))).filter((key) => files.has(key));
  const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
  const book = { mtimeMs, files, spine, title, canonPath };
  opened.set(path, book);
  return book;
}

export interface EpubDocument { item: number; items: number; title: string | null; html: string }

/** How many spine documents the EPUB has. */
export async function epubItems(path: string): Promise<number> { return (await open(path)).spine.length; }

/** Spine document `item`: its body made safe, pictures inlined; null past the end. */
export async function epubDocument(path: string, item: number): Promise<EpubDocument | null> {
  const book = await open(path), name = book.spine[item];
  if (!name) return null;
  const doc = book.files.get(name)!.toString("utf8"), dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
  const picture = (tag: string) => {
    const src = attr(tag, "src") ?? attr(tag, "xlink:href") ?? attr(tag, "href");
    const inside = src && !/^[a-z]+:/i.test(src) ? book.canonPath(resolveEpubPath(dir, src)) : null;
    const bytes = inside ? book.files.get(inside) : undefined, type = inside ? IMAGE_TYPES[(inside.match(/\.[a-z]+$/i)?.[0] ?? "").toLowerCase()] : undefined;
    if (!bytes || !type) return "";
    if (bytes.length > MOST_BYTES) return `<p class="toolarge">[a picture of ${Math.round(bytes.length / 1048576)} MB left out]</p>`;
    return `<img class="epub" alt="" src="data:${type};base64,${bytes.toString("base64")}">`;
  };
  // Pictures first (an SVG wrapper becomes its picture), then nothing that runs, loads or leaves the page is kept; the
  // pictures' data URIs are put back after the attributes are stripped.
  const pictures: string[] = [];
  const keep = (tag: string) => { const html = picture(tag); if (!html) return ""; pictures.push(html); return `<img data-picture="${pictures.length - 1}">`; };
  const html = (doc.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "")
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, (svg) => keep(svg.match(/<image\b[^>]*>/i)?.[0] ?? ""))
    .replace(/<img\b(?![^>]*data-picture)[^>]*>/gi, keep)
    .replace(/<(script|style|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|link|meta|base|iframe|object|embed|input|form|button|a)\b[^>]*>/gi, "")
    .replace(/\s(on[a-z]+|style|srcset|href|xlink:href|src|action|formaction|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<img data-picture="(\d+)">/g, (_, n: string) => pictures[Number(n)] ?? "");
  return { item, items: book.spine.length, title: book.title, html };
}
