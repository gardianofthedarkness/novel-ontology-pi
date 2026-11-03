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
