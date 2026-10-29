import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import type { Entity, Relation } from "../src/ground/ontology/types.js";
import { castScope } from "../src/solidifier/identity/cast.js";
import { buildCalendar, calendarStale, compareOnCalendar, dayOf, describeEntry, loadCalendar, placeOnCalendar, type BookTimes } from "../src/solidifier/calendar/calendar.js";
import { calendarPacketId } from "../src/solidifier/calendar/review.js";

type Period = BookTimes["periods"][number];
const period = (id: string, storyIndex: number, extra: Partial<Period> = {}): Period => ({ id, label: id, storyIndex, flashback: false, date: null, scenes: 1, ...extra });
const md = (month: number, day: number, derived = false) => ({ month, day, derived });
const book = (sourceId: string, readingOrder: number, periods: Period[]): BookTimes => ({ book: { sourceId, workspace: `/${sourceId}`, title: sourceId, readingOrder, continuityId: "main" }, periods });

test("one clock: periods on their day at their clock time or part of the day; books are marks on it", () => {
  const calendar = placeOnCalendar("u", [
    book("b1", 1, [period("eve", 0, { date: md(12, 24), partOfDay: "night" }), period("late", 1, { date: md(12, 24, true), partOfDay: "late-night" }), period("next", 2, { date: md(12, 25, true), partOfDay: "evening" })]),
    book("b2", 2, [period("three", 0, { date: md(12, 25), hour: 15, minute: 0 }), period("half-six", 1, { date: md(12, 25, true), hour: 18, minute: 30 })]),
  ]);
  const at = (id: string) => calendar.entries.find((entry) => entry.timeId === id)!;
  assert.equal(describeEntry(at("three")), "Year 1 · 12-25 · 15:00");
  assert.equal(at("three").placed, "stated");
  assert.equal(at("half-six").placed, "derived");
  // A late night after the evening of the same date runs past midnight, after the night.
  assert.equal(compareOnCalendar(at("eve"), at("late")), -1);
  assert.equal(dayOf(at("late").span.end).day, 25);
  // Across books: Book 2's 15:00 is before Book 1's evening of the same day.
  assert.equal(compareOnCalendar(at("three"), at("next")), -1);
  assert.equal(compareOnCalendar(at("next"), at("half-six")), null, "an evening and 18:30 overlap: the calendar does not order them");
  assert.deepEqual(calendar.books.map((entry) => [entry.sourceId, entry.year, entry.yearBy]), [["b1", 1, "first"], ["b2", 1, "same"]]);
  assert.ok(calendar.books[0].span!.start < calendar.books[1].span!.start && calendar.books[1].span!.end < calendar.books[0].span!.end, "Book 2 sits inside Book 1's span");
});

test("undated periods are a range between their dated neighbours; a flashback sits at its own date", () => {
  const calendar = placeOnCalendar("u", [book("b1", 1, [
    period("memory", 0, { date: md(3, 1), flashback: true }),
    period("morning", 1, { date: md(12, 24), partOfDay: "morning" }),
    period("later", 2),
    period("night", 3, { date: md(12, 24, true), partOfDay: "night" }),
  ])]);
  const at = (id: string) => calendar.entries.find((entry) => entry.timeId === id)!;
  assert.equal(at("later").placed, "between");
  assert.equal(at("later").year, null);
  assert.equal(compareOnCalendar(at("morning"), at("later")), null);
  assert.ok(at("later").span.start === at("morning").span.start && at("later").span.end === at("night").span.end);
  assert.equal(describeEntry(at("memory")), "Year 1 · 3-1");
  assert.equal(compareOnCalendar(at("memory"), at("morning")), -1, "story time, not reading order");
  assert.equal(calendar.conflicts.length, 0, "a flashback dated earlier is not a conflict");
});

test("story order is the reference: a later period dated earlier is reported, not reordered", () => {
  const calendar = placeOnCalendar("u", [book("b1", 1, [period("night", 0, { date: md(12, 24), partOfDay: "night" }), period("midnight", 1, { date: md(12, 24), hour: 0, minute: 0 })])]);
  assert.equal(calendar.conflicts.length, 1);
  assert.match(calendar.conflicts[0].note, /Story order puts "midnight" after "night"/);
});

test("years nobody states: a book whose dates go back is asked, and stays in the same year until answered", () => {
  const books = [book("b1", 1, [period("a", 0, { date: md(12, 24) }), period("b", 1, { date: md(12, 25) })]), book("b2", 2, [period("c", 0, { date: md(12, 24) })]), book("b3", 3, [period("d", 0, { date: md(1, 2) })])];
  const open = placeOnCalendar("u", books);
  assert.deepEqual(open.books.map((entry) => [entry.year, entry.yearBy]), [[1, "first"], [1, "pending"], [1, "pending"]]);
  assert.equal(open.questions.length, 2);
  assert.ok(calendarPacketId(open)?.startsWith("ut_"));
  // Reviewed: Book 2 is the same Christmas from another side; Book 3 is the new year.
  const answered = placeOnCalendar("u", books, [{ sourceId: "b2", after: "b1", verdict: "same", reason: "", at: "" }, { sourceId: "b3", after: "b2", verdict: "later", reason: "", at: "" }]);
  assert.deepEqual(answered.books.map((entry) => [entry.year, entry.yearBy]), [[1, "first"], [1, "reviewed"], [2, "reviewed"]]);
  assert.equal(answered.questions.length, 0);
  assert.equal(calendarPacketId(answered), null);
  const at = (id: string) => answered.entries.find((entry) => entry.timeId === id)!;
  assert.equal(compareOnCalendar(at("b"), at("d")), -1, "Year 2's January comes after Year 1's December");
});

test("a standalone book has its own calendar, rebuilt when its story time changes", async () => {
  const dir = (await initWorkspace(join(await mkdtemp(join(tmpdir(), "calendar-")), "novel"))).novelDir;
  const bundle = new BundleStore(join(dir, "ontology"));
  const time = (id: string, storyIndex: number, properties: Record<string, unknown>): Entity => ({ id, kind: "TimePoint", names: [{ text: id, lang: "zh", kind: "canonical" }], properties: { storyIndex, ...properties }, confidence: 0.9 });
  await bundle.upsertEntity(time("time_a", 0, { date: { month: 12, day: 24, derived: false }, partOfDay: "evening" }));
  await bundle.addRelation({ fromId: "scene_000001", toId: "time_a", type: "OCCURS_DURING", properties: {}, confidence: 0.9 } as Relation);
  const scope = await castScope(dir, {});
  assert.equal(await calendarStale(scope), true);
  const built = await buildCalendar(scope);
  assert.equal(built.entries[0].scenes, 1);
  assert.equal(await calendarStale(scope), false);
  await bundle.upsertEntity(time("time_b", 1, { date: { month: 12, day: 25, derived: true } }));
  assert.equal(await calendarStale(scope), true, "new story time makes the calendar out of date");
  await buildCalendar(scope);
  assert.equal((await loadCalendar(scope))!.entries.length, 2);
});
