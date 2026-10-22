import type { WorldEdge, WorldNode } from "../types.js";
import { arrangeRelationships, type Position3 } from "./spatialLayout.js";
import { arrangeSceneCloud } from "./sceneCloudLayout.js";
import type { StructureMode } from "./sceneHierarchy.js";

export interface TimelineTrack {
  id: string;
  label: string;
  lane: WorldNode["lane"];
  start: [number, number, number];
  end: [number, number, number];
}

export function arrangeTimeline(nodes: WorldNode[], edges: WorldEdge[], interior: boolean, structure: StructureMode = "cloud"): { nodes: WorldNode[]; tracks: TimelineTrack[] } {
  if (interior && nodes.some((node) => node.kind === "scene")) return structure === "chronology" ? arrangeSceneChronology(nodes, edges) : { nodes: arrangeSceneCloud(nodes, edges), tracks: [] };
  const groups: { id: string; label: string; lane: WorldNode["lane"]; records: WorldNode[] }[] = [];
  const attached = new Set(interior ? [] : nodes.filter((node) => node.parent && nodes.some((parent) => parent.id === node.parent && !parent.parent)).map((node) => node.id));
  if (!interior) {
    for (const lane of ["canon", "branch"] as const) {
      const lanes = nodes.filter((node) => node.lane === lane && !attached.has(node.id));
      for (const track of [...new Set(lanes.map((node) => node.trackId ?? lane))].sort()) {
        const records = lanes.filter((node) => (node.trackId ?? lane) === track).sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
        if (records.length) groups.push({ id: `${lane}:${track}`, label: records[0].trackLabel ?? (track === lane ? lane === "canon" ? "Canon" : "Branch" : track), lane, records });
      }
    }
  } else {
    const temporal = nodes.filter((node) => node.kind !== "character");
    for (const track of [...new Set(temporal.filter((node) => node.trackId).map((node) => `${node.lane}:${node.trackId}`))].sort()) {
      const records = temporal.filter((node) => `${node.lane}:${node.trackId}` === track).sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
      groups.push({ id: track, label: records[0].trackLabel ?? records[0].trackId!, lane: records[0].lane, records });
    }
    const remaining = new Set(temporal.filter((node) => !node.trackId).sort((first, second) => first.id.localeCompare(second.id)).map((node) => node.id));
    while (remaining.size) {
      const first = remaining.values().next().value as string;
      const component = new Set([first]);
      const queue = [first];
      remaining.delete(first);
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const edge of edges) {
          if (edge.kind !== "flow" && edge.kind !== "contains") continue;
          const neighbor = edge.from === queue[cursor] ? edge.to : edge.to === queue[cursor] ? edge.from : null;
          if (neighbor && remaining.delete(neighbor)) { component.add(neighbor); queue.push(neighbor); }
        }
      }
      const records = nodes.filter((node) => component.has(node.id)).sort((left, right) => left.chrono - right.chrono || left.id.localeCompare(right.id));
      if (records.every((node) => node.kind === "location")) continue;
      const place = records.find((node) => node.kind === "location") ?? records[0];
      groups.push({ id: place.id, label: place.label, lane: place.lane, records });
    }
  }
  const coordinates = new Map<string, [number, number, number]>();
  const anchors = new Map<string, Position3>();
  const tracks: TimelineTrack[] = [];
  const step = interior ? 180 : 210;
  const rowSpacing = interior ? 220 : 320;
  groups.forEach((group, index) => {
    const vertical = ((groups.length - 1) / 2 - index) * rowSpacing;
    const depth = interior ? ((groups.length - 1) / 2 - index) * 380 : 0;
    let offset = 0;
    if (!interior && group.lane === "branch") {
      const fork = edges.find((edge) => edge.kind === "cross" && group.records.some((node) => node.id === edge.to));
      const source = nodes.find((node) => node.id === fork?.from);
      const target = group.records.find((node) => node.id === fork?.to);
      if (source && target) offset = source.chrono - target.chrono;
    }
    const spine = interior && group.records.some((node) => node.kind === "scene") ? group.records.filter((node) => node.kind === "scene") : group.records;
    for (const node of spine) {
      const position: Position3 = [(node.chrono + offset) * step, vertical, depth];
      coordinates.set(node.id, position);
      anchors.set(node.id, position);
    }
    const horizontal = spine.map((node) => coordinates.get(node.id)![0]);
    const source = edges.find((edge) => edge.kind === "cross" && group.records.some((node) => node.id === edge.to));
    const forkLabel = !interior && source ? nodes.find((node) => node.id === source.from)?.label : null;
    tracks.push({ id: group.id, label: `${String(index + 1).padStart(2, "0")} / ${group.label}${forkLabel ? ` · from ${forkLabel}` : ""}`, lane: group.lane, start: [Math.min(...horizontal) - 70, vertical, depth - 15], end: [Math.max(...horizontal) + 85, vertical, depth - 15] });
  });
  const spatial = arrangeRelationships(nodes, edges, anchors);
  for (const [id, position] of spatial) coordinates.set(id, position);
  const horizontal = [...anchors.values()].map((position) => position[0]);
  const center = horizontal.length ? (Math.min(...horizontal) + Math.max(...horizontal)) / 2 : 0;
  return {
    nodes: nodes.map((node) => {
      const position = coordinates.get(node.id) ?? [0, 0, 0];
      const centered: [number, number, number] = [position[0] - center, position[1], position[2]];
      return { ...node, ...(interior ? { interiorPos: centered } : { lanePos: centered }) };
    }),
    tracks: tracks.map((track) => ({ ...track, start: [track.start[0] - center, track.start[1], track.start[2]], end: [track.end[0] - center, track.end[1], track.end[2]] })),
  };
}

