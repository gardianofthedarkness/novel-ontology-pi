import { castScope, rootCastScope, STANDALONE, type CastScope } from "../../../solidifier/identity/cast.js";
import { buildCalendar, dayOf, describeEntry, loadCalendar, type CalendarFile } from "../../../solidifier/calendar/calendar.js";
import { calendarPacketId } from "../../../solidifier/calendar/review.js";

export const CALENDAR_USAGE = "novel calendar show|build <novel-dir> | novel calendar show|build <library-dir> --universe <id>";

const readable = (scope: CastScope, calendar: CalendarFile) => {
  const title = (sourceId: string) => calendar.books.find((book) => book.sourceId === sourceId)?.title ?? sourceId;
  const packetId = calendarPacketId(calendar);
  const days = new Map<string, string[]>();
  for (const entry of calendar.entries) {
    const key = entry.placed === "between" ? describeEntry(entry) : `Year ${entry.year} · ${entry.month}-${entry.day}`;
    days.set(key, [...(days.get(key) ?? []), `${entry.time ? `${entry.time} ` : ""}${entry.label}${entry.flashback ? " (flashback)" : ""} — ${title(entry.sourceId)}, ${entry.scenes} scene(s)${entry.placed === "derived" ? ", derived" : ""}`]);
  }
  const at = (minute: number) => { const day = dayOf(minute); return `Year ${day.year} · ${day.month}-${day.day}`; };
  return {
    universe: scope.universeId, builtAt: calendar.builtAt,
    books: calendar.books.map((book) => ({ title: book.title, readingOrder: book.readingOrder, year: book.year, yearBy: book.yearBy, ...(book.statedYear ? { statedYear: book.statedYear } : {}), periods: book.periods, spans: book.span ? `${at(book.span.start)} → ${at(book.span.end)}` : "not on the calendar yet (no dated story time)" })),
    days: Object.fromEntries(days),
    conflicts: calendar.conflicts.map((conflict) => `${title(conflict.ref.split("::")[0])}: ${conflict.note}`),
    review: packetId ? { packetId, questions: calendar.questions.length, next: scope.universeId === STANDALONE ? null : `novel review show ${scope.root} ${packetId} --scope universe --universe ${scope.universeId}` } : null,
  };
};

/** `novel calendar show|build`: the universe calendar a book (or a library's universe) reads its clock from. */
export async function calendarCommand(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const [sub, target, flag, universeId, ...rest] = args;
  if (!["show", "build"].includes(sub ?? "") || !target || target.startsWith("--") || rest.length || (flag !== undefined && (flag !== "--universe" || !universeId))) throw new Error(`Usage: ${CALENDAR_USAGE}`);
  const scope = flag ? await rootCastScope(target, universeId, env) : await castScope(target, env);
  const calendar = sub === "build" ? await buildCalendar(scope) : await loadCalendar(scope) ?? await buildCalendar(scope);
  return readable(scope, calendar);
}
