import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { albumProjection, portraitId, resolveAlbumAsset } from './album.mjs';

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'album-'));
  await mkdir(join(directory, 'ontology'), { recursive: true });
  await mkdir(join(directory, 'assets', 'portraits'), { recursive: true });
  await writeFile(join(directory, 'assets', 'ill_0001.jpg'), 'jpeg-bytes');
  await writeFile(join(directory, 'assets', 'portraits', 'mikoto.png'), 'png-bytes');
  await writeFile(join(directory, 'assets', 'notes.txt'), 'not an image');
  await writeFile(join(directory, 'secret.png'), 'outside assets');
  await symlink(join(directory, 'secret.png'), join(directory, 'assets', 'link.png'));
  const illustrations = [
    { id: 'ill_0001', asset: 'assets/ill_0001.jpg', sentenceId: 'b0001_s0004', kind: 'plate' },
    { id: 'ill_escape', asset: 'assets/../secret.png', sentenceId: null, kind: 'story' },
    { id: 'ill_link', asset: 'assets/link.png', sentenceId: null, kind: 'story' },
    { id: 'ill_text', asset: 'assets/notes.txt', sentenceId: null, kind: 'story' },
  ];
  const portraits = [
    { entityId: 'char_1', name: '御坂美琴', portrait: 'assets/portraits/mikoto.png' },
    { entityId: null, name: 'orphan', portrait: 'assets/portraits/orphan.png' },
    { entityId: 'char_gone', name: 'merged away', portrait: 'assets/portraits/gone.png' },
  ];
  await writeFile(join(directory, 'ontology', 'illustrations.jsonl'), illustrations.map((row) => JSON.stringify(row)).join('\n'));
  await writeFile(join(directory, 'ontology', 'portraits.jsonl'), portraits.map((row) => JSON.stringify(row)).join('\n'));
  return directory;
}

test('album projection lists pictures and only portraits bound to a known entity', async () => {
  const directory = await workspace();
  const album = await albumProjection(directory, new Map([['char_1', '御坂美琴']]));
  assert.deepEqual(album.pictures[0], { id: 'ill_0001', kind: 'plate', sentenceId: 'b0001_s0004', sceneId: null, sceneFraction: null });
  assert.deepEqual(album.portraits, [{ id: 'portrait:assets/portraits/mikoto.png', entityId: 'char_1', entityLabel: '御坂美琴' }]);
  assert.doesNotMatch(JSON.stringify(album), /\/(Users|tmp|private|var)\//, 'no host paths');
  assert.deepEqual(await albumProjection(join(directory, 'missing')), { pictures: [], portraits: [] });
});

test('asset resolver serves only listed images inside assets/', async () => {
  const directory = await workspace();
  assert.equal((await resolveAlbumAsset(directory, 'ill_0001'))?.type, 'image/jpeg');
  assert.equal((await resolveAlbumAsset(directory, portraitId({ portrait: 'assets/portraits/mikoto.png' })))?.type, 'image/png');
  for (const id of ['ill_escape', 'ill_link', 'ill_text', 'assets/ill_0001.jpg', '../secret.png', '', 'x'.repeat(301)]) {
    assert.equal(await resolveAlbumAsset(directory, id), null, `refused: ${id.slice(0, 30)}`);
  }
});

test('album binds exact scene anchors without exporting scene coverage; overlapping coverage stays unresolved', async () => {
  const directory = await workspace();
  const scene = { id: 'scene_1', sentenceIds: ['b0001_s0003', 'b0001_s0004', 'b0001_s0005'] };
  const album = await albumProjection(directory, new Map(), [scene]);
  assert.equal(album.pictures[0].sceneId, 'scene_1');
  assert.equal(album.pictures[0].sceneFraction, 0.5);
  assert.ok(!JSON.stringify(album).includes('sentenceIds'));
  const ambiguous = await albumProjection(directory, new Map(), [scene, { ...scene, id: 'scene_2' }]);
  assert.equal(ambiguous.pictures[0].sceneId, null);
  assert.equal(ambiguous.pictures[0].sceneFraction, null);
});
