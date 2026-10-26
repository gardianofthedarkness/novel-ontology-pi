import type { WorldEdge, WorldNode } from "../types.js";
import { representativeScene } from "./orbitalModel.js";

/**
 * Traditional narrative view: the book in reading order as plain lists —
 * chapters, their scenes, each scene's records — from the same world the
 * orbit draws. Live proposals (ghosts) and held records join their chapter
 * like canon records and keep their state, so the list fills in as Pi works.
 */
export interface NarrativeScene {
  node: WorldNode;
  /** 1-based position among the book's scenes in reading order. */
  number: number;
  /** Events and dialogue the scene covers, earlier → later. */
  records: WorldNode[];
  present: WorldNode[];
  mentioned: WorldNode[];
  locations: WorldNode[];
}
export interface NarrativeChapter {
  node: WorldNode;
  title: string;
  /** The chapter's most connected scene summary (the orbit's chapter label). */
  gist: string | null;
  scenes: NarrativeScene[];
  /** Records no scene covers yet (often fresh proposals). */
  loose: WorldNode[];
  /** Characters present in the chapter's scenes, most scenes first. */
  cast: { node: WorldNode; scenes: number }[];
  nodes: WorldNode[];
  edges: WorldEdge[];
  counts: { events: number; dialogue: number; proposed: number; held: number };
}

interface WorldLike {
  laneNodes: WorldNode[];
  interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>;
  bigEventLabels?: Record<string, string>;
}

const byChrono = (first: WorldNode, second: WorldNode) => first.chrono - second.chrono || first.id.localeCompare(second.id);
const isRecord = (node: WorldNode) => node.kind === "event" || node.kind === "dialogue";

export function narrativeChapters(world: WorldLike, activityNodes: WorldNode[] = [], activityEdges: WorldEdge[] = []): NarrativeChapter[] {
  let sceneNumber = 0;
  return world.laneNodes.filter((node) => node.kind === "bigEvent").sort(byChrono).map((chapter) => {
    const interior = world.interiors[chapter.id];
    const nodes = [...new Map([...(interior?.nodes ?? []), ...activityNodes.filter((node) => node.parent === chapter.id)].map((node) => [node.id, node])).values()];
    const edges = [...new Map([...(interior?.edges ?? []), ...activityEdges.filter((edge) => edge.parent === chapter.id)].map((edge) => [edge.id, edge])).values()];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const linked = (sceneId: string, label: string, toScene: boolean) => edges
      .filter((edge) => edge.relationLabel === label && (toScene ? edge.to === sceneId : edge.from === sceneId))
      .map((edge) => byId.get(toScene ? edge.from : edge.to))
      .filter((node): node is WorldNode => !!node);
    const covered = new Set<string>();
    const scenes = nodes.filter((node) => node.kind === "scene").sort(byChrono).map((node): NarrativeScene => {
      const records = edges.filter((edge) => edge.kind === "contains" && edge.from === node.id).map((edge) => byId.get(edge.to)).filter((entry): entry is WorldNode => !!entry && isRecord(entry));
      for (const record of records) covered.add(record.id);
      const unique = (list: WorldNode[]) => [...new Map(list.map((entry) => [entry.id, entry])).values()];
      return {
        node, number: ++sceneNumber,
        records: unique(records).sort(byChrono),
        present: unique(linked(node.id, "Present in scene", true)),
        mentioned: unique(linked(node.id, "Mentioned in scene", true)),
        locations: unique([...linked(node.id, "Scene location", false), ...edges.filter((edge) => edge.relationType === "LOCATED_AT" && edge.from === node.id).map((edge) => byId.get(edge.to)).filter((entry): entry is WorldNode => !!entry)]),
      };
    });
    const presence = new Map<string, number>();
    for (const scene of scenes) for (const person of scene.present) presence.set(person.id, (presence.get(person.id) ?? 0) + 1);
    const cast = [...presence].map(([id, count]) => ({ node: byId.get(id)!, scenes: count })).sort((first, second) => second.scenes - first.scenes || first.node.label.localeCompare(second.node.label));
    for (const person of nodes.filter((node) => node.kind === "character" && node.state !== "canon" && !presence.has(node.id))) cast.push({ node: person, scenes: 0 });
    const records = nodes.filter(isRecord);
    return {
      node: chapter,
      title: world.bigEventLabels?.[chapter.id] ?? chapter.label,
      gist: representativeScene(nodes, edges)?.summary ?? chapter.summary ?? null,
      scenes,
      loose: records.filter((node) => !covered.has(node.id)).sort(byChrono),
      cast,
      nodes,
      edges,
      counts: {
        events: records.filter((node) => node.kind === "event").length,
        dialogue: records.filter((node) => node.kind === "dialogue").length,
        proposed: nodes.filter((node) => node.state === "proposed").length,
        held: nodes.filter((node) => node.state === "held").length,
      },
    };
  });
}

/** Where a record lives: its chapter, and its scene when one covers it. */
export function locateRecord(chapters: NarrativeChapter[], id: string): { chapter: NarrativeChapter; scene: NarrativeScene | null } | null {
  for (const chapter of chapters) {
    if (chapter.node.id === id) return { chapter, scene: null };
    const scene = chapter.scenes.find((entry) => entry.node.id === id || entry.records.some((record) => record.id === id));
    if (scene) return { chapter, scene };
    if (chapter.nodes.some((node) => node.id === id)) return { chapter, scene: null };
  }
  return null;
}
