# Team development playground (optional)

This root-level `playground/` directory is a team development and testing harness,
not an end-user installation requirement. End users run the CLI + skill natively;
Docker is optional even for teammates. The shared frontend stays in
`apps/playground/` and the scoped Pi runner stays in `tools/pi-review/`.

Share code and a rights-cleared synthetic fixture, not the private commercial
novels or a running Mac's credentials/database. Each teammate gets a separate
local runtime and database. The native graph is rebuilt on that machine.

## What is included

- **Lantern Harbor v1:** original synthetic Chinese fiction, two chapters,
  eight scenes, three characters and two locations. Text and illustrative
  annotations: CC0-1.0; application code: MIT. See the
  [dataset card](fixtures/lantern-harbor/DATASET_CARD.md).
- A deterministic populated **reference** snapshot for inspection, with real
  JSONL, native Cypher queries, original-text endpoints and the orbital UI.
- A separate empty **live** database for the actual Pi + skill + scoped CLI
  loop. Hand-authored annotations are never inserted as Pi-approved results.
- A private backend-connected Vite HMR preview. Frontend edits do not restart
  the agent or start extraction. Configuration changes may reload the page.
- An allowlisted share-archive exporter with exact file hashes and provenance.
  No private book, provider key, runtime queue, operator link or native graph
  file is meant to travel with the package.

This fixture is not an accuracy benchmark, human gold set or proof of a
successful model extraction. The live pipeline may produce different results.

## Optional team setup: Docker Compose

