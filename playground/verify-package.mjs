import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyPackage(directory) {
  const root = await realpath(resolve(directory));
  const manifest = JSON.parse(await readFile(join(root, 'TEAM-PACKAGE.json'), 'utf8'));
  if (manifest.format !== 'novel-team-playground-v1' || !manifest.files || Array.isArray(manifest.files)) throw new Error('Invalid team package manifest');
  const entries = Object.entries(manifest.files);
  if (!entries.length) throw new Error('Empty package manifest');
  for (const [relative, expected] of entries) {
    if (!relative || isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe package manifest path');
    const target = join(root, relative);
    if (await realpath(target) !== target) throw new Error(`Package symlink rejected: ${relative}`);
    const bytes = await readFile(target);
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`Package checksum mismatch: ${relative}`);
  }
  return { verifiedFiles: entries.length, format: manifest.format, note: 'Checksums verify integrity, not publisher identity or safety of unlisted files.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Usage: node playground/verify-package.mjs [extracted-package-root]');
  console.log(JSON.stringify(await verifyPackage(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url))), null, 2));
}
