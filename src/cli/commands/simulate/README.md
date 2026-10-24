# CLI group · simulation — empty for now

The codebase mirrors the product hierarchy (roadmap decision #21):
the CLI has two command groups, **extract** (data extraction: the
Digger and the Solidifier) and **simulate**. This group is kept
deliberately empty.

What exists today lives elsewhere:

- Timelines and forking — this group's foundation — are served by
  the shared commands (`novel timeline list|show`,
  `src/cli/commands/shared/queryCommands.ts`) over the deterministic
  state fold (`src/ground/ontology/state.ts`).
- Character simulation (sector 12) is designed but not built: a
  character's state is a fold of canon events up to a time point;
  the stochastic element enters only when generating forward from a
  fork snapshot (roadmap decision #10).

When the first simulation command lands, it registers in this
directory — not in extract/, not in shared/.
