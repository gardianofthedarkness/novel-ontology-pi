import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJob } from './job.mjs';

test('library capability contains only explicit source/volume bindings outside extraction workspaces', () => {
  const binding = { sourceId: `doc_${'a'.repeat(64)}`, volume: 1 };
  const base = { volumes: [{ id: 1, input: 'source.txt', workspace: 'novel' }] };
  const library = { directory: 'library', bindings: [binding] };
  assert.equal(parseJob({ ...base, library }, '/private/job').library.directory, '/private/job/library');
  for (const value of [null, {}, { ...library, apiKey: 'x' }, { ...library, bindings: [binding, binding] }, { ...library, bindings: [{ ...binding, volume: 2 }] }, { ...library, directory: '.' }, { ...library, directory: 'novel/metadata' }, { ...library, bindings: [{ sourceId: '../other', volume: 1 }] }]) assert.throws(() => parseJob({ ...base, library: value }, '/private/job'));
});

test('optional EPUB is host-assigned, external to workspaces, never a wildcard read grant', () => {
  const job = parseJob({ volumes: [{ input: 'book.txt', workspace: 'novel', epub: 'book.epub' }] }, '/private/job');
  assert.equal(job.volumes[0].epub, '/private/job/book.epub');
  for (const epub of ['', 3, 'secret.txt', 'novel/book.epub']) assert.throws(() => parseJob({ volumes: [{ input: 'book.txt', workspace: 'novel', epub }] }, '/private/job'));
});

test('portable job paths, explicit larger budgets and scope are preserved', () => {
  const job = parseJob({ chapters: 4, limits: { recallsPerBlock: 12, pendingRevisionsPerBlock: 30 }, volumes: [{ input: 'volume1.txt' }, { input: 'volume2.txt' }] }, '/private/job');
  assert.equal(job.volumes[0].input, '/private/job/volume1.txt');
  assert.equal(job.volumes[1].id, 2);
  assert.equal(job.chapters, 4);
  assert.equal(job.limits.recallsPerBlock, 12);
  assert.equal(job.limits.pendingRevisionsPerBlock, 30);
  assert.equal(parseJob({ volumes: [{ input: 'source.txt' }] }, '/private/job').chapters, null);
});

test('invalid budgets, credentials, duplicate scopes and overlapping workspaces fail closed', () => {
  for (const value of [
    { volumes: [] }, { chapters: 0 }, { minutes: Infinity }, { limits: { commands: -1 } },
    { limits: { recallsPerBlock: '10' } }, { apiKey: 'not-a-real-key' },
    { volumes: [{ id: 1, input: 'one.txt' }, { id: 1, input: 'two.txt' }] },
    { volumes: [{ input: 'one.txt', workspace: 'novel' }, { input: 'two.txt', workspace: 'novel/child' }] },
    { volumes: [{ input: 'novel/source.txt', workspace: 'novel' }] },
  ]) assert.throws(() => parseJob({ volumes: [{ input: 'source.txt' }], ...value }, '/private/job'));
});
