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
  original input basename, applied prefix and 24,000-character block boundaries
  must be unchanged. The manifest assigns only unapplied blocks while the
  viewer retains every chapter; approval/application audit and stored source
  are checked before skipping an applied block.
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
Never serve arbitrary workspace files. `serve.mjs` provides a loopback-only,
expiring private viewer; public tunnel provisioning remains separate. A host
can also mount `streamSnapshots` from `live-stream.mjs` at the private
`api/live/stream` endpoint, using its existing authorized snapshot reader and
explicit expiry. The phone viewer prefers this stream and falls back to its
existing `api/live` polling endpoint when streaming is unavailable.

Structural validation rejects dangling/mistyped references and overlapping
scene presence/mentions. The CJK-summary heuristic is only a warning check
for Chinese-containing inputs, not a general language detector or semantic
validation. Full-volume stability and automatic semantic correctness are
not established by a single integration test.

### Live construction activity

The phone snapshot includes `activity`: actual observed faculty calls, the active
construction chapter, ordered visible touches, and ID-only EM merge/distinct
events. `faculty.activity` records correlate S1 decisions, ordinary CLI work and
actual S2 fallback starts/completions/failures. `draft.updated.touchedIds` names
only newly created or edited draft records (an entity candidate that matches a
known entity is announced under that entity's id, so it lights up in place);
each faculty carries its block, chapter and newest visible draft scene for the
viewer's faculty animations; resolved entity candidates arrive as
`candidate.resolved` join events (not EM decisions); source text and model payloads are
not transported. Several records published together are explicitly a batch,
not an invented ordering of parallel model decisions.

Activity follow frames the overview once when its actual page changes, never
re-centering the camera on consecutive edits in the same page. Navigation stops
at the scene overview: zooming reveals each scene's event/dialogue spheres
in-place, but double-click, keyboard entry and activity follow cannot promote
those contents into a separate uncoiled record timeline. Nested scene groups
remain navigable. A refresh cursor collects every visible touched ID since
the preceding snapshot; containing nodes and a shared blue bound highlight the
whole batch. Cross-scene batches choose their shared ancestor page. Headings,
breadcrumbs and edit captions follow the active page and current processor step.

The activity toggle follows work inside the existing orbital universe, navigating
the ordinary chapter and scene-group layers without flattening
them or mounting another graph. Toggle again to restore the bookmarked orbital
path, selected/revealed record, camera position/target, zoom, focal offset and
inspector. A blue wire box and readable label mark the latest visible touch or
its containing orbital node. Parallel dialogue ghosts can appear before scene
segmentation and attach in place once their parent scene arrives. Faculty
activity expands into the observed call graph; completed calls
are not presented as still running. EM notifications require real new events,
not replays of historical merges on reconnect. Historical sessions without
faculty-level telemetry explicitly cannot distinguish System 2 fallback from
ordinary CLI work-model calls. New instrumentation does not recover absent past
metadata or require restarting an in-flight paid job.

Live snapshots are pushed after file changes with a 100 ms coalescing window,
one projection in flight, and a two-second safety check for missed notifications.
The initial snapshot is followed by changed fields only; unchanged chapters are
not resent or re-laid out for faculty/counter updates. Gzip is flushed per SSE
frame to avoid tunnel buffering. Disconnects release file watchers; reconnects
receive current truth rather than queued obsolete animations. Slow clients are
disconnected instead of accumulating an unbounded stream backlog.
The activity count measures construction log records, not model calls: a real
packet can publish hundreds of proposals at once. Such batches are not slowed
down or split into fabricated intermediate agent steps.

### Observed Pi merge-review progress

The optional `activity.review` projection reads actual scoped Bash tool requests
and results from the SDK's local session journal. It incrementally processes
complete UTF-8 JSONL records, coalesces concurrent readers, caps file/read/cache
sizes, and never modifies the journal or sends a prompt. Old or unavailable
session telemetry remains explicitly unavailable. No worker restart is needed
to attach a newly started observer/viewer to an existing SDK session.

The expandable Pi review panel identifies the book, chapter, ChangeSet, revision,
fact/proposal/evidence page or source-line range and semantic field types.
Observed fact reads are deduplicated within a revision and reset on a new one;
they are not proof of understanding, acceptance or extraction accuracy. Actual
decision counts are displayed separately. Requests are labelled requested, not
claimed to be executing simultaneously. Failed or oversized reads do not earn
read coverage. Raw tool output, source excerpts, model thinking, correction
payloads, command paths and private review reasons are not exported.

Review targets use their existing proposal-to-node mapping and containing-scene
highlights. They do not increment construction counts or fabricate edits. Review
captions and passive record selection use the current review targets rather than
the previous extraction write. Inactive/older review history cannot steal focus
from newer construction, and reading mode retains the user's independent view.

### Interactive Pi console

`PiConsole` is an expandable glass overlay showing actual command/status entries
and user/assistant messages. It uses private host endpoints `GET api/pi` and
`POST api/pi/messages`, not an unrestricted terminal. Hosts mount `createPiConsole`
from `pi-console.mjs` behind the existing private viewer path. POST additionally
requires an independent `X-Pi-Control` capability and an exact allowed Origin;
the operator link supplies that capability in its fragment, never a query string.
Keep the queue/configuration outside the public web root and set explicit expiry.

`runConsoleSession` serially delivers queued messages to the real Pi SDK session.
It makes no model calls until a user message arrives. Existing scoped Bash and
review/merge guards wrap that session unchanged. `run.mjs --interactive` uses the
same database and remaining source blocks, not a replay or a new extraction
pipeline. It generates the private console capability after checking credentials.

Build the CLI/frontend and install the optional SDK first, then use the same
private home for the runner and viewer in separate terminals:

```sh
npm run build --prefix apps/playground
NOVEL_REVIEW_HOME=/private/review-home node tools/pi-review/run.mjs \
  /private/job.json --interactive
NOVEL_REVIEW_HOME=/private/review-home node tools/pi-review/serve.mjs \
  --port 4324 --minutes 90
```

Open the printed operator link, expand **Pi console**, and send your instruction.
Starting either process never sends a continuation prompt. For an independently
authorized tunnel, set `--origin https://your-tunnel-host` explicitly; the server
still binds only `127.0.0.1`. Do not share the operator capability in PRs/issues.
Keep `minutes` within the runner's job window. Server/worker expiry and stale
heartbeat checks disable messages rather than silently extending access.
The portable host does not mount session replay; use the source-redacted CLI
export described earlier when needed. It never serves raw source or reports.

Queue records are private, bounded and UUID-deduplicated across processes and
restarts. Queued, processing, consumed and failed are distinct; ambiguous claims
are retained without automatic paid replay. A worker heartbeat controls whether
the composer accepts messages. Replies are bounded text; command arguments,
raw tool outputs, credentials and private review payloads are not exported by
the transcript projector. Messages arriving during a turn wait for that turn to
finish; opening or expanding the viewer never starts the next chapter.

See the [real live-test report](../../docs/reports/pi-review-live-2026-10-22.md).
See also the [orbital activity and console validation](../../docs/reports/orbital-live-console-2026-10-24.md).
