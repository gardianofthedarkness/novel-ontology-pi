import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize as authorizeScoped } from './guard.mjs';
const novel = '/private/review/novel';
const input = '/private/review/source.txt';
const skill = '/private/review/SKILL.md';
const chapterOne = '/private/review/b0002.txt';
const defaultScope = { novel, input, skill, sourcePaths: [skill, chapterOne], blockIds: ['b0001', 'b0002'], maxBlocks: 2 };
const authorize = (command, scope = defaultScope) => authorizeScoped(command, scope);

test('one bounded shared gate authorizes all registered storage scopes without faculty-specific mutations', () => {
  const library = { directory: '/private/library', bindings: [] };
  const scope = { ...defaultScope, library, reviewProtocol: 'review-v1', causalityChangesetIds: ['cs_causality_agent_123'] };
  for (const [root, packet, flags] of [
    [novel, 'cs_b0001', '--scope book'],
    [novel, 'cs_causality_agent_123', '--scope book'],
    [library.directory, `uc_${'a'.repeat(64)}`, '--scope universe --universe world'],
    [library.directory, `plan_${'b'.repeat(64)}`, '--scope library'],
  ]) {
    assert.equal(authorize(`novel review show ${root} ${packet} ${flags} --offset 0 --limit 20`, scope).kind, 'cli');
    assert.equal(authorize(`novel review evidence ${root} ${packet} ${flags} --fact 'assertion/relation' --limit 20`, scope).kind, 'cli');
    assert.equal(authorize(`novel review decide ${root} ${packet} ${flags} --revision ${'c'.repeat(64)} --decisions '[]'`, scope).kind, 'cli');
    assert.equal(authorize(`novel review apply ${root} ${packet} ${flags} --revision ${'c'.repeat(64)}`, scope).kind, 'cli');
  }
  for (const command of [
    `novel changeset approve ${novel} cs_b0001`,
    `novel changeset decide ${novel} cs_b0001 --revision ${'c'.repeat(64)} --decisions '[]'`,
    `novel library decide ${library.directory} plan_${'b'.repeat(64)}`,
    `novel causality universe decide ${library.directory} world uc_${'a'.repeat(64)}`,
  ]) assert.throws(() => authorize(command, scope), /Use novel review/);
  for (const command of [
    `novel review show /tmp/unassigned cs_b0001 --scope book`,
    `novel review show ${novel} cs_unassigned --scope book`,
    `novel review show ${novel} cs_b0001 --scope faculty`,
    `novel review show ${novel} cs_b0001 --limit 21`,
    `novel review show ${novel} cs_b0001 --limit 1 --limit 2`,
    `novel review apply ${novel} cs_b0001 --revision stale`,
    `novel review apply ${novel} cs_b0001 --revision ${'c'.repeat(64)} --auto-approve yes`,
    `novel review decide ${novel} cs_b0001 --revision ${'c'.repeat(64)} --decisions '${JSON.stringify(Array.from({ length: 51 }, () => ({})))}'`,
    `novel review show ${library.directory} uc_${'a'.repeat(64)} --scope universe`,
  ]) assert.throws(() => authorize(command, scope), command);
});

test('causality is bounded, workspace-scoped and only registered standalone packets can reach review', () => {
  const scope = { ...defaultScope, causalityChangesetIds: ['cs_causality_sweep_123'] };
  assert.deepEqual(authorize(`novel causality sweep ${novel}`, scope).args.slice(-2), ['--limit', '10']);
  assert.equal(authorize(`novel causality candidates ${novel} --chapter 0 --limit 20`, scope).kind, 'cli');
  assert.equal(authorize(`novel causality evidence ${novel} ev_1 card_2 --changeset cs_causality_sweep_123 --offset 0 --limit 1`, scope).kind, 'cli');
  assert.equal(authorize(`novel changeset show ${novel} cs_causality_sweep_123 --offset 0 --limit 10`, scope).kind, 'cli');
  assert.equal(authorize(`novel changeset approve ${novel} cs_causality_sweep_123`, scope).kind, 'cli');
  for (const command of [
    `novel causality sweep /tmp/other --limit 1`, `novel causality sweep ${novel} --limit 21`,
    `novel causality sweep ${novel} --auto-approve yes`, `novel causality sweep ${novel} --limit 1 --limit 2`,
    `novel causality candidates ${novel} --chapter -1`, `novel causality propose ${novel} ../private ev_1`,
    `novel causality evidence ${novel} ev_1 card_2 --changeset cs_causality_sweep_999`,
    `novel changeset approve ${novel} cs_causality_sweep_999`,
    `novel changeset facts ${novel} cs_causality_sweep_123`,
    `novel fix relate ${novel} ev_1 ev_2 --kind CAUSES --reason bypass`,
  ]) assert.throws(() => authorize(command, scope), command);
});

