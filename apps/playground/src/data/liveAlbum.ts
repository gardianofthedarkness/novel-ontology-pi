import type { AlbumPortrait } from "../types.js";
import type { OrbitIllustration } from "./pictureNodes.js";

/** The live snapshot's album projection (pictures + bound portraits). */
export interface LiveAlbum {
  pictures: { id: string; kind: string; sentenceId: string | null }[];
  portraits: { id: string; entityId: string; entityLabel: string }[];
}

/** Scoped, read-only image URL for one album id in the loaded book. */
export const albumAssetUrl = (id: string, book: number | null) => `api/album-asset?id=${encodeURIComponent(id)}${book === null ? "" : `&volume=${book}`}`;

export function liveAlbum(album: LiveAlbum | undefined, book: number | null): { pictures: OrbitIllustration[]; portraits: AlbumPortrait[] } {
  return {
    pictures: (album?.pictures ?? []).map((picture) => ({ id: picture.id, kind: picture.kind, sentenceId: picture.sentenceId, asset: albumAssetUrl(picture.id, book) })),
    portraits: (album?.portraits ?? []).map((portrait) => ({ id: portrait.id, entityId: portrait.entityId, entityLabel: portrait.entityLabel, asset: albumAssetUrl(portrait.id, book) })),
  };
}

/** Keep the previous array when nothing changed, so live refreshes don't re-render the orbit. */
export const sameAlbumEntries = <T extends { id: string; asset: string }>(previous: T[], next: T[]) => previous.length === next.length && previous.every((entry, index) => entry.id === next[index].id && entry.asset === next[index].asset && JSON.stringify(entry) === JSON.stringify(next[index]));
