import { Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useState } from "react";
import "@xyflow/react/dist/style.css";
import type { LiveActivity } from "../data/liveActivity";

const STAGES = ["Sectioning", "Miniloop / Jev", "Extraction", "ChangeSet", "Merge gate"];
const STATUS_LABEL = { idle: "Waiting for agent", working: "Agent working", review: "Awaiting review", complete: "Merged · held records stay separate", error: "Replay unavailable" };

interface Props {
  stage: number;
  status: keyof typeof STATUS_LABEL;
  reducedMotion: boolean;
  faculties?: LiveActivity["faculties"];
  telemetryNote?: string | null;
}

export function PipelineStrip({ stage, status, reducedMotion, faculties, telemetryNote }: Props) {
  const [expanded, setExpanded] = useState(false);
  const nodes: Node[] = STAGES.map((label, index) => ({
    id: String(index),
    position: { x: index * 166, y: 0 },
    data: { label: `${String(index + 1).padStart(2, "0")} / ${label}` },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    className: `${index < stage || status === "complete" ? "complete" : index === stage ? "current" : ""}${index === stage && status === "working" ? " working" : ""}`,
    ariaLabel: `${label}: ${index < stage || status === "complete" ? "complete" : index === stage ? STATUS_LABEL[status] : "waiting"}`,
    style: { width: 138, height: 32 },
  }));
  const edges: Edge[] = STAGES.slice(1).map((_, index) => ({
    id: `pipeline-${index}`,
    source: String(index),
    target: String(index + 1),
    type: "straight",
    animated: !reducedMotion && status === "working" && stage === index + 1,
    style: { stroke: index < stage ? "var(--olive)" : "var(--faint)", strokeWidth: 1.5 },
  }));
  const columns = window.innerWidth < 620 ? 2 : 4;
  const observed = faculties?.map((faculty, index): Node => ({ id: faculty.id, position: { x: (index % columns) * 190, y: Math.floor(index / columns) * 76 }, data: { label: `${faculty.label} · ${faculty.status === "working" ? `${faculty.active} active` : faculty.status === "error" ? "failed" : "completed"} · ${faculty.calls} calls` }, className: faculty.status === "working" ? "current working" : faculty.status === "error" ? "failed" : "complete", style: { width: 176, minHeight: 60, fontSize: 11 }, ariaLabel: `${faculty.label}: ${faculty.status}` }));
  if (observed?.length) return <section className="pipeline faculty-pipeline" aria-label="Live agent processing pipeline"><details onToggle={event => setExpanded(event.currentTarget.open)}><summary>Faculty activity · {faculties!.filter(faculty => faculty.status === "working").length} active · {observed.length} faculties ↗</summary><div className="faculty-sheet"><h3>Jev / CLI / System 2 / Pi</h3><p className="telemetry-note">{telemetryNote ?? "Actual observed faculty calls. Completed calls are not shown as active."}</p><div className="faculty-flow">{expanded && <ReactFlow nodes={observed} edges={[]} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.4} maxZoom={1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll={false} zoomOnPinch={false} preventScrolling={false} colorMode="dark" proOptions={{ hideAttribution: true }} />}</div></div></details></section>;
  return (
    <section className="pipeline" aria-label="Live agent processing pipeline">
      <div className="pipeline-summary"><span className="eyebrow">{observed?.length ? "Live faculty calls / CLI + Jev + work model + Pi" : "Processing / 01—05"}</span><span role="status">{STATUS_LABEL[status]}</span></div>
      {telemetryNote && <p className="telemetry-note">{telemetryNote}</p>}
      <div className="pipeline-viewport"><div className="pipeline-flow">
        <ReactFlow nodes={observed?.length ? observed : nodes} edges={observed?.length ? [] : edges} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.4} maxZoom={1}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false}
          panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
          preventScrolling={false} colorMode="dark" proOptions={{ hideAttribution: true }}>
        </ReactFlow>
      </div></div>
    </section>
  );
}