If your team prefers containers, install Docker with Compose. Otherwise use
[Native local development](#native-local-development) below. From the
repository/package root:

```sh
docker compose -f playground/compose.yaml up --build
```

The default is **view mode**, a clearly labelled read-only illustrative snapshot.
No provider credentials, Pi prompt or model call is required. Open the full
`Read-only link` printed in the logs. Bare `http://127.0.0.1:5180/` returns 401
intentionally. The unguessable `/view/.../` path is required for assets and APIs.

Compose publishes only `127.0.0.1:5180`. The container runs as non-root and
persists sessions in the `playground-data` named volume. Frontend `src/` is
mounted read-only from this checkout for HMR; edit it on the host. Pick another
host port with `PLAYGROUND_PORT=5181 docker compose -f playground/compose.yaml up --build` if necessary.
Each teammate should use a separate clone/local Docker project, not share a
single writable volume. The current package uses an official Node 24.3.0 Debian
image and committed npm lockfiles. The image tag is version-pinned, not digest-
pinned. Native dependencies must support the target architecture.

### Real idle Pi mode

Supply **your own** credentials using your secret manager or a secure terminal
environment. Do not paste them into chat, source, shell command arguments,
dataset files, Dockerfiles, image build arguments or a shared `.env` file.
The required variable names are `WORK_LLM_API_KEY` and `TYPESAFE_API_KEY`.

```sh
PLAYGROUND_MODE=agent docker compose -f playground/compose.yaml up --build
```

Open the printed **operator** URL, including its `#pi=...` fragment, and expand
Pi console. It hosts the real Pi SDK/skill/CLI against the fresh synthetic source
database. No task is sent during startup. Try an explicit instruction such as
“Process the first chapter of the assigned synthetic story.” Viewing, opening
the console, HMR and health checks do not send model prompts. Read-only URLs
cannot submit messages. The operator capability must stay private.

The runner currently uses DeepSeek `deepseek-flash` and Jev `jev-1.13.0`; it does
not take arbitrary provider endpoints from this launcher. API aliases are not
claims about an underlying dated model release. Time, command and per-block
recall/revision bounds apply; they are **not a hard dollar/token spending cap**.
Normal independent review, source/revision coverage and merge gates remain.
There is no auto-approve path or automatic paid retry of failed user messages.

Stop gracefully with Ctrl-C or `docker compose -f playground/compose.yaml down`. Do not use `down -v` unless
you deliberately want to delete the saved test sessions. No automatic restart
policy renews sessions or resumes paid work. The default session is two hours;
`PLAYGROUND_MINUTES` can set 1–240. Expiry shuts down hosting and the worker.

## Native local development

Node 24.3.0 (or compatible Node 22+), npm, and the target platform's Ladybug
native addon are required. No Python dependency is needed for the built-in
fixture; the optional EPUB importer uses Python 3.

```sh
npm ci
npm ci --prefix tools/pi-review --ignore-scripts
npm ci --prefix apps/playground
npm run build
npm run build --prefix apps/playground
npm run playground:team
```

With credentials in the environment, use the real idle agent instead:

```sh
npm run playground:team -- --mode agent
```

`--home /private/team-playground`, `--port 5180`, `--minutes 120` and
`--origin https://your-exact-authorized-host` override the runtime defaults.
Environment equivalents are `PLAYGROUND_HOME`, `PLAYGROUND_PORT`,
`PLAYGROUND_MINUTES`, `PLAYGROUND_MODE`, `PLAYGROUND_ORIGIN`. Native hosting
binds to loopback. `PLAYGROUND_CONTAINER=1` binds the outer gateway to all
container interfaces; Compose keeps its published host port loopback-only.
The inner viewer, model observer and HMR service stay loopback-bound.

## Runtime and isolation

The ignored `.team-playground/` directory, or the chosen home, contains:

```text
host.lock
active.json
session-<time>-<random>/
  dataset-manifest.json
  lantern-harbor.txt
  reference/              # illustrative source-bound fixture
  metadata/               # chapter/block source mapping
  live/                   # separate fresh processing database
  job.json
  runtime/                # private Pi queue, sessions and audit
  links.json              # private viewer/operator capabilities
```

`dataset-manifest.json` records fixture/source SHA-256, schema, counts and npm
lockfile hashes. Its Git revision identifies the base commit, not uncommitted
changes. Exported packages have an exact additional source-file manifest.
There are no fabricated extraction, approval or causal-certificate records.

One host owns `host.lock`. Do not start a second writer or delete an active
lock. After a crash, verify PID ownership and inspect the retained session
before recovering a stale lock. The next normal launch creates a new fresh live
workspace; old sessions remain saved, but this v1 launcher does **not** auto-
resume an old session or provide multi-user accounts/workspace routing.

## Make a shareable package / dataset

```sh
npm run playground:team:package -- --out /private/team-playground-v1.tar.gz
```

This builds an explicitly allowlisted source distribution plus a portable
`datasets/lantern-harbor-v1/` snapshot, dataset card, source, metadata and
checksums. It excludes native `.lbug` files, sessions and arbitrary data files.
Existing output paths are refused. Extract the archive, inspect
`TEAM-PACKAGE.json`, then use the same setup instructions. The archive contains
the current allowed working-tree files, not only committed HEAD. It is a minimal
runtime/developer distribution, not a complete mirror of every repository doc.

Before installing anything, verify the extracted package using only Node's
standard library:

```sh
node playground/verify-package.mjs
```

The standalone verifier checks listed file hashes and rejects traversal/symlinks.
Checksums detect corruption/tampering relative to the manifest, not a forged
publisher identity. Obtain the archive and its published SHA-256 from a trusted
channel; the manifest is not a cryptographic release signature.

The secret-pattern scan is a precaution, not proof that arbitrary code/data is
safe to publish. Review the file manifest and source rights before uploading.
Do **not** substitute the old `novel bundle export` output without review: that
general-purpose transfer includes original text and ChangeSet audit records.

Recommended sharing:

- **GitHub:** code/Compose and a reviewed release archive or PR. No upload or
  release is created by these scripts.
- **Hugging Face Dataset:** upload only the reviewed
  `datasets/lantern-harbor-v1/` folder from the archive, with its CC0 dataset card.
  Private commercial-novel datasets require separate rights/access review.
- **Private Docker Space:** `playground/Dockerfile` (build context: repository root) is a starting point.
  A Space needs `sdk: docker`, `app_port: 8080`, `PLAYGROUND_CONTAINER=1`, its exact
  `PLAYGROUND_ORIGIN`, runtime Secrets for agent mode, and persistent storage
  mounted/configured through `PLAYGROUND_HOME`. Use separate instances for
  independent writers. This package does not provision authentication, platform
  storage, billing limits or a Space; do not publish an open shared Pi operator.

## Optional private historical Vol1 data

The separately hosted [Vol1 developer snapshot](https://huggingface.co/datasets/gardianofthedarkness/novel-ontology-vol1-dev)
is **private**, personally owned, and currently accessible only to its owner.
GitHub collaborators do not automatically get Hugging Face access. Team access
requires a separately authorized arrangement; do not make the dataset public.
It contains third-party novel text and historical extraction, not CC0 data,
a gold benchmark, or newly certified facts. No redistribution rights are granted.
The public synthetic fixture remains the default for every playground command.

An authorized account can download the pinned snapshot using the Hugging Face
CLI after authenticating through its normal secure login flow:

```sh
hf download gardianofthedarkness/novel-ontology-vol1-dev PRIVATE-vol1-dev-v1.tar.gz \
  --repo-type dataset --revision 86d878de44e19b94e0a55d9ca8023cc7b83d85fd \
  --local-dir .team-playground/imports/vol1
shasum -a 256 .team-playground/imports/vol1/PRIVATE-vol1-dev-v1.tar.gz
```

Expected SHA-256:
`af5a2266ef3e2b642408f0efef0d0c5519269f2664234cdf70189168976fb8fb`.
Keep downloaded data ignored and private. Follow the archive's README and
integrity manifest, import into a disposable workspace, and rebuild its native
graph. Never overwrite a live writer's database. The archive excludes credentials,
operator links, Pi sessions, private audit reasons, raw model responses,
ChangeSets, original EPUBs, and native graph files. No paid processing or public
hosting starts from downloading it; provider credentials are supplied separately.

## Phone access and development safety

Only open a tunnel when the owner explicitly asks. Tunnel the protected outer
gateway, not raw Vite, repository folders, runtime data or the model observer.
Set its exact external HTTPS origin before hosting. Host/Origin, private path,
independent message capability and HMR WebSocket token checks remain enabled.
Do not rewrite the tunnel Host to localhost or set Vite allowedHosts to true.
Stop the tunnel at the authorized expiry; a tunnel does not extend Pi's session.

The default live design stack is **idle Pi + real scoped backend + connected
hot frontend**. View mode is explicitly a read-only illustrative exception,
not evidence of live construction. Never manufacture activity, modify a live
writer's database, silently spend provider credits or present held facts as
verified canon just to populate a screenshot.

## Validation

```sh
npm run playground:team:test
```

Tests use synthetic data/credentials only, never submit a model prompt, and
exercise reference queries, original scene/dialogue text, fresh-workspace
isolation, idle real Pi startup, permissions, private-path/Origin guards,
actual HMR file updates and simulated phone-origin proxying. Loopback binding
must be permitted. Integration tests are separate from semantic-accuracy tests.
