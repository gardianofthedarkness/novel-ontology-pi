// Read mode's original book (the user, 2026-11-02: the reader reads the EPUB as published, its headings, paragraphs and
// pictures kept, not the extracted text): one spine document at a time, its body with scripts, styles, links and event
// attributes taken out and each picture pointed at bookEpubFile. Read-only, on the private link like the rest of the viewer.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo } from './config.mjs';

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const books = new Map();

/** The volume's EPUB: the source's own (`epub`), else the job's album input for its metadata directory (runtime/NOVEL_JOB.json). */
export async function epubPathOf(source) {
  if (source?.epub) return source.epub;
  if (!source?.metadataDirectory) return null;
  const job = await readFile(resolve(source.metadataDirectory, '..', '..', 'NOVEL_JOB.json'), 'utf8').then(JSON.parse, () => null);
  const volume = job?.volumes?.find(entry => entry.metadataDirectory === source.metadataDirectory || entry.workspace === source.workspace);
  return volume?.album?.epub ?? null;
}

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')))?.[1] ?? null;

/** The EPUB opened once (kept while its file is unchanged): its files, title and spine documents in reading order. */
async function open(path) {
  const { mtimeMs } = await stat(path);
  const known = books.get(path);
  if (known?.mtimeMs === mtimeMs) return known;
  const { unzipAll } = await import(pathToFileURL(resolve(repo, 'dist/src/digger/intake/album/zip.js')).href);
  const { resolveEpubPath } = await import(pathToFileURL(resolve(repo, 'dist/src/digger/intake/album/epub.js')).href);
  const files = unzipAll(await readFile(path)), canon = new Map([...files.keys()].map(key => [key.toLowerCase(), key])), canonPath = key => canon.get(key.toLowerCase()) ?? key;
  const opfPath = canonPath(attr(files.get('META-INF/container.xml')?.toString('utf8') ?? '', 'full-path') ?? '');
  const opf = files.get(opfPath)?.toString('utf8') ?? '', opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const manifest = new Map([...opf.matchAll(/<item\s+[^>]*>/gi)].map(([tag]) => [attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type') ?? '' }]));
  const spine = [...opf.matchAll(/<itemref\s+[^>]*>/gi)].map(([tag]) => manifest.get(attr(tag, 'idref')))
    .filter(item => item?.href && (/html|xml/i.test(item.type) || /\.(x?html?|xml)$/i.test(item.href))).map(item => canonPath(resolveEpubPath(opfDir, item.href))).filter(key => files.has(key));
  const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
  const book = { mtimeMs, files, spine, title, canonPath, resolveEpubPath };
  books.set(path, book);
  return book;
}

/** Spine document `item` of the volume's EPUB: { item, items, title, html } (html: its body, made safe), or null. */
export async function bookEpub(source, item) {
  const path = await epubPathOf(source);
  if (!path) return null;
  const book = await open(path);
  const name = book.spine[item];
  if (!name) return null;
  const doc = book.files.get(name).toString('utf8'), dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
  const picture = tag => {
    const src = attr(tag, 'src') ?? attr(tag, 'xlink:href') ?? attr(tag, 'href');
    const inside = src && !/^[a-z]+:/i.test(src) ? book.canonPath(book.resolveEpubPath(dir, src)) : null;
    return inside && book.files.has(inside) ? `<img data-epub="${inside.replace(/"/g, '&quot;')}" alt="">` : '';
  };
  // A picture names its file inside the book (data-epub; an SVG wrapper becomes its picture); the page points it at
  // book-epub-file. Then nothing that runs, loads or leaves the page is kept.
  const html = (doc.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, svg => picture(svg.match(/<image\b[^>]*>/i)?.[0] ?? ''))
    .replace(/<img\b[^>]*>/gi, picture)
    .replace(/<(script|style|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?(script|link|meta|base|iframe|object|embed|input|form|button)\b[^>]*>/gi, '')
    .replace(/\s(on[a-z]+|style|srcset|href|xlink:href|src|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return { item, items: book.spine.length, title: book.title, html };
}

/** A picture of the volume's EPUB by its path inside the book: { bytes, type }, or null (only pictures are served). */
export async function bookEpubFile(source, inside) {
  const type = IMAGE_TYPES[(inside.match(/\.[a-z]+$/i)?.[0] ?? '').toLowerCase()];
  const path = type ? await epubPathOf(source) : null;
  if (!path) return null;
  const bytes = (await open(path)).files.get(inside);
  return bytes ? { bytes, type } : null;
}
