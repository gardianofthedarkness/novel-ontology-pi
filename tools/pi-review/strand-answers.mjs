import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The latest answered strands report of a workspace (`novel timeplace
 * strands --ask`): who is present where a question was asked, and the scenes
 * that stand alone (nobody known there, someone else is). The story view
 * draws strands from these casts instead of borrowing. A view input, not
 * canon; a report without answers (a plan only) is skipped.
 */
export async function readStrandAnswers(workspace) {
  const folder = resolve(workspace, 'timeplace');
  const names = (await readdir(folder).catch(() => [])).filter(name => /^strands-[\w-]+\.json$/.test(name)).sort().reverse();
  for (const name of names) {
    const report = await readFile(resolve(folder, name), 'utf8').then(JSON.parse, () => null);
    if (!report?.after) continue;
    const casts = report.casts && typeof report.casts === 'object' ? report.casts : {};
    return { casts: Object.fromEntries(Object.entries(casts).filter(([, ids]) => Array.isArray(ids)).map(([id, ids]) => [id, ids.filter(value => typeof value === 'string')])), alone: Array.isArray(report.alone) ? report.alone.filter(value => typeof value === 'string') : [] };
  }
  return null;
}
