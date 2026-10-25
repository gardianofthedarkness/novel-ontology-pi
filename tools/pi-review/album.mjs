import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/**
 * Album (EPUB pictures + bound portraits) for the live viewer: a read-only
 * projection of `ontology/illustrations.jsonl` and `ontology/portraits.jsonl`,
 * plus a resolver that serves only image files listed there and stored under
 * the workspace's `assets/`. Album records are not canon and never written.
 */
const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
const maximumBytes = 15 * 1024 * 1024;

async function rows(path) {
  try { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export const portraitId = (record) => `portrait:${record.portrait}`;

async function records(directory) {
  const [illustrations, portraits] = await Promise.all([rows(`${directory}/ontology/illustrations.jsonl`), rows(`${directory}/ontology/portraits.jsonl`)]);
  return {
    illustrations: illustrations.filter((record) => typeof record?.id === 'string' && typeof record.asset === 'string'),
    portraits: portraits.filter((record) => typeof record?.portrait === 'string'),
  };
}

/** Pictures with their sentence anchors, and portraits bound to a known entity
 * (unbound portraits stay hidden by design). Assets are referenced by id. */
export async function albumProjection(directory, entityLabels = new Map()) {
  const { illustrations, portraits } = await records(directory);
  return {
    pictures: illustrations.map((record) => ({ id: record.id, kind: typeof record.kind === 'string' ? record.kind : 'story', sentenceId: typeof record.sentenceId === 'string' ? record.sentenceId : null })),
    portraits: portraits.filter((record) => typeof record.entityId === 'string' && entityLabels.has(record.entityId)).map((record) => ({ id: portraitId(record), entityId: record.entityId, entityLabel: entityLabels.get(record.entityId) })),
  };
}

/** The image file for one album id, or null. Never derives a path from the id. */
export async function resolveAlbumAsset(directory, id) {
  if (typeof id !== 'string' || !id || id.length > 300) return null;
  const { illustrations, portraits } = await records(directory);
  const relative = illustrations.find((record) => record.id === id)?.asset ?? portraits.find((record) => portraitId(record) === id)?.portrait;
  const type = relative && imageTypes[extname(relative).toLowerCase()];
  if (!type || !relative.startsWith('assets/') || relative.includes('\0')) return null;
  try {
    const assets = await realpath(resolve(directory, 'assets'));
    const filename = await realpath(resolve(directory, relative));
    if (!filename.startsWith(`${assets}${sep}`)) return null;
    const info = await stat(filename);
    if (!info.isFile() || info.size > maximumBytes) return null;
    return { filename, type };
  } catch { return null; }
}
