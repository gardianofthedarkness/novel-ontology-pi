// A reading made before its kinds kept their distributions (M1, docs/v3/design.html#next-steps A6; the user, 2026-11-03: top
// distributions and scores kept for sentences): each sentence's whole distribution over the kinds and its top three,
// from the answers Jev gave in the reading's own decision cache. Nothing is asked again. The reading is rewritten in
// place, its former self kept beside it as data.before-kind-scores.json.
//   node engine/reading/kind-scores.mjs <reading>/v2/data.json <reading>/cache/decisions
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Jev's kind answers in a decision cache: sentence id → its answers (a sentence asked twice has two). */
export async function cachedKinds(cacheDir) {
  const out = new Map();
  for (const name of await readdir(cacheDir)) {
    const stored = JSON.parse(await readFile(join(cacheDir, name), 'utf8').catch(() => 'null'));
    for (const answer of Array.isArray(stored) ? stored : Object.values(stored ?? {})) {
      if (!answer || !/^dlg_kind:/.test(answer.key ?? '') || !answer.distribution) continue;
      const id = answer.key.slice('dlg_kind:'.length);
      (out.get(id) ?? out.set(id, []).get(id)).push(answer);
    }
  }
  return out;
}

const round = p => Number(p.toFixed(3));
/** The reading's kinds with their distributions and top three: the cached answer that gave the kind kept (by its score). */
export function withScores(kinds, cached) {
  let kept = 0, missing = 0;
  const out = Object.fromEntries(Object.entries(kinds).map(([id, entry]) => {
    const answers = cached.get(id) ?? [], given = entry.was ?? entry.kind;
    const answer = answers.find(item => item.value === given && round(item.confidence ?? 0) === round(entry.confidence ?? 0)) ?? answers.find(item => item.value === given) ?? answers[0];
    if (!answer) { missing++; return [id, entry]; }
    kept++;
    const distribution = Object.fromEntries(Object.entries(answer.distribution).map(([kind, p]) => [kind, round(p)]));
    return [id, { ...entry, top: Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 3), distribution }];
  }));
  return { kinds: out, kept, missing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [readingPath, cacheDir] = process.argv.slice(2);
  if (!readingPath || !cacheDir) { console.error('usage: node engine/reading/kind-scores.mjs <reading>/v2/data.json <reading>/cache/decisions'); process.exit(2); }
  const reading = JSON.parse(await readFile(readingPath, 'utf8')), { kinds, kept, missing } = withScores(reading.kinds, await cachedKinds(cacheDir));
  await copyFile(readingPath, readingPath.replace(/\.json$/, '.before-kind-scores.json'));
  await writeFile(readingPath, JSON.stringify({ ...reading, kinds }));
  console.log(JSON.stringify({ sentences: Object.keys(kinds).length, kept, missing }));
}
