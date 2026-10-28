import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { Entity, Relation } from "../../ground/ontology/types.js";
import { castScope, type CastBook, type CastScope } from "../identity/cast.js";

/**
 * The universe calendar: ONE clock for a whole universe.
 *
 * Every book's story periods (TimePoints) end up placed on it: a period with
 * a stated or derived date is on that day, at its clock time or part of the
 * day; a period without a date is placed as a range between its dated
 * neighbours in the book's story order (never given a made-up time). Books
 * are marks on the calendar (the span their periods cover), not the axis.
 * Story time is the reference: a flashback sits at its own date, and the
 * calendar never reorders a book's periods against its story order — where a
 * stated date and the story order disagree, it reports a conflict.
 *
 * Years nobody states are relative: Year 1 is the first dated book of a
 * continuity; a later book is in the same year unless its dates go backwards
 * (then "same year, or a later one?" is raised for review, and it stays in
 * the same year until decided). Same principle as universal EM: what the text
 * states is placed automatically, what is inferred across books is reviewed.
 *
 * Stored at `<library>/calendar/<universe>.json` (`<book>/calendar/book.json`
 * for a standalone book). Every faculty and view that involves time reads
 * positions from here (calendarEntry, compareOnCalendar).
 */
export interface CalendarSpan { start: number; end: number }
export interface CalendarEntry {
  /** `<sourceId>::<timeId>`. */
  ref: string;
  sourceId: string;
  timeId: string;
  label: string;
  /** The day it is on (null: only a range between dated periods is known). */
  year: number | null;
  month: number | null;
  day: number | null;
  /** Clock time or part of the day when stated ("15:00", "evening"). */
  time: string | null;
  /** The part of the day it is in: the stated one (晚上五点 is evening), else the one its clock time falls in; null when only the day is known. */
  part: string | null;
  /** Where it can be, in calendar minutes (start = end for a stated clock time). */
  span: CalendarSpan;
  /** stated: the book states its date; derived: from stated words ("the next day"); between: a range between dated neighbours. */
  placed: "stated" | "derived" | "between";
  storyIndex: number;
  flashback: boolean;
  scenes: number;
}
export interface CalendarBook {
  sourceId: string;
  title: string;
  readingOrder: number | null;
  continuityId: string | null;
  year: number | null;
  /** first: Year 1 of its continuity; same: dates continue the previous book's; reviewed: a reviewer decided; pending: raised for review, provisionally the same year. */
  yearBy: "first" | "same" | "reviewed" | "pending" | null;
  /** The year a book states ("2019年"), kept as a label; positions stay relative. */
  statedYear: number | null;
  span: CalendarSpan | null;
  periods: number;
}
export interface YearQuestion {
  id: string;
  sourceId: string;
  /** The previous dated book of the continuity, in reading order. */
  after: string;
  /** This book's first dated period and the previous book's last, for the reviewer. */
  first: string;
  previousLast: string;
  firstId: string;
  previousId: string;
}
export interface YearDecision { sourceId: string; after: string; verdict: "same" | "later"; reason: string; at: string }
export interface CalendarFile {
  version: 1;
  universeId: string;
  builtAt: string;
  /** Hash of what the calendar read: a different hash means it is out of date. */
  inputs: string;
  books: CalendarBook[];
  entries: CalendarEntry[];
  /** Where a stated date and the story order disagree, or a year waits for review. */
  conflicts: { ref: string; note: string }[];
  questions: YearQuestion[];
  decisions: YearDecision[];
}

// --- calendar arithmetic (ordering keys, not real date arithmetic) -----------

