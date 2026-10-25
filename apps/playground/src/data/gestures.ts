/**
 * Phone swipes on the record bar: left/right step along the timeline, up goes
 * one level deeper, down goes back. A swipe is quick, long enough and clearly
 * along one axis; anything else (taps, slow drags, diagonals) is ignored.
 */
export type Swipe = "left" | "right" | "up" | "down";
export const SWIPE_MIN_PX = 48;
export const SWIPE_MAX_MS = 650;

export function classifySwipe(dx: number, dy: number, ms: number): Swipe | null {
  if (ms > SWIPE_MAX_MS) return null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
  if (ax >= ay * 1.5) return dx < 0 ? "left" : "right";
  if (ay >= ax * 1.5) return dy < 0 ? "up" : "down";
  return null;
}
