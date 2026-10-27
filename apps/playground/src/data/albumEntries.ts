import type { WorldNode } from "../types.js";
import { placePictures, type OrbitIllustration } from "./pictureNodes.js";

export interface AlbumPanelPicture {
  id: string;
  asset: string;
  kind: string;
  label: string;
  placed: boolean;
  prevSceneLabel: string | null;
  nextSceneLabel: string | null;
  chrono: number | null;
}

export function albumScenes(nodes: WorldNode[]) {
  const chapters = new Map(nodes.filter(node => node.kind === "bigEvent" && !node.albumSceneId).map(node => [node.id, node.chrono]));
  return nodes.filter(node => node.kind === "scene" || node.albumSceneId)
    .sort((first, second) => (chapters.get(first.parent ?? "") ?? 0) - (chapters.get(second.parent ?? "") ?? 0) || first.chrono - second.chrono || first.id.localeCompare(second.id))
    .map((node, index) => ({ id: node.albumSceneId ?? node.id, drawId: node.id, label: node.label, chrono: index, sentenceIds: node.sentenceIds ?? [] }));
}

export function albumEntries(nodes: WorldNode[], pictures: OrbitIllustration[]): AlbumPanelPicture[] {
  const scenes = albumScenes(nodes);
  const labels = new Map(scenes.map(scene => [scene.id, scene.label]));
  const kinds: Record<string, string> = { cover: "Cover", plate: "Plate", story: "Illustration", paratext: "Paratext" };
  return placePictures(scenes, pictures).map(placement => ({
    id: placement.pictureId, asset: placement.asset, kind: placement.kind,
    label: kinds[placement.kind] ?? "Picture", placed: placement.placed,
    prevSceneLabel: labels.get(placement.prevSceneId ?? "") ?? null,
    nextSceneLabel: labels.get(placement.nextSceneId ?? "") ?? null,
    chrono: placement.chrono,
  }));
}

export function albumScrollOffset(scrollTop: number, viewportHeight: number, itemTop: number, itemHeight: number): number {
  if (itemTop < scrollTop) return Math.max(0, itemTop);
  if (itemTop + itemHeight > scrollTop + viewportHeight) return Math.max(0, itemTop + Math.min(itemHeight, viewportHeight) - viewportHeight);
  return scrollTop;
}