export const DAY = 1440;
const dayIndex = (year: number, month: number, day: number) => ((year * 12 + (month - 1)) * 31 + (day - 1));
export const dayStart = (year: number, month: number, day: number) => dayIndex(year, month, day) * DAY;
/** The day a calendar minute falls on. */
export function dayOf(minute: number): { year: number; month: number; day: number } {
  const index = Math.floor(minute / DAY);
  return { year: Math.floor(index / 372), month: Math.floor((index % 372) / 31) + 1, day: (index % 31) + 1 };
}
/** Parts of the day as minute ranges. A late night told after an evening of the same date is that night past midnight. */
export const PARTS: Record<string, [number, number]> = {
  "late-night": [0, 300], dawn: [300, 420], morning: [420, 690], noon: [690, 810], daytime: [420, 1050],
  afternoon: [810, 1050], "after-school": [930, 1080], evening: [1050, 1260], night: [1260, 1440],
};
const LATE_NIGHT_AFTER_EVENING: [number, number] = [DAY, DAY + 300];
/** The parts a clock time falls in, in order: a clock time runs to the end of its part unless the next period starts sooner. */
const SEQUENCE = ["late-night", "dawn", "morning", "noon", "afternoon", "evening", "night"];
const partAt = (minute: number) => SEQUENCE.find((part) => minute >= PARTS[part][0] && minute < PARTS[part][1]) ?? null;
const partEnd = (minute: number) => PARTS[partAt(minute) ?? ""]?.[1] ?? DAY;
const pad = (value: number) => String(value).padStart(2, "0");

/** a before b, b before a, or null when their spans overlap (the calendar cannot order them). */
export function compareOnCalendar(a: Pick<CalendarEntry, "span">, b: Pick<CalendarEntry, "span">): -1 | 1 | null {
  if (a.span.end < b.span.start || (a.span.end === b.span.start && a.span.start < b.span.end)) return -1;
  if (b.span.end < a.span.start || (b.span.end === a.span.start && b.span.start < a.span.end)) return 1;
  return null;
}

// --- placing one universe ---------------------------------------------------

/** One book's story periods as the calendar reads them. */
export interface BookTimes {
  book: CastBook & { continuityId?: string | null };
  periods: { id: string; label: string; storyIndex: number; flashback: boolean; date: { year?: number; month?: number; day?: number; derived?: boolean } | null; partOfDay?: string; hour?: number; minute?: number; scenes: number }[];
}

/** Read a book's applied story periods (TimePoints) and how many scenes each holds. */
export async function bookTimes(book: CastBook & { continuityId?: string | null }): Promise<BookTimes> {
  const bundle = new BundleStore(join(book.workspace, "ontology"));
  const fold = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
  const entities = fold(await bundle.loadFile<Entity>("entities.jsonl").catch(() => [] as Entity[]));
  const relations = await bundle.loadFile<Relation>("relations.jsonl").catch(() => [] as Relation[]);
  const scenes = new Map<string, number>();
  for (const relation of relations) if (relation.type === "OCCURS_DURING") scenes.set(relation.toId, (scenes.get(relation.toId) ?? 0) + 1);
  const periods = entities.filter((entity) => entity.kind === "TimePoint").map((entity) => {
    const properties = entity.properties ?? {};
    const value = (properties.value ?? {}) as { hour?: number; minute?: number };
    const date = properties.date && typeof properties.date === "object" ? properties.date as BookTimes["periods"][number]["date"] : null;
    return {
      id: entity.id, label: entity.names[0]?.text ?? entity.id, storyIndex: Number(properties.storyIndex ?? 0), flashback: properties.flashback === true, date,
      ...(typeof properties.partOfDay === "string" ? { partOfDay: properties.partOfDay } : {}),
      ...(typeof value.hour === "number" ? { hour: value.hour, minute: typeof value.minute === "number" ? value.minute : 0 } : {}),
      scenes: scenes.get(entity.id) ?? 0,
    };
  });
  return { book, periods: periods.sort((first, second) => first.storyIndex - second.storyIndex) };
}

/**
 * Place every book on one calendar. Pure: the same books and decisions give
 * the same calendar. Books come in reading order.
 */
