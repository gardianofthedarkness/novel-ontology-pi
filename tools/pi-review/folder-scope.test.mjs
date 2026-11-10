import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permit, words } from './folder-scope.mjs';

const scope = { folder: '/Users/someone/Documents', novel: '/Users/someone/Documents/.novel/bin/novel', skill: '/app/skills/novel-folder/SKILL.md' };

test('words: quotes kept whole, shell syntax refused', () => {
  assert.deepEqual(words(`novel folder put "/a b" uni 'The Book' --series "Two \\"Q\\""`), ['novel', 'folder', 'put', '/a b', 'uni', 'The Book', '--series', 'Two "Q"']);
  for (const bad of ['novel folder show /x | head', 'novel folder show /x; rm -rf /', 'cat $HOME/x', 'novel folder show "$(id)"', 'novel folder show `id`', 'novel folder show /x > out', 'novel "open']) assert.equal(words(bad), null, bad);
});

test('permit: the folder verbs that sort books on this folder, and the skill', () => {
  assert.deepEqual(permit(`${scope.novel} folder basics "${scope.folder}"`, scope), { kind: 'novel', args: ['folder', 'basics', scope.folder] });
  assert.equal(permit(`novel folder put ${scope.folder} u1 abc --series "S" --at 2`, scope).kind, 'novel');
  assert.equal(permit(`cat ${scope.skill}`, scope).kind, 'read');
  assert.deepEqual(permit(`sed -n '1,80p' ${scope.skill}`, scope).lines, [1, 80]);
  for (const bad of [`novel folder read ${scope.folder} abc`, `novel folder keys ${scope.folder}`, `novel folder import ${scope.folder} /x.txt`, `novel folder show /Users/someone`, `novel jev login`, `cat /etc/passwd`, `rm -rf ${scope.folder}`, `ls ${scope.folder}`]) assert.throws(() => permit(bad, scope), undefined, bad);
});
