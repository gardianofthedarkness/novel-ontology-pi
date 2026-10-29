import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { libraryAdd, libraryDecide, libraryInit, libraryPlan, libraryPropose, libraryShow, libraryView } from '../../dist/src/ground/workspace/library.js';
import { createLibraryAccess } from './library-access.mjs';
import { authorize } from './guard.mjs';

const execute = promisify(execFile);
const cli = resolve('dist/src/cli/cli.js');

async function fixture(context) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'library-access-')));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const library = join(directory, 'library');
  await libraryInit(library);
  const sources = [], volumes = [];
  for (const index of [1, 2]) {
    const input = join(directory, `世界甲 第${index}卷.txt`);
    await writeFile(input, `这是世界甲第${index}卷的原文。\n小明出发。`);
    sources.push((await libraryAdd(library, input)).source);
    volumes.push({ id: index, input });
  }
  const config = { directory: library, bindings: sources.map((source, index) => ({ sourceId: source.id, volume: index + 1 })) };
  const access = await createLibraryAccess(config, volumes);
  const support = sources.map(source => ({ sourceId: source.id, field: 'filename', quote: source.filename }));
  const organization = {
    universes: [{ id: 'world', title: '世界甲', evidence: [{ sourceId: sources[0].id, field: 'text', offset: 0, quote: '这是世界甲第1卷的原文。' }] }],
    continuities: [{ id: 'main', title: '主线', universeId: 'world', evidence: support }],
    series: [{ id: 'story', title: '故事甲', evidence: support }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, seriesId: 'story', continuityId: 'main', readingOrder: index + 1, status: 'confirmed', evidence: [support[index]], note: '根据原文与卷次。' })),
  };
  const scope = { novel: '/unavailable', input: '', skill: '', sourcePaths: [], blockIds: [], maxBlocks: 1, library: config };
  const run = async command => {
    const { args } = authorize(command, scope);
    await access.before(args, true);
    const { stdout } = await execute(process.execPath, [cli, ...args]);
    await access.credit(args, stdout);
    return JSON.parse(stdout);
  };
  return { directory, library, sources, volumes, config, access, organization, run };
}

test('scoped real CLI pages, source evidence and current review gate approve universe membership without fusing workspaces', async context => {
  const fixtureData = await fixture(context);
  const { library, sources, access, organization, run } = fixtureData;
  const current = await libraryShow(library);
  const proposal = await run(`novel library propose '${library}' --revision ${current.revision} --organization '${JSON.stringify(organization)}'`);
  const decide = ['library', 'decide', library, proposal.planId, '--revision', proposal.revision, '--decision', 'approve', '--reason', '原文和卷次支持归属。'];
  await assert.rejects(access.before(decide, true), /EVERY current plan page/);
  const first = await run(`novel library plan '${library}' ${proposal.planId} --offset 0 --limit 1`);
  await assert.rejects(access.before(decide, true), /EVERY current plan page/);
  for (let offset = 1; offset < first.page.total; offset++) await run(`novel library plan '${library}' ${proposal.planId} --offset ${offset} --limit 1`);
  await assert.rejects(access.before(decide, false), /skill/);
  await assert.rejects(access.before(decide, true), /exact text evidence/);
  await run(`novel library show '${library}' --offset 0 --limit 20`);
  await run(`novel library evidence '${library}' ${sources[0].id} --offset 0 --limit 5`);
  await assert.rejects(access.before(decide, true), /exact text evidence/);
  await run(`novel library evidence '${library}' ${sources[0].id} --offset 5 --limit 1500`);
  const receipt = await access.before(decide, true);
  assert.equal(receipt.inspectedItems, first.page.total);
  await run(`novel library decide '${library}' ${proposal.planId} --revision ${proposal.revision} --decision approve --reason '原文和卷次支持归属。'`);
  const result = await libraryShow(library, { kind: 'universe', id: 'world' });
  assert.equal(result.sources.length, 2);
  assert.notEqual(result.sources[0].workspace, result.sources[1].workspace);
  const view = await libraryView(library);
  assert.equal(view.organization.universes[0].title, '世界甲');
  assert.equal(view.plans.length, 0);
  assert.equal(view.events.at(-1).type, 'library.plan.approved');
  await assert.rejects(access.before(decide, true), /stale/);
});

test('stale/altered plan pages, foreign source bindings and expanded catalogs never gain review credit', async context => {
  const { library, volumes, config, access, organization, sources } = await fixture(context);
  const proposal = await libraryPropose(library, organization, (await libraryShow(library)).revision);
  const plan = await libraryPlan(library, proposal.planId);
  const args = ['library', 'plan', library, proposal.planId, '--offset', '0', '--limit', '20'];
  const { stdout } = await execute(process.execPath, [cli, ...args]);
  const bad = JSON.parse(stdout);
  bad.items[0].value.title = 'tampered';
  await access.credit(args, JSON.stringify(bad));
  const decide = ['library', 'decide', library, plan.id, '--revision', plan.revision, '--decision', 'hold', '--reason', '需核实'];
  await assert.rejects(access.before(decide, true), /EVERY current plan page/);
  await access.credit(args, stdout);
  assert.equal((await access.before(decide, true)).decision, 'hold');
  await libraryDecide(library, plan.id, plan.revision, 'hold', '需核实');
  await assert.rejects(access.before(decide, true), /stale/);
  await assert.rejects(createLibraryAccess({ ...config, bindings: [{ sourceId: sources[1].id, volume: 1 }, { sourceId: sources[0].id, volume: 2 }] }, volumes), /identity/);
  const extra = join(fixtureDataPath(config), 'extra.txt');
  await writeFile(extra, '另一本书');
  await libraryAdd(library, extra);
  await assert.rejects(access.before(['library', 'show', library], true), /scope changed/);
});

const fixtureDataPath = config => resolve(config.directory, '..');

test('all four concise skills load through the actual Pi resource loader without a model prompt', async context => {
  const { DefaultResourceLoader, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const directory = await mkdtemp(join(tmpdir(), 'library-skills-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [resolve('skills/novel-ontology/SKILL.md'), resolve('skills/novel-library/SKILL.md'), resolve('skills/novel-portraits/SKILL.md'), resolve('skills/novel-stage/SKILL.md')];
  const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: SettingsManager.inMemory({}), noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, additionalSkillPaths: paths });
  await loader.reload();
  const skills = loader.getSkills().skills;
  for (const path of paths) assert.ok(skills.some(skill => resolve(skill.filePath) === path));
});
