/**
 * Nearness in story time (docs/v2/spawning.md §2; the user, 2026-11-01): two scenes are close when they are on the same day,
 * in the same or the next part of it. Read from the time tree's nodes (`t:y1:12-24:evening`, a clock time by its hour).
 */
const SLOTS: Record<string, number> = { "late-night": 0, dawn: 1, "early-morning": 1, morning: 2, noon: 3, afternoon: 4, evening: 5, night: 6 };
/** A time node's day and part of the day. */
const timeOf = (node: string | null | undefined): { day: string; slot: number | null } | null => {
  const match = node?.match(/^t:y\d+:(\d{1,2}-\d{1,2})(?::(.+))?$/);
  if (!match) return null;
  const rest = match[2] ?? null, clock = rest?.match(/^(\d{1,2}):\d{2}$/), hour = clock ? Number(clock[1]) : null;
  return { day: match[1], slot: hour !== null ? (hour < 5 ? 0 : hour < 7 ? 1 : hour < 11 ? 2 : hour < 14 ? 3 : hour < 17 ? 4 : hour < 20 ? 5 : 6) : rest ? SLOTS[rest] ?? null : null };
};
/** Close in time: the same day, the same or the next part of it (a part unknown on either side: the same day). */
export function closeInTime(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = timeOf(before), b = timeOf(after);
  if (!a || !b) return !before && !after;
  if (a.day !== b.day) return false;
  return a.slot === null || b.slot === null || (b.slot >= a.slot && b.slot - a.slot <= 1);
}
