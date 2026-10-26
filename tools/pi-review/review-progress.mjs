import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { authorize } from './guard.mjs';

const identifier = value => typeof value === 'string' && /^[\w:./-]{1,512}$/.test(value) ? value : null;
const fields = new Set(['identity', 'alias', 'actors', 'presence', 'mention', 'location', 'turn', 'dialogue-member', 'relation', 'state']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const caches = new Map();
const readers = new Map();

export function createReviewTracker(volumes) {
  const sourcePaths = volumes.flatMap(volume => volume.blocks.map(block => block.evidence));
  const scopes = volumes.map(volume => ({ novel: volume.workspace, input: volume.input, skill: '', sourcePaths, blockIds: volume.blocks.map(block => block.id), maxBlocks: volume.maxBlocks }));
  const pending = new Map();
  const coverage = new Map();
  let latest = null;
  const describe = command => {
    let permitted;
    for (const scope of scopes) { try { permitted = authorize(command, scope); break; } catch {} }
    if (!permitted) return null;
    if (permitted.kind === 'read') {
      for (const volume of volumes) {
        const block = volume.blocks.find(block => block.evidence === permitted.path);
        if (block) return { volume: volume.id, chapterIndex: block.chapterIndex, blockId: block.id, changesetId: `cs_${block.id}`, phase: permitted.count ? 'source-count' : 'source', sourceStart: permitted.start ?? 1, sourceEnd: Math.min(permitted.end ?? block.lines, block.lines) };
      }
      return null;
    }
    const args = permitted.args;
    const unified = args[0] === 'review';
    if (!unified && (args[0] !== 'changeset' || !['facts', 'show', 'decide', 'revise', 'approve', 'hold'].includes(args[1]))) return null;
    const volume = volumes.find(volume => volume.workspace === args[2]);
    const block = volume?.blocks.find(block => `cs_${block.id}` === args[3]);
    if (!block) return null;
    const phase = unified ? ({ show: 'facts', evidence: 'evidence', decide: 'decide', apply: 'approve' })[args[1]] : args[1] === 'facts' ? args.includes('--fact') ? 'evidence' : args.includes('--summary') ? 'summary' : 'facts' : args[1] === 'show' ? args.includes('--notes') ? 'notes' : args.includes('--summary') ? 'summary' : 'proposals' : args[1];
    const factId = identifier(args[args.indexOf('--fact') + 1]);
    let factIds = args.includes('--fact') && factId ? [factId] : [];
    if (phase === 'decide') {
      try { factIds = JSON.parse(args[args.indexOf('--decisions') + 1]).slice(0, 50).map(decision => identifier(decision.factId)).filter(Boolean); } catch {}
    }
    return { volume: volume.id, chapterIndex: block.chapterIndex, blockId: block.id, changesetId: `cs_${block.id}`, phase, factIds, fields: [...new Set(factIds.map(id => id.split('/')[1]).filter(field => fields.has(field)))] };
  };
  return {
    consume(row) {
      const message = row.type === 'message' ? row.message : null;
      if (message?.role === 'assistant') {
        for (const item of message.content ?? []) if (item.type === 'toolCall' && item.name === 'bash') {
          const focus = describe(item.arguments?.command ?? '');
          pending.set(item.id, focus ? { ...focus, id: item.id, timestamp: row.timestamp, status: 'requested' } : null);
          if (pending.size > 128) pending.delete(pending.keys().next().value);
        }
      }
      if (message?.role === 'toolResult' && pending.has(message.toolCallId)) {
        const focus = pending.get(message.toolCallId);
        pending.delete(message.toolCallId);
        latest = focus ? { ...focus, timestamp: row.timestamp, status: message.isError ? 'error' : 'ok' } : null;
        if (latest && !message.isError) {
          let page;
          try { page = JSON.parse((message.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')); } catch {}
          if (page?.id === focus.changesetId) {
            const revision = /^[a-f0-9]{64}$/.test(page.revision ?? '') ? page.revision : null;
            const key = `${focus.volume}:${focus.changesetId}`;
            let inspected = coverage.get(key);
            if (revision && inspected?.revision !== revision) { inspected = { revision, facts: new Set(), positions: new Map(), totalFacts: null }; coverage.set(key, inspected); }
            const facts = Array.isArray(page.facts) ? page.facts.slice(0, 50) : [];
            if (inspected && count(page.totalFacts) !== null) inspected.totalFacts = page.totalFacts;
            for (const [index, fact] of facts.entries()) if (identifier(fact.id) && inspected) {
              inspected.facts.add(fact.id);
              if (count(page.page?.offset) !== null) inspected.positions.set(fact.id, page.page.offset + index + 1);
            }
            const factIds = page.factId ? [identifier(page.factId)].filter(Boolean) : facts.length ? facts.map(fact => identifier(fact.id)).filter(Boolean) : focus.factIds ?? [];
            latest = { ...latest, revision, totalFacts: inspected?.totalFacts ?? null, inspectedFacts: inspected?.facts.size ?? 0,
              factIds, factPositions: factIds.flatMap(id => inspected?.positions.has(id) ? [inspected.positions.get(id)] : []).sort((first, second) => first - second),
              proposalIds: Array.isArray(page.proposals) ? page.proposals.slice(0, 20).map(proposal => identifier(proposal.id)).filter(Boolean) : [],
              fields: facts.length ? [...new Set(facts.map(fact => fact.field).filter(field => fields.has(field)))] : focus.fields,
              offset: count(page.page?.offset), pageCount: facts.length || (Array.isArray(page.sentences) ? page.sentences.length : Array.isArray(page.proposals) ? page.proposals.length : page.reviewNotes ? Object.keys(page.reviewNotes).length : 0), total: count(page.page?.total),
              accepted: count(page.accepted ?? page.verifiedFacts), rejected: count(page.rejected ?? page.rejectedFacts), held: count(page.held ?? page.explicitHolds ?? page.deferredFacts), unreviewed: count(page.unreviewed) };
          } else if (['facts', 'evidence', 'summary', 'proposals', 'notes'].includes(focus.phase)) latest.status = 'unavailable';
        }
      }
      return pending.size ? pending.values().next().value : latest;
    },
  };
}

async function readSessionReviewProgress(metadataDirectory) {
  const root = dirname(metadataDirectory);
  try {
    const directory = join(root, 'sessions');
    const candidates = await Promise.all((await readdir(directory)).filter(name => /^[\w.-]+\.jsonl$/.test(name)).map(async name => ({ path: join(directory, name), info: await stat(join(directory, name)) })));
    const file = candidates.filter(file => file.info.isFile()).sort((first, second) => second.info.mtimeMs - first.info.mtimeMs)[0];
    if (!file || file.info.size > 64000000) return null;
    let cache = caches.get(root);
    if (!cache || cache.path !== file.path || cache.offset > file.info.size) {
      const handle = await open(join(root, 'job.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      let manifest;
      try { if ((await handle.stat()).size > 4000000) return null; manifest = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      cache = { path: file.path, offset: 0, pending: '', decoder: new StringDecoder('utf8'), tracker: createReviewTracker(manifest.volumes), progress: null };
      caches.set(root, cache);
      if (caches.size > 8) caches.delete(caches.keys().next().value);
    }
    if (cache.offset < file.info.size) {
      const handle = await open(cache.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const buffer = Buffer.alloc(Math.min(4000000, file.info.size - cache.offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, cache.offset);
        cache.offset += bytesRead;
        const lines = (cache.pending + cache.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        cache.pending = lines.pop();
        if (cache.pending.length > 4000000) { caches.delete(root); return null; }
        for (const line of lines) { try { cache.progress = cache.tracker.consume(JSON.parse(line)); } catch {} }
      } finally { await handle.close(); }
    }
    return cache.offset < file.info.size ? null : cache.progress;
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EACCES'].includes(error.code) || error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export function sessionReviewProgress(metadataDirectory) {
  const root = dirname(metadataDirectory);
  if (readers.has(root)) return readers.get(root);
  const reading = readSessionReviewProgress(metadataDirectory).finally(() => readers.delete(root));
  readers.set(root, reading);
  return reading;
}
