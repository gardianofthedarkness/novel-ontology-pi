// A faculty call that started this recently still counts as live work: many
// System 1 calls start and finish between two viewer polls.
export const RECENT_FACULTY_MS = 5000;

export function liveActivity({ processing, agent, drafts, changesets, interiors, blockChapters, afterId, reviewProgress, now = Date.now() }) {
  const visible = new Set(Object.values(interiors).flatMap(graph => graph.nodes.map(node => node.id)));
  const proposals = new Map(changesets.flatMap(packet => packet.proposals.map(proposal => [proposal.id, proposal])));
  const calls = new Map();
  for (const record of agent) {
    if (!record.provider || !record.call) continue;
    const key = `${record.provider}:${record.call}`;
    calls.set(key, { ...calls.get(key), ...record, label: record.label || calls.get(key)?.label });
  }
  for (const record of processing) {
    const event = record.event;
    if (event.type !== 'faculty.activity') continue;
    const key = `cli:${event.blockId}:${event.callId}`;
    calls.set(key, { ...event, timestamp: record.timestamp, startedAt: event.status === 'started' ? record.timestamp : calls.get(key)?.startedAt, provider: event.system, status: event.status === 'started' ? 'working' : event.status === 'completed' ? 'ok' : 'error', label: `${event.system === 'system1' ? 'System 1 / Jev' : event.system === 'system2' ? 'System 2 fallback' : 'CLI extraction'} · ${event.faculty}` });
  }
  const faculties = new Map();
  for (const record of [...calls.values()].sort((first, second) => first.timestamp.localeCompare(second.timestamp))) {
    const faculty = record.faculty ?? (record.provider === 'jev' ? record.label?.split(' · ')[1] ?? 'decisions' : record.provider === 'pi' ? 'Pi review' : 'CLI work model');
    const key = `${record.provider}:${faculty}`;
    const previous = faculties.get(key);
    const startedAt = [previous?.startedAt, record.startedAt].filter(Boolean).sort().at(-1);
    faculties.set(key, { id: key, faculty, label: record.label ?? faculty, system: record.provider, status: record.status, timestamp: record.timestamp, calls: (previous?.calls ?? 0) + 1, active: (previous?.active ?? 0) + (record.status === 'working' ? 1 : 0), blockId: record.blockId ?? previous?.blockId, startedAt });
  }
  // Where each faculty works: its block's chapter and the newest visible draft
  // scene of that block (faculty events name a block, not records).
  const draftScenes = blockId => [...visible].filter(id => id.startsWith(`draft:${blockId}:scene:`)).sort((first, second) => Number(first.split(':').at(-1)) - Number(second.split(':').at(-1)));
  for (const faculty of faculties.values()) {
    if (faculty.active) faculty.status = 'working';
    faculty.recent = !!faculty.startedAt && now - Date.parse(faculty.startedAt) <= RECENT_FACULTY_MS;
    if (faculty.blockId) {
      faculty.chapterId = `chapter_${blockChapters.get(faculty.blockId) ?? 0}`;
      faculty.anchorIds = draftScenes(faculty.blockId).slice(-1);
    }
    delete faculty.startedAt;
  }
  let latestTouch = null;
  const touches = [];
  let activeBlock = null;
  const afterIndex = afterId ? processing.findIndex(record => record.id === afterId) : -1;
  for (const [index, record] of processing.entries()) {
    const event = record.event;
    if (event.type === 'block.started') activeBlock = event.blockId;
    let ids = event.touchedIds ?? [];
    if (event.type === 'entity.merged') ids = [event.keepId];
    if (event.type === 'proposal.added') {
      const proposal = proposals.get(event.proposal.id);
      ids = [proposal?.payload?.needsExtraction ? `draft:${proposal.id}` : proposal?.payload?.id].filter(Boolean);
    }
    const nodeIds = ids.filter(id => visible.has(id));
    const nodeId = nodeIds.at(-1);
    if (nodeId) {
      latestTouch = { id: `${record.id}:${nodeId}`, nodeId, timestamp: record.timestamp, faculty: event.faculty ?? event.patchId ?? event.proposal?.provenance?.patchId ?? 'CLI', precision: ids.length > 1 ? 'batch' : 'record' };
      touches.push({ index, id: record.id, nodeIds, timestamp: record.timestamp, faculty: latestTouch.faculty, chapterId: `chapter_${blockChapters.get(event.blockId ?? activeBlock) ?? 0}` });
    }
  }
  const changed = afterIndex < 0 ? touches.slice(-1) : touches.filter(touch => touch.index > afterIndex);
  const batch = changed.length ? { id: changed.at(-1).id, nodeIds: [...new Set(changed.flatMap(touch => touch.nodeIds))], chapterIds: [...new Set(changed.map(touch => touch.chapterId))], faculties: [...new Set(changed.map(touch => touch.faculty))], timestamp: changed.at(-1).timestamp } : null;
  const construction = [...drafts].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))[0];
  const blockId = construction?.blockId ?? processing.findLast(record => record.event.type === 'block.started')?.event.blockId;
  const terminal = agent.findLast(record => record.type === 'pi.status');
  const command = agent.findLast(record => record.type === 'pi.command');
  const review = reviewProgress ? Object.fromEntries(['id', 'timestamp', 'volume', 'chapterIndex', 'blockId', 'changesetId', 'phase', 'status', 'sourceStart', 'sourceEnd', 'revision', 'totalFacts', 'inspectedFacts', 'factIds', 'factPositions', 'proposalIds', 'fields', 'offset', 'pageCount', 'total', 'accepted', 'rejected', 'held', 'unreviewed'].filter(key => reviewProgress[key] !== undefined).map(key => [key, reviewProgress[key]])) : null;
  if (review) {
    review.active = terminal?.status === 'working' && review.timestamp >= terminal.timestamp;
    const proposalIds = new Set([...(review.proposalIds ?? []), ...(review.factIds ?? []).map(id => id.split('/')[0])]);
    review.nodeIds = [...new Set([...proposalIds].flatMap(id => {
      const payload = proposals.get(id)?.payload;
      return payload ? [payload.id, payload.fromId, payload.toId, payload.entityId, payload.characterId, payload.afterEventId].filter(id => visible.has(id)) : [];
    }))];
  }
  const identityEvents = processing.filter(record => ['entity.merged', 'entity.distinct'].includes(record.event.type)).map(record => ({ id: record.id, timestamp: record.timestamp, event: record.event.type === 'entity.merged' ? { type: 'entity.merged', keepId: record.event.keepId, dropId: record.event.dropId } : { type: 'entity.distinct', aId: record.event.aId, bId: record.event.bId } }));
  // A new candidate that extraction resolved glides into what it became.
  for (const draft of drafts) for (const candidate of draft.entityCandidates ?? []) {
    if (candidate.status !== 'new' || !candidate.resolvedId) continue;
    identityEvents.push({ id: `candidate:${draft.blockId}:${candidate.key}`, timestamp: draft.updatedAt, event: { type: 'candidate.resolved', keepId: candidate.resolvedId, dropId: `draft:${draft.blockId}:entity:${candidate.key}` } });
  }
  return {
    cursor: processing.at(-1)?.id ?? null,
    batch,
    count: processing.filter(record => ['draft.updated', 'proposal.added', 'entity.merged'].includes(record.event.type)).length,
    chapterId: `chapter_${review?.active ? review.chapterIndex : blockChapters.get(blockId) ?? 0}`,
    blockId: review?.active ? review.blockId : blockId ?? null,
    phase: review?.active ? `Pi review · ${review.changesetId} · ${review.phase} · ${review.status}${review.total != null && review.offset != null ? ` · ${review.offset + 1}–${Math.min(review.offset + review.pageCount, review.total)} / ${review.total}` : ''}` : terminal?.status === 'complete' ? 'Processing complete · last construction state; no extraction is currently running' : terminal?.status === 'error' ? 'Processor stopped · last construction state' : terminal?.status === 'idle' ? terminal.label ?? 'Pi ready · waiting for your message' : construction?.stage === 'gate' ? `Pi review · ${command?.label ?? 'checking semantic facts'} · ${command?.status ?? 'working'}` : construction ? `${construction.patchId} · live construction` : terminal?.label ?? 'Waiting for extraction',
    review,
    latestTouch,
    faculties: [...faculties.values()].sort((first, second) => second.timestamp.localeCompare(first.timestamp)).slice(0, 16),
    identityEvents,
    telemetryNote: processing.some(record => record.event.type === 'faculty.activity') ? null : 'This running version records work-model calls, but not their fallback faculty. System 2 is not separately identifiable in this session.',
  };
}
