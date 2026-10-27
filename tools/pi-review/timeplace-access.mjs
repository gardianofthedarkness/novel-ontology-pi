import { readFile, readdir } from 'node:fs/promises';

/**
 * Time-place packets Pi may review through the shared gate: pending
 * `cs_timeplace_*` changesets written by `novel timeplace run --propose`,
 * carrying their original sentences, and holding only time/place facts
 * (TimePoint and Location identities, OCCURS_DURING and LOCATED_AT).
 */
const packetId = /^cs_timeplace_[A-Za-z0-9_-]+_\d+$/;
const kinds = new Set(['TimePoint', 'Location']);
const relations = new Set(['OCCURS_DURING', 'LOCATED_AT']);
const timePlaceFact = proposal => proposal.kind === 'upsert_entity' ? kinds.has(proposal.payload?.kind) : proposal.kind === 'add_relation' && relations.has(proposal.payload?.type);

export async function timePlaceChangesetIds(workspace) {
  const names = await readdir(`${workspace}/changesets`).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const ids = [];
  for (const name of names.filter(name => name.endsWith('.json') && packetId.test(name.slice(0, -5)))) {
    const packet = JSON.parse(await readFile(`${workspace}/changesets/${name}`, 'utf8'));
    if (packet.id !== name.slice(0, -5) || !/^time-place(-ch\d+)?$/.test(packet.blockId ?? '') || !packet.reviewSource?.length || !packet.proposals?.length || !packet.proposals.every(timePlaceFact)) continue;
    ids.push(packet.id);
  }
  return ids;
}
