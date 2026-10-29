import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The stage reports the Places map reads (view inputs, not canon): each
 * place's picked building (novel stage architecture) and the buildings the
 * story names in each staged scene (novel stage objects). Null before the
 * report exists or when it cannot be read.
 */
const report = (workspace, name) => readFile(resolve(workspace, 'stage', `${name}.json`), 'utf8').then(JSON.parse, () => null);

/** Place id → picked kind or "none". */
export async function readArchitecture(workspace) {
  const picks = (await report(workspace, 'architecture'))?.places;
  return picks ? Object.fromEntries(Object.entries(picks).filter(([, pick]) => typeof pick?.kind === 'string').map(([id, pick]) => [id, pick.kind])) : null;
}

/** Named buildings, one row per mention: {sceneId, name, model (a building kind the stage can draw, or null), size}. */
export async function readStageBuildings(workspace) {
  const scenes = (await report(workspace, 'objects'))?.scenes;
  if (!scenes || typeof scenes !== 'object') return null;
  return Object.entries(scenes).flatMap(([sceneId, entry]) => (Array.isArray(entry?.objects) ? entry.objects : [])
    .filter(thing => thing?.kind === 'building' && typeof thing.name === 'string' && thing.name.trim())
    .map(thing => ({ sceneId, name: thing.name.trim(), model: thing.match?.kind === 'building' && typeof thing.match.id === 'string' ? thing.match.id : null, size: Number.isFinite(thing.size) ? thing.size : null })));
}
