import type { AlbumPortrait } from "../types.js";
import type { OrbitIllustration } from "./pictureNodes.js";
import type { OrbitalDraw } from "./orbitalLayout.js";

/** The live snapshot's album projection (pictures + bound portraits). */
export interface LiveAlbum {
  pictures: { id: string; kind: string; sentenceId: string | null; sceneId?: string | null; sceneFraction?: number | null }[];
  portraits: { id: string; entityId: string; entityLabel: string }[];
}

/** Scoped, read-only image URL for one album id in the loaded book. */
export const albumAssetUrl = (id: string, book: number | null) => `api/album-asset?id=${encodeURIComponent(id)}${book === null ? "" : `&volume=${book}`}`;

export function liveAlbum(album: LiveAlbum | undefined, book: number | null): { pictures: OrbitIllustration[]; portraits: AlbumPortrait[] } {
  return {
    pictures: (album?.pictures ?? []).map((picture) => ({ id: picture.id, kind: picture.kind, sentenceId: picture.sentenceId, ...(picture.sceneId !== undefined ? { sceneId: picture.sceneId, sceneFraction: picture.sceneFraction } : {}), asset: albumAssetUrl(picture.id, book) })),
    portraits: (album?.portraits ?? []).map((portrait) => ({ id: portrait.id, entityId: portrait.entityId, entityLabel: portrait.entityLabel, asset: albumAssetUrl(portrait.id, book) })),
  };
}

/** Keep the previous array when nothing changed, so live refreshes don't re-render the orbit. */
export const sameAlbumEntries = <T extends { id: string; asset: string }>(previous: T[], next: T[]) => previous.length === next.length && previous.every((entry, index) => entry.id === next[index].id && entry.asset === next[index].asset && JSON.stringify(entry) === JSON.stringify(next[index]));

export function portraitDraws(baseDraws: OrbitalDraw[], portraits: AlbumPortrait[]): OrbitalDraw[] {
  const known = new Set(baseDraws.map((draw) => draw.node.id));
  const draws: OrbitalDraw[] = [];
  for (const portrait of portraits) {
    if (known.has(portrait.id)) continue;
    const character = baseDraws.find((draw) => draw.node.id === portrait.entityId);
    if (!character) continue;
    known.add(portrait.id);
    draws.push({
      node: { id: portrait.id, label: `Portrait · ${portrait.entityLabel}`, kind: "portrait", state: "canon", parent: character.node.parent, lane: "canon", chrono: character.node.chrono, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
      role: "main",
      radius: character.radius * 0.8 || 14,
      position: [character.position[0] + character.radius * 2.4, character.position[1] + character.radius * 1.2, character.position[2]],
      asset: portrait.asset,
    });
  }
  return draws;
}
