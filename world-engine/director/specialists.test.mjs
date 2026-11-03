import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORS, FACULTIES, firing, lead, registryProblems } from './specialists.mjs';

test('the registry holds together: every type fires or is quiet, every faculty is fired and read, every director reads', () => {
  assert.deepEqual(registryProblems(), []);
  for (const director of Object.values(DIRECTORS)) assert.ok(director.asks.length && (director.kind !== 'action' || director.scale[0] < director.scale[1]));
});

test('the built Jev questions the registry names are modes in the code', async () => {
  const modes = { ...(await import('../../dist/src/v2/context/directorModes.js')), ...(await import('../../dist/src/v2/context/spawnModes.js')), ...(await import('../../dist/src/v2/context/terrainModes.js')) };
  for (const director of Object.values(DIRECTORS)) for (const ask of director.asks.filter(entry => entry.status === 'built')) for (const name of ask.name.match(/\b[a-z]\w+Mode\b/g) ?? []) assert.ok(modes[name], `${name} is a mode`);
});

test('the gate: a dense stretch fires its faculty with hysteresis and a margin; a fight leads to the combat director, a fight in a chase to the mega-scene one', () => {
  const block = (distribution, confidence = 0.9) => ({ block: { distribution, confidence } });
  const quiet = block({ routine: 0.1, confrontation: 0.1, traversal: 0.1 });
  const windows = [quiet, quiet, block({ confrontation: 0.4 }), block({ confrontation: 0.18 }), block({ confrontation: 0.4, traversal: 0.4 }), quiet, quiet, quiet, quiet];
  const fired = firing(windows);
  assert.deepEqual(fired.choreography, [false, true, true, true, true, true, false, false, false], 'on at 2, held through the dip at 3 (the minimum span), off at 5, a window of margin each side');
  assert.equal(fired.generalist.every(Boolean), true);
  assert.equal(lead(fired, 2).lead, 'combat');
  assert.deepEqual(lead(fired, 4), { lead: 'mega', with: ['combat'] });
  assert.equal(lead(fired, 8).lead, 'routine');
  assert.equal(Object.keys(FACULTIES).length >= 8, true);
});

