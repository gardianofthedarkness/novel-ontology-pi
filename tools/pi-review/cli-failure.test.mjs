import test from 'node:test';
import assert from 'node:assert/strict';
import { cliFailure } from './cli-failure.mjs';

test('a failed command reports its aspect and code, never its text', () => {
  const output = 'partial output\n{"error":"Decision #2 repeats factId f1","aspect":"review","code":"DECISION_INVALID","hint":"…"}\n';
  assert.deepEqual(cliFailure(output), { aspect: 'review', code: 'DECISION_INVALID' });
  assert.equal(cliFailure('{"error":"Error: old style"}'), null, 'older CLIs carry no code');
  assert.equal(cliFailure('{"error":"x","aspect":"<script>","code":"X"}'), null, 'only well-formed codes pass');
  assert.equal(cliFailure('plain text failure'), null);
});