function arrangeSceneChronology(nodes: WorldNode[], edges: WorldEdge[]): { nodes: WorldNode[]; tracks: TimelineTrack[] } {
  const scenes = nodes.filter((node) => node.kind === "scene").sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
  const times = [...new Set(scenes.map((node) => node.chrono))];
  const groups = [...new Set(scenes.map((node) => `${node.lane}:${node.trackId ?? "story"}`))].sort();
  const anchors = new Map<string, Position3>();
  const tracks = groups.map((id, index): TimelineTrack => {
    const records = scenes.filter((node) => `${node.lane}:${node.trackId ?? "story"}` === id);
    const vertical = ((groups.length - 1) / 2 - index) * 280;
    const depth = ((groups.length - 1) / 2 - index) * 240;
    for (const node of records) anchors.set(node.id, [(times.indexOf(node.chrono) - (times.length - 1) / 2) * 210, vertical, depth]);
    const horizontal = records.map((node) => anchors.get(node.id)![0]);
    return { id, label: `${records[0].trackLabel ?? records[0].trackId ?? records[0].lane} · earlier → later`, lane: records[0].lane, start: [Math.min(...horizontal) - 85, vertical, depth - 15], end: [Math.max(...horizontal) + 100, vertical, depth - 15] };
  });
  const positions = arrangeRelationships(nodes, edges, anchors);
  return { nodes: nodes.map((node) => ({ ...node, interiorPos: positions.get(node.id)! })), tracks };
}

export function withOverviewActivity(laneNodes: WorldNode[], laneEdges: WorldEdge[], activityNodes: WorldNode[], activityEdges: WorldEdge[]): { nodes: WorldNode[]; edges: WorldEdge[] } {
  const nodes = [...laneNodes, ...activityNodes];
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [...laneEdges, ...activityEdges].filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  for (const node of activityNodes) {
    if (!node.parent || !ids.has(node.parent) || edges.some((edge) => edge.from === node.parent && edge.to === node.id)) continue;
    edges.push({ id: `overview-parent:${node.id}`, from: node.parent, to: node.id, kind: "contains", state: node.state, parent: node.parent });
  }
  return { nodes, edges };
}