export function placeOnCalendar(universeId: string, books: BookTimes[], decisions: YearDecision[] = []): Omit<CalendarFile, "builtAt"> {
  const entries: CalendarEntry[] = [], conflicts: CalendarFile["conflicts"] = [], questions: YearQuestion[] = [], placedBooks: CalendarBook[] = [];
  const dated = (period: BookTimes["periods"][number]) => !!(period.date?.month && period.date?.day);
  const monthDay = (period: BookTimes["periods"][number]) => (period.date!.month! - 1) * 31 + (period.date!.day! - 1);
  // The last dated book of each continuity: year and its last day, for the next book.
  const lastOf = new Map<string, { sourceId: string; year: number; lastMonthDay: number; label: string; id: string }>();
  for (const { book, periods } of books) {
    const continuity = book.continuityId ?? "";
    const story = periods.filter(dated).filter((period) => !period.flashback);
    const statedYear = periods.find((period) => period.date?.year && !period.date.derived)?.date?.year ?? null;
    let year: number | null = null, yearBy: CalendarBook["yearBy"] = null;
    const previous = lastOf.get(continuity);
    if (story.length || periods.some(dated)) {
      const first = (story[0] ?? periods.find(dated))!;
      if (!previous) { year = 1; yearBy = "first"; }
      else if (monthDay(first) >= previous.lastMonthDay) { year = previous.year; yearBy = "same"; }
      else {
        const decision = decisions.find((entry) => entry.sourceId === book.sourceId && entry.after === previous.sourceId);
        if (decision) { year = previous.year + (decision.verdict === "later" ? 1 : 0); yearBy = "reviewed"; }
        else {
          year = previous.year; yearBy = "pending";
          const id = `yq_${createHash("sha256").update(`${book.sourceId}|${previous.sourceId}`).digest("hex").slice(0, 16)}`;
          questions.push({ id, sourceId: book.sourceId, after: previous.sourceId, first: `${first.label} (${first.date!.month}-${first.date!.day})`, previousLast: previous.label, firstId: first.id, previousId: previous.id });
          conflicts.push({ ref: `${book.sourceId}::${first.id}`, note: `Dates go back from the previous book (${previous.label}): same year or a later one? Placed in the same year until reviewed.` });
        }
      }
    }
    // Dated periods: their day, at their clock time or part of the day.
    const own: CalendarEntry[] = [];
    const lastPartOnDay = new Map<number, number>();
    for (const period of periods) {
      if (!dated(period) || year === null) continue;
      const start = dayStart(year, period.date!.month!, period.date!.day!);
      const sameDayEarlier = lastPartOnDay.get(start);
      const afterEvening = sameDayEarlier !== undefined && sameDayEarlier > PARTS["late-night"][1];
      let range: [number, number] = [0, DAY], time: string | null = null, month = period.date!.month!, day = period.date!.day!;
      const stated = period.partOfDay && PARTS[period.partOfDay] ? period.partOfDay : null;
      if (period.hour !== undefined) {
        const minute = period.hour * 60 + (period.minute ?? 0);
        // A derived date's small hours told after that date's evening are past midnight: the next day.
        const nextDay = !!period.date!.derived && minute < PARTS["late-night"][1] && afterEvening;
        range = nextDay ? [DAY + minute, DAY + minute] : [minute, minute];
        time = `${pad(period.hour)}:${pad(period.minute ?? 0)}`;
        if (nextDay) ({ month, day } = dayOf(start + DAY));
      }
      else if (period.partOfDay && PARTS[period.partOfDay]) { range = period.partOfDay === "late-night" && afterEvening ? LATE_NIGHT_AFTER_EVENING : PARTS[period.partOfDay]; time = period.partOfDay; }
      lastPartOnDay.set(start, Math.max(sameDayEarlier ?? 0, range[0]));
      const part = stated ?? (period.hour !== undefined ? partAt(period.hour * 60 + (period.minute ?? 0)) : null);
      own.push({ ref: `${book.sourceId}::${period.id}`, sourceId: book.sourceId, timeId: period.id, label: period.label, year, month, day, time, part, span: { start: start + range[0], end: start + range[1] }, placed: period.date!.derived ? "derived" : "stated", storyIndex: period.storyIndex, flashback: period.flashback, scenes: period.scenes });
    }
    // A clock time is when a period starts: it runs until the next period starts, at most to the end of its part of the day
    // (the stated part when that ends later: 晚上五点 runs into the evening, not just to the end of the afternoon).
    for (const [index, entry] of own.entries()) {
      if (!/^\d\d:\d\d$/.test(entry.time ?? "")) continue;
      const midnight = Math.floor(entry.span.start / DAY) * DAY;
      const next = own.slice(index + 1).find((other) => !other.flashback && other.span.start > entry.span.start)?.span.start ?? Infinity;
      entry.span = { start: entry.span.start, end: Math.min(midnight + Math.max(partEnd(entry.span.start - midnight), PARTS[entry.part ?? ""]?.[1] ?? 0), next) };
    }
    // Story order is the reference: a later (non-flashback) period dated earlier than the one before it is a conflict, reported, not reordered.
    let latest: CalendarEntry | null = null;
    for (const entry of own) {
      if (latest && !entry.flashback && entry.span.end < latest.span.start) conflicts.push({ ref: entry.ref, note: `Story order puts "${entry.label}" after "${latest.label}", but its date/time is earlier.` });
      if (!entry.flashback && (!latest || entry.span.start >= latest.span.start)) latest = entry;
    }
    // Undated periods: a range between their dated neighbours in story order.
    const placed = new Map(own.map((entry) => [entry.timeId, entry]));
    if (own.length) for (const [index, period] of periods.entries()) {
      if (placed.has(period.id)) continue;
      const before = periods.slice(0, index).reverse().map((entry) => placed.get(entry.id)).find((entry) => entry && !entry.flashback);
      const after = periods.slice(index + 1).map((entry) => placed.get(entry.id)).find((entry) => entry && !entry.flashback);
      const start = before?.span.start ?? Math.min(...own.map((entry) => entry.span.start));
      const end = after?.span.end ?? Math.max(...own.map((entry) => entry.span.end));
      own.push({ ref: `${book.sourceId}::${period.id}`, sourceId: book.sourceId, timeId: period.id, label: period.label, year: null, month: null, day: null, time: null, part: null, span: { start, end: Math.max(start, end) }, placed: "between", storyIndex: period.storyIndex, flashback: period.flashback, scenes: period.scenes });
    }
    entries.push(...own);
    const span = own.length ? { start: Math.min(...own.map((entry) => entry.span.start)), end: Math.max(...own.map((entry) => entry.span.end)) } : null;
    placedBooks.push({ sourceId: book.sourceId, title: book.title, readingOrder: book.readingOrder, continuityId: book.continuityId ?? null, year, yearBy, statedYear, span, periods: periods.length });
    if (year !== null && story.length) {
      const last = story.reduce((best, period) => monthDay(period) >= monthDay(best) ? period : best);
      lastOf.set(continuity, { sourceId: book.sourceId, year, lastMonthDay: monthDay(last), label: `${last.label} (${last.date!.month}-${last.date!.day})`, id: last.id });
    }
  }
  entries.sort((first, second) => first.span.start - second.span.start || first.span.end - second.span.end || first.ref.localeCompare(second.ref));
  const inputs = createHash("sha256").update(JSON.stringify([universeId, books.map(({ book, periods }) => [book.sourceId, book.readingOrder, book.continuityId ?? null, periods]), decisions.map((decision) => [decision.sourceId, decision.after, decision.verdict])])).digest("hex").slice(0, 16);
  return { version: 1, universeId, inputs, books: placedBooks, entries, conflicts, questions, decisions };
}

