/**
 * Manifold unification at spawn (docs/v2/borrow-and-spawn.md §8.6; the user's design, 2026-11-01). Heights are averages,
 * so a parent's average is its parts' averages weighted by their areas. When a part is placed, the others change so the
 * parent's average holds, a later height having the better right over an earlier one:
 *  - parts spawned at this moment (and the parent's own open ground, the first time) are set first, within their ranges;
 *  - raising: the rest of the parent rises, as cities grow;
 *  - lowering, within the deformation limit: only parts above the parent's average that are not nominated, the highest
 *    first, each by a share of its average at most (a damaged one more), never below its range nor the parent's average;
 *  - what that cannot hold, the parent's average takes.
 * Nominated buildings are the source of truth: never changed here (they add to the averages above them where they stand).
 */
import { setting } from "../settings.js";
export interface HeightPart {
  id: string;
  /** Its ground's area (m²). */
  area: number;
  /** Its average height (m). */
  average: number;
  /** The least and most average its kind allows. */
  range: [number, number];
  /** The height just decided (it stands), a nominated building (the source of truth). */
  fixed?: boolean;
  nominated?: boolean;
  damaged?: boolean;
  /** Spawned at this moment: no history yet, so no limit but its range. */
  born?: boolean;
}

/** The deformation limit (the user, 2026-11-01): how far one spawn may lower a part, as a share of its average. */
export const LIMIT = setting<{ lower: number; damaged: number }>("spawn.heightLimit");

export interface Unified { averages: Record<string, number>; parent: number; moved: { id: string; from: number; to: number }[] }

/** The parts' averages once the parent's average is held as well as the rules allow, and the parent's average after (§8.6). */
export function unify(parentAverage: number, parts: HeightPart[]): Unified {
  const now = new Map(parts.map((part) => [part.id, part.average])), area = parts.reduce((sum, part) => sum + part.area, 0);
  if (!area) return { averages: Object.fromEntries(now), parent: parentAverage, moved: [] };
  const total = () => parts.reduce((sum, part) => sum + part.area * now.get(part.id)!, 0);
  const gap = () => parentAverage * area - total();
  // Spread a height-area gap over parts, each by the same height, within each part's own bounds (filling the free ones first).
  const spread = (who: HeightPart[], bound: (part: HeightPart) => [number, number]) => {
    let left = who.filter((part) => { const [lo, hi] = bound(part); return lo < hi; });
    for (let round = 0; round < 8 && left.length && Math.abs(gap()) > 1e-6; round++) {
      const weight = left.reduce((sum, part) => sum + part.area, 0), step = gap() / weight;
      for (const part of left) { const [lo, hi] = bound(part); now.set(part.id, Math.min(hi, Math.max(lo, now.get(part.id)! + step))); }
      left = left.filter((part) => { const [lo, hi] = bound(part), at = now.get(part.id)!; return step > 0 ? at < hi - 1e-9 : at > lo + 1e-9; });
    }
  };
  // 1. What was born now: anywhere in its range.
  spread(parts.filter((part) => part.born && !part.fixed && !part.nominated), (part) => part.range);
  // 2. Raising: the rest rises, within its range.
  if (gap() > 1e-6) spread(parts.filter((part) => !part.born && !part.fixed && !part.nominated), (part) => [now.get(part.id)!, part.range[1]]);
  // 3. Lowering within the deformation limit: the highest above the parent's average first, each only so far.
  if (gap() < -1e-6)
    for (const part of parts.filter((p) => !p.born && !p.fixed && !p.nominated && now.get(p.id)! > parentAverage).sort((a, b) => now.get(b.id)! - now.get(a.id)!)) {
      if (gap() > -1e-6) break;
      const was = now.get(part.id)!, floor = Math.max(part.range[0], parentAverage, was * (1 - (part.damaged ? LIMIT.damaged : LIMIT.lower)));
      now.set(part.id, Math.max(floor, was + gap() / part.area));
    }
  const parent = Math.round((total() / area) * 10) / 10;
  const averages = Object.fromEntries(parts.map((part) => [part.id, Math.round(now.get(part.id)! * 10) / 10]));
  return { averages, parent, moved: parts.filter((part) => Math.abs(averages[part.id] - part.average) > 0.05).map((part) => ({ id: part.id, from: part.average, to: averages[part.id] })) };
}
