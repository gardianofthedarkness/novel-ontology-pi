import { BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, getBezierPath, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { FLOW_EDGES, FLOW_NODES, flowState, type FlowKind, type FlowNode, type FlowNodeState } from "../data/facultyFlow";
import type { LiveActivity } from "../data/liveActivity";
import "./faculty-flow.css";

const UNIT_X = 162, UNIT_Y = 84, NODE_W = 146, NODE_H = 44;
const KIND_LABEL: Record<FlowKind, string> = { jev: "Jev", work: "work model", mixed: "Jev + work", step: "step" };
const SIDES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]] as const;

type FacultyData = { flow: FlowNode; state: FlowNodeState; scoped: boolean | null; selected: boolean };
type LaneData = { label: string; width: number; height: number };
type ContextData = { context: string; flowing: boolean; feedback: boolean; motion: boolean };

const FacultyNode = memo(function FacultyNode({ data }: NodeProps<Node<FacultyData>>) {
  const { flow, state, scoped, selected } = data;
  const detail = state.status === "firing" ? `${state.active || ""} firing`.trim() : state.calls ? `${state.calls} call${state.calls === 1 ? "" : "s"}` : flow.kind === "step" ? "" : "idle";
  return (
    <div className={`flow-node kind-${flow.kind} is-${state.status}${scoped === false ? " is-out" : ""}${scoped ? " is-scoped" : ""}${selected ? " is-selected" : ""}`}>
      {SIDES.map(([id, position]) => <Handle key={`s${id}`} id={`s${id}`} type="source" position={position} isConnectable={false} />)}
      {SIDES.map(([id, position]) => <Handle key={`t${id}`} id={`t${id}`} type="target" position={position} isConnectable={false} />)}
      {/* Re-keyed on every new call, so each call replays one spark. */}
      {state.calls > 0 && <span key={state.calls} className="flow-spark" aria-hidden="true" />}
      <strong>{flow.label}</strong>
      <small>{[KIND_LABEL[flow.kind], detail].filter(Boolean).join(" · ")}</small>
    </div>
  );
});

function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return <div className="flow-lane" style={{ width: data.width, height: data.height }}><span>{data.label}</span></div>;
}

function ContextEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<ContextData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const flowing = !!data?.flowing;
  return (
    <>
      <BaseEdge id={id} path={path} className={`flow-edge${flowing ? " is-flowing" : ""}${data?.feedback ? " is-feedback" : ""}`} interactionWidth={12} />
      {flowing && data?.motion && [0, 0.55, 1.1].map((begin) => (
        <circle key={begin} r={2.6} className="flow-particle">
          <animateMotion dur="1.65s" repeatCount="indefinite" begin={`${begin}s`} path={path} />
        </circle>
      ))}
      {/* Labels only where the edge has room; the detail view names every input. */}
      {flowing && Math.hypot(targetX - sourceX, targetY - sourceY) > 110 && <EdgeLabelRenderer><span className="flow-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data?.context}</span></EdgeLabelRenderer>}
    </>
  );
}

const nodeTypes = { faculty: FacultyNode, lane: LaneNode };
const edgeTypes = { context: ContextEdge };

/** Which sides an edge leaves and enters by: sideways within a row, else down (or up for feedback). */
function handles(source: FlowNode, target: FlowNode) {
  if (Math.abs(target.y - source.y) < 0.5) return target.x > source.x ? { sourceHandle: "sr", targetHandle: "tl" } : { sourceHandle: "sl", targetHandle: "tr" };
  return target.y > source.y ? { sourceHandle: "sb", targetHandle: "tt" } : { sourceHandle: "st", targetHandle: "tb" };
}

const NODE_BY_ID = new Map(FLOW_NODES.map((entry) => [entry.id, entry]));
const xs = FLOW_NODES.map((entry) => entry.x), left = Math.min(...xs) * UNIT_X - 18, width = (Math.max(...xs) - Math.min(...xs)) * UNIT_X + NODE_W + 36;
const band = (lane: "digger" | "solidifier") => {
  const ys = FLOW_NODES.filter((entry) => entry.lane === lane).map((entry) => entry.y);
  return { top: Math.min(...ys) * UNIT_Y - 30, height: (Math.max(...ys) - Math.min(...ys)) * UNIT_Y + NODE_H + 42 };
};
const lanes = [band("digger"), band("solidifier")];
/** The whole graph's width/height, so the canvas keeps its shape and fills the console's width. */
const ASPECT = `${width} / ${lanes[1].top + lanes[1].height - lanes[0].top}`;
const LANES: Node<LaneData>[] = (["digger", "solidifier"] as const).map((lane) => {
  const { top, height } = band(lane);
  return { id: `lane:${lane}`, type: "lane", position: { x: left, y: top }, data: { label: lane === "digger" ? "Digger" : "Solidifier", width, height }, draggable: false, selectable: false, focusable: false, zIndex: -1 };
});

interface Props { activity?: LiveActivity | null; reducedMotion: boolean }

