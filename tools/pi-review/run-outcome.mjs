export function runOutcome(changesets, records, expectedChapters = 2, unit = 'chapters') {
  const applications = new Map();
  for (const record of records) {
    const event = record.event ?? record;
    if (event.type === 'changeset.applied') applications.set(event.changesetId, event);
  }
  const held = changesets.filter((changeset) => ['held', 'revision_requested'].includes(changeset.status)).map((changeset) => changeset.id);
  const approved = changesets.filter((changeset) => changeset.status === 'approved');
  const applied = approved.filter((changeset) => applications.has(changeset.id));
  const deferred = applied.reduce((total, changeset) => total + applications.get(changeset.id).unsupportedProposalIds.length, 0);
  const heldFacts = applied.reduce((total, changeset) => total + (applications.get(changeset.id).deferredFactIds?.length ?? 0), 0);
  const unsupported = (deferred ? ` · ${deferred} proposals deferred` : '') + (heldFacts ? ` · ${heldFacts} semantic facts held` : '');
  const progress = `${applied.length}/${expectedChapters} ${unit} applied`;
  if (held.length) return { status: 'review', label: `Pi paused · ${held.join(', ')} held · ${progress}${unsupported}`, held, applied: applied.length, deferred };
  if (applied.length === expectedChapters) return { status: 'complete', label: `${heldFacts ? 'Pi processing complete' : 'Pi review complete'} · ${progress}${unsupported}`, held, applied: applied.length, deferred, heldFacts };
  return { status: 'review', label: `Pi stopped · ${progress} · needs attention${unsupported}`, held, applied: applied.length, deferred };
}

/**
 * The console's after-turn line: the book Pi last worked on and, for a
 * multi-book job, all books — counting blocks applied before this session
 * too. (Counting only the blocks this session was assigned read "0/305
 * applied" right after finishing a book that was already complete.)
 * `volumes` are the job's volumes (`maxBlocks` = the book's blocks, `blocks`
 * = those still unapplied when the session started); `states` are the
 * session's block states (jobState).
 */
export function progressLine(volumes, states, activeVolume) {
  const appliedIn = (volume) => volume.maxBlocks - volume.blocks.length + states.filter(state => state.volume === volume.id && state.applied).length;
  const active = volumes.find(volume => volume.id === activeVolume) ?? volumes[0];
  const book = `Vol ${active.id}: ${appliedIn(active)}/${active.maxBlocks} blocks applied`;
  const all = volumes.length > 1 ? ` · all ${volumes.length} books: ${volumes.reduce((sum, volume) => sum + appliedIn(volume), 0)}/${volumes.reduce((sum, volume) => sum + volume.maxBlocks, 0)}` : '';
  return `${book}${all} · ${states.reduce((sum, state) => sum + state.deferredFacts, 0)} semantic facts held · ${states.reduce((sum, state) => sum + state.deferred, 0)} proposals deferred`;
}
