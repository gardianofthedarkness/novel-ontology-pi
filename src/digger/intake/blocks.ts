/**
 * Block cutting — deterministic, code only.
 *
 * Ingestion rolls by chapter-or-long-block (DESIGN.md processing model).
 * This module decides the units: first find chapter boundaries, then cut
 * each chapter into blocks of at most `targetChars`, always on paragraph
 * boundaries so a block never starts mid-paragraph. A chapter longer than
 * the target becomes several blocks sharing its chapterIndex.
 *
 * Chapter headings recognized (line-anchored, multilingual):
 *   第X章 / 第X話 / 第X节 / 第X回  (CJK numerals or digits, incl. fullwidth)
 *   序章 / 終章 / 番外編 / プロローグ / エピローグ
 *   Chapter N / CHAPTER N / Prologue / Epilogue
 * Text before the first heading is chapter 0 ("front matter").
 *
 * Two false-heading shapes are demoted (defects K1/K2, found on real
 * light-novel EPUB extractions):
 *   K1 — credit/reference lines like `第一章：ICERUSH` (a bare marker, a
 *        colon, then names) match the heading pattern but are a credits
 *        listing, not a boundary. They come in clusters (several within a
 *        few lines of each other, interleaved with other credit lines);
 *        a LONE colon-titled chapter (`第一章：启程` followed by body)
 *        has no such neighbors and stays a heading.
 *   K2 — a heading that opens a chapter with no body line at all (only
 *        blank lines and other heading lines before the next heading)
 *        is not a boundary either: EPUBs often print a combined title
 *        line (`序章　在平安夜最初的交叉点`) immediately followed by the
 *        same heading bare (`序章`) plus the subtitle as body — the
 *        combined line alone would become a 12–13-char orphan chapter,
 *        and table-of-contents entries are the same shape.
 *     Demoted lines are not removed: they fold into the preceding
 *     chapter's text, so chapters still tile the source exactly.
 * As a final invariant, cutBlocks never emits a block whose whole text
 * is a single heading line (K2 safety net for size-cut artifacts).
 */

export interface Chapter {
  index: number;
  title: string | null;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface Block {
  /** "b0001", "b0002", … — stable for a given (text, targetChars). */
  id: string;
  index: number;
  chapterIndex: number;
  chapterTitle: string | null;
  startOffset: number;
  endOffset: number;
  charCount: number;
  text: string;
}

const CN_NUM = "[0-9０-９一二三四五六七八九十百千两零〇]";
const HEADING_PATTERNS: RegExp[] = [
  new RegExp(`^\\s*第\\s*${CN_NUM}+\\s*[章話话节節回卷]`),
  /^\s*(序章|終章|终章|番外編|番外编|プロローグ|エピローグ)/,
  /^\s*(Chapter|CHAPTER|Prologue|Epilogue)\s+\d+/,
  /^\s*(Prologue|Epilogue)\s*$/,
];

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  return HEADING_PATTERNS.some((re) => re.test(t));
}

/** K1 credit/reference shape: bare marker + colon + text, short line. */
const CREDIT_SHAPE = new RegExp(
  `^\\s*(第\\s*${CN_NUM}+\\s*[章話话节節回卷]|序章|終章|终章|番外編|番外编|プロローグ|エピローグ)\\s*[:：]`,
);
const CREDIT_MAX_LEN = 30;
/** Credit lines cluster within ±N lines of each other … */
const CREDIT_CLUSTER_LINES = 6;
/** … with no prose line at least this long between them. A real chapter
 * body always interposes prose; a credits listing never does. */
const PROSE_MIN_LEN = 20;

function isCreditLine(line: string): boolean {
  const t = line.trim();
  return t.length <= CREDIT_MAX_LEN && CREDIT_SHAPE.test(t);
}

/** Split raw novel text into chapters by heading lines. */
export function splitChapters(text: string): Chapter[] {
  const lines = text.split("\n");
  const starts: { lineIndex: number; offset: number; title: string }[] = [];
  let offset = 0;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1; // +\n
  }
  lines.forEach((line, i) => {
    if (isHeading(line)) {
      starts.push({ lineIndex: i, offset: lineOffsets[i], title: line.trim() });
    }
  });

  // K1: demote credit/reference lines that appear in a cluster — another
  // credit-shaped heading nearby with no prose line between them.
  const creditFlags = starts.map((s) => isCreditLine(lines[s.lineIndex]));
  const proseBetween = (a: number, b: number): boolean => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let i = lo + 1; i < hi; i++) {
      const t = lines[i].trim();
      if (t.length >= PROSE_MIN_LEN && !isHeading(lines[i])) return true;
    }
    return false;
  };
  const afterCredits = starts.filter(
    (s, k) =>
      !creditFlags[k] ||
      !starts.some(
        (o, j) =>
          j !== k &&
          creditFlags[j] &&
          Math.abs(o.lineIndex - s.lineIndex) <= CREDIT_CLUSTER_LINES &&
          !proseBetween(s.lineIndex, o.lineIndex),
      ),
  );
  // K2: demote a heading whose chapter would contain no body line
  // (nothing but blank lines and other heading lines before the next
  // heading or the end of the text).
  const bounds = afterCredits.filter((s, k) => {
    const endLine =
      k + 1 < afterCredits.length ? afterCredits[k + 1].lineIndex : lines.length;
    for (let i = s.lineIndex + 1; i < endLine; i++) {
      const t = lines[i].trim();
      if (t.length > 0 && !isHeading(lines[i])) return true;
    }
    return false;
  });

  const chapters: Chapter[] = [];
  if (!bounds.length || bounds[0].offset > 0) {
    const end = bounds.length ? bounds[0].offset : text.length;
    const front = text.slice(0, end);
    if (front.trim().length > 0) {
      chapters.push({
        index: 0,
        title: null,
        startOffset: 0,
        endOffset: end,
        text: front,
      });
    }
  }
  bounds.forEach((s, k) => {
    const end = k + 1 < bounds.length ? bounds[k + 1].offset : text.length;
    chapters.push({
      index: chapters.length,
      title: s.title,
      startOffset: s.offset,
      endOffset: end,
      text: text.slice(s.offset, end),
    });
  });
  return chapters;
}