test('library organization stays in the assigned catalog and uses bounded revisioned reads', () => {
  const sourceId = `doc_${'a'.repeat(64)}`, planId = `plan_${'b'.repeat(64)}`;
  const library = { directory: '/private/library', bindings: [{ sourceId, volume: 1 }] };
  const scope = { ...defaultScope, library };
  assert.deepEqual(authorize('novel library show /private/library', scope).args.slice(-4), ['--offset', '0', '--limit', '10']);
  assert.equal(authorize(`novel library evidence /private/library ${sourceId} --offset 0 --limit 2000`, scope).kind, 'cli');
  assert.equal(authorize(`novel library plan /private/library ${planId} --offset 0 --limit 1`, scope).kind, 'cli');
  assert.equal(authorize(`novel library propose /private/library --revision ${'a'.repeat(64)} --organization '{}'`, scope).kind, 'cli');
  assert.equal(authorize(`novel library decide /private/library ${planId} --revision ${'b'.repeat(64)} --decision hold --reason '证据不足'`, scope).kind, 'cli');
  for (const command of [
    'novel library init /private/library', 'novel library add /private/library /tmp/book.epub',
    `novel library prepare /private/library ${sourceId}`, 'novel library show /tmp/other',
    `novel library propose /private/library /tmp/raw.json --revision ${'a'.repeat(64)}`,
    'novel library show /private/library --limit 100', 'novel library show /private/library --offset 1 --offset 2',
    `novel library evidence /private/library doc_${'c'.repeat(64)}`,
    `novel library evidence /private/library ${sourceId} --limit 2001`,
    `novel library decide /private/library ${planId} --revision stale --decision approve --reason test`,
    `novel library decide /private/library ${planId} --revision ${'b'.repeat(64)} --decision approve --reason test --auto-approve yes`,
    `novel library show /private/library --universe world --series same`,
  ]) assert.throws(() => authorize(command, scope), command);
  assert.throws(() => authorize('novel library show /private/library'));
});

test('album CLI permits only the assigned matching EPUB and scoped workspace', () => {
  const album = { epub: '/private/review/book.epub', importAllowed: true };
  const scope = { ...defaultScope, album };
  assert.equal(authorize(`novel album import '${novel}' '${album.epub}'`, scope).label, 'novel album import');
  assert.equal(authorize(`novel album list '${novel}'`, scope).kind, 'cli');
  assert.equal(authorize(`novel album portraits '${novel}'`, scope).kind, 'cli');
  assert.equal(authorize(`novel album assign '${novel}'`, scope).kind, 'cli');
  assert.equal(authorize(`novel album assign '${novel}' --check`, scope).kind, 'cli');
  for (const command of [
    `cat '${album.epub}'`, `novel album import '${novel}' /tmp/other.epub`,
    `novel album import /tmp/other '${album.epub}'`, `novel album list '${novel}' --output /tmp/leak`,
    `novel album portraits '${novel}' --auto-approve`,
    `novel album assign /tmp/other`, `novel album assign '${novel}' --names-file /tmp/names`,
    `novel album assign '${novel}' --min-conf 0.1`, `novel album assign '${novel}' --check --check`,
    `novel album assign '${novel}' --python /tmp/script`, `python3 tools/album-portraits/portraits.py '${novel}'`,
  ]) assert.throws(() => authorize(command, scope));
  assert.throws(() => authorize(`novel album import '${novel}' '${album.epub}'`, { ...scope, album: { ...album, importAllowed: false } }));
  assert.throws(() => authorize(`novel album import '${novel}' '${album.epub}'`));
});