test('the docs are as the registry writes them', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(process.execPath, [new URL('./specialists-doc.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `run node world-engine/director/specialists-doc.mjs: ${run.stdout}${run.stderr}`);
});

test('every state lands on something the ontology has (src/ground/ontology/types.ts), or says it needs a new field', async () => {
  const { readFile } = await import('node:fs/promises');
  const { STATE, target } = await import('./specialists.mjs');
  const types = await readFile(new URL('../../src/ground/ontology/types.ts', import.meta.url), 'utf8');
  const union = name => [...(types.match(new RegExp(`export type ${name} =([\\s\\S]*?");`))?.[1] ?? '').matchAll(/"([A-Za-z_]+)"/g)].map(m => m[1]);
  const fields = name => [...(types.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '').matchAll(/^\s+([a-zA-Z]+)\??:/gm)].map(m => m[1]);
  const has = { scene: fields('Scene'), stateChange: fields('StateChange'), relation: union('RelationType'), event: union('EventType'), entity: union('EntityKind') };
  assert.ok(has.relation.includes('PART_OF') && has.stateChange.includes('emotions'), 'the types were read');
  for (const [id, states] of Object.entries(STATE)) for (const entry of states) for (const to of [entry.to, entry.also].filter(Boolean)) {
    const { base, a } = target(to);
    if (base === 'timeline') continue;
    assert.ok(has[base], `${id} · ${entry.state}: ${base} is not an ontology record`);
    assert.ok(has[base].includes(a) || entry.schema, `${id} · ${entry.state}: ${to} is not in types.ts (mark schema: true for a new field)`);
  }
});

test('what the registry calls built, canon writes today', async () => {
  const { readFile } = await import('node:fs/promises');
  const { STATE, target } = await import('./specialists.mjs');
  const canon = await readFile(new URL('../review/canon.mjs', import.meta.url), 'utf8');
  const FILE = { scene: 'scenes.jsonl', stateChange: 'state-changes.jsonl', relation: 'relations.jsonl', entity: 'entities.jsonl', event: 'events.jsonl' };
  for (const [id, states] of Object.entries(STATE)) for (const entry of states.filter(item => item.status === 'built' && item.to)) {
    const { base, a } = target(entry.to);
    assert.ok(canon.includes(`'${FILE[base]}'`), `${id} · ${entry.state}: canon writes no ${FILE[base]}`);
    if (base === 'relation') assert.ok(canon.includes(`'${a}'`), `${id} · ${entry.state}: canon writes no ${a}`);
  }
});

test('only the directors who record action take the zoom: they read the scale faculty and hold a camera; one of them always leads', () => {
  const action = Object.entries(DIRECTORS).filter(([, director]) => director.kind === 'action').map(([id]) => id);
  assert.deepEqual(action, ['routine', 'mega', 'combat']);
  for (const [id, director] of Object.entries(DIRECTORS)) assert.equal(director.reads.includes('scale'), action.includes(id), `${id} and the zoom`);
  for (const id of ['character', 'transport', 'architect']) assert.equal(DIRECTORS[id].camera, undefined, `${id} holds no camera`);
  // A routine stretch fires conversation and inner state: the routine director leads, the character director answers its own.
  const fired = { conversation: [true], feeling: [true], props: [true] };
  assert.deepEqual(lead(fired, 0), { lead: 'routine', with: ['character', 'transport'] });
  assert.equal(lead({ props: [true] }, 0).lead, 'routine', 'a state director never leads');
});

test('a page per faculty and per director: each faculty says how it is asked, each director its Jev questions, the notes in sync', async () => {
  const { FACULTY_ASKS, DIRECTOR_QUESTIONS, directorQuestions } = await import('./questions.mjs');
  assert.deepEqual(Object.keys(FACULTY_ASKS).sort(), Object.keys(FACULTIES).sort());
  assert.deepEqual(Object.keys(DIRECTOR_QUESTIONS).sort(), Object.keys(DIRECTORS).sort());
  const asked = await directorQuestions();
  for (const [id, entries] of Object.entries(asked)) for (const entry of entries) {
    assert.ok(entry.questions.length, `${id}: ${entry.mode ?? entry.key} asks something`);
    for (const question of entry.questions) assert.ok(question.primitive === 'box' || question.options.length, `${id} · ${question.key}: options`);
  }
  assert.ok(asked.mega[0].questions[0].options.includes('with:<another>'), 'a built question is the mode\'s own');
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(process.execPath, [new URL('./directing-vault.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `run node world-engine/director/directing-vault.mjs: ${run.stdout}${run.stderr}`);
});

test('the mixed index: sentences and blocks, each by its score; an unsure block leans on its sentences', () => {
  const sentence = (action, confidence = 0.9) => ({ distribution: { action, narration: 1 - action }, confidence });
  const window = (blockShare, blockSure, actionShare) => ({ block: { distribution: { confrontation: blockShare, routine: 1 - blockShare }, confidence: blockSure }, sentences: Array.from({ length: 12 }, () => sentence(actionShare)) });
  const calm = window(0.1, 0.9, 0.1);
  // Window 4: Jev unsure of the block (0.2), which looks calm, but its sentences are action through and through.
  const windows = [calm, calm, calm, calm, window(0.05, 0.2, 0.9), calm, calm, calm, calm, calm];
  const { index, choreography } = firing(windows);
  assert.ok(index.choreography[4] >= 1.5 && choreography[4], `the sentences carry it: ${index.choreography[4]}`);
  // The same block, sure of itself (0.95), outweighs the sentences less: its own calm counts.
  const sure = firing(windows.map((entry, n) => (n === 4 ? { ...entry, block: { ...entry.block, confidence: 0.95 } } : entry)));
  assert.ok(sure.index.choreography[4] < index.choreography[4], 'a sure calm block pulls the index down');
});

test('the block types Jev is asked are the registry\'s', async () => {
  const { BLOCK_TYPES: asked } = await import('../../dist/src/digger/autostep/segmentation.js');
  const { BLOCK_TYPES } = await import('./specialists.mjs');
  assert.deepEqual(Object.keys(asked), Object.keys(BLOCK_TYPES));
});