/** Paragraphs of a chapter, with offsets relative to the chapter start. */
function paragraphs(chapterText: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const lines = chapterText.split("\n");
  let offset = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  const flush = () => {
    if (curStart !== null) out.push({ start: curStart, end: curEnd });
    curStart = null;
  };
  for (const line of lines) {
    const lineEnd = offset + line.length;
    if (line.trim().length === 0) {
      flush();
    } else {
      if (curStart === null) curStart = offset;
      curEnd = lineEnd;
    }
    offset = lineEnd + 1;
  }
  flush();
  // Single-newline novels (common for CJK web novels): each line already
  // flushed as its own paragraph only if blank lines exist; if the whole
  // chapter came out as one blob with internal newlines, split per line.
  if (out.length === 1 && chapterText.includes("\n")) {
    const per: { start: number; end: number }[] = [];
    let off = 0;
    for (const line of lines) {
      if (line.trim().length > 0) per.push({ start: off, end: off + line.length });
      off += line.length + 1;
    }
    if (per.length > 1) return per;
  }
  return out;
}

/**
 * Cut a novel into processing blocks: chapters first, then size-capped
 * on paragraph boundaries. `targetChars` default matches the design's
 * chapter-or-long-block roll (≈ a long chapter stays one block).
 */
export const DEFAULT_BLOCK_SIZE = 24000;

export function cutBlocks(text: string, targetChars = DEFAULT_BLOCK_SIZE): Block[] {
  const chapters = splitChapters(text);
  const blocks: Block[] = [];
  let n = 0;
  for (const ch of chapters) {
    const paras = paragraphs(ch.text);
    let curStart: number | null = null;
    let curEnd = 0;
    const flush = () => {
      if (curStart === null) return;
      n += 1;
      blocks.push({
        id: `b${String(n).padStart(4, "0")}`,
        index: n - 1,
        chapterIndex: ch.index,
        chapterTitle: ch.title,
        startOffset: ch.startOffset + curStart,
        endOffset: ch.startOffset + curEnd,
        charCount: curEnd - curStart,
        text: ch.text.slice(curStart, curEnd),
      });
      curStart = null;
    };
    for (const p of paras) {
      if (curStart !== null && p.end - curStart > targetChars) flush();
      if (curStart === null) curStart = p.start;
      curEnd = p.end;
    }
    flush();
  }
  return mergeHeadingOnlyBlocks(blocks);
}

/**
 * K2 safety net: a block whose whole text is a single heading line is
 * never emitted — it merges into the following block (the heading
 * announces that block's chapter), or into the previous block when it
 * is the last block of its chapter. Adjacent blocks tile the source,
 * so a union is still an exact source slice. Ids are renumbered.
 */
function mergeHeadingOnlyBlocks(blocks: Block[]): Block[] {
  const union = (a: Block, b: Block): Block => ({
    ...b,
    startOffset: a.startOffset,
    charCount: b.endOffset - a.startOffset,
    text: a.text + b.text,
  });
  const out: Block[] = [];
  let pending: Block | null = null;
  blocks.forEach((b, i) => {
    let cur = pending ? union(pending, b) : b;
    pending = null;
    const t = cur.text.trim();
    const headingOnly = t.length > 0 && !t.includes("\n") && isHeading(t);
    if (headingOnly) {
      const next = blocks[i + 1];
      const endsChapter = !next || next.chapterIndex !== cur.chapterIndex;
      if (endsChapter && out.length === 0 && next) {
        pending = cur; // nothing before it (e.g. an orphan title line as front matter): merge forward
      } else if (endsChapter && out.length > 0) {
        const prev = out[out.length - 1];
        out[out.length - 1] = {
          ...prev,
          endOffset: cur.endOffset,
          charCount: cur.endOffset - prev.startOffset,
          text: prev.text + cur.text,
        };
      } else if (!endsChapter) {
        pending = cur;
      } else {
        out.push(cur); // the whole text is one heading line; nothing to merge into
      }
    } else {
      out.push(cur);
    }
  });
  if (pending) out.push(pending);
  return out.map((b, i) => ({
    ...b,
    id: `b${String(i + 1).padStart(4, "0")}`,
    index: i,
  }));
}
