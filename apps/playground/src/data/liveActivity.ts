export interface LiveActivity {
  review?: {
    id: string; timestamp: string; active: boolean; volume: number; chapterIndex: number; blockId: string; changesetId: string;
    phase: string; status: string; nodeIds: string[]; factIds?: string[]; factPositions?: number[]; fields?: string[]; revision?: string | null;
    sourceStart?: number; sourceEnd?: number; offset?: number | null; pageCount?: number; total?: number | null;
    totalFacts?: number | null; inspectedFacts?: number; accepted?: number | null; rejected?: number | null; held?: number | null; unreviewed?: number | null;
  } | null;
  cursor?: string | null;
  batch?: { id: string; nodeIds: string[]; chapterIds: string[]; faculties: string[]; timestamp: string } | null;
  count: number;
  chapterId: string;
  blockId: string | null;
  phase: string;
  latestTouch: { id: string; nodeId: string; timestamp: string; faculty: string; precision: string } | null;
  /** blockId/chapterId/anchorIds say where a faculty works (block level; the
   * newest visible draft scene of its block when there is one). recent: a call
   * started within the last few seconds, so quick calls still show. */
  faculties: { id: string; label: string; faculty: string; system: string; status: string; active: number; calls: number; blockId?: string; chapterId?: string; anchorIds?: string[]; recent?: boolean }[];
  identityEvents: { id: string; timestamp: string; event: { type: "entity.merged"; keepId: string; dropId: string } | { type: "candidate.resolved"; keepId: string; dropId: string } | { type: "entity.distinct"; aId: string; bId: string } }[];
  telemetryNote: string | null;
}

export function activityFocus(activity?: LiveActivity | null) {
  const review = activity?.review;
  const reviewing = !!review && (!activity?.latestTouch || review.timestamp >= activity.latestTouch.timestamp);
  return {
    id: reviewing ? `${review.id}:${review.timestamp}` : activity?.batch?.id ?? activity?.latestTouch?.id,
    nodeIds: reviewing ? review.nodeIds : activity?.batch?.nodeIds ?? (activity?.latestTouch ? [activity.latestTouch.nodeId] : []),
    kind: reviewing ? "review" : "edit",
    historical: reviewing && !review.active,
    timestamp: reviewing ? review.timestamp : activity?.batch?.timestamp ?? activity?.latestTouch?.timestamp,
    faculty: reviewing ? "Pi review" : (activity?.batch?.faculties ?? (activity?.latestTouch ? [activity.latestTouch.faculty] : [])).join(" / "),
  };
}

/** Pi is working right now: a live review, or a faculty with calls in flight. */
export const piBusy = (activity?: LiveActivity | null) => !!activity && (!!activity.review?.active || activity.faculties.some((faculty) => faculty.active > 0));
