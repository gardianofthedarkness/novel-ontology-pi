import type { LiveActivity } from "./liveActivity.js";

/**
 * The Digger + Solidifier faculty graph (docs/faculty-flow.md), and its live
 * state from faculty telemetry. Edges are the declared context each faculty
 * reads; telemetry says which faculty fired, never which record moved, so an
 * edge "flows" only when its target fires after its source in the same block.
 */
export type FlowLane = "digger" | "solidifier";
/** jev: System 1 questions; work: work-model calls; mixed: both; step: not a model call. */
export type FlowKind = "jev" | "work" | "mixed" | "step";
export interface FlowNode { id: string; label: string; lane: FlowLane; kind: FlowKind; names: string[]; x: number; y: number }
export interface FlowEdge { id: string; source: string; target: string; context: string; feedback?: boolean }

const node = (id: string, label: string, lane: FlowLane, kind: FlowKind, names: string[], x: number, y: number): FlowNode => ({ id, label, lane, kind, names, x, y });

export const FLOW_NODES: FlowNode[] = [
  node("intake", "Intake", "digger", "step", [], 1.25, 0),
  node("album", "Album anchors", "digger", "step", [], 2.6, 0),
  node("scenes", "Scene boundaries", "digger", "jev", ["scene_start", "scene_end", "scene_seam", "scene-boundaries"], 0.5, 1),
  node("exchanges", "Dialogue exchanges", "digger", "jev", ["dlg_kind", "dlg_turn", "dlg_start", "dlg_end", "dialogue-boundaries", "dialogue-structure"], 2, 1),
  node("adjudicate", "Scene adjudication", "digger", "work", ["scene-adjudication"], -0.75, 1),
  node("identity", "Entities + presence", "digger", "work", ["entities-participants"], 0, 2),
  node("understanding", "Scene understanding", "digger", "work", ["scene-understanding"], 1.15, 2),
  node("miniloop", "Miniloop names", "digger", "jev", ["newname", "nick", "present"], -0.75, 3),
  node("birth", "Universal EM", "digger", "jev", ["who", "birth", "fragment"], 0.25, 3),
  node("members", "Dialogue members", "digger", "mixed", ["dialogue-member", "dialogue-participants", "speaker", "speaker-attribution", "dialogue-attribution", "dialogue-adjudication"], 2.2, 3),
  node("assembly", "Grounding assembly", "digger", "step", ["grounding-assembly"], 1.25, 4),
  node("extraction", "Extraction", "digger", "work", ["extraction"], 1.25, 5),
  node("causality", "Causality", "solidifier", "jev", ["causality", "causal", "succession"], 0, 6.1),
  node("gate", "Review gate · Pi", "solidifier", "step", ["Pi review"], 1.25, 7),
  node("recall", "Recall pins", "solidifier", "step", [], 2.6, 7),
  node("apply", "Apply to canon", "solidifier", "step", [], 1.25, 8),
  node("timeplace", "Time + place", "solidifier", "mixed", ["timeplace", "in", "entity", "time_role", "place_tree", "strand_presence"], 2.6, 8.4),
  node("matching", "EM after apply", "solidifier", "jev", ["matching", "same", "distinct", "variant"], -0.1, 9),
  node("atlas", "Universe atlas", "solidifier", "jev", ["atlas"], 1.25, 9.6),
  node("universe", "Universe causality", "solidifier", "jev", ["universe-causality"], 2.6, 9.6),
  node("stage", "Stage · buildings, movement", "solidifier", "jev", ["stated_", "moves_", "how_", "dir_"], 2.6, 10.6),
  // The v2 reading flow (src/v2, docs/v2/world-engine-v2.md §2): listing (work model), typing, unified EM and EM² roles (Jev).
  node("listing", "Listing · v2", "digger", "work", ["v2-listing"], 3.6, 1),
  node("typing", "Typing · v2", "digger", "jev", ["type", "proper"], 3.6, 2),
  node("unified", "Unified EM · v2", "digger", "jev", ["em", "own"], 3.6, 3),
  node("roles", "Roles · EM² · v2", "digger", "jev", ["role", "ref"], 3.6, 4),
  node("storytime", "Story time · v2", "digger", "jev", ["time"], 3.6, 5),
];

const edge = (source: string, target: string, context: string, feedback = false): FlowEdge => ({ id: `${source}->${target}`, source, target, context, ...(feedback ? { feedback } : {}) });