test('permits only scoped, explicit CLI operations', () => {
  assert.equal(authorize(`novel ingest '${novel}' '${input}' --max-blocks 2 --block-size 24000`).kind, 'cli');
  assert.equal(authorize(`novel fix merge '${novel}' loc_1 loc_2 --reason '同一条街; confirmed in source'`).args[3], 'loc_1');
  assert.equal(authorize(`cat '${skill}'`).kind, 'read');
  assert.equal(authorize(`novel query '${novel}' 'MATCH (entity:Character) RETURN entity.id'`).kind, 'cli');
  assert.equal(authorize(`novel changeset show '${novel}' cs_b0001 --offset 20 --limit 20`).kind, 'cli');
  assert.equal(authorize(`sed -n '151,300p' '${chapterOne}'`).start, 151);
  assert.equal(authorize(`wc -l '${chapterOne}'`).count, true);
  assert.equal(authorize(`novel fix correct '${novel}' --block b0001 --key extraction:constraints --value '{"distinctNames":[["甲","乙"]]}' --reason '原文中是不同人物'`).kind, 'cli');
  assert.equal(authorize(`novel recall '${novel}' b0001`).kind, 'cli');
  assert.equal(authorize(`novel search '${novel}' '黄昏'`).kind, 'cli');
  assert.equal(authorize(`novel search '${novel}' '黄昏' --limit 30`).args.at(-1), '30');
  assert.equal(authorize(`novel changeset revise '${novel}' cs_b0002 --edits '{"sanitizeTypes":true}' --reason '类型检查'`).kind, 'cli');
});

test('rejects shell injection, arbitrary reads, paths, writes, and gate bypass', () => {
  for (const command of [
    'env', 'cat /etc/passwd', `novel changeset approve /tmp/other cs_b0001`,
    `novel ingest '${novel}' '${input}' --auto-approve`,
    `novel config; env`, `novel config | cat`, 'novel config\nenv',
    'novel config $(env)', 'novel config > /tmp/key',
    `novel query '${novel}' 'MATCH (entity) DELETE entity'`,
    `novel graph build '${novel}/ontology' /tmp/other`,
    `novel changeset approve '${novel}' cs_b0003`,
    `sed -n '1,100p' /etc/passwd`, `sed -n '0,10p' '${chapterOne}'`,
    `novel changeset show '${novel}' cs_b0001 --output /tmp/leak`,
    `novel changeset show '${novel}' cs_b0001`, `novel changeset show '${novel}' cs_b0001 --limit 100`,
    `novel recall '${novel}' b0003`,
    `novel search '${novel}' '黄昏' --limit 31`, `novel search '${novel}' '黄昏' --output /tmp/leak`, `novel search /tmp/other '黄昏'`,
    `novel fix correct '${novel}' --block b0003 --key extraction:constraints --value '{}' --reason 'test'`,
    `novel fix correct '${novel}' --block b0001 --key key --value '{}' --reason 'test' --output /tmp/leak`,
    `novel changeset revise '${novel}' cs_b0003 --edits '{}' --reason 'test'`,
    `novel changeset revise '${novel}' cs_b0002 --edits '{}' --reason 'test' --output /tmp/leak`,
  ]) assert.throws(() => authorize(command), command);
});

test('full-volume scopes permit only the current block in the selected workspace', () => {
  const scope = { novel: '/tmp/authorized-volume-2', input: '/tmp/authorized-volume-2.txt', skill, sourcePaths: [skill, '/tmp/current-b0009.txt'], blockIds: ['b0009'], maxBlocks: 9 };
  assert.equal(authorize("novel ingest /tmp/authorized-volume-2 /tmp/authorized-volume-2.txt --max-blocks 9 --block-size 24000", scope).kind, 'cli');
  assert.equal(authorize("novel changeset show /tmp/authorized-volume-2 cs_b0009 --offset 0 --limit 10", scope).kind, 'cli');
  assert.equal(authorize("novel recall /tmp/authorized-volume-2 b0009", scope).kind, 'cli');
  assert.equal(authorize('novel inspect /tmp/authorized-volume-2', scope).kind, 'cli');
  for (const command of [
    'novel changeset approve /tmp/authorized-volume-2 cs_b0008',
    'novel changeset approve /tmp/other-volume cs_b0009',
    'novel ingest /tmp/authorized-volume-2 /tmp/authorized-volume-2.txt --max-blocks 10 --block-size 24000',
    'novel recall /tmp/authorized-volume-2 b0001',
    'cat /tmp/old-b0008.txt',
    'novel inspect /tmp/other-volume',
    'novel inspect /tmp/authorized-volume-2 --output /tmp/leak',
    "novel fix correct /tmp/authorized-volume-2 --block b0009 --key x --key y --value '{}' --reason test",
  ]) assert.throws(() => authorize(command, scope), command);
});

