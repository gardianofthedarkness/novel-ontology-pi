import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { preparePlayground, repository, fixtureDirectory } from './prepare.mjs';

const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const fixed = new Set(['README.md', 'LICENSE', 'DESIGN.md', 'playground/Dockerfile', 'playground/compose.yaml', 'playground/Dockerfile.dockerignore', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'apps/playground/package.json', 'apps/playground/package-lock.json', 'apps/playground/tsconfig.json', 'apps/playground/vite.config.ts', 'apps/playground/index.html', 'apps/playground/AGENTS.md', 'tools/pi-review/package.json', 'tools/pi-review/package-lock.json', 'tools/pi-review/job.example.json', 'playground/fixtures/lantern-harbor/story.json', 'playground/fixtures/lantern-harbor/DATASET_CARD.md',
  // Places: the baked hologram buildings, and the pictures the stage faculty shows Jev (one per kind).
  'apps/playground/src/data/architectureModels.json', ...['castle', 'church', 'city', 'home', 'hospital', 'market', 'office', 'park', 'school', 'skyscraper', 'station', 'village'].map(kind => `assets/architecture/${kind}.png`)]);
const sourceRoots = ['src', 'test', 'skills/novel-ontology', 'skills/novel-library', 'apps/playground/src', 'tools/pi-review', 'playground'];
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.mjs', '.py', '.css', '.html', '.md', '.svg']);
const forbidden = /(?:^|\/)(?:node_modules|\.git|private|runtime|__pycache__|\.pi-review|\.team-playground)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:epub|lbug(?:\..*)?|log)$/i;

export function assertPublishable(relative, bytes) {
  if (forbidden.test(relative)) throw new Error(`Private/generated path is not publishable: ${relative}`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9]{32,}\b|\/view\/[A-Za-z0-9_-]{43}\//.test(bytes.toString('utf8'))) throw new Error(`Secret-shaped content needs manual review: ${relative}`);
}

export async function collectPackageFiles(root = repository) {
  const selected = new Set();
  const add = async relative => {
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Package inputs must be regular files: ${relative}`);
    const bytes = await readFile(join(root, relative));
    assertPublishable(relative, bytes);
    selected.add(relative);
  };
  for (const relative of fixed) {
    try { await add(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const walk = async relative => {
    if (forbidden.test(relative)) return;
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const filename = `${relative}/${entry.name}`;
      if (forbidden.test(filename)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlink excluded from share package: ${filename}`);
      if (entry.isDirectory()) await walk(filename);
      else if (sourceExtensions.has(extname(filename))) await add(filename);
    }
  };
  for (const directory of sourceRoots) {
    try { await walk(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...selected].sort();
}

export async function exportPackage(destination) {
  process.umask(0o077);
  const target = resolve(destination);
  if (!target.endsWith('.tar.gz')) throw new Error('Choose a new .tar.gz output path');
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const reservation = await open(target, 'wx', 0o600);
  await reservation.close();
  const staging = await mkdtemp(join(tmpdir(), 'novel-team-package-'));
  try {
    const output = join(staging, 'novel-ontology-pi');
    await mkdir(output);
    const selected = await collectPackageFiles();
    for (const relative of selected) {
      await mkdir(dirname(join(output, relative)), { recursive: true });
      await copyFile(join(repository, relative), join(output, relative));
    }
    const prepared = await preparePlayground(join(staging, 'synthetic-data'));
    const dataset = join(output, 'datasets/lantern-harbor-v1');
    const bundleFiles = ['source/lantern-harbor.txt', 'ontology/manifest.json', 'ontology/entities.jsonl', 'ontology/relations.jsonl', 'ontology/events.jsonl', 'ontology/scenes.jsonl', 'ontology/timelines.jsonl', 'ontology/branches.jsonl'];
    for (const filename of bundleFiles) {
      const relative = `datasets/lantern-harbor-v1/bundle/${filename}`;
      await mkdir(dirname(join(output, relative)), { recursive: true });
      await copyFile(join(prepared.reference, filename), join(output, relative));
      selected.push(relative);
    }
    for (const filename of await readdir(prepared.metadata)) {
      const relative = `datasets/lantern-harbor-v1/metadata/${filename}`;
      await mkdir(dirname(join(output, relative)), { recursive: true });
      await copyFile(join(prepared.metadata, filename), join(output, relative));
      selected.push(relative);
    }
    await copyFile(join(fixtureDirectory, 'DATASET_CARD.md'), join(dataset, 'README.md'));
    await copyFile(join(prepared.home, 'dataset-manifest.json'), join(dataset, 'manifest.json'));
    selected.push('datasets/lantern-harbor-v1/README.md', 'datasets/lantern-harbor-v1/manifest.json');
    const files = {};
    for (const relative of selected.sort()) {
      const bytes = await readFile(join(output, relative));
      assertPublishable(relative, bytes);
      files[relative] = { sha256: hash(bytes), bytes: bytes.length };
    }
    const manifest = { format: 'novel-team-playground-v1', createdAt: new Date().toISOString(), baseGitRevision: prepared.manifest.gitRevision, fixtureId: prepared.manifest.fixtureId, note: 'Exact checksums describe this package, including uncommitted source. No private novels, runtime state, provider credentials, operator capabilities or native graph database are included.', files };
    await writeFile(join(output, 'TEAM-PACKAGE.json'), JSON.stringify(manifest, null, 2));
    await execute('tar', ['-czf', target, '-C', staging, 'novel-ontology-pi']);
    return { archive: target, sha256: hash(await readFile(target)), sourceFiles: selected.length, fixture: prepared.manifest.counts, modelCalls: 0 };
  } catch (error) { await rm(target, { force: true }); throw error; }
  finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('Usage: node playground/export-package.mjs --out /private/new-team-playground.tar.gz');
  console.log(JSON.stringify(await exportPackage(values.out), null, 2));
}
