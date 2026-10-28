// The precomputed spiral timeline for the story view: stored geometry only
// (solved offline by `novel calendar build`), with scene ids renamed to the
// ones the projection uses. Null when nothing has been built yet.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * root: the library (or the standalone book); universeId: its universe ("book"
 * when standalone); rename(sourceId, sceneId) → the view's scene id, or null
 * for a book the view does not show.
 */
export async function readSpiral(root, universeId, rename) {
  let file;
  try { file = JSON.parse(await readFile(join(resolve(root), 'calendar', `${universeId}.spiral.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  if (file?.version !== 1 || !Array.isArray(file.continuities)) return null;
  const view = (qualified) => { const at = String(qualified).indexOf('::'); return at < 0 ? null : rename(qualified.slice(0, at), qualified.slice(at + 2)); };
  const runs = [], links = [], days = [];
  file.continuities.forEach((continuity, lane) => {
    for (const run of continuity.runs) {
      const knots = run.knots.flatMap((knot) => { const id = view(knot.id); return id ? [{ id, x: knot.x, q: knot.q }] : []; });
      if (!knots.length) continue;
      runs.push({ id: run.id, lane, color: run.color, tube: run.tube, knots, track: run.track, axis: run.axis });
    }
    for (const link of continuity.links) { const from = view(link.from), to = view(link.to); if (from && to) links.push({ from, to, lane }); }
    for (const day of continuity.days) days.push({ ...day, lane });
  });
  return runs.length ? { builtAt: file.builtAt, scale: file.scale, runs, links, days } : null;
}