test('fact decisions remain workspace-scoped and require a revision without shell access', () => {
  const reference = `${skill.replace(/\/SKILL.md$/, '')}/references/semantic-review.md`;
  const scope = { novel: '/tmp/novel', input: '/tmp/source.txt', skill, sourcePaths: [skill, reference], blockIds: ['b0001'], maxBlocks: 1 };
  assert.equal(authorizeScoped(`cat '${reference}'`, scope).kind, 'read');
  assert.equal(authorizeScoped('novel changeset facts /tmp/novel cs_b0001 --offset 0 --limit 20', scope).kind, 'cli');
  assert.equal(authorizeScoped(`novel changeset decide /tmp/novel cs_b0001 --revision ${'a'.repeat(64)} --decisions '[]'`, scope).kind, 'cli');
  for (const command of [
    'novel changeset facts /tmp/other cs_b0001',
    'novel changeset facts /tmp/novel cs_b0001 --limit 300',
    'novel changeset facts /tmp/novel cs_b0001 --output /tmp/leak',
    "novel changeset decide /tmp/novel cs_b0001 --revision stale --decisions '[]'",
    `novel changeset decide /tmp/novel cs_b0002 --revision ${'a'.repeat(64)} --decisions '[]'`,
  ]) assert.throws(() => authorizeScoped(command, scope));
});

test('time-place runs only propose for the assigned book, and their packets review through the shared gate', () => {
  const scope = { ...defaultScope, reviewProtocol: 'review-v1', timePlaceChangesetIds: ['cs_timeplace_time-place_1700000000000'] };
  assert.equal(authorize(`novel timeplace run ${novel} --propose --mode hybrid --chapter 2`, scope).label, 'novel timeplace run');
  assert.equal(authorize(`novel timeplace show ${novel}`, scope).label, 'novel timeplace show');
  assert.equal(authorize(`novel timeplace tree ${novel} --propose --max-questions 30`, scope).label, 'novel timeplace tree');
  for (const command of [`novel timeplace tree ${novel}`, `novel timeplace tree ${novel} --propose --mode llm`, `novel timeplace tree ${novel} --propose --max-questions 500`, `novel timeplace tree /tmp/other --propose`]) assert.throws(() => authorize(command, scope), command);
  assert.equal(authorize(`novel review show ${novel} cs_timeplace_time-place_1700000000000 --scope book --limit 20`, scope).kind, 'cli');
  for (const command of [
    `novel timeplace run ${novel}`,
    `novel timeplace run ${novel} --propose --force`,
    `novel timeplace run ${novel} --propose --out /tmp/x.json`,
    `novel timeplace run ${novel} --propose --mode everything`,
    `novel timeplace run /elsewhere --propose`,
  ]) assert.throws(() => authorize(command, scope), /Time-place/);
  assert.throws(() => authorize(`novel review show ${novel} cs_timeplace_time-place_9 --scope book`, scope), /outside the assigned scope/);
  // Strands: a report for the story view; --ask spends a bounded number of questions.
  assert.equal(authorize(`novel timeplace strands ${novel}`, scope).label, 'novel timeplace strands');
  assert.equal(authorize(`novel timeplace strands ${novel} --ask --max-questions 30 --min-impact 8`, scope).label, 'novel timeplace strands');
  for (const command of [`novel timeplace strands ${novel} --ask --max-questions 500`, `novel timeplace strands ${novel} --propose`, `novel timeplace strands ${novel} --out /tmp/x.json`, `novel timeplace strands /elsewhere --ask`, `novel timeplace run ${novel} --propose --ask`]) assert.throws(() => authorize(command, scope), command);
});

test('error explanations are available to Pi', () => {
  assert.equal(authorize('novel explain QUERY_UNKNOWN_PROPERTY').kind, 'cli');
  assert.equal(authorize('novel explain --list').kind, 'cli');
  for (const command of ['novel explain', 'novel explain ../x', 'novel explain A B']) assert.throws(() => authorize(command), command);
});

