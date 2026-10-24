/**
 * CLI group · SIMULATION — kept empty for now (roadmap decision #21).
 *
 * The hierarchy reserves this group beside data extraction. Its
 * foundation already exists in the shared group (timeline list/show
 * in ../shared/queryCommands.ts, over the ground ontology fold);
 * the group's OWN commands — character simulation, fork-and-play —
 * land with sector 12 and register here, so a reader of the CLI
 * tree sees the whole intended shape today, not a gap.
 */
export const SIMULATE_GROUP = {
  id: "simulate",
  status: "empty" as const,
  note: "Reserved by the hierarchy (decision #21). No commands yet; see README.md in this directory.",
};
