import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORS, FACULTIES, damped, firing, lead, registryProblems } from './specialists.mjs';

test('the registry holds together: every type fires or damps, every faculty is fired and read, every director reads', () => {
  assert.deepEqual(registryProblems(), []);
  for (const director of Object.values(DIRECTORS)) assert.ok(director.scale[0] < director.scale[1] && director.asks.length);
});

test('the built Jev questions the registry names are modes in the code', async () => {
  const modes = { ...(await import('../../dist/src/v2/context/directorModes.js')), ...(await import('../../dist/src/v2/context/spawnModes.js')), ...(await import('../../dist/src/v2/context/terrainModes.js')) };
  for (const director of Object.values(DIRECTORS)) for (const ask of director.asks.filter(entry => entry.status === 'built')) for (const name of ask.name.match(/\b[a-z]\w+Mode\b/g) ?? []) assert.ok(modes[name], `${name} is a mode`);
});

test('the gate: a dense stretch fires its faculty with hysteresis and a margin; a fight leads to the combat director, a fight in a chase to the mega-scene one', () => {
  const quiet = { types: { routine: 0.1, confrontation: 0.1, traversal: 0.1 } };
  const windows = [quiet, quiet, { types: { confrontation: 0.4 } }, { types: { confrontation: 0.18 } }, { types: { confrontation: 0.4, traversal: 0.4 } }, quiet, quiet, quiet, quiet];
  const fired = firing(windows);
  assert.deepEqual(fired.choreography, [false, true, true, true, true, true, false, false, false], 'on at 2, held through the dip at 3 (the minimum span), off at 5, a window of margin each side');
  assert.equal(fired.generalist.every(Boolean), true);
  assert.equal(lead(fired, 2).lead, 'combat');
  assert.deepEqual(lead(fired, 4), { lead: 'mega', with: ['combat'] });
  assert.equal(lead(fired, 8).lead, 'routine');
  assert.equal(damped({ types: { interior: 0.6, routine: 0.3 } }), true);
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
