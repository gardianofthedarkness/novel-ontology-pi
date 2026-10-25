import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export async function inspectAlbumAccess(epub, input, extractText) {
  if (!epub) return null;
  const path = resolve(epub);
  const info = await lstat(path);
  if (!/\.epub$/iu.test(path) || !info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024 || await realpath(path) !== path) throw new Error('Assigned EPUB must be a bounded regular file, not a symlink');
  const bytes = await readFile(path);
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Assigned EPUB exceeds the size limit');
  const text = extractText ?? (await import('../../dist/src/digger/intake/album/epub.js')).walkEpub;
  const importAllowed = text(bytes).text === await readFile(input, 'utf8');
  return { epub: path, sha256: createHash('sha256').update(bytes).digest('hex'), importAllowed, ...(importAllowed ? {} : { reasonCode: 'assigned_text_differs_from_epub_use_fresh_workspace' }) };
}

export async function verifyAlbumAccess(album, input) {
  const current = await inspectAlbumAccess(album?.epub, input);
  if (!album?.importAllowed || !current?.importAllowed || current.sha256 !== album.sha256) throw new Error('EPUB or assigned text changed; album import requires a matching fresh intake, never re-anchor applied source implicitly');
}

export async function readAppliedSource(workspace, input) {
  const { storedSource, sourceHash } = await import('../../dist/src/ground/workspace/source.js');
  const bound = await storedSource(workspace);
  const text = await readFile(resolve(workspace, 'source', bound?.file ?? basename(input)), 'utf8');
  if (bound && (sourceHash(text) !== bound.sha256 || bound.blockSize !== 24000)) throw new Error('Stored source or block boundaries changed; restore before resuming');
  return text;
}
