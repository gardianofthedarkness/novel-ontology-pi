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
  assert.equal(authorize(`novel stage landscape ${novel} --no-jev`, defaultScope).label, 'novel stage landscape');
  assert.equal(authorize(`novel stage movement ${novel} --max-calls 2000`, defaultScope).label, 'novel stage movement');
  assert.equal(authorize(`novel stage prep ${novel}`, defaultScope).label, 'novel stage prep');
  assert.equal(authorize(`novel stage objects ${novel} --max-calls 40`, defaultScope).label, 'novel stage objects');
  for (const command of [`novel stage movement /tmp/other`, `novel stage movement ${novel} --max-calls 99999`, `novel stage prep ${novel} --force`, `novel stage architecture ${novel} --max-calls 5`, `novel stage scale ${novel} --max-calls 5`, `novel stage scale /tmp/other`, `novel stage landscape ${novel} --max-calls 5`, `novel stage landscape /tmp/other`, `novel stage movement ${novel} --cache /tmp/x`, `novel stage objects ${novel} --force`, `novel stage objects ${novel} --no-work`, `novel stage delete ${novel}`]) assert.throws(() => authorize(command, defaultScope), command);
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

test('Pi may search the original text and answer a world-first book\'s review batches, in their bounded forms', () => {
  const novel = defaultScope.novel;
  assert.equal(authorizeScoped(`novel source grep ${novel} 刺猬头`, defaultScope).label, 'novel source');
  assert.equal(authorizeScoped(`novel source similar ${novel} 茵蒂克丝咬头 --limit 5`, defaultScope).label, 'novel source');
  assert.equal(authorizeScoped(`novel world pool ${novel}`, defaultScope).label, 'novel world');
  assert.equal(authorizeScoped(`novel world answer ${novel} wb_0123456789abcdef wi_0123456789abcdef same --reason 'b0001_s0002 names both'`, defaultScope).label, 'novel world');
  assert.throws(() => authorizeScoped(`novel world answer ${novel} wb_0123456789abcdef wi_0123456789abcdef same`, defaultScope));
  assert.throws(() => authorizeScoped('novel source grep /other/book 刺猬头', defaultScope));
});

test('Pi may read the evidence for the world\'s held items: the reading, the world log and the EPUB, read-only (W5)', () => {
  const novel = defaultScope.novel, ok = command => { try { return !!authorizeScoped(command, defaultScope); } catch { return false; } };
  assert.ok(ok(`novel reading ${novel} card dialogue:b0000_s0300`));
  assert.ok(ok(`novel reading ${novel} scene scene_000003`));
  assert.ok(ok(`novel world log ${novel} --scene scene_000003`));
  assert.ok(ok(`novel world log ${novel} --person char_000004 --run d20261102081221`));
  assert.ok(ok(`novel source epub ${novel}`));
  assert.ok(ok(`novel source epub ${novel} --doc 8 --offset 100 --limit 50`));
  assert.ok(ok(`novel source epub ${novel} --grep 便利店`));
  for (const command of [`novel reading /other/book card x`, `novel reading ${novel} chapter 1`, `novel world log ${novel}`, `novel world log ${novel} --scene a --scene b`, `novel world held ${novel}`, `novel world apply ${novel}`, `novel source epub ${novel} --doc`, `novel source epub ${novel} --write x`]) assert.ok(!ok(command), command);
});

test('Pi may pace a simulation run for the live view, within 0.5–5 s a moment, and nothing else new', async () => {
  const book = defaultScope.novel, ok = command => { try { return authorize(command).kind === 'cli'; } catch { return false; } };
  assert.ok(ok(`novel sim run ${book} --strand world --pace 2`));
  assert.ok(!ok(`novel sim run ${book} --strand world --pace 9`));
  assert.ok(!ok(`novel sim run ${book} --strand world --force`));
  assert.ok(!ok(`novel sim pick ${book} --strand world --max-calls 60 --pace 2`));
});