test('the universe atlas proposes cross-book place links on the assigned library only; ua_ packets review through the shared gate', () => {
  const library = { directory: '/private/library', bindings: [] };
  const scope = { ...defaultScope, library, reviewProtocol: 'review-v1' };
  assert.equal(authorize(`novel atlas sweep ${library.directory} world --propose --max-questions 30`, scope).label, 'novel atlas sweep');
  assert.equal(authorize(`novel atlas show ${library.directory} world`, scope).label, 'novel atlas show');
  assert.equal(authorize(`novel review show ${library.directory} ua_${'d'.repeat(64)} --scope universe --universe world --limit 20`, scope).kind, 'cli');
  for (const command of [
    `novel atlas sweep ${library.directory} world`,
    `novel atlas sweep /tmp/other world --propose`,
    `novel atlas sweep ${library.directory} world --propose --max-questions 500`,
    `novel atlas sweep ${library.directory} world --propose --out /tmp/leak`,
    `novel atlas show ${library.directory}`,
    `novel atlas sweep ${novel} world --propose`,
  ]) assert.throws(() => authorize(command, scope), command);
  assert.throws(() => authorize(`novel atlas show ${library.directory} world`), 'no library assigned');
});
test('the analysis checklist is read-only and limited to assigned books and the assigned library', () => {
  const library = { directory: '/private/library', bindings: [] };
  const scope = { ...defaultScope, library };
  assert.equal(authorize(`novel checklist ${novel}`, scope).label, 'novel checklist');
  assert.equal(authorize(`novel checklist ${library.directory} --universe world`, scope).label, 'novel checklist');
  for (const command of [`novel checklist /tmp/other`, `novel checklist ${novel} --input /etc/passwd`, `novel checklist ${library.directory}`, `novel checklist ${library.directory} --universe '../x'`]) assert.throws(() => authorize(command, scope), command);
});

test('refusals say what to change; long pages are clamped; help and status forms resolve', () => {
  // A long page is clamped to 150 lines, and the next page is named.
  const page = authorize(`sed -n '1,300p' '${chapterOne}'`);
  assert.deepEqual([page.start, page.end], [1, 150]);
  assert.match(page.note, /next: sed -n '151,300p'/);
  // Help in any spelling, and "what is left" questions.
  for (const command of ['novel --help', 'novel help changeset', `novel causality sweep --help`]) assert.deepEqual(authorize(command).args, ['help'], command);
  assert.deepEqual(authorize(`novel status ${novel}`).args, ['checklist', novel, '--input', input]);
  assert.deepEqual(authorize(`novel checklist ${novel}`).args, ['checklist', novel, '--input', input], 'the checklist knows the assigned input');
  // A refused form quotes the allowed one; an unknown command lists what exists; shell tools are named.
  assert.throws(() => authorize(`novel causality sweep ${novel} --limit 50`), /Use: novel causality .*sweep <book> \[--limit 1-20\]/);
  assert.throws(() => authorize(`novel state ${novel} char_1`), /novel state is not available here\. Available: .*checklist/);
  assert.throws(() => authorize('date -u'), /Shell tools \(ls, cd, grep, date, pipes\) are not/);
  assert.throws(() => authorize(`novel changeset hold ${novel} cs_b0001`, { ...defaultScope, reviewProtocol: 'review-v1' }), /Use novel review/);
  // A time-place run's report for this book is readable; another book's is not.
  assert.equal(authorize(`cat ${novel}/timeplace/run-2026.json`).kind, 'read');
  assert.throws(() => authorize(`cat ${novel}/timeplace/../ontology/entities.jsonl`));
  assert.throws(() => authorize('cat /private/other/timeplace/run.json'));
});

test('read mode stage commands run on the assigned book, bounded, and the prep takes no options', () => {
  assert.equal(authorize(`novel stage show ${novel}`, defaultScope).label, 'novel stage show');
  assert.equal(authorize(`novel stage scale ${novel}`, defaultScope).label, 'novel stage scale');
  assert.equal(authorize(`novel stage architecture ${novel}`, defaultScope).label, 'novel stage architecture');
  assert.equal(authorize(`novel stage movement ${novel} --max-calls 2000`, defaultScope).label, 'novel stage movement');
  assert.equal(authorize(`novel stage prep ${novel}`, defaultScope).label, 'novel stage prep');
  assert.equal(authorize(`novel stage objects ${novel} --max-calls 40`, defaultScope).label, 'novel stage objects');
  for (const command of [`novel stage movement /tmp/other`, `novel stage movement ${novel} --max-calls 99999`, `novel stage prep ${novel} --force`, `novel stage architecture ${novel} --max-calls 5`, `novel stage scale ${novel} --max-calls 5`, `novel stage scale /tmp/other`, `novel stage movement ${novel} --cache /tmp/x`, `novel stage objects ${novel} --force`, `novel stage objects ${novel} --no-work`, `novel stage delete ${novel}`]) assert.throws(() => authorize(command, defaultScope), command);
  // Its review packet goes through the shared gate like any other, once the runner lists it.
  assert.equal(authorize(`novel review show ${novel} cs_stage_objects_1 --scope book --offset 0 --limit 20`, { ...defaultScope, stageObjectsChangesetIds: ['cs_stage_objects_1'] }).label, 'novel review show');
  assert.throws(() => authorize(`novel review show ${novel} cs_stage_objects_2 --scope book --offset 0 --limit 20`, { ...defaultScope, stageObjectsChangesetIds: ['cs_stage_objects_1'] }));
});

