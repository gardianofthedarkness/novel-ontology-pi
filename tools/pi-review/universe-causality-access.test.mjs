import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { universeFixture } from '../../dist/test/helpers/universeFixture.js';
import { loadUniverseContext, qualifyCausalUnit, universeCandidates } from '../../dist/src/solidifier/causality/universe.js';
import { createUniverseCausalityAccess } from './universe-causality-access.mjs';
import { authorize } from './guard.mjs';
import { createViewer } from './serve.mjs';
import { createServer } from 'node:http';
import { applySnapshotChanges } from './snapshot-delta.mjs';

const execute = promisify(execFile);
const cli = resolve('dist/src/cli/cli.js');
async function fixture(context) {
  const data = await universeFixture(context);
  const configPath = join(data.root, 'host-bindings.json');
  await writeFile(configPath, JSON.stringify(data.bindings), { mode: 0o600 });
  const access = createUniverseCausalityAccess(data.bindings);
  const scope = { novel: '/not-selected', input: '', skill: '/skill', sourcePaths: [], blockIds: [], maxBlocks: 1,
    library: { directory: data.directory, bindings: data.sources.map((source, index) => ({ sourceId: source.id, volume: index + 1 })) } };
  const run = async (command, extraEnv = {}) => {
    const { args } = authorize(command, scope);
    const receipt = await access.before(args, true);
    const { stdout } = await execute(process.execPath, [cli, ...args], { env: { ...process.env, ...extraEnv, NOVEL_CAUSAL_BINDINGS: configPath } });
    await access.credit(args, stdout);
    return { ...JSON.parse(stdout), receipt };
  };
  return { ...data, scope, run, access };
}

test('guard restricts universe commands to assigned library, qualified endpoints, explicit revisions and bounded pages', async context => {
  const { scope, directory, sources } = await fixture(context);
  const prefix = `novel causality universe`;
  assert.equal(authorize(`${prefix} candidates '${directory}' world`, scope).label, 'novel causality universe candidates');
  const from = qualifyCausalUnit(sources[0].id, 'ev_1'), to = qualifyCausalUnit(sources[1].id, 'ev_1');
  for (const command of [
    `${prefix} candidates /tmp/other world`, `${prefix} candidates '${directory}' world --limit 21`,
    `${prefix} candidates '${directory}' world --offset 501`, `${prefix} sweep '${directory}' world --limit 1`,
    `${prefix} sweep '${directory}' world --revision ${'a'.repeat(64)} --auto-approve yes`,
    `${prefix} evidence '${directory}' world ev_1 ev_1`, `${prefix} propose '${directory}' world '${from}' '${to}' --revision stale --reason test`,
    `${prefix} show '${directory}' world ../private`, `${prefix} list '${directory}' world --path /tmp/private`,
  ]) assert.throws(() => authorize(command, scope), command);
});

test('real universe sweep CLI sends a single bounded Jev wire batch with original passages and creates only pending proposals', async context => {
  const { directory, run } = await fixture(context);
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(request.headers.authorization, 'Bearer synthetic-universe-key');
    assert.ok(payload.state.includes('水闸') || payload.state.includes('城镇'));
    assert.ok(payload.state.includes('NOT confirmed entity identity'));
    assert.equal(Object.keys(payload.questions).length, 4);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: 'noul', noul: key.startsWith('causal:') ? 0.95 : 0.1 }])) }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  context.after(() => new Promise(done => server.close(done)));
  const candidates = await run(`novel causality universe candidates '${directory}' world --limit 2`);
  const result = await run(`novel causality universe sweep '${directory}' world --revision ${candidates.revision} --limit 2`, { TYPESAFE_API_KEY: 'synthetic-universe-key', JEV_ENDPOINT: `http://127.0.0.1:${server.address().port}` });
  assert.equal(requests, 1);
  assert.equal(result.checked, 2);
  assert.equal(result.proposed, 2);
  assert.equal(result.complete, false);
  const view = await run(`novel causality universe list '${directory}' world --limit 20`);
  assert.equal(view.links.length, 2);
  assert.ok(view.links.every(link => link.state === 'proposed'));
});

