import { forwardRef } from "react";
import {
  GraphCanvas,
  type GraphCanvasRef,
  type GraphEdge as RGEdge,
  type GraphNode as RGNode,
} from "reagraph";
import type { WorldEdge, WorldNode } from "../types";

const KIND_FILL: Record<WorldNode["kind"], string> = {
  bigEvent: "#2dd4bf",
  character: "#a78bfa",
  location: "#7dd3fc",
  scene: "#94a3b8",
  event: "#2dd4bf",
  dialogue: "#fbbf24",
};

function toRGNode(n: WorldNode, pos: [number, number, number]): RGNode {
  let fill = KIND_FILL[n.kind];
  if (n.lane === "branch" && n.kind === "bigEvent") fill = "#a78bfa";
  if (n.state === "proposed") fill = "#d97706"; // amber ghost
  if (n.state === "held") fill = "#64748b"; // slate — held reads differently from pending
  const stateTag =
    n.state === "proposed" ? "◌ proposed" : n.state === "held" ? "⧗ held" : "";
  return {
    id: n.id,
    label: n.label,
    subLabel: [n.subLabel, stateTag].filter(Boolean).join(" · "),
    fill,
    size: n.kind === "bigEvent" ? 15 : n.kind === "character" ? 10 : 8,
    data: { world: n },
    position: pos,
  } as RGNode;
}

function toRGEdge(e: WorldEdge): RGEdge {
  const color =
    e.state === "proposed"
      ? "#d97706"
      : e.state === "held"
        ? "#64748b"
        : e.kind === "flow"
          ? "#2dd4bf"
          : e.kind === "cross"
            ? "#a78bfa"
            : "#475569";
  return {
    id: e.id,
    source: e.from,
    target: e.to,
    color,
    size: e.kind === "flow" ? 2 : 1,
  } as RGEdge;
}

interface Props {
  nodes: WorldNode[];
  edges: WorldEdge[];
  interior: boolean;
  layout: "locked" | "force";
  onNodeClick: (node: WorldNode) => void;
}

/**
 * The one-world graph stage (Reagraph). Positions are authored from the
 * ontology (chronological layout), so the default layout is "locked"
 * (nooverlap — coordinates ARE the design); "force" is the loose
 * organic alternative for exploration.
 */
export const WorldGraph = forwardRef<GraphCanvasRef, Props>(function WorldGraph(
  { nodes, edges, interior, layout, onNodeClick },
  ref,
) {
  const ids = new Set(nodes.map((n) => n.id));
  const rgNodes = nodes.map((n) =>
    toRGNode(n, interior ? n.interiorPos : n.lanePos),
  );
  const rgEdges = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map(toRGEdge);
  return (
    <GraphCanvas
      ref={ref}
      nodes={rgNodes}
      edges={rgEdges}
      layoutType={layout === "locked" ? "nooverlap" : "forceDirected3d"}
      cameraMode="orbit"
      draggable={false}
      labelType="all"
      edgeArrowPosition="end"
      animated={layout === "force"}
      onNodeClick={(node) => {
        const world = (node as RGNode).data?.world as WorldNode | undefined;
        if (world) onNodeClick(world);
      }}
    />
  );
});
