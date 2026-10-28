import { test } from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_DAY, calendarDays, calendarTimeLabel, type CalendarView, type CalendarViewEntry, type StoryScene, type TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";
import { calendarPins, dayPartMarks, spiralNodeId } from "../apps/playground/src/data/orbitalTimePlace.js";
import type { Position3 } from "../apps/playground/src/data/spatialLayout.js";

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

test("calendar pins: in each book's stretch, a pin before each day's first scene; flashbacks and out-of-order days get none", () => {
  const scene = (id: string, book: number, time: string, flashback = false) => ({ id, book, times: [{ id: time, via: "anchor" }], flashback } as unknown as StoryScene);
  const data = { scenes: [scene("1:a", 1, "1:eve"), scene("1:b", 1, "1:eve"), scene("1:c", 1, "1:next"), scene("1:memory", 1, "1:old", true), scene("2:a", 2, "2:three")],
    calendar: { books: [], conflicts: [], questions: 0, entries: [
      entry("1:eve", 1, { time: "night" }), entry("1:next", 1, { day: 25, span: { start: day(12, 25) + 1050, end: day(12, 25) + 1260 } }),
      entry("1:old", 1, { month: 3, day: 1, span: { start: day(3, 1), end: day(3, 2) } }), entry("2:three", 2, { day: 25, span: { start: day(12, 25) + 900, end: day(12, 25) + 1020 } }),
    ] } } as unknown as TimePlaceProjection;
  const x: Record<string, number> = { "1:a": 0, "1:b": 40, "1:c": 1600, "1:memory": 20, "2:a": 3200 };
  const anchors = new Map(Object.entries(x).map(([id, at]): [string, Position3] => [spiralNodeId(id), [at, 100, 0]]));
  const pins = calendarPins(data, anchors, () => 0);
  assert.deepEqual(pins.map((pin) => [pin.label, pin.detail, pin.x]), [["12月24日", "Year 1 · Book 1", -60], ["12月25日", "Year 1 · Book 1", 4740], ["12月25日", "Year 1 · Book 2", 9540]]);
  assert.ok(pins.every((pin) => pin.card > pin.top && pin.z < -3000), "the date above the book's strands, far behind them");
  // Two days starting closer than one date's width share a label.
  const close = calendarPins(data, new Map([...anchors].map(([id, at]): [string, Position3] => [id, [id === spiralNodeId("1:c") ? 300 : at[0], at[1], at[2]]])), () => 0);
  assert.deepEqual(close.filter((pin) => pin.detail.endsWith("Book 1")).map((pin) => pin.label), ["12月24–25日"]);
});

test("parts of the day: a smaller mark under the dates where each part starts, staggered so every part keeps its own", () => {
  const scene = (id: string, time: string, flashback = false) => ({ id, book: 1, times: [{ id: time, via: "anchor" }], flashback } as unknown as StoryScene);
  const at = (minute: number) => ({ start: day(12, 25) + minute, end: day(12, 25) + minute + 60 });
  const data = { scenes: [scene("1:a", "1:midnight"), scene("1:b", "1:morning"), scene("1:c", "1:morning"), scene("1:d", "1:afternoon"), scene("1:e", "1:evening"), scene("1:f", "1:night"), scene("1:memory", "1:old", true), scene("1:g", "1:dayonly")],
    calendar: { books: [], conflicts: [], questions: 0, entries: [
      entry("1:midnight", 1, { day: 25, time: "00:00", part: "late-night", span: at(0) }), entry("1:morning", 1, { day: 25, time: "morning", part: "morning", span: at(420) }),
      entry("1:afternoon", 1, { day: 25, time: "15:00", part: "afternoon", span: at(900) }), entry("1:evening", 1, { day: 25, time: "17:00", part: "evening", span: at(1020) }),
      entry("1:night", 1, { day: 25, time: "night", part: "night", span: at(1260) }), entry("1:old", 1, { month: 3, day: 1, time: "morning", part: "morning" }), entry("1:dayonly", 1, { day: 26 }),
    ] } } as unknown as TimePlaceProjection;
  // Midnight and morning far apart; afternoon and evening crowded together; night clear of afternoon again.
  const x: Record<string, number> = { "1:a": 0, "1:b": 2000, "1:c": 2100, "1:d": 4000, "1:e": 4100, "1:f": 4800, "1:memory": 10, "1:g": 6000 };
  const anchors = new Map(Object.entries(x).map(([id, value]): [string, Position3] => [spiralNodeId(id), [value, 100, 0]]));
  const marks = dayPartMarks(data, anchors, () => 0);
  assert.deepEqual(marks.map((mark) => mark.label), ["midnight", "morning", "afternoon", "evening", "night"], "every part, each at its first scene; none for a flashback or a day-only period");
  assert.deepEqual(marks.map((mark) => mark.x), [-60, 5940, 11940, 12240, 14340]);
  assert.ok(marks[3].y < marks[2].y && marks[4].y === marks[2].y, "a crowded mark drops to the second row; the next clear one returns to the first");
  const [pin] = calendarPins(data, anchors, () => 0);
  assert.ok(marks.every((mark) => mark.y < pin.card && mark.foot < mark.y && Math.abs(mark.z - pin.z) < 1e-6), "under the dates, on the same backdrop, a line down to the ruler");
  // Three parts within one label's width and both rows taken: the third joins a label.
  const tight = dayPartMarks(data, new Map([...anchors].map(([id, at]): [string, Position3] => [id, [id === spiralNodeId("1:f") ? 4120 : id === spiralNodeId("1:e") ? 4060 : at[0], at[1], at[2]]])), () => 0);
  assert.deepEqual(tight.map((mark) => mark.label), ["midnight", "morning", "afternoon–night", "evening"]);
});
