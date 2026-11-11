/**
 * A book with a reading, as an editor reads source with its symbols (docs/v3/design.html#workspace): the text's sentences at their
 * offsets; the reading's people, places, things and concepts as symbols, each with a record (its definition); every line
 * that names, describes, quotes or addresses one as a reference, with how the reading reached it and how sure it is; the
 * outline of chapters, scenes and cards; the reading's doubtful credits as problems. Read-only over what the reading made.
 */
import { readFile } from "node:fs/promises";
import { cutBlocks } from "../digger/intake/blocks.js";
import { sectionBlock } from "../digger/intake/sectioning.js";
import { storedSource } from "../ground/workspace/source.js";
import { corroborateCredits } from "../v2/rules/presence.js";
import { cutParts, type BookText } from "./folder.js";

export interface Span { start: number; end: number }
export interface Line extends Span { id: string; text: string; scene: number; chapter: number }
export interface Symbol_ { id: string; category: string; type: string; label: string; names: string[]; first: string | null; unnamed: boolean }
export interface Reference extends Span {
  entity: string;
  sentence: string;
  /** named | described | speaks | acts | addressed | mentioned */
  how: string[];
  /** The reading's confidence in a speaker or doer it reached through a role, when it gave one. */
  confidence?: number;
  /** The words the role went through ("the girl"). */
  via?: string;
  /** False when the reading kept the answer as a guess only. */
  settled: boolean;
  /** True when the span is the name itself, false when it is the whole line. */
  exact: boolean;
}
export interface Problem extends Span { code: string; message: string; severity: "warning" | "information"; entity?: string; scene?: string }
export interface OutlineNode extends Span { kind: "chapter" | "scene" | "part" | "card"; id: string; label: string; detail?: string; children: OutlineNode[] }

interface ReadPerson { id: string; how: string[]; at?: string[] }
interface ReadCard { id: string; kind: string; first: string; last: string; sentences: string[]; entities?: { id: string; at?: string[] }[]; people?: ReadPerson[]; inside?: string[] }
interface ReadRole { kind?: string; who?: { id: string | null; answer?: string; confidence?: number; via?: string }; to?: { id: string | null; answer?: string; confidence?: number; via?: string } }
interface ReadScene { id: string; index: number; chapter: number; sentences: string[]; type?: string }
interface ReadEntity { id: string; category: string; type?: string; names?: string[]; proper?: string[]; first?: string; seen?: string[] }
interface ReadSlot { id: string; kind?: string; label?: string; names?: string[]; sentences?: string[] }
interface Reading { scenes: ReadScene[]; cards: ReadCard[]; roles?: Record<string, ReadRole>; chart: { entities: ReadEntity[] }; slots?: ReadSlot[] | Record<string, ReadSlot> }

export interface BookIndex {
  book: BookText;
  lines: Line[];
  line(id: string): Line | undefined;
  lineAt(offset: number): Line | undefined;
  symbols: Symbol_[];
  symbol(id: string): Symbol_ | undefined;
  references(entity: string): Reference[];
  /** The references a line holds, the one under the offset first. */
  at(offset: number): Reference[];
  /** Every reference a line holds. */
  onLine(sentence: string): Reference[];
  speakers: (Span & { sentence: string; entity: string; label: string; confidence: number; settled: boolean; via?: string })[];
  outline: OutlineNode[];
  problems: Problem[];
  scenes: (Span & { id: string; index: number; chapter: number; type: string; lines: number })[];
  counts(entity: string): Record<string, number>;
}

const text = (index: number) => String(index + 1);
const sceneNo = (id: string) => Number(id.replace(/^scene_0*/, "")) || 0;

/** An outline without a reading: chapters and the parts the text marks. */
export function plainOutline(book: BookText): OutlineNode[] {
  return book.chapters.map((chapter, index) => ({
    kind: "chapter" as const, id: `chapter-${index}`, label: chapter.title ?? (index === 0 ? "Front matter" : `Section ${text(index)}`), start: chapter.start, end: chapter.end,
    children: cutParts(book.text, chapter.start, chapter.end).map((part) => ({ kind: "part" as const, id: `chapter-${index}-part-${part.index}`, label: part.label ? `Part ${part.label}` : "Opening", start: part.start, end: part.end, children: [] })),
  }));
}

export async function loadReading(book: BookText): Promise<Reading | null> {
  if (!book.reading) return null;
  return JSON.parse(await readFile(book.reading.data, "utf8")) as Reading;
}

/** The block size the reading's sentence ids were cut with. */
export async function blockSizeOf(book: BookText): Promise<number | undefined> {
  return book.reading ? (await storedSource(book.reading.novel))?.blockSize : undefined;
}

