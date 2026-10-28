import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RECENT_FACULTY_MS } from './live-activity.mjs';

const TELEMETRY_TAIL = 1024 * 1024;

/** The newest records of the library's call telemetry (atlas, universe causality); never its decisions. */
async function telemetryRecords(directory) {
  let file;
  try { file = await open(resolve(directory, 'telemetry', 'events.jsonl'), 'r'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  try {
    const { size } = await file.stat();
    const length = Math.min(size, TELEMETRY_TAIL);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift();
    return lines.filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } finally { await file.close(); }
}

/** One entry per library faculty, in the shape of a book's live faculties. */
export function libraryFaculties(records, now = Date.now()) {
  const calls = new Map();
  for (const record of records) {
    const event = record?.event;
    if (event?.type !== 'faculty.activity' || typeof event.callId !== 'string' || typeof event.faculty !== 'string') continue;
    const previous = calls.get(event.callId);
    calls.set(event.callId, { faculty: event.faculty, system: event.system, timestamp: record.timestamp, status: event.status === 'started' ? 'working' : event.status === 'completed' ? 'ok' : 'error', startedAt: event.status === 'started' ? record.timestamp : previous?.startedAt });
  }
  const faculties = new Map();
  for (const call of [...calls.values()].sort((first, second) => first.timestamp.localeCompare(second.timestamp))) {
    const id = `library:${call.system}:${call.faculty}`;
    const previous = faculties.get(id);
    faculties.set(id, { id, faculty: call.faculty, label: `Library · ${call.faculty}`, system: call.system, status: call.status, timestamp: call.timestamp, calls: (previous?.calls ?? 0) + 1, active: (previous?.active ?? 0) + (call.status === 'working' ? 1 : 0), startedAt: [previous?.startedAt, call.startedAt].filter(Boolean).sort().at(-1) });
  }
  return [...faculties.values()].map(({ startedAt, ...faculty }) => ({ ...faculty, status: faculty.active ? 'working' : faculty.status, recent: !!startedAt && now - Date.parse(startedAt) <= RECENT_FACULTY_MS }));
}

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
  return { ...view, bindings: safeBindings, causal, events, totalEvents: view.totalEvents + causal.totalEvents, faculties: libraryFaculties(await telemetryRecords(directory)) };
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

export function withLibraryLive(data, { faculties = [], ...library }) {
  const sourceId = library.bindings.find(binding => binding.volume === data.volume)?.sourceId ?? null;
  const last = library.events.at(-1);
  const journal = library.events.slice(-30).map(event => ({
    id: event.id, timestamp: event.timestamp, text: event.type.replaceAll('.', ' / '), tone: event.type.endsWith('approved') ? 'ok' : 'jev',
  }));
  // Library faculties join the book's live faculties, so the faculty graph lights them like any other.
  const activity = data.activity && faculties.length ? { ...data.activity, faculties: [...data.activity.faculties ?? [], ...faculties] } : data.activity;
  return { ...data, ...(activity ? { activity } : {}), world: { ...data.world, library, sourceId },
    libraryActivity: { count: library.totalEvents, latest: last ?? null },
    feed: [...(data.feed ?? []), ...journal].sort((left, right) => String(left.timestamp ?? '').localeCompare(String(right.timestamp ?? ''))).slice(-180) };
}