export function FacultyFlowPanel({ activity, reducedMotion }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<Node, Edge<ContextData>> | null>(null);
  // Refit when the console resizes; the graph is static, so nothing else moves the camera.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { void flowRef.current?.fitView({ padding: 0.02 }); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const state = useMemo(() => flowState(activity), [activity]);
  const nodes = useMemo<Node[]>(() => [...LANES, ...FLOW_NODES.map((flow): Node<FacultyData> => ({
    id: flow.id, type: "faculty", position: { x: flow.x * UNIT_X, y: flow.y * UNIT_Y },
    data: { flow, state: state.nodes[flow.id], scoped: state.scope.size ? state.scope.has(flow.id) : null, selected: selectedId === flow.id },
    width: NODE_W, height: NODE_H, draggable: false, connectable: false,
    ariaLabel: `${flow.label}, ${KIND_LABEL[flow.kind]}: ${state.nodes[flow.id].status}${state.nodes[flow.id].calls ? `, ${state.nodes[flow.id].calls} calls` : ""}`,
  }))], [state, selectedId]);
  const edges = useMemo<Edge<ContextData>[]>(() => FLOW_EDGES.map((entry) => ({
    id: entry.id, source: entry.source, target: entry.target, type: "context", ...handles(NODE_BY_ID.get(entry.source)!, NODE_BY_ID.get(entry.target)!),
    data: { context: entry.context, flowing: state.flowing.has(entry.id), feedback: !!entry.feedback, motion: !reducedMotion },
    zIndex: state.flowing.has(entry.id) ? 1 : 0, focusable: false,
  })), [state, reducedMotion]);
  const selected = selectedId ? NODE_BY_ID.get(selectedId) : undefined;
  const command = activity?.command;

  return (
    <section className={`faculty-flow-panel${reducedMotion ? " is-still" : ""}`} aria-label="Faculty flow: Digger and Solidifier">
      <div className="flow-summary" role="status">
        <span>{state.firing ? `${state.firing} firing` : "Quiet"} · {state.flowing.size} context edge{state.flowing.size === 1 ? "" : "s"} live</span>
        {command && <span className="pi-console-badge">{command.label} · {command.status}</span>}
      </div>
      <div ref={canvasRef} className="flow-canvas" style={{ aspectRatio: ASPECT }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={(instance) => { flowRef.current = instance; }}
          fitView fitViewOptions={{ padding: 0.02 }} minZoom={0.3} maxZoom={1.4}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false}
          panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false} colorMode="dark" proOptions={{ hideAttribution: true }}
          onNodeClick={(_, clicked) => clicked.type === "faculty" && setSelectedId((current) => current === clicked.id ? null : clicked.id)} />
      </div>
      {selected ? <FlowDetail flow={selected} state={state.nodes[selected.id]} flowing={state.flowing} onClose={() => setSelectedId(null)} />
        : <p className="flow-hint">Pulses are real calls from the event log; moving dots are the context a firing faculty reads. Dashed lines are fallbacks and feedback. Tap a faculty for its inputs.</p>}
      {state.unmapped.length > 0 && <p className="flow-hint">Also reported, not in the graph: {state.unmapped.map((entry) => `${entry.faculty} (${entry.calls})`).join(", ")}.</p>}
    </section>
  );
}

function FlowDetail({ flow, state, flowing, onClose }: { flow: FlowNode; state: FlowNodeState; flowing: Set<string>; onClose: () => void }) {
  const inputs = FLOW_EDGES.filter((entry) => entry.target === flow.id), outputs = FLOW_EDGES.filter((entry) => entry.source === flow.id);
  const line = (entry: (typeof FLOW_EDGES)[number], other: string) => <li key={entry.id} className={flowing.has(entry.id) ? "is-flowing" : ""}>{NODE_BY_ID.get(other)!.label}: {entry.context}{entry.feedback ? " (fallback/feedback)" : ""}</li>;
  return (
    <div className="flow-detail">
      <header><strong>{flow.label}</strong><span className="pi-console-badge">{KIND_LABEL[flow.kind]} · {state.status}</span><button type="button" onClick={onClose} aria-label="Close faculty details">×</button></header>
      <p>{state.calls ? `${state.calls} call${state.calls === 1 ? "" : "s"}${state.blockId ? ` · last in ${state.blockId}` : ""}${state.at ? ` · ${new Date(state.at).toLocaleTimeString()}` : ""}` : flow.kind === "step" ? "Not a model call: shown through drafts, ChangeSets and Pi's commands." : "No calls yet in this run."}</p>
      {flow.names.length > 0 && <p>Reported as {flow.names.map((name) => <code key={name}>{name}</code>)}</p>}
      <div className="flow-io"><div><h4>Reads</h4><ul>{inputs.length ? inputs.map((entry) => line(entry, entry.source)) : <li>Source text</li>}</ul></div>
        <div><h4>Feeds</h4><ul>{outputs.length ? outputs.map((entry) => line(entry, entry.target)) : <li>Canon / reports</li>}</ul></div></div>
    </div>
  );
}
