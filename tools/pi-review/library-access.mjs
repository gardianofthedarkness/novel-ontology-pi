import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export async function createLibraryAccess(config, volumes) {
  if (!config) return null;
  const { libraryShow, libraryPlan, libraryReviewItems } = await import('../../dist/src/ground/workspace/library.js');
  const directory = resolve(config.directory);
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) throw new Error('Assigned library must be a regular canonical directory');
  const identities = new Map();
  for (const binding of config.bindings) {
    const volume = volumes.find(entry => entry.id === binding.volume);
    const hash = volume?.album?.sha256 ?? (volume && createHash('sha256').update(await readFile(volume.input)).digest('hex'));
    if (`doc_${hash}` !== binding.sourceId) throw new Error('Library source does not match the assigned input/EPUB identity');
    identities.set(binding.sourceId, hash);
  }
  let revision;
  const metadata = new Map(), evidence = new Map(), plans = new Map();
  const verify = async () => {
    const catalog = await libraryShow(directory);
    if (catalog.sources.length !== identities.size || catalog.sources.some(source => identities.get(source.id) !== source.sha256)) throw new Error('Library source scope changed; start a newly authorized job');
    if (revision !== catalog.revision) { revision = catalog.revision; metadata.clear(); evidence.clear(); plans.clear(); }
    return catalog;
  };
  await verify();
  const observed = support => {
    if (support.field !== 'text') return metadata.get(support.sourceId)?.[support.field]?.includes(support.quote) === true;
    const pages = [...(evidence.get(support.sourceId) ?? [])].sort((first, second) => first.offset - second.offset);
    let covered = support.offset;
    const end = support.offset + support.quote.length;
    for (const page of pages) {
      const start = Math.max(covered, page.offset), stop = Math.min(end, page.offset + page.text.length);
      if (start > covered || stop <= covered) continue;
      if (page.text.slice(start - page.offset, stop - page.offset) !== support.quote.slice(start - support.offset, stop - support.offset)) return false;
      covered = stop;
      if (covered >= end) return true;
    }
    return false;
  };
  return {
    config: { directory, bindings: config.bindings, operations: ['show', 'evidence', 'propose', 'plan', 'decide', 'history'], registration: 'host-only', preparation: 'host-only' },
    async before(args, skillsRead) {
      const catalog = await verify();
      if (args[1] !== 'decide') return null;
      const plan = await libraryPlan(directory, args[3]);
      if (plan.stale || plan.revision !== args[args.indexOf('--revision') + 1]) throw new Error('Read the current library plan revision; stale decisions are unavailable');
      const items = libraryReviewItems(plan.organization);
      const inspected = plans.get(plan.revision);
      if (!skillsRead || inspected?.size !== items.length) throw new Error('Read the library skill/schema and EVERY current plan page before deciding');
      const decision = args[args.indexOf('--decision') + 1];
      if (decision === 'approve' && items.some(item => (item.value.evidence ?? []).some(support => !observed(support)))) throw new Error('Read every cited source title/filename or exact text evidence page before approving organization');
      return { planId: plan.id, revision: plan.revision, baseRevision: catalog.revision, inspectedItems: inspected.size, totalItems: items.length, decision };
    },
    async credit(args, output) {
      const catalog = await verify();
      let page;
      try { page = JSON.parse(output); } catch { return; }
      if (args[1] === 'show' && page.revision === catalog.revision) {
        for (const item of page.items ?? []) if (item.type === 'source') {
          const actual = catalog.sources.find(source => source.id === item.value?.id);
          if (actual && actual.title === item.value.title && actual.filename === item.value.filename) metadata.set(actual.id, { title: actual.title, filename: actual.filename });
        }
      }
      if (args[1] === 'evidence' && page.revision === catalog.revision && page.source?.id === args[3] && typeof page.text === 'string' && Number.isSafeInteger(page.offset) && page.offset >= 0) evidence.set(page.source.id, [...(evidence.get(page.source.id) ?? []), { offset: page.offset, text: page.text }]);
      if (args[1] === 'plan') {
        const plan = await libraryPlan(directory, args[3]);
        const items = libraryReviewItems(plan.organization);
        const offset = page.page?.offset, limit = page.page?.limit;
        if (plan.stale || page.id !== plan.id || page.revision !== plan.revision || page.baseRevision !== catalog.revision || page.stale || page.page?.total !== items.length || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || JSON.stringify(page.items) !== JSON.stringify(items.slice(offset, offset + limit))) return;
        const covered = plans.get(plan.revision) ?? new Set();
        for (let index = offset; index < Math.min(offset + limit, items.length); index++) covered.add(index);
        plans.set(plan.revision, covered);
      }
    },
  };
}