/** "Year 1 · 12-25 · evening": a readable calendar position. */
export function describeEntry(entry: Pick<CalendarEntry, "year" | "month" | "day" | "time" | "span" | "placed">): string {
  if (entry.placed === "between") { const [from, to] = [dayOf(entry.span.start), dayOf(entry.span.end)]; return `between Year ${from.year} · ${from.month}-${from.day} and ${to.month}-${to.day}`; }
  return `Year ${entry.year} · ${entry.month}-${entry.day}${entry.time ? ` · ${entry.time}` : ""}`;
}

// --- storage ------------------------------------------------------------------

export const calendarPath = (scope: Pick<CastScope, "root" | "universeId">) => join(scope.root, "calendar", `${scope.universeId}.json`);

export async function loadCalendar(scope: Pick<CastScope, "root" | "universeId">): Promise<CalendarFile | null> {
  try { return JSON.parse(await readFile(calendarPath(scope), "utf8")) as CalendarFile; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function saveCalendar(scope: Pick<CastScope, "root" | "universeId">, calendar: CalendarFile) {
  const path = calendarPath(scope);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(calendar, null, 1), { mode: 0o600 });
  await rename(temporary, path);
}

/** The universe's books in reading order, each with its continuity. */
export async function calendarBooks(scope: CastScope): Promise<(CastBook & { continuityId: string | null })[]> {
  if (scope.standalone) return scope.books.map((book) => ({ ...book, continuityId: null }));
  const { libraryShow } = await import("../../ground/workspace/library.js");
  const catalog = await libraryShow(scope.root, { kind: "universe", id: scope.universeId });
  return scope.books.map((book) => ({ ...book, continuityId: catalog.sources.find((source) => source.id === book.sourceId)?.assignment.continuityId ?? null }))
    .sort((first, second) => (first.readingOrder ?? Infinity) - (second.readingOrder ?? Infinity) || first.sourceId.localeCompare(second.sourceId));
}

/** Build (or rebuild) a universe's calendar from every book's applied story time and the reviewed year decisions. No model calls. */
export async function buildCalendar(scope: CastScope): Promise<CalendarFile> {
  const previous = await loadCalendar(scope);
  const books = await Promise.all((await calendarBooks(scope)).map(bookTimes));
  const calendar: CalendarFile = { ...placeOnCalendar(scope.universeId, books, previous?.decisions ?? []), builtAt: new Date().toISOString() };
  await saveCalendar(scope, calendar);
  return calendar;
}

/** The calendar a book reads its clock from (built on first use). */
export async function bookCalendar(novelDir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ scope: CastScope; calendar: CalendarFile }> {
  const scope = await castScope(novelDir, env);
  return { scope, calendar: await loadCalendar(scope) ?? await buildCalendar(scope) };
}

/** Is the stored calendar behind the books it reads? */
export async function calendarStale(scope: CastScope): Promise<boolean> {
  const stored = await loadCalendar(scope);
  if (!stored) return true;
  const books = await Promise.all((await calendarBooks(scope)).map(bookTimes));
  return placeOnCalendar(scope.universeId, books, stored.decisions).inputs !== stored.inputs;
}

/** A period's position on the calendar. */
export const calendarEntry = (calendar: CalendarFile, sourceId: string, timeId: string) => calendar.entries.find((entry) => entry.sourceId === sourceId && entry.timeId === timeId);

/** Record reviewed year decisions and rebuild. */
export async function decideYears(scope: CastScope, decisions: Omit<YearDecision, "at">[]): Promise<CalendarFile> {
  const stored = await loadCalendar(scope) ?? await buildCalendar(scope);
  const kept = stored.decisions.filter((entry) => !decisions.some((decision) => decision.sourceId === entry.sourceId && decision.after === entry.after));
  await saveCalendar(scope, { ...stored, decisions: [...kept, ...decisions.map((decision) => ({ ...decision, at: new Date().toISOString() }))] });
  return buildCalendar(scope);
}