test('the stage simulation: Pi ranks story lines, asks Jev and runs the engine within bounds and shows the runs; accepting a run is the user\'s', () => {
  assert.equal(authorize(`novel sim strands ${novel}`, defaultScope).label, 'novel sim strands');
  assert.equal(authorize(`novel sim run ${novel} --auto 3`, defaultScope).label, 'novel sim run');
  assert.equal(authorize(`novel sim run ${novel} --strand scene_000002`, defaultScope).label, 'novel sim run');
  assert.equal(authorize(`novel sim show ${novel}`, defaultScope).label, 'novel sim show');
  assert.equal(authorize(`novel sim pick ${novel} --auto 3 --max-calls 40`, defaultScope).label, 'novel sim pick');
  for (const command of [`novel sim pick ${novel} --auto 3`, `novel sim pick ${novel} --max-calls 61`, `novel sim pick ${novel} --max-calls 0`, `novel sim pick ${novel} --max-calls 10 --accept`, `novel sim run ${novel} --max-calls 10`, `novel sim pick /tmp/other --max-calls 10`]) assert.throws(() => authorize(command, defaultScope), command);
  for (const command of [`novel sim run ${novel} --accept`, `novel sim run ${novel} --auto 9`, `novel sim run ${novel} --auto 0`, `novel sim run /tmp/other --auto 1`, `novel sim run ${novel} --strand ../x`, `novel sim show ${novel} --auto 1`, `novel sim delete ${novel}`]) assert.throws(() => authorize(command, defaultScope), command);
});

test('universal EM: Pi may show and sweep its own book; identity packets review through the shared gate', () => {
  assert.equal(authorize(`novel em show ${novel}`).label, 'novel em show');
  assert.equal(authorize(`novel em sweep ${novel} --limit 50`).label, 'novel em sweep');
  for (const command of [`novel em sweep ${novel} --limit 500`, `novel em sweep /elsewhere`, `novel em merge ${novel}`, `novel match ${novel} --changeset cs_b0001`]) assert.throws(() => authorize(command), command);
  const packet = `um_${'a'.repeat(24)}`;
  // A standalone book reviews its own identity packets; a book in a library reviews them at the universe.
  assert.equal(authorize(`novel review show ${novel} ${packet} --scope book`, { ...defaultScope, reviewProtocol: 'review-v1' }).label, 'novel review show');
  const library = { directory: '/private/library', bindings: [] };
  assert.equal(authorize(`novel review show /private/library ${packet} --scope universe --universe toaru`, { ...defaultScope, library, reviewProtocol: 'review-v1' }).label, 'novel review show');
  assert.throws(() => authorize(`novel review show ${novel} ${packet} --scope book`, { ...defaultScope, library, reviewProtocol: 'review-v1' }));
});

test('the universe calendar: Pi may show and rebuild the clock of its book or its library universe; year questions review at the universe', () => {
  const library = { directory: '/private/library', bindings: [] };
  const scope = { ...defaultScope, library, reviewProtocol: 'review-v1' };
  assert.equal(authorize(`novel calendar show ${novel}`, scope).label, 'novel calendar show');
  assert.equal(authorize(`novel calendar build /private/library --universe toaru`, scope).label, 'novel calendar build');
  for (const command of [`novel calendar build /elsewhere`, `novel calendar show /private/other --universe toaru`, `novel calendar decide ${novel}`]) assert.throws(() => authorize(command, scope), command);
  assert.equal(authorize(`novel review show /private/library ut_${'b'.repeat(24)} --scope universe --universe toaru`, scope).label, 'novel review show');
});
