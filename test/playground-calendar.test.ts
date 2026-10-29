import { test } from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_DAY, calendarDays, calendarTimeLabel, type CalendarView, type CalendarViewEntry } from "../apps/playground/src/data/timePlace.js";

const day = (month: number, date: number) => ((1 * 12 + (month - 1)) * 31 + (date - 1)) * CALENDAR_DAY;
const entry = (id: string, book: number, extra: Partial<CalendarViewEntry>): CalendarViewEntry => ({ id, book, label: id, year: 1, month: 12, day: 24, time: null, span: { start: day(12, 24), end: day(12, 24) + CALENDAR_DAY }, placed: "stated", flashback: false, scenes: 1, ...extra });

test("the story view's calendar: days in order, periods in clock order, undated ones after the dated", () => {
  const view: CalendarView = { books: [], conflicts: [], questions: 0, entries: [
    entry("1:next", 1, { day: 25, time: "evening", span: { start: day(12, 25) + 1050, end: day(12, 25) + 1260 }, placed: "derived" }),
    entry("1:later", 1, { year: null, month: null, day: null, placed: "between", span: { start: day(12, 24) + 1260, end: day(12, 25) + 1260 } }),
    entry("2:three", 2, { day: 25, time: "15:00", span: { start: day(12, 25) + 900, end: day(12, 25) + 900 } }),
    entry("1:night", 1, { time: "night", span: { start: day(12, 24) + 1260, end: day(12, 24) + 1440 } }),
  ] };
  const days = calendarDays(view);
  assert.deepEqual(days.map((entry) => entry.label), ["Year 1 · 12月24日", "Year 1 · 12月25日"]);
  assert.deepEqual(days[0].entries.map((entry) => entry.id), ["1:night", "1:later"], "the undated period follows the dated ones of the day its range starts");
  assert.deepEqual(days[1].entries.map((entry) => [entry.id, entry.book]), [["2:three", 2], ["1:next", 1]], "books interleave by the clock, not by volume");
  assert.equal(calendarTimeLabel(days[1].entries[0]), "15:00");
  assert.equal(calendarTimeLabel(days[1].entries[1]), "evening");
  assert.equal(calendarTimeLabel(days[0].entries[1]), "undated");
});