export function indexBook(book: BookText, reading: Reading, blockSize?: number): BookIndex {
  // Sentences at their place in the whole text.
  const byId = new Map<string, Line>(), lines: Line[] = [];
  for (const block of blockSize ? cutBlocks(book.text, blockSize) : cutBlocks(book.text)) {
    for (const sentence of sectionBlock(block.text, block.index).sentences) {
      const line: Line = { id: sentence.id, text: sentence.text, start: block.startOffset + sentence.startOffset, end: block.startOffset + sentence.endOffset, scene: -1, chapter: block.chapterIndex };
      byId.set(line.id, line); lines.push(line);
    }
  }
  lines.sort((a, b) => a.start - b.start);
  const lineAt = (offset: number): Line | undefined => {
    let low = 0, high = lines.length - 1;
    // A line ends where the next may begin: the offset between two belongs to the second.
    while (low <= high) { const mid = (low + high) >> 1, line = lines[mid]; if (offset < line.start) high = mid - 1; else if (offset >= line.end) low = mid + 1; else return line; }
    return high >= 0 && lines[high].end === offset ? lines[high] : undefined;
  };
  const scenes = reading.scenes.map((scene) => {
    const own = scene.sentences.map((id) => byId.get(id)).filter((line): line is Line => Boolean(line));
    for (const line of own) line.scene = scene.index;
    return { id: scene.id, index: scene.index, chapter: scene.chapter, type: scene.type ?? "scene", lines: own.length, start: own.length ? Math.min(...own.map((line) => line.start)) : 0, end: own.length ? Math.max(...own.map((line) => line.end)) : 0 };
  });

  // Symbols: the chart's entities, then the people the text only describes.
  const symbols: Symbol_[] = reading.chart.entities.map((entity) => {
    const proper = entity.proper ?? [], names = [...proper, ...(entity.names ?? []).filter((name) => !proper.includes(name))];
    return { id: entity.id, category: entity.category, type: entity.type ?? entity.category, label: names[0] ?? entity.id, names, first: entity.first ?? entity.seen?.[0] ?? null, unnamed: false };
  });
  const slots = Array.isArray(reading.slots) ? reading.slots : Object.values(reading.slots ?? {});
  for (const slot of slots) symbols.push({ id: slot.id, category: "person", type: slot.kind ?? "unnamed", label: slot.label ?? slot.names?.[0] ?? slot.id, names: slot.names ?? (slot.label ? [slot.label] : []), first: slot.sentences?.[0] ?? null, unnamed: true });
  const symbolOf = new Map(symbols.map((symbol) => [symbol.id, symbol]));

  // References, one per entity and line, the ways it is referred to joined.
  const found = new Map<string, Reference>(), perEntity = new Map<string, Reference[]>();
  const refer = (entity: string, sentence: string, how: string, extra: { confidence?: number; via?: string; settled?: boolean } = {}) => {
    const line = byId.get(sentence);
    if (!line || !symbolOf.has(entity)) return;
    const key = `${entity}|${sentence}`;
    let reference = found.get(key);
    if (!reference) {
      reference = { entity, sentence, start: line.start, end: line.end, how: [], settled: true, exact: false };
      found.set(key, reference); (perEntity.get(entity) ?? perEntity.set(entity, []).get(entity)!).push(reference);
    }
    if (!reference.how.includes(how)) reference.how.push(how);
    if (extra.confidence !== undefined) reference.confidence = extra.confidence;
    if (extra.via) reference.via = extra.via;
    if (extra.settled === false && reference.how.every((way) => way === how)) reference.settled = false; else if (extra.settled !== false) reference.settled = true;
  };
  for (const entity of reading.chart.entities) for (const sentence of entity.seen ?? []) refer(entity.id, sentence, entity.category === "person" ? "named" : "mentioned");
  for (const slot of slots) for (const sentence of slot.sentences ?? []) refer(slot.id, sentence, "described");
  for (const card of reading.cards) {
    for (const person of card.people ?? []) for (const sentence of person.at?.length ? person.at : [card.first]) for (const how of person.how) refer(person.id, sentence, how);
    for (const entity of card.entities ?? []) for (const sentence of entity.at ?? []) refer(entity.id, sentence, symbolOf.get(entity.id)?.category === "person" ? "named" : "mentioned");
  }
  const speakers: BookIndex["speakers"] = [];
  for (const [sentence, role] of Object.entries(reading.roles ?? {})) {
    const line = byId.get(sentence);
    for (const [side, how] of [[role.who, role.kind === "action" ? "acts" : "speaks"], [role.to, "addressed"]] as const) {
      const entity = side?.id ?? side?.answer;
      if (!side || !entity || !symbolOf.has(entity)) continue;
      refer(entity, sentence, how, { confidence: side.confidence, via: side.via, settled: side.id !== null });
      if (line && side === role.who && role.kind !== "action") speakers.push({ sentence, entity, label: symbolOf.get(entity)!.label, confidence: side.confidence ?? 0, settled: side.id !== null, ...(side.via ? { via: side.via } : {}), start: line.start, end: line.end });
    }
  }
  // Where the name itself stands in the line, the reference narrows to it.
  for (const reference of found.values()) {
    const line = byId.get(reference.sentence)!, names = [...symbolOf.get(reference.entity)!.names, ...(reference.via ? [reference.via] : [])].filter((name) => name.length > 0).sort((a, b) => b.length - a.length);
    for (const name of names) { const at = line.text.indexOf(name); if (at >= 0) { reference.start = line.start + at; reference.end = reference.start + name.length; reference.exact = true; break; } }
  }
  for (const list of perEntity.values()) list.sort((a, b) => a.start - b.start);
  const perLine = new Map<string, Reference[]>();
  for (const reference of found.values()) (perLine.get(reference.sentence) ?? perLine.set(reference.sentence, []).get(reference.sentence)!).push(reference);
  speakers.sort((a, b) => a.start - b.start);

  const at = (offset: number): Reference[] => {
    const line = lineAt(offset);
    if (!line) return [];
    const here = perLine.get(line.id) ?? [];
    const under = here.filter((reference) => reference.exact && offset >= reference.start && offset <= reference.end).sort((a, b) => (b.end - b.start) - (a.end - a.start));
    if (under.length) return under;
    // A name the reading did not list on this line still points at its owner.
    const named = symbols.flatMap((symbol) => symbol.names.map((name) => ({ symbol, name }))).filter((entry) => entry.name.length > 1).sort((a, b) => b.name.length - a.name.length);
    for (const entry of named) {
      for (let from = line.text.indexOf(entry.name); from >= 0; from = line.text.indexOf(entry.name, from + 1)) {
        const start = line.start + from, end = start + entry.name.length;
        if (offset >= start && offset <= end) return [{ entity: entry.symbol.id, sentence: line.id, start, end, how: ["text"], settled: true, exact: true }];
      }
    }
    // Else whoever says or does the line.
    return here.filter((reference) => reference.how.some((how) => how === "speaks" || how === "acts"));
  };

  // The outline: chapters, their scenes, a scene's cards that no other card holds.
  const held = new Set(reading.cards.flatMap((card) => card.inside ?? []));
  const cardsOf = new Map<number, OutlineNode[]>();
  for (const card of reading.cards) {
    if (held.has(card.id) || card.kind === "narration") continue;
    const first = byId.get(card.first), last = byId.get(card.last) ?? first;
    if (!first || !last || first.scene < 0) continue;
    const people = (card.people ?? []).filter((person) => person.how.some((how) => how === "speaks" || how === "acts")).map((person) => symbolOf.get(person.id)?.label).filter(Boolean);
    (cardsOf.get(first.scene) ?? cardsOf.set(first.scene, []).get(first.scene)!).push({ kind: "card", id: card.id, label: card.kind, ...(people.length ? { detail: people.slice(0, 4).join(", ") } : {}), start: first.start, end: Math.max(last.end, first.end), children: [] });
  }
  const outline: OutlineNode[] = book.chapters.map((chapter, index) => ({
    kind: "chapter" as const, id: `chapter-${index}`, label: chapter.title ?? (index === 0 ? "Front matter" : `Section ${text(index)}`), start: chapter.start, end: chapter.end,
    children: scenes.filter((scene) => scene.lines > 0 && scene.start >= chapter.start && scene.start < chapter.end).map((scene) => ({ kind: "scene" as const, id: scene.id, label: `Scene ${sceneNo(scene.id)}`, detail: scene.type, start: scene.start, end: scene.end, children: (cardsOf.get(scene.index) ?? []).sort((a, b) => a.start - b.start) })),
  }));

  // Problems: credits the unit does not back (a line credited to someone who is not there).
  const problems: Problem[] = [], sceneOf = new Map(reading.scenes.map((scene) => [scene.id, scene]));
  const checked = corroborateCredits(reading.cards, reading.roles ?? {}, reading.scenes);
  for (const entry of checked.demoted) {
    const scene = sceneOf.get(entry.unit), inScene = new Set(scene?.sentences ?? []), label = symbolOf.get(entry.person)?.label ?? entry.person;
    const weak = (perEntity.get(entry.person) ?? []).filter((reference) => inScene.has(reference.sentence) && reference.how.some((how) => how === "speaks" || how === "acts" || how === "addressed"));
    for (const reference of weak) {
      const way = reference.how.includes("addressed") && !reference.how.includes("speaks") && !reference.how.includes("acts") ? "spoken to" : reference.via ? `reached through "${reference.via}"` : "credited";
      problems.push({ code: "credit-not-backed", severity: "warning", entity: entry.person, scene: entry.unit, start: reference.start, end: reference.end,
        message: `${label} is ${way} here, but scene ${sceneNo(entry.unit)} never names them and the scene before does not have them.` });
    }
  }
  problems.sort((a, b) => a.start - b.start);

  return {
    book, lines, line: (id) => byId.get(id), lineAt, symbols, symbol: (id) => symbolOf.get(id), references: (entity) => perEntity.get(entity) ?? [], at, onLine: (id) => perLine.get(id) ?? [], speakers, outline, problems, scenes,
    counts: (entity) => { const counts: Record<string, number> = {}; for (const reference of perEntity.get(entity) ?? []) for (const how of reference.how) counts[how] = (counts[how] ?? 0) + 1; return counts; },
  };
}

