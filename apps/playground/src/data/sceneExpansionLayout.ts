import type { WorldNode } from "../types.js";
import type { expandSceneGraph, StructureMode } from "./sceneHierarchy.js";
import { arrangeTimeline, type TimelineTrack } from "./timelineLayout.js";
import { arrangeRelationships, type Position3 } from "./spatialLayout.js";

export function arrangeSceneExpansion(projection: ReturnType<typeof expandSceneGraph>, structure: StructureMode, retained: ReadonlyMap<string, Position3> = new Map()) {
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const roots = projection.rootIds.map((id) => byId.get(id)!);
  const base = arrangeTimeline(roots, projection.rootEdges, true, structure);
  const positions = new Map<string, Position3>(base.nodes.map((node) => [node.id, retained.get(node.id) ?? node.interiorPos]));
  const tracks: TimelineTrack[] = [...base.tracks];
  for (const step of projection.steps) {
    const parent = positions.get(step.parentId);
    if (!parent) continue;
    const children = step.childIds.map((id) => byId.get(id)!);
    for (const node of children) {
      const previous = retained.get(node.id);
      if (previous) positions.set(node.id, previous);
    }
    if (structure === "chronology") {
      const scenes = children.filter((node) => node.kind === "scene").sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
      const times = [...new Set(scenes.map((node) => node.chrono))];
      const stories = [...new Set(scenes.map((node) => `${node.lane}:${node.trackId ?? "story"}`))].sort();
      for (const [storyIndex, story] of stories.entries()) {
        const members = scenes.filter((node) => `${node.lane}:${node.trackId ?? "story"}` === story);
        const vertical = parent[1] - 240 - storyIndex * 200;
        const region = Array.from(step.parentId).reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
        const depth = parent[2] + 200 + (region % 7) * 70;
        for (const node of members) if (!positions.has(node.id)) positions.set(node.id, [parent[0] + (times.indexOf(node.chrono) - (times.length - 1) / 2) * 110, vertical, depth]);
        const horizontal = members.map((node) => positions.get(node.id)![0]);
        tracks.push({ id: `expanded-track:${step.parentId}:${story}`, label: `${byId.get(step.parentId)!.label} · earlier → later`, lane: members[0].lane, start: [Math.min(...horizontal) - 70, vertical, depth - 15], end: [Math.max(...horizontal) + 85, vertical, depth - 15] });
      }
    }
    const placed = projection.nodes.filter((node) => positions.has(node.id));
    const pending = children.filter((node) => !positions.has(node.id));
    if (!pending.length) continue;
    const centers = new Map(pending.map((node) => [node.id, parent]));
    const local = arrangeRelationships([...placed, ...pending], projection.edges, positions, { centers });
    for (const node of pending) positions.set(node.id, local.get(node.id)!);
  }
  return { nodes: projection.nodes.map((node): WorldNode => ({ ...node, interiorPos: positions.get(node.id) ?? node.interiorPos })), tracks };
}