test('settings, warehouse and model commands pass for the assigned book, with a why where something is written and the user\'s OK for a download', () => {
  const packs = `${process.env.NOVEL_MODEL_PACKS ?? `${process.env.HOME}/claude-world-first/model-packs`}`;
  for (const command of [
    `novel settings show '${novel}'`, `novel settings show '${novel}' fill --changed`, `novel settings show '${novel}' --place loc_000001`, 'novel settings explain fill.streets',
    `novel settings set '${novel}' fill.streets '{"arterial":24}' --why 'wider arterials'`, `novel settings set '${novel}' fill.ops '[]' --place loc_000001 --why 'none here' --before`,
    `novel settings unset '${novel}' fill.streets --why 'back'`, `novel settings diff '${novel}'`, `novel settings diff '${novel}' --from vol-1/0017-before`,
    `novel settings profile save '${novel}' old-town --why 'a look'`, `novel settings profile apply '${novel}' old-town --why 'the look' --before`, `novel settings profile list '${novel}'`,
    'novel warehouse list', 'novel warehouse list --source kit', `novel warehouse list '${novel}'`, `novel warehouse find 'pine tree'`, `novel warehouse find 'pine tree' --kind 'a small weapon' --top 5 '${novel}'`,
    'novel warehouse show kit:cw_nature_pine', `novel warehouse use kit:cw_nature_pine for prop:tree '${novel}' --why 'pines'`, `novel warehouse use kit:cw_veh_bus for 'vehicle:a bus' '${novel}' --why 'buses' --before`,
    `novel warehouse use kit:cw_bldg_house for use:house '${novel}' --why 'houses' --floors 1 3`,
    `novel warehouse fetch mykit https://github.com/x/y --licence MIT --ok 'yes, fetch it' --why 'more trees' --path assets/scad --limit 50`, 'novel warehouse refresh mykit',
    `novel warehouse add mykit '${packs}/mykit' --licence CC0-1.0 --why 'a kit on disk'`,
    `novel model nominate '${novel}'`, `novel model list '${novel}' --state todo`, `novel model brief '${novel}' 'the van'`, `novel model write '${novel}' --all --limit 5`, `novel model check '${novel}' --all`,
    `novel model use '${novel}' 'the van' kit:cw_veh_van --why 'a van'`, `novel model bind '${novel}'`, `novel model parts 'a small weapon'`,
    `novel look context '${novel}'`, `novel look context '${novel}' --place loc_000001 --top 12`,
    `novel warehouse interact kit:cw_veh_bus '${novel}'`, `novel warehouse interact 'an aircraft' '{"crash":{"degree":4,"radius":40}}' '${novel}' --why 'a wide-body'`,
  ]) assert.equal(authorize(command).kind, 'cli', command);
  assert.equal(authorize(`novel warehouse use kit:cw_nature_pine for prop:tree '${novel}' --why 'pines'`).label, 'novel warehouse use');
  for (const command of [
    `novel settings set '${novel}' fill.streets '{"arterial":24}'`, `novel settings set /tmp/other fill.streets '{}' --why x`, `novel settings show /tmp/other`, `novel settings set '${novel}' fill.streets '{}' --why x --output /tmp/leak`,
    `novel settings profile apply '${novel}' old-town`, `novel warehouse fetch mykit https://github.com/x/y --licence MIT --why 'no ok'`, `novel warehouse fetch mykit http://github.com/x/y --licence MIT --ok yes --why w`,
    `novel warehouse add mykit /tmp/other --licence MIT --why w`, `novel warehouse use kit:cw_nature_pine for lamp:tree '${novel}' --why w`, `novel warehouse use kit:cw_nature_pine for prop:tree /tmp/other --why w`,
    `novel warehouse use kit:cw_nature_pine for prop:tree '${novel}'`, `novel warehouse find 'tree' --top 500`, `novel model put '${novel}' 'the van' /tmp/van.scad`, `novel model write /tmp/other --all`,
    `novel model use '${novel}' 'the van' van`, `novel warehouse list --source 'kit; env'`, `novel look context /tmp/other`, `novel look context '${novel}' --top 500`, `novel warehouse interact kit:cw_veh_bus '{"solid":false}' '${novel}'`, `novel warehouse interact kit:cw_veh_bus /tmp/other`,
  ]) assert.throws(() => authorize(command), command);
});

test('the place tree: the assigned book only, a why for every decision and a sentence id where the text must show it', () => {
  for (const command of [
    `novel places tree '${novel}'`, `novel places check '${novel}'`, `novel places moves '${novel}'`, `novel places apply '${novel}'`,
    `novel places place '${novel}' loc_000001`, `novel places unit '${novel}' scene_000077`, `novel places units '${novel}' --unplaced --chapter 3`, `novel places units '${novel}' --place pool:loc_000001 --by carried`, `novel places hold '${novel}' unnamed:place_000095_1 pool:\u5b66\u56ed\u90fd\u5e02 --line b0003_s0294 --why 'his dorm'`,
    `novel places setting '${novel}' loc_000001 --line b0001_s0002 --why 'he walks its streets'`, `novel places mention '${novel}' loc_000009 --why 'only talked about'`,
    `novel places drop '${novel}' loc_000014 --why 'a food, not a place' --override`, `novel places hold '${novel}' unnamed:place_000095_1 pool:loc_000001 --line b0003_s0294 --why 'his dorm'`,
    `novel places set '${novel}' scene_000077 unnamed:place_000095_1 --line b0002_s1215 --why 'back at the dorm'`, `novel places same '${novel}' scene_000078 scene_000077 --why 'still there'`, `novel places same '${novel}' scene_000078 scene_000077 --through scene_000090 --why 'a run there'`, `novel places nowhere '${novel}' scene_000002 --why 'the blurb'`, `novel places wide '${novel}' scene_000007 --through scene_000010 --why 'a chase through the streets'`, `novel places merge '${novel}' unnamed:place_000078_3 unnamed:place_000095_1 --why 'one dorm'`,
    `novel places travel '${novel}' scene_000200 char_000001 --line b0006_s0010 --why 'he flies to London'`,
  ]) assert.equal(authorize(command).kind, 'cli', command);
  assert.equal(authorize(`novel places check '${novel}'`).label, 'novel places check');
  for (const command of [
    `novel places tree /tmp/other`, `novel places setting '${novel}' loc_000001 --why 'no line'`, `novel places set '${novel}' scene_000077 loc_000001 --line b0002_s1215`,
    `novel places hold '${novel}' unnamed:place_000095_1 --line b0003_s0294 --why 'no parent'`, `novel places same '${novel}' scene_000078 scene_000077 --why x --line b1 --why y`,
    `novel places drop '${novel}' loc_000014 --why 'x' --force`, `novel places rewrite '${novel}'`, `novel places units '${novel}' --chapter all`,
  ]) assert.throws(() => authorize(command), command);
});

