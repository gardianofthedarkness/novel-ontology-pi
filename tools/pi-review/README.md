# Scoped Pi review runner

Optional Pi SDK integration for the CLI, separate from its dependencies.
Node 22+, built CLI, and network access to DeepSeek and TypeSafe are required
for a live run. Tests use synthetic data and make no paid model calls.

## Setup

From the repository root:

```sh
npm ci
npm run build
npm ci --prefix tools/pi-review --ignore-scripts
npm test --prefix tools/pi-review
```

Supply `WORK_LLM_API_KEY` through your environment or secret manager.
TypeSafe uses `TYPESAFE_API_KEY` or the CLI's existing secure store
(`node dist/src/cli/cli.js jev login`). Never put either key in job JSON,
source control, command arguments, reports, or session shares.

The runner pins Pi SDK 1.4.0, requests `deepseek-flash` for Pi and CLI
extraction, and uses `jev-1.13.0` for decisions. The provider's API alias
does not independently establish a dated underlying model version.

## Run

Copy `job.example.json` to a private directory and place a UTF-8 `source.txt`
beside it. Paths in the job resolve relative to that JSON file, not the
shell's working directory. EPUB conversion is outside this runner.

```sh
node tools/pi-review/run.mjs /private/job.json
```

- `chapters: 4` assigns the first four chapter sections, including any
  prologue at index zero. Omit `chapters` to assign all blocks.
- `volumes` is an ordered list of `{id, input, workspace?}`. Each volume
  gets a separate database. Omitted workspaces are fresh and private
  inside this attempt. Specify a workspace deliberately to resume it;
  original input and 24,000-character block boundaries must be unchanged.
- `minutes` bounds the run. `limits` sets recalls/revisions per block and
  total command calls. The example's 2 recalls / 3 revisions are historical
  test settings, **not recommended universal limits for large packets**.
  Set explicit larger budgets before launching when warranted. No
  automatic/adaptive budget increase is implemented; exhausted budgets
  preserve held work. Successful audited recalls/revisions remain counted
  across restarts of an existing workspace.
- The task prompt is only: `Continue processing the full volumes using
  the novel-ontology skill.` Policy and repair instructions live in the
  concise skill and its on-demand reference, not novel-specific prompts.

Private output defaults to ignored `.pi-review/runtime/`; override its
parent with `NOVEL_REVIEW_HOME`. Each attempt has `job.json`,
`progress.json`, `approval-receipts.jsonl`, session files, private reports,
and pre-fix ontology checkpoints. `validation.json` is written after the
assigned blocks apply. `complete` means the assigned target passed the
checks; deferred proposal kinds and held semantic facts are reported separately.
`factsComplete` is distinct from processing completion.
`review` and `error` are not completion. Inspect the current attempt's
progress/error files, not just process termination.

## Gates and boundaries

Live-model smoke scripts must not use `--auto-approve`. To inspect extraction
alone, run `novel ingest ... --max-blocks 1` without that flag in a fresh private
workspace, then inspect the held packet with `changeset facts ... --summary`.
That is not canonical application or completed semantic review. Use this scoped
runner for independent end-to-end review; no operator override/accept-all smoke
path is provided. Enabling one would require a separate owner policy decision.

The custom Bash backend parses one allowlisted CLI/read command; it never
executes shell text. Commands are serialized, confined to manifest
workspaces, and cannot use `--auto-approve` or direct data writes. The
runner locks its runtime and each workspace. Do not delete a live writer's
lock or run a separate unrestricted CLI writer against the same database.
After a crash, verify the recorded PID is no longer active before manually
recovering a stale lock. These are cooperative locks, not an OS sandbox.

Semantic packets use `changeset facts` / `decide`: accepted assertions require
delivery of complete fact values and source excerpts for the current packet
and canonical-context revision. Missing/uncertain assertions remain held
outside canon; code validates spans and references. Pi does not optimize
segmentation or small event detection. Targeted replacements preserve unrelated
speakers and state. See [the policy and commands](../../docs/semantic-review.md).
Legacy approval still requires every source line and proposal/note page.
Receipts prove delivery, not comprehension or semantic accuracy.
Canonical fixes retain private checkpoints; held/applied packets cannot be
overwritten by ingest/recall to bypass review. A structural/packet-wide hold
stops the serial loop; individual held facts do not block unrelated supported
work. Held fact counts must not be presented as fully verified completion.

## Replay and projection

```sh
NOVEL_REVIEW_HOME=/private/review-home node tools/pi-review/replay.mjs \
  stability-YYYY-MM-DDTHH-MM-SS-mmmZ /private/replay.html
node tools/pi-review/validate-stability.mjs /private/attempt-directory
```

Replay sanitizes the actual JSONL session **before** Pi's native HTML
exporter sees it. Commands, gate errors, safe result metadata and Pi token
counts remain; narrative, thinking, source, arguments and raw tool output
stay private. Inspect exports before sharing. Costs are explicitly
unpriced; token counts omit nested CLI models. The exporter adapter uses
an internal SDK HTML module, so the dependency is pinned and the adapter
has an offline rendering test. Replay is a reloadable snapshot, not live
chat or a breakpoint debugger. No server or public tunnel is opened.

`snapshot(directory, metadataDirectory, options)` in `snapshot.mjs` projects
working drafts into ghosts, chapter grouping, graph edges, gate statuses,
and metadata-only activity for an authorized frontend. It intentionally
contains derived names/summaries: **it is not a source-free public export**.
Never serve arbitrary workspace files. The task-local tunnel/polling UI
is not packaged here; existing frontend transport contracts are unchanged.

Structural validation rejects dangling/mistyped references and overlapping
scene presence/mentions. The CJK-summary heuristic is only a warning check
for Chinese-containing inputs, not a general language detector or semantic
validation. Full-volume stability and automatic semantic correctness are
not established by a single integration test.

See the [real live-test report](../../docs/reports/pi-review-live-2026-10-22.md).
