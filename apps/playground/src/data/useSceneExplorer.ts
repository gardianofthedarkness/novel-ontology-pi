import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldEdge, WorldNode } from "../types";
import { expandSceneGraph, revealSceneNode, sceneIndex, scopeForNode, type SceneScope, type StructureMode } from "./sceneHierarchy";
import { arrangeSceneExpansion } from "./sceneExpansionLayout";
import type { Position3 } from "./spatialLayout";

export function useSceneExplorer(sourceNodes: WorldNode[], sourceEdges: WorldEdge[], enabled: boolean, viewKey: string) {
  const [structure, setStructure] = useState<StructureMode>("cloud");
  const [navigation, setNavigation] = useState<{ key: string; path: SceneScope[] }>({ key: viewKey, path: [] });
  const positionCache = useRef<{ key: string; positions: Map<string, Position3> }>({ key: "", positions: new Map() });
  const layoutKey = `${viewKey}:${structure}`;
  const requests = navigation.key === viewKey ? navigation.path : [];
  const index = useMemo(() => sceneIndex(sourceNodes, sourceEdges), [sourceNodes, sourceEdges]);
  const active = enabled && index.scenes.length > 0;
  const projection = useMemo(() => expandSceneGraph(active ? sourceNodes : [], active ? sourceEdges : [], requests), [active, sourceNodes, sourceEdges, requests]);
  const timeline = useMemo(() => active ? arrangeSceneExpansion(projection, structure, positionCache.current.key === layoutKey ? positionCache.current.positions : undefined) : null, [active, projection, structure, layoutKey]);
  useEffect(() => {
    if (timeline) positionCache.current = { key: layoutKey, positions: new Map(timeline.nodes.map((node) => [node.id, node.interiorPos])) };
  }, [layoutKey, timeline]);
  const path = projection.expanded;
  const navigate = (next: SceneScope[]) => setNavigation({ key: viewKey, path: next });
  return {
    nodes: active ? projection.nodes : sourceNodes,
    edges: active ? projection.edges : sourceEdges,
    rootIds: active ? projection.rootIds : undefined,
    timeline, active, structure, setStructure, path, rank: index.rank,
    key: layoutKey,
    reset: () => navigate([]),
    back: () => { if (!path.length) return false; navigate(path.slice(0, -1)); return true; },
    open: (node: WorldNode) => {
      if (!active) return false;
      if (path.some((scope) => scope.key === node.id)) {
        const remaining = expandSceneGraph(sourceNodes, sourceEdges, path.filter((scope) => scope.key !== node.id)).expanded;
        navigate(remaining);
        return true;
      }
      const next = scopeForNode(node);
      if (!next) return false;
      navigate([...path, next]);
      return true;
    },
    reveal: (node: WorldNode) => {
      if (!active || projection.nodes.some((record) => record.id === node.id)) return false;
      const next = revealSceneNode(sourceNodes, sourceEdges, path, node);
      if (next.length === path.length) return false;
      navigate(next);
      return true;
    },
  };
}
