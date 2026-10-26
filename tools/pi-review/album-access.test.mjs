import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAlbumAccess, readAppliedSource, verifyAlbumAccess } from './album-access.mjs';
import { createZip } from '../../dist/src/digger/intake/album/zip.js';
import { walkEpub } from '../../dist/src/digger/intake/album/epub.js';
import { initWorkspace } from '../../dist/src/ground/workspace/init.js';
import { bindWorkspaceSource } from '../../dist/src/ground/workspace/source.js';

test('real EPUB intake access checks assigned text, bytes, symlinks and changed source without models', async context => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'album-access-')));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const epub = join(directory, 'book.epub'), input = join(directory, 'book.txt');
  const bytes = createZip([
    { name: 'META-INF/container.xml', data: '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>' },
    { name: 'content.opf', data: '<package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>' },
    { name: 'one.xhtml', data: '<html><body><p>第一章</p><p>这是原文。</p></body></html>' },
  ], true);
  await writeFile(epub, bytes);
  await writeFile(input, walkEpub(bytes).text);
  const album = await inspectAlbumAccess(epub, input);
  assert.equal(album.importAllowed, true);
  await verifyAlbumAccess(album, input);
  await writeFile(input, 'different legacy text');
  assert.equal((await inspectAlbumAccess(epub, input)).importAllowed, false);
  await assert.rejects(verifyAlbumAccess(album, input), /assigned text changed/);
  await writeFile(input, walkEpub(bytes).text);
  await writeFile(epub, Buffer.concat([bytes, Buffer.from('changed')]));
  await assert.rejects(verifyAlbumAccess(album, input), /EPUB or assigned text changed/);
  const alias = join(directory, 'alias.epub');
  await symlink(epub, alias);
  await assert.rejects(inspectAlbumAccess(alias, input), /symlink/);
  assert.equal(await inspectAlbumAccess(null, input), null);
});

test('resume reads the actual bound album text, not the external assigned input basename', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'album-resume-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'novel');
  await initWorkspace(workspace);
  const albumText = join(workspace, 'source', '原始卷名.txt');
  await writeFile(albumText, '第一章\n这是原文。');
  const assigned = join(directory, 'book-2.txt');
  await writeFile(assigned, '第一章\n这是原文。');
  await bindWorkspaceSource(workspace, assigned);
  assert.equal(await readAppliedSource(workspace, assigned), '第一章\n这是原文。');
  await writeFile(albumText, 'modified');
  await assert.rejects(readAppliedSource(workspace, assigned), /Stored source/);
});
