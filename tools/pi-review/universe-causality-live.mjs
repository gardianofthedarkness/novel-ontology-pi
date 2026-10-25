import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { causalSource } from '../../dist/src/solidifier/causality/evidence.js';
import { universeCausalView } from '../../dist/src/solidifier/causality/universe.js';

export async function readUniverseCausalityLive(directory, bindings = [], resolveWorkspace) {
  const packets = await readdir(resolve(directory, 'causality/packets')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (!packets.length) return { links: [], events: [], totalEvents: 0, totalPackets: 0, invalidPackets: 0, omittedPackets: 0, generation: 0 };
  let config;
  if (resolveWorkspace) {
    config = { directory: resolve(directory), bindings: await Promise.all(bindings.map(async binding => {
      const workspace = await resolveWorkspace(String(binding.volume));
      const hasUnits = await Promise.all(['events', 'scenes'].map(name => readFile(resolve(workspace, `ontology/${name}.jsonl`), 'utf8').then(text => !!text.trim(), error => { if (error.code === 'ENOENT') return false; throw error; })));
      return { sourceId: binding.sourceId, workspace, inputSha256: hasUnits.some(Boolean) ? (await causalSource(workspace)).hash : '0'.repeat(64) };
    })) };
  }
  return universeCausalView(directory, config);
}
