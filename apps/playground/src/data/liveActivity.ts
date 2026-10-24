export interface LiveActivity {
  cursor?: string | null;
  batch?: { id: string; nodeIds: string[]; chapterIds: string[]; faculties: string[]; timestamp: string } | null;
  count: number;
  chapterId: string;
  blockId: string | null;
  phase: string;
  latestTouch: { id: string; nodeId: string; timestamp: string; faculty: string; precision: string } | null;
  faculties: { id: string; label: string; faculty: string; system: string; status: string; active: number; calls: number }[];
  identityEvents: { id: string; timestamp: string; event: { type: "entity.merged"; keepId: string; dropId: string } | { type: "entity.distinct"; aId: string; bId: string } }[];
  telemetryNote: string | null;
}