test('real scoped CLI cannot accept cross-book causality without current packet and both original source reads', async context => {
  const { directory, sources, bindings, run, access, workspaces } = await fixture(context);
  const from = qualifyCausalUnit(sources[0].id, 'ev_1'), to = qualifyCausalUnit(sources[1].id, 'card_1');
  const before = await readFile(join(workspaces[0], 'ontology/relations.jsonl'), 'utf8');
  const candidates = await run(`novel causality universe candidates '${directory}' world --limit 1`);
  const proposeArgs = ['causality', 'universe', 'propose', directory, 'world', from, to, '--revision', candidates.revision, '--reason', 'PRIVATE_CAUSAL_REASON'];
  await assert.rejects(() => access.before(proposeArgs, false), /skills/);
  const proposed = await run(`novel causality universe propose '${directory}' world '${from}' '${to}' --revision ${candidates.revision} --reason PRIVATE_CAUSAL_REASON`);
  const inspected = await run(`novel causality universe show '${directory}' world ${proposed.packetId} --limit 1`);
  const decisions = [{ proposalId: inspected.proposals[0].id, verdict: 'accept', reason: 'PRIVATE_REVIEW_REASON', temporalReason: 'PRIVATE_TEMPORAL_REASON' }];
  const command = `novel causality universe decide '${directory}' world ${proposed.packetId} --revision ${inspected.revision} --decisions '${JSON.stringify(decisions)}'`;
  await assert.rejects(() => run(command), /BOTH original/);
  const evidenceCommand = `novel causality universe evidence '${directory}' world '${from}' '${to}' --packet ${proposed.packetId} --limit 1`;
  const first = await run(evidenceCommand);
  await assert.rejects(() => run(command), /BOTH original/);
  const forged = { ...first, sentences: first.sentences.map(sentence => ({ ...sentence, text: 'fake source' })) }; delete forged.receipt;
  await access.credit(['causality', 'universe', 'evidence', directory, 'world', from, to, '--packet', proposed.packetId, '--offset', '1', '--limit', '1'], JSON.stringify(forged));
  await assert.rejects(() => run(command), /BOTH original/);
  await run(`${evidenceCommand} --offset 1`);
  const result = await run(command);
  assert.equal(result.applied, 1);
  assert.equal(result.receipt.proofs[0].sourceSentences, 2);
  assert.equal(await readFile(join(workspaces[0], 'ontology/relations.jsonl'), 'utf8'), before);
  assert.equal((await run(`novel causality universe list '${directory}' world --limit 1`)).links[0].state, 'canon');
  const current = await loadUniverseContext(directory, 'world', bindings);
  const staleSweep = ['causality', 'universe', 'sweep', directory, 'world', '--revision', current.revision, '--limit', '1'];
  await assert.rejects(() => access.before(staleSweep, true), /current universe candidates/);
  const next = await universeCandidates(current, 0, 1);
  await access.credit(['causality', 'universe', 'candidates', directory, 'world', '--limit', '1'], JSON.stringify(next));
  await access.before(staleSweep, true);
});

test('protected SSE projects actual CLI universe proposals and decisions without exposing original passages, paths or private reasons', async context => {
  const { root, directory, sources, scope, run, workspaces } = await fixture(context);
  const dist = join(root, 'frontend');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
  await writeFile(join(dist, 'assets/app.js'), 'export const synthetic = true;');
  const viewer = await createViewer({ port: 0, expiresAt: Date.now() + 30000, dist, libraryDirectory: directory, libraryBindings: scope.library.bindings,
    resolveWorkspace: async volume => workspaces[Number(volume) - 1], watchPaths: [],
    readLive: async () => ({ volume: 1, world: { laneNodes: [], laneEdges: [], interiors: {} }, feed: [], status: 'idle' }) });
  context.after(viewer.close);
  const controller = new AbortController(); context.after(() => controller.abort());
  const response = await fetch(`${viewer.origin}${viewer.privatePath}api/live/stream`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', current;
  const nextSnapshot = async () => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const type = packet.match(/^event: (.+)/)?.[1];
        const match = packet.match(/\ndata: (.+)/);
        if (!match) continue;
        const value = JSON.parse(match[1]);
        if (type === 'snapshot') current = value;
        if (type === 'patch') current = applySnapshotChanges(current, value);
        if (current) return current;
      } else {
        const chunk = await reader.read(); if (chunk.done) throw new Error('Stream ended before a causal update'); buffer += chunk.value;
      }
    }
  };
  await nextSnapshot();
  const page = await run(`novel causality universe candidates '${directory}' world --limit 1`);
  const from = qualifyCausalUnit(sources[0].id, 'ev_1'), to = qualifyCausalUnit(sources[1].id, 'ev_1');
  const proposed = await run(`novel causality universe propose '${directory}' world '${from}' '${to}' --revision ${page.revision} --reason PRIVATE_CAUSAL_REASON`);
  let view;
  do { view = await nextSnapshot(); } while (!view.world.library?.causal.links.length);
  assert.equal(view.world.library.causal.links[0].state, 'proposed');
  const inspected = await run(`novel causality universe show '${directory}' world ${proposed.packetId} --limit 1`);
  const decisions = [{ proposalId: inspected.proposals[0].id, verdict: 'hold', reason: 'PRIVATE_HOLD_REASON' }];
  await run(`novel causality universe decide '${directory}' world ${proposed.packetId} --revision ${inspected.revision} --decisions '${JSON.stringify(decisions)}'`);
  do { view = await nextSnapshot(); } while (view.world.library.causal.links[0].state !== 'held');
  assert.ok(view.feed.some(entry => entry.text.includes('causality')));
  const raw = JSON.stringify(view);
  for (const forbidden of [root, 'PRIVATE_CAUSAL_REASON', 'PRIVATE_HOLD_REASON', '小明打开了水闸', 'temporalReason', 'inputSha256']) assert.ok(!raw.includes(forbidden), forbidden);
  controller.abort(); await reader.cancel().catch(() => {});
});
