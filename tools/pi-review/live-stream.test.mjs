import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { applySnapshotChanges, snapshotChanges } from './snapshot-delta.mjs';
import { streamSnapshots } from './live-stream.mjs';

test('delta retains unchanged world references, supports null/deletion, and does not mutate previous state', () => {
  const previous = { world: { interiors: { chapter_0: { nodes: [1] }, chapter_1: { nodes: [2] } } }, touch: { id: 'before' }, remove: true };
  const current = { world: { interiors: { chapter_0: { nodes: [1] }, chapter_1: { nodes: [2, 3] } } }, touch: null };
  const changes = snapshotChanges(previous, current);
  const applied = applySnapshotChanges(previous, changes);
  assert.deepEqual(applied, current);
  assert.equal(applied.world.interiors.chapter_0, previous.world.interiors.chapter_0);
  assert.deepEqual(previous.world.interiors.chapter_1.nodes, [2]);
  assert.ok(!JSON.stringify(changes).includes('chapter_0'));
  const activityOnly = applySnapshotChanges(current, snapshotChanges(current, { ...current, count: 123 }));
  assert.equal(activityOnly.world, current.world);
  assert.throws(() => applySnapshotChanges({}, [{ path: ['__proto__', 'polluted'], value: true }]));
});

test('compressed SSE flushes initial state, watches atomic replacements, coalesces real bursts and reconnects to current truth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'novel-stream-'));
  const path = join(directory, 'draft.json');
  await writeFile(path, '{}');
  let current = { world: { interiors: { chapter_0: { nodes: ['unchanged'] } } }, count: 1 };
  let reads = 0;
  const server = createServer((request, response) => {
    void streamSnapshots(request, response, { read: async () => { reads++; return current; }, watchPaths: [directory], expiresAt: Date.now() + 10000, interval: 20 }).catch(() => response.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const controllers = [];
  const connect = async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(url, { signal: controller.signal, headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    return async () => {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          return { type: event.match(/^event: (.+)/)[1], data: JSON.parse(event.match(/\ndata: (.+)/)[1]) };
        }
        const result = await reader.read();
        if (result.done) throw new Error('Stream closed before update');
        buffer += result.value;
      }
    };
  };
  try {
    const next = await connect();
    assert.deepEqual(await next(), { type: 'snapshot', data: current });
    current = { ...current, count: 501 };
    const started = Date.now();
    await writeFile(`${path}.tmp`, '{}');
    await rename(`${path}.tmp`, path);
    const update = await next();
    assert.equal(update.type, 'patch');
    assert.deepEqual(update.data, [{ path: ['count'], value: 501 }]);
    assert.ok(Date.now() - started < 1500, 'file changes must not wait for the two-second safety poll');
    controllers[0].abort();
    const reconnected = await connect();
    assert.deepEqual(await reconnected(), { type: 'snapshot', data: current });
    controllers[1].abort();
    await delay(100);
    const stoppedReads = reads;
    await writeFile(path, '{"after":"disconnect"}');
    await delay(100);
    assert.equal(reads, stoppedReads);
  } finally {
    for (const controller of controllers) controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