export const FLOW_EDGES: FlowEdge[] = [
  edge("intake", "album", "sentence ids"),
  edge("intake", "scenes", "sentences"),
  edge("intake", "exchanges", "sentences"),
  edge("scenes", "adjudicate", "uncertain boundary", true),
  edge("scenes", "identity", "closed scene"),
  edge("scenes", "understanding", "closed scene"),
  edge("scenes", "miniloop", "scenes, no work model", true),
  edge("identity", "birth", "descriptions, fragments"),
  edge("identity", "members", "block identities"),
  edge("exchanges", "members", "exchange spans"),
  edge("birth", "assembly", "identities"),
  edge("understanding", "assembly", "events, states"),
  edge("members", "assembly", "dialogue cards"),
  edge("assembly", "extraction", "scene results"),
  edge("miniloop", "extraction", "names, presence", true),
  edge("extraction", "causality", "new events, scenes"),
  edge("extraction", "gate", "block ChangeSet"),
  edge("causality", "gate", "CAUSES proposals"),
  edge("timeplace", "stage", "place tree, strands"),
  edge("gate", "apply", "approved"),
  edge("gate", "recall", "corrections", true),
  edge("recall", "scenes", "pinned answers", true),
  edge("gate", "scenes", "revision ≤ 2", true),
  edge("apply", "timeplace", "new scenes"),
  edge("timeplace", "gate", "time-place ChangeSet"),
  edge("apply", "matching", "touched entities"),
  edge("matching", "apply", "audited merge", true),
  edge("apply", "atlas", "canon"),
  edge("apply", "universe", "canon"),
  edge("intake", "listing", "sentence batches"),
  edge("listing", "typing", "names"),
  edge("typing", "unified", "typed names"),
  edge("exchanges", "unified", "facts"),
  edge("unified", "roles", "names, descriptions"),
  edge("unified", "storytime", "time words"),
  edge("scenes", "storytime", "scenes"),
  edge("storytime", "roles", "facts by story time"),
  edge("scenes", "roles", "scenes"),
  edge("exchanges", "roles", "sentence kinds"),
];

const BY_NAME = new Map(FLOW_NODES.flatMap((entry) => entry.names.map((name) => [name, entry.id] as const)));
const DIGGER = FLOW_NODES.filter((entry) => entry.lane === "digger").map((entry) => entry.id);

/** The graph node a reported faculty name belongs to, if any. */
export function flowNodeOf(faculty: string): string | undefined {
  return BY_NAME.get(faculty);
}

/** Pi's CLI commands and the nodes each one runs (longest prefix wins). */
const COMMANDS: [string, string[]][] = [
  ["novel ingest", [...DIGGER, "causality", "gate", "apply", "timeplace", "matching"]],
  ["novel review", ["gate", "apply"]],
  ["novel changeset", ["gate", "apply", "timeplace", "matching"]],
  ["novel em", ["matching", "apply"]],
  ["novel causality universe", ["universe"]],
  ["novel causality", ["causality", "gate"]],
  ["novel timeplace", ["timeplace", "gate"]],
  ["novel atlas", ["atlas"]],
  ["novel album", ["album"]],
  ["novel recall", ["recall", "scenes", "exchanges"]],
  ["novel fix", ["apply"]],
  ["novel stage", ["stage"]],
];

export function commandScope(label: string | undefined | null): string[] {
  if (!label) return [];
  const text = label.trim().toLowerCase();
  return [...COMMANDS].sort((first, second) => second[0].length - first[0].length).find(([prefix]) => text.startsWith(prefix))?.[1] ?? [];
}

export type FlowStatus = "idle" | "firing" | "done" | "failed";
export interface FlowNodeState { status: FlowStatus; calls: number; active: number; at?: string; blockId?: string; names: string[] }
export interface FlowState {
  nodes: Record<string, FlowNodeState>;
  flowing: Set<string>;
  scope: Set<string>;
  /** Reported faculties with no node: shown, never dropped. */
  unmapped: { faculty: string; calls: number; active: number }[];
  firing: number;
}

const RANK: Record<FlowStatus, number> = { idle: 0, done: 1, failed: 2, firing: 3 };
const blank = (): FlowNodeState => ({ status: "idle", calls: 0, active: 0, names: [] });

export function flowState(activity: LiveActivity | null | undefined): FlowState {
  const nodes: Record<string, FlowNodeState> = Object.fromEntries(FLOW_NODES.map((entry) => [entry.id, blank()]));
  const unmapped: FlowState["unmapped"] = [];
  for (const faculty of activity?.faculties ?? []) {
    const id = flowNodeOf(faculty.faculty);
    if (!id) {
      unmapped.push({ faculty: faculty.faculty, calls: faculty.calls, active: faculty.active });
      continue;
    }
    const state = nodes[id];
    const live = faculty.active > 0 || !!faculty.recent;
    state.calls += faculty.calls;
    state.active += faculty.active;
    state.names.push(faculty.faculty);
    if (faculty.timestamp && (!state.at || faculty.timestamp > state.at)) {
      state.at = faculty.timestamp;
      if (faculty.blockId) state.blockId = faculty.blockId;
    }
    // Firing outranks a failure, a failure outranks finished work.
    const status: FlowStatus = live ? "firing" : faculty.status === "error" ? "failed" : "done";
    if (RANK[status] > RANK[state.status]) state.status = status;
  }
  if (activity?.review?.active) nodes.gate = { ...nodes.gate, status: "firing", active: Math.max(1, nodes.gate.active) };
  const scope = new Set(activity?.command && /working|running|started/i.test(activity.command.status) ? commandScope(activity.command.label) : []);
  const flowing = new Set<string>();
  for (const entry of FLOW_EDGES) {
    const source = nodes[entry.source], target = nodes[entry.target];
    if (target.status !== "firing") continue;
    const sourceKind = FLOW_NODES.find((candidate) => candidate.id === entry.source)!.kind;
    // A step has no telemetry of its own: it feeds whoever fires next. A
    // faculty feeds its target only after it fired, in the same block.
    const fed = sourceKind === "step" ? !entry.feedback
      : source.status !== "idle" && (!source.at || !target.at || source.at <= target.at) && (!source.blockId || !target.blockId || source.blockId === target.blockId);
    if (fed) flowing.add(entry.id);
  }
  return { nodes, flowing, scope, unmapped, firing: Object.values(nodes).filter((state) => state.status === "firing").length };
}
