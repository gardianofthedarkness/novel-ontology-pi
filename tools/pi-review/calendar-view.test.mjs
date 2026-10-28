import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarView } from './calendar-view.mjs';

test('the story view gets the same calendar the CLI builds: books interleave by the clock, years relative', async () => {
  const time = (id, storyIndex, extra) => ({ id, label: id, storyIndex, flashback: false, sceneIds: ['s'], ...extra });
  const view = await calendarView({ books: [
    { sourceId: 'a', title: 'Book A', readingOrder: 1, continuityId: 'c', volume: 1, times: [time('1:night', 0, { date: { month: 12, day: 24 }, partOfDay: 'night' }), time('1:next', 1, { date: { month: 12, day: 25, derived: true }, partOfDay: 'evening' })] },
    { sourceId: 'b', title: 'Book B', readingOrder: 2, continuityId: 'c', volume: 2, times: [time('2:three', 0, { date: { month: 12, day: 25 }, clock: { hour: 15, minute: 0 } })] },
  ] });
  assert.deepEqual(view.entries.map(entry => [entry.id, entry.book, entry.time]), [['1:night', 1, 'night'], ['2:three', 2, '15:00'], ['1:next', 1, 'evening']]);
  assert.deepEqual(view.books.map(book => [book.volume, book.year, book.yearBy]), [[1, 1, 'first'], [2, 1, 'same']]);
  assert.equal(view.questions, 0);
});