/** An entity's record: what a definition is for a novel's symbol. */
export function recordOf(index: BookIndex, entity: string, others: { book: string; title: string; references: number }[] = []): string {
  const symbol = index.symbol(entity);
  if (!symbol) return `# ${entity}\n\nNot in this book's reading.\n`;
  const references = index.references(entity), counts = index.counts(entity), first = symbol.first ? index.line(symbol.first) : references[0] ? index.line(references[0].sentence) : undefined;
  const chapterOf = (line: { chapter: number }) => index.book.chapters[line.chapter]?.title ?? (line.chapter === 0 ? "Front matter" : `Section ${text(line.chapter)}`);
  const perChapter = new Map<number, number>(), beside = new Map<string, number>();
  const scenesWith = new Set<number>();
  for (const reference of references) { const line = index.line(reference.sentence)!; perChapter.set(line.chapter, (perChapter.get(line.chapter) ?? 0) + 1); if (line.scene >= 0) scenesWith.add(line.scene); }
  if (symbol.category === "person") for (const other of index.symbols) {
    if (other.id === entity || other.category !== "person" || other.unnamed) continue;
    const shared = new Set(index.references(other.id).map((reference) => index.line(reference.sentence)!.scene).filter((scene) => scenesWith.has(scene)));
    if (shared.size) beside.set(other.label, shared.size);
  }
  const unsure = references.filter((reference) => !reference.settled).length;
  const out = [`# ${symbol.label}`, "", `${symbol.unnamed ? "Unnamed " : ""}${symbol.category}${symbol.type !== symbol.category ? ` (${symbol.type})` : ""} · ${symbol.id} · ${index.book.title}`, ""];
  if (symbol.names.length > 1) out.push(`**Also called:** ${symbol.names.slice(1).join(", ")}`, "");
  if (first) out.push(`**First appears:** ${chapterOf(first)}, scene ${first.scene + 1}`, "", `> ${first.text}`, "");
  out.push(`**References:** ${references.length} lines in ${scenesWith.size} scenes${unsure ? ` (${unsure} are guesses the reading did not settle)` : ""}`, "");
  out.push("| How | Lines |", "| --- | --- |", ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([how, count]) => `| ${how} | ${count} |`), "");
  out.push("| Chapter | Lines |", "| --- | --- |", ...[...perChapter].sort((a, b) => a[0] - b[0]).map(([chapter, count]) => `| ${chapterOf({ chapter })} | ${count} |`), "");
  if (beside.size) out.push(`**Most often in a scene with:** ${[...beside].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => `${label} (${count})`).join(", ")}`, "");
  if (others.length) out.push("**In the universe's other books:**", "", ...others.map((other) => `- ${other.title}: ${other.references} lines`), "");
  return `${out.join("\n")}\n`;
}

/** Offsets and editor positions (lines and UTF-16 columns) of a text. */
export function linesOf(source: string): { position(offset: number): { line: number; character: number }; offset(position: { line: number; character: number }): number; count: number } {
  const starts = [0];
  for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1)) starts.push(at + 1);
  return {
    count: starts.length,
    position(offset) {
      const bounded = Math.max(0, Math.min(offset, source.length));
      let low = 0, high = starts.length - 1;
      while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= bounded) low = mid; else high = mid - 1; }
      return { line: low, character: bounded - starts[low] };
    },
    offset(position) {
      const line = Math.max(0, Math.min(position.line, starts.length - 1)), end = line + 1 < starts.length ? starts[line + 1] - 1 : source.length;
      return Math.min(starts[line] + Math.max(0, position.character), end);
    },
  };
}
