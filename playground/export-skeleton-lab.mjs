// The skeleton lab as one page: the compiled skeleton model (apps/playground/src/data/skeleton.ts) inlined into
// playground/skeleton-lab.html. Generated buildings only; no book data.
//   npm run build && node playground/export-skeleton-lab.mjs <out.html>
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
if (!out) throw new Error('Usage: node playground/export-skeleton-lab.mjs <out.html>');
const model = await readFile(`${repository}/dist/apps/playground/src/data/skeleton.js`, 'utf8');
const page = (await readFile(`${repository}/playground/skeleton-lab.html`, 'utf8')).replace('// @skeleton-module', () => model.replace(/<\/script/gi, '<\\/script'));
await writeFile(out, page);
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(page) }));
