import { readFile, readdir } from 'node:fs/promises';

/**
 * Time-place packets Pi may review through the shared gate: pending
 * `cs_timeplace_*` changesets written by `novel timeplace run --propose`,
 * carrying their original sentences, and holding only time/place facts
 * (TimePoint and Location identities, OCCURS_DURING, LOCATED_AT and the
 * place tree's PART_OF). `place-tree` packets come from the place-tree sweep.
 */
const packetId = /^cs_timeplace_[A-Za-z0-9_-]+_\d+$/;
const kinds = new Set(['TimePoint', 'Location']);
const relations = new Set(['OCCURS_DURING', 'LOCATED_AT', 'PART_OF']);
const timePlaceFact = proposal => proposal.kind === 'upsert_entity' ? kinds.has(proposal.payload?.kind) : proposal.kind === 'add_relation' && relations.has(proposal.payload?.type);

export async function timePlaceChangesetIds(workspace) {
  const names = await readdir(`${workspace}/changesets`).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const ids = [];
  for (const name of names.filter(name => name.endsWith('.json') && packetId.test(name.slice(0, -5)))) {
    const packet = JSON.parse(await readFile(`${workspace}/changesets/${name}`, 'utf8'));
    if (packet.id !== name.slice(0, -5) || !/^(?:time-place(-ch\d+)?|place-tree)$/.test(packet.blockId ?? '') || !packet.reviewSource?.length || !packet.proposals?.length || !packet.proposals.every(timePlaceFact)) continue;
    ids.push(packet.id);
  }
  return ids;
}

/**
 * Stage-objects packets Pi may review through the same gate: pending
 * `cs_stage_objects_*` changesets written by `novel stage objects`, carrying
 * their original sentences, and holding only what the book says about its
 * named buildings and things: Location and Item records, new name forms of
 * them, a building's PART_OF place and a thing's MENTIONED_IN scenes.
 */
const objectsPacketId = /^cs_stage_objects_\d+$/;
const objectFact = proposal => proposal.kind === 'upsert_entity' ? ['Location', 'Item'].includes(proposal.payload?.kind) && proposal.payload?.properties?.source === 'stage-objects'
  : proposal.kind === 'add_alias' ? typeof proposal.payload?.entityId === 'string' && typeof proposal.payload?.aliasText === 'string'
  : proposal.kind === 'add_relation' && ['PART_OF', 'MENTIONED_IN'].includes(proposal.payload?.type);

export async function stageObjectsChangesetIds(workspace) {
  const names = await readdir(`${workspace}/changesets`).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const ids = [];
  for (const name of names.filter(name => name.endsWith('.json') && objectsPacketId.test(name.slice(0, -5)))) {
    const packet = JSON.parse(await readFile(`${workspace}/changesets/${name}`, 'utf8'));
    if (packet.id !== name.slice(0, -5) || packet.blockId !== 'stage-objects' || !packet.reviewSource?.length || !packet.proposals?.length || !packet.proposals.every(objectFact)) continue;
    ids.push(packet.id);
  }
  return ids;
}
