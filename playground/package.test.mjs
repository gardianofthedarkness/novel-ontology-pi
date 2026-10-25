import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPublishable, collectPackageFiles } from './export-package.mjs';
import { verifyPackage } from './verify-package.mjs';
import { repository } from './prepare.mjs';

test('optional development assets live under root playground without changing user CLI commands', async () => {
  const files = await collectPackageFiles(repository);
  for (const name of ['skills/novel-library/SKILL.md', 'skills/novel-library/references/organization.md']) assert.ok(files.includes(name), name);
  for (const name of ['playground/Dockerfile', 'playground/compose.yaml', 'playground/Dockerfile.dockerignore', 'playground/start.mjs', 'playground/fixtures/lantern-harbor/story.json']) assert.ok(files.includes(name), name);
  for (const name of ['Dockerfile', 'compose.yaml', '.dockerignore', 'tools/team-playground/start.mjs']) await assert.rejects(access(join(repository, name)), { code: 'ENOENT' });
  const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node dist/src/cli/cli.js');
  assert.equal(pkg.scripts['playground:team'], 'node playground/start.mjs');
  const compose = await readFile(join(repository, 'playground/compose.yaml'), 'utf8');
  assert.match(compose, /context: \.\./);
  assert.match(compose, /dockerfile: playground\/Dockerfile/);
  assert.match(compose, /\.\.\/apps\/playground\/src:/);
});

test('share package rejects private paths and secret-shaped content', () => {
  for (const name of ['.env', 'tools/pi-review/.env.local', '.team-playground/active.json', 'runtime/job.json', 'private/source.txt', 'novel.epub', 'ontology/graph.lbug.wal']) assert.throws(() => assertPublishable(name, Buffer.from('synthetic')));
  assert.throws(() => assertPublishable('src/bad.ts', Buffer.from(`const key = 'sk-${'a'.repeat(32)}';`)));
  assert.throws(() => assertPublishable('src/bad.ts', Buffer.from(`/view/${'a'.repeat(43)}/`)));
  assert.doesNotThrow(() => assertPublishable('src/cli.ts', Buffer.from('Read TYPESAFE_API_KEY from the environment')));
});

test('standalone package verification detects tampering and rejects traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'team-integrity-'));
  try {
    await writeFile(join(root, 'sample.txt'), 'original synthetic fixture');
    const bytes = Buffer.from('original synthetic fixture');
    const expected = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(root, 'TEAM-PACKAGE.json'), JSON.stringify({ format: 'novel-team-playground-v1', files: { 'sample.txt': expected } }));
    assert.equal((await verifyPackage(root)).verifiedFiles, 1);
    await writeFile(join(root, 'sample.txt'), 'changed');
    await assert.rejects(verifyPackage(root), /checksum mismatch/);
    await writeFile(join(root, 'TEAM-PACKAGE.json'), JSON.stringify({ format: 'novel-team-playground-v1', files: { '../outside.txt': expected } }));
    await assert.rejects(verifyPackage(root), /Unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('allowlist includes source, not arbitrary data/config files or symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'team-allowlist-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'tools/pi-review/runtime'), { recursive: true });
    await writeFile(join(root, 'src/allowed.ts'), 'export const synthetic = true;');
    await writeFile(join(root, 'tools/pi-review/shared.d.mts'), 'export function synthetic(): void;');
    await writeFile(join(root, 'src/unapproved-data.json'), '{"private":"do not package"}');
    await writeFile(join(root, 'tools/pi-review/runtime/source.txt'), 'not publishable');
    await writeFile(join(root, '.env'), 'do not package');
    assert.deepEqual(await collectPackageFiles(root), ['src/allowed.ts', 'tools/pi-review/shared.d.mts']);
    await symlink(join(root, '.env'), join(root, 'src/linked.ts'));
    await assert.rejects(collectPackageFiles(root), /Symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
