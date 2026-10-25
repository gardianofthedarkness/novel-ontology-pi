import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readLibraryLive(directory, bindings = [], readView, resolveWorkspace) {
  const reader = readView ?? (await import('../../dist/src/ground/workspace/library.js')).libraryView;
  const view = await reader(resolve(directory));
  const known = new Set(view.sources.map(source => source.id));
  const seen = new Set();
  const volumes = new Set();
  const safeBindings = bindings.map(binding => {
    if (!known.has(binding.sourceId) || !Number.isSafeInteger(binding.volume) || binding.volume < 1 || seen.has(binding.sourceId) || volumes.has(binding.volume)) throw new Error('Invalid library source binding');
    seen.add(binding.sourceId);
    volumes.add(binding.volume);
    return { sourceId: binding.sourceId, volume: binding.volume };
  });
  const { readUniverseCausalityLive } = await import('./universe-causality-live.mjs');
  const causal = await readUniverseCausalityLive(directory, safeBindings, resolveWorkspace);
  const events = [...view.events, ...causal.events].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  return { ...view, bindings: safeBindings, causal, events, totalEvents: view.totalEvents + causal.totalEvents };
}

export async function configuredLibraryBindings(volumes, root) {
  const bindings = [];
  for (const volume of volumes) {
    try {
      const identity = JSON.parse(await readFile(resolve(root, volume.workspace, 'ontology/library-source.json'), 'utf8'));
      if (!/^doc_[a-f0-9]{64}$/.test(identity.documentId)) throw new Error('Invalid workspace source identity');
      bindings.push({ sourceId: identity.documentId, volume: volume.id });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return bindings;
}

export function withLibraryLive(data, library) {
  const sourceId = library.bindings.find(binding => binding.volume === data.volume)?.sourceId ?? null;
  const last = library.events.at(-1);
  const journal = library.events.slice(-30).map(event => ({
    id: event.id, timestamp: event.timestamp, text: event.type.replaceAll('.', ' / '), tone: event.type.endsWith('approved') ? 'ok' : 'jev',
  }));
  return { ...data, world: { ...data.world, library, sourceId },
    libraryActivity: { count: library.totalEvents, latest: last ?? null },
    feed: [...(data.feed ?? []), ...journal].sort((left, right) => String(left.timestamp ?? '').localeCompare(String(right.timestamp ?? ''))).slice(-180) };
}
