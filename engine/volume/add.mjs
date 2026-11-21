// The next book of a world library, set up for the volume runner (volume.mjs): until now done by hand for vol-1 and vol-2.
// From an EPUB (or a text file): its text (the EPUB's spine in reading order, as the folder's own reader gives it) into
// <library>/inputs/f_<id>.txt, a fresh book folder <library>/vol-N/novel with that text, its source record and its
// manifest (the previous book's, with the new book's id and title), and the job's entry. f_<id> is the first 12 hex of the
// file's sha256, as everywhere else (src/library/folder.ts). Nothing is read by a model: the reading is the runner's.
//
//   node engine/volume/add.mjs <library> <epub or txt> [--dry]
// Refuses a book the job already has, or a book folder already there.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function addBook(libraryDir, bookFile, { dry = false } = {}) {
  const library = resolve(libraryDir), file = resolve(bookFile), jobFile = join(library, 'job.json');
  const job = existsSync(jobFile) ? await json(jobFile) : { volumes: [] };
  if (job.volumes.some((v) => resolve(v.epub ?? '') === file)) throw new Error(`the job already has ${basename(file)}`);
  const n = Math.max(0, ...job.volumes.map((v) => Number(v.id) || 0)) + 1;
  const book = `vol-${n}`, novel = join(library, book, 'novel');
  if (existsSync(join(library, book))) throw new Error(`${book} is already there`);

  const { readBook } = await import(pathToFileURL(join(repository, 'story-graph/dist/src/library/folder.js')).href);
  const bytes = await readFile(file), id = `f_${sha(bytes).slice(0, 12)}`;
  const kind = extname(file).toLowerCase() === '.epub' ? 'epub' : 'text';
  const { title, text } = readBook(bytes, kind, file);
  if (!text.trim()) throw new Error(`no text in ${basename(file)}`);
  const textSha = sha(Buffer.from(text, 'utf8'));

  // The manifest as the books before had it (models, embedding), the new book's id and title.
  const before = job.volumes.at(-1)?.workspace, prior = [before && join(dirname(before), 'novel.source', 'ontology', 'manifest.json'), before && join(before, 'ontology', 'manifest.json')].find((f) => f && existsSync(f));
  const base = prior ? await json(prior) : { schemaVersion: 1, sourceLanguages: [], embeddingModel: 'BAAI/bge-small-zh-v1.5', embeddingDimension: 512, decisionModel: 'jev-1.14.0', worldFirst: true };
  const manifest = { ...base, novelId: `novel_${randomUUID()}`, title, blocksProcessed: 0 };
  const source = { version: 1, sourceId: `source_${textSha}`, sha256: textSha, file: `${id}.txt`, blockSize: 24000 };
  const entry = { id: n, input: join(library, 'inputs', `${id}.txt`), workspace: novel, epub: file.replace(/\\/g, '/') };
  const plan = { book, id, title, chars: text.length, entry };
  if (dry) return { dry: true, ...plan };

  await mkdir(join(library, 'inputs'), { recursive: true });
  await mkdir(join(novel, 'source'), { recursive: true });
  await mkdir(join(novel, 'ontology'), { recursive: true });
  await writeFile(entry.input, text, 'utf8');
  await writeFile(join(novel, 'source', `${id}.txt`), text, 'utf8');
  await writeFile(join(novel, 'ontology', 'source.json'), JSON.stringify(source, null, 2));
  await writeFile(join(novel, 'ontology', 'manifest.json'), JSON.stringify(manifest, null, 2));
  job.volumes.push(entry);
  await writeFile(jobFile, JSON.stringify(job, null, 2));
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), [library, bookFile] = args.filter((a) => !a.startsWith('--'));
  if (!library || !bookFile) { console.error('usage: node engine/volume/add.mjs <library> <epub or txt> [--dry]'); process.exit(2); }
  console.log(JSON.stringify(await addBook(library, bookFile, { dry: args.includes('--dry') }), null, 1));
}