test('the rooms: the assigned book only, a why for every decision, a sentence id but for what is not said', () => {
  for (const command of [
    `novel rooms rooms '${novel}'`, `novel rooms check '${novel}'`, `novel rooms room '${novel}' unnamed:place_000025_2`, `novel rooms stage '${novel}' scene_000026`,
    `novel rooms kind '${novel}' unnamed:place_000025_2 bedroom --line b0002_s0050 --why 'a single dorm room'`, `novel rooms kind '${novel}' unnamed:place_000025_2 'not said' --why 'never described'`,
    `novel rooms floor '${novel}' unnamed:place_000025_2 7 --line b0002_s0040 --why 'the seventh floor'`, `novel rooms part '${novel}' unnamed:place_000049_1 unnamed:place_000025_2 --line b0002_s0700 --why 'its entrance'`,
    `novel rooms opens '${novel}' unnamed:place_000025_2 balcony --line b0002_s0050 --why 'he opens the balcony door'`,
    `novel rooms at '${novel}' scene_000026 slot_000026_4 balcony --line b0002_s0060 --why 'over the rail'`, `novel rooms at '${novel}' scene_000027 char_000001 floor --through scene_000030 --line b0002_s0070 --why 'stays in'`,
  ]) assert.equal(authorize(command).kind, 'cli', command);
  assert.equal(authorize(`novel rooms check '${novel}'`).label, 'novel rooms check');
  for (const command of [
    `novel rooms rooms /tmp/other`, `novel rooms kind '${novel}' unnamed:place_000025_2 bedroom --line b0002_s0050`, `novel rooms at '${novel}' scene_000026 slot_000026_4 Balcony! --line b1 --why x`,
    `novel rooms at '${novel}' scene_000026 slot_000026_4 balcony --line b1 --why x --force y`, `novel rooms erase '${novel}'`, `novel rooms kind '${novel}' unnamed:place_000025_2 --why 'no kind'`,
  ]) assert.throws(() => authorize(command), command);
});

test('a whole volume and what it carries: the assigned book only, the runner\'s steps, a why where the agent decides', () => {
  for (const command of [
    `novel volume status '${novel}'`, `novel volume run '${novel}'`, `novel volume run '${novel}' --step terrain`, `novel volume run '${novel}' --until prefilm`,
    `novel volume log '${novel}' read`, `novel volume log '${novel}' direct --lines 80`, `novel volume done '${novel}' look --why 'models and settings set'`,
    `novel strands show '${novel}'`, `novel strands inherit '${novel}'`, `novel strands inherit '${novel}' --work --dry`,
    `novel strands set '${novel}' vol-1:scene_000002 inherited --why 'the same group goes on' --into vol-2:scene_000003`, `novel strands set '${novel}' vol-1:scene_000002 closed --why 'resolved'`,
  ]) assert.equal(authorize(command).kind, 'cli', command);
  for (const command of [
    'novel volume status /tmp/other', `novel volume run '${novel}' --step 'a;b'`, `novel volume done '${novel}' direct --why x`, `novel volume done '${novel}' look`, `novel volume run '${novel}' --step terrain --until x`,
    `novel strands register '${novel}'`, `novel strands keep '${novel}' --run d20261109081436`, `novel strands set '${novel}' vol-1:scene_000002 maybe --why x`, `novel strands set '${novel}' vol-1:scene_000002 closed`,
    `novel strands inherit '${novel}' --work --work`, 'novel strands show /tmp/other',
  ]) assert.throws(() => authorize(command), undefined, command);
});
