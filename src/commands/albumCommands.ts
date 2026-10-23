/** `novel album` — EPUB illustration import + anchor listing. */
import { importEpubAlbum, resolveAnchors } from "../album/album.js";

export async function albumImport(novelDir: string, epubPath: string) {
  return importEpubAlbum(novelDir, epubPath);
}

export async function albumList(novelDir: string, blockSize?: number) {
  return resolveAnchors(novelDir, blockSize);
}
