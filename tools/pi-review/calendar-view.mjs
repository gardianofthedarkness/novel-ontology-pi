// The universe calendar for the story view: the same placement the CLI's
// `novel calendar` uses (one clock), over the projection's periods —
// including story time still awaiting review, so the calendar fills in live.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const calendarModule = () => import('../../dist/src/solidifier/calendar/calendar.js');

/** Reviewed year decisions stored with a universe's calendar. */
export async function storedYearDecisions(libraryDirectory, universeId) {
  try { return JSON.parse(await readFile(join(resolve(libraryDirectory), 'calendar', `${universeId}.json`), 'utf8')).decisions ?? []; }
  catch { return []; }
}

/**
 * books: [{ sourceId, title, readingOrder, continuityId, volume, times }] in
 * reading order, times as the projection holds them (ids as the view uses them).
 */
export async function calendarView({ universeId = 'book', books, decisions = [] }) {
  const { placeOnCalendar } = await calendarModule();
  const input = books.map(book => ({
    book: { sourceId: book.sourceId, workspace: '', title: book.title, readingOrder: book.readingOrder ?? null, continuityId: book.continuityId ?? null },
    periods: book.times.map(time => ({ id: time.id, label: time.label, storyIndex: time.storyIndex, flashback: time.flashback, date: time.date ?? null, ...(time.partOfDay ? { partOfDay: time.partOfDay } : {}), ...(time.clock ? { hour: time.clock.hour, minute: time.clock.minute ?? 0 } : {}), scenes: time.sceneIds?.length ?? 0 })).sort((first, second) => first.storyIndex - second.storyIndex),
  }));
  const placed = placeOnCalendar(universeId, input, decisions);
  const volumeOf = new Map(books.map(book => [book.sourceId, book.volume ?? null]));
  return {
    books: placed.books.map(book => ({ sourceId: book.sourceId, volume: volumeOf.get(book.sourceId), title: book.title, readingOrder: book.readingOrder, year: book.year, yearBy: book.yearBy, span: book.span })),
    entries: placed.entries.map(entry => ({ id: entry.timeId, book: volumeOf.get(entry.sourceId), label: entry.label, year: entry.year, month: entry.month, day: entry.day, time: entry.time, span: entry.span, placed: entry.placed, flashback: entry.flashback, scenes: entry.scenes })),
    conflicts: placed.conflicts.map(conflict => conflict.note),
    questions: placed.questions.length,
  };
}
