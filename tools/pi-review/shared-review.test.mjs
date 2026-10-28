import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { universeFixture } from '../../dist/test/helpers/universeFixture.js';
import { proposeCausalityLink } from '../../dist/src/cli/commands/extract/causalityCommands.js';
import { causalSource } from '../../dist/src/solidifier/causality/evidence.js';
import { loadChangeSet, saveChangeSet } from '../../dist/src/solidifier/merge/changesetStore.js';
import { authorize } from './guard.mjs';
import { sharedReviewReceipt, requireSharedReviewSkills } from './shared-review.mjs';
import { validateStability } from './validate-stability.mjs';

const execute = promisify(execFile);

test('actual scoped CLI shared review stages, applies and produces a valid fresh stability receipt without model calls', async context => {
  const data = await universeFixture(context);
  const workspace = data.workspaces[0];
  const proposed = await proposeCausalityLink(workspace, 'ev_1', 'card_1', { reason: 'Synthetic source review only.' });
  const predecessor = await loadChangeSet(workspace, proposed.changesetId);
  const packet = { ...predecessor, id: 'cs_b0001', blockId: 'b0001', reviewSource: (await causalSource(workspace)).sentences };
  await saveChangeSet(workspace, packet);
  const scope = { novel: workspace, input: '', skill: '', sourcePaths: [], blockIds: ['b0001'], maxBlocks: 1, reviewProtocol: 'review-v1' };
  const env = { ...process.env, NOVEL_SECRETS_DIR: join(data.root, 'empty-secrets'), TYPESAFE_API_KEY: '', JEV_API_KEY_ENV: '', JEV_ENDPOINT: 'http://127.0.0.1:1/no-paid-calls' };
  const run = async suffix => {
    const { args } = authorize(`novel review ${suffix}`, scope);
    requireSharedReviewSkills(args, { ontology: true, causality: true }, packet);
    const { stdout } = await execute(process.execPath, [resolve('dist/src/cli/cli.js'), ...args], { env });
    return { args, output: JSON.parse(stdout) };
  };
  const shown = await run(`show '${workspace}' cs_b0001 --scope book --limit 20`);
  const factId = shown.output.facts[0].id;
  const revision = shown.output.revision;
  await run(`decide '${workspace}' cs_b0001 --scope book --revision ${revision} --decisions '${JSON.stringify([{ factId, verdict: 'accept', reason: 'Synthetic source-supported assertion.' }])}'`);
  assert.equal((await loadChangeSet(workspace, packet.id)).status, 'pending_review');
  const applied = await run(`apply '${workspace}' cs_b0001 --scope book --revision ${revision}`);
  assert.equal(applied.output.verified, 1);
  const current = await loadChangeSet(workspace, packet.id);
  const jobRoot = join(data.root, 'job');
  await mkdir(jobRoot);
  const receipt = sharedReviewReceipt(applied.args, applied.output, { id: 1 }, current);
  await writeFile(join(jobRoot, 'approval-receipts.jsonl'), JSON.stringify(receipt) + '\n');
  const sourceFiles = await import('node:fs/promises').then(fs => fs.readdir(join(workspace, 'source')));
  const manifest = { volumes: [{ id: 1, workspace, input: join(workspace, 'source', sourceFiles.find(name => name.endsWith('.txt'))), blocks: [{ id: 'b0001', chapterIndex: 0, lines: 3 }] }] };
  assert.equal((await validateStability(jobRoot, manifest)).complete, true);
  for (const broken of [
    { ...receipt, operation: 'decide', applied: false },
    { ...receipt, verifiedSourceFacts: [] },
    { ...receipt, inspectedFactIds: [] },
    { ...receipt, packetRevision: 'a'.repeat(64) },
  ]) {
    await writeFile(join(jobRoot, 'approval-receipts.jsonl'), JSON.stringify(broken) + '\n');
    assert.equal((await validateStability(jobRoot, manifest)).complete, false);
  }
  assert.ok((await readFile(join(workspace, 'review', 'history.jsonl'), 'utf8')).includes('"operation":"apply"'));
});

test('shared gate requires only relevant loaded skills, with extra causal and library evidence safeguards', () => {
  const book = ['review', 'show', '/book', 'cs_b0001', '--scope', 'book'];
  assert.equal(requireSharedReviewSkills(book, { ontology: true }), 'book');
  assert.throws(() => requireSharedReviewSkills(book, { ontology: true }, { proposals: [{ kind: 'add_relation', payload: { type: 'CAUSES' } }] }), /relevant source/);
  assert.equal(requireSharedReviewSkills(['review', 'show', '/lib', 'plan', '--scope', 'library'], { library: true, schema: true }), 'library');
  assert.throws(() => requireSharedReviewSkills(['review', 'show', '/lib', 'packet', '--scope', 'universe'], { ontology: true, library: true }), /relevant source/);
  // Identity matches (universal EM) are the universe's shared character list: the ontology skill is enough.
  assert.equal(requireSharedReviewSkills(['review', 'show', '/lib', `um_${'a'.repeat(24)}`, '--scope', 'universe', '--universe', 'toaru'], { ontology: true }), 'universe');
  assert.throws(() => requireSharedReviewSkills(['review', 'show', '/lib', `um_${'a'.repeat(24)}`, '--scope', 'universe', '--universe', 'toaru'], {}), /relevant source/);
});
