/**
 * EPUB spine walk (sector: album).
 *
 * Walks an EPUB's spine in reading order and produces ONE extracted
 * text plus the exact character offset of every referenced image in
 * that text. Anchoring is exact by construction: `novel album import`
 * writes this extracted text into the novel's `source/` directory, and
 * ingesting THAT file puts every illustration at a known offset →
 * block → sentence → scene (see album.ts `resolveAnchors`).
 *
 * Parsing is deliberately regex-based (no XML dependency): EPUB
 * container/OPF shapes are stable, and every extraction rule here is
 * deterministic so offsets are reproducible.
 */
import { unzipAll } from "./zip.js";

export interface EpubImageRef {
  /** Path of the image inside the EPUB (normalized, forward slashes). */
  sourcePath: string;
  /** Character offset into `EpubWalk.text` where the image tag sits. */
  charOffset: number;
  /** Spine position of the document that references the image. */
  spineIndex: number;
  /** Characters of extracted text in the referencing document. */
  docTextChars: number;
  /** True when the OPF marks this image as the cover. */
  isCover: boolean;
  /** False for images that appear only in the manifest (e.g. a cover
   *  no spine document references); those anchor to the text start
   *  (cover) or end (anything else) with spineIndex -1. */
  inSpine: boolean;
}

export interface EpubWalk {
  title: string | null;
  text: string;
  images: EpubImageRef[];
  spineDocs: number;
  /** True when the OPF marks a cover image (meta or cover-image property). */
  hasMarkedCover: boolean;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))
    ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : null;
}

/** Resolve `href` against a directory inside the EPUB; normalize ../ and ./ */
export function resolveEpubPath(baseDir: string, href: string): string {
  let h = href.split("#")[0];
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  const parts = (baseDir ? baseDir.split("/") : []).concat(h.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Deterministic XHTML → text: block tags become newlines, tags vanish. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/\r\n?/g, "\n");
}

interface ManifestItem { id: string; href: string; mediaType: string; properties: string }

export function walkEpub(epubBytes: Buffer): EpubWalk {
  const files = unzipAll(epubBytes);
  // Real-world EPUBs (duokan exports especially) reference paths with
  // the wrong case; archive names are case-sensitive, readers are not.
  const canon = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
  const canonPath = (p: string): string => canon.get(p.toLowerCase()) ?? p;
  const container = files.get("META-INF/container.xml");
  if (!container) throw new Error("EPUB has no META-INF/container.xml");
  const opfPathRaw = attr(container.toString("utf8"), "full-path");
  if (!opfPathRaw) throw new Error("EPUB container.xml names no OPF rootfile");
  const opfPath = canonPath(opfPathRaw);
  const opfBuf = files.get(opfPath);
  if (!opfBuf) throw new Error(`EPUB OPF not found inside archive: ${opfPath}`);
  const opf = opfBuf.toString("utf8");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const titleMatch = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim() || null : null;

  const manifest = new Map<string, ManifestItem>();
  for (const m of opf.matchAll(/<item\s+[^>]*>/gi)) {
    const tag = m[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: attr(tag, "media-type") ?? "",
      properties: attr(tag, "properties") ?? "",
    });
  }

  let coverId: string | null = null;
  for (const m of opf.matchAll(/<meta\s+[^>]*>/gi)) {
    if ((attr(m[0], "name") ?? "").toLowerCase() === "cover") coverId = attr(m[0], "content");
  }
  const coverPaths = new Set<string>();
  for (const item of manifest.values()) {
    if (item.id === coverId || item.properties.split(/\s+/).includes("cover-image")) {
      coverPaths.add(canonPath(resolveEpubPath(opfDir, item.href)));
    }
  }

  const spine: string[] = [];
  for (const m of opf.matchAll(/<itemref\s+[^>]*>/gi)) {
    const idref = attr(m[0], "idref");
    if (!idref) continue;
    if ((attr(m[0], "linear") ?? "yes").toLowerCase() === "no") continue;
    spine.push(idref);
  }

  let text = "";
  const images: EpubImageRef[] = [];
  let spineDocs = 0;
  const IMG_TAG = /<img\b[^>]*>|<image\b[^>]*>/gi;

  spine.forEach((idref, spineIndex) => {
    const item = manifest.get(idref);
    if (!item) return;
    const isDoc = /html|xml/i.test(item.mediaType) || /\.(x?html?|xml)$/i.test(item.href);
    if (!isDoc) return;
    const docPath = canonPath(resolveEpubPath(opfDir, item.href));
    const docBuf = files.get(docPath);
    if (!docBuf) return;
    spineDocs++;
    const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
    const html = docBuf.toString("utf8");
    let cursor = 0;
    let docTextChars = 0;
    const pending: Omit<EpubImageRef, "docTextChars" | "inSpine">[] = [];
    for (const m of html.matchAll(IMG_TAG)) {
      const seg = htmlToText(html.slice(cursor, m.index));
      text += seg;
      docTextChars += seg.length;
      const src = attr(m[0], "src") ?? attr(m[0], "xlink:href") ?? attr(m[0], "href");
      if (src) {
        const sourcePath = canonPath(resolveEpubPath(docDir, src));
        pending.push({
          sourcePath,
          charOffset: text.length,
          spineIndex,
          isCover: coverPaths.has(sourcePath),
        });
      }
      cursor = (m.index ?? 0) + m[0].length;
    }
    const tail = htmlToText(html.slice(cursor));
    text += tail;
    docTextChars += tail.length;
    for (const ref of pending) images.push({ ...ref, docTextChars, inSpine: true });
    if (!text.endsWith("\n")) text += "\n";
  });

  // Manifest images no spine document referenced (the usual cover):
  // they still belong to the album — cover at the text start, the rest
  // at the end as paratext.
  const referenced = new Set(images.map((i) => i.sourcePath));
  for (const item of manifest.values()) {
    if (!item.mediaType.startsWith("image/")) continue;
    const sourcePath = canonPath(resolveEpubPath(opfDir, item.href));
    if (referenced.has(sourcePath)) continue;
    const isCover = coverPaths.has(sourcePath);
    images.push({
      sourcePath,
      charOffset: isCover ? 0 : text.length,
      spineIndex: -1,
      docTextChars: 0,
      isCover,
      inSpine: false,
    });
  }
  images.sort((a, b) => a.charOffset - b.charOffset || a.spineIndex - b.spineIndex);

  return { title, text, images, spineDocs, hasMarkedCover: coverPaths.size > 0 };
}
