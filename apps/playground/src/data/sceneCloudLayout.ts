import type { WorldEdge, WorldNode } from "../types.js";
import { arrangeRelationships, type Position3 } from "./spatialLayout.js";

export function arrangeSceneCloud(nodes: WorldNode[], edges: WorldEdge[]): WorldNode[] {
  const scenes = nodes.filter((node) => node.kind === "scene").sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
  const tracks = [...new Set(scenes.map((node) => `${node.lane}:${node.trackId ?? "chapter"}`))].sort();
  const centers = new Map<string, Position3>();
  const radius = 90 + Math.sqrt(scenes.length) * 38;
  for (const [trackIndex, track] of tracks.entries()) {
    const members = scenes.filter((node) => `${node.lane}:${node.trackId ?? "chapter"}` === track);
    for (const [index, scene] of members.entries()) {
      const vertical = 1 - 2 * (index + 0.5) / members.length;
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const horizontal = Math.sqrt(1 - vertical * vertical);
      centers.set(scene.id, [
        Math.cos(angle) * horizontal * radius + (trackIndex - (tracks.length - 1) / 2) * radius * 4,
        vertical * radius,
        Math.sin(angle) * horizontal * radius,
      ]);
    }
  }
  const layoutEdges = edges.filter((edge) => !edge.id.includes(":narrative-order:"));
  const positions = arrangeRelationships(nodes, layoutEdges, new Map(), { centers });
  return nodes.map((node) => ({ ...node, interiorPos: positions.get(node.id) ?? [0, 0, 0] }));
}
