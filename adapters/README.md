# The Adaptor — one adaptor, every agent host

The product has four parts (roadmap decision #21): **Skill + CLI +
Adaptor + Frontend**. This directory is the Adaptor's home: it makes
the Skill and the CLI installable into any popular agent host — Pi,
Codex, Claude Code, and peers — in each host's native format, in one
step.

## The pattern (researched Oct 24, 2026)

The reference implementation is **REA — Reverse Engineer Anything**
([github.com/morluto/rea](https://github.com/morluto/rea), MIT; the
"Reverse Engineer Everything" project), a skill+CLI/MCP repo whose
setup went viral in Oct 2026. How REA does multi-agent adaptation:

- **One canonical skill set.** Skills live once, in
  `.agents/skills/<name>/SKILL.md` with `references/` and per-skill
  metadata (`agents/openai.yaml`). Root `AGENTS.md` is the shared
  instruction canon. Nothing is duplicated per host.
- **One setup command.** `npx rea-agents setup`: the user picks
  agents, **reviews a proposed plan, approves it**, and setup applies
  it — registering the server and publishing the matching workflow
  instructions into each host — **with backups of existing
  configuration** and rollback on failure.
- **A per-host "client" layer.** Each host is a client module with
  its own config quirks (Claude Code: strict JSON; Codex: TOML edited
  *preserving comments*; Gemini: workspace trust; plus Pi, OpenCode,
  Hermes, Qwen and more). Setup is a plan/apply engine over these
  descriptors: `SetupPlan`, `SetupClients`, `SetupSkill`,
  `SetupRecoveryBackup` in their `src/application/`.
- **An acceptance test per host.** Their suite has one setup test
  per client (`piClientSetup`, `codexToolPolicySetup`,
  `claudeCodeStrictJsonSetup`, `geminiWorkspaceTrust`, …) — a host
  is not "supported" until its setup test passes.

The same shape appears in addyosmani/agent-skills: a shared `skills/`
core plus thin per-host adapter surface (`.claude/commands/`,
`.claude-plugin/`, `.gemini/commands/`, `.codex-plugin/`) — host
paths are *native discovery conventions*, never renamed or merged.

## Our adaptor

- **Canon:** `skills/novel-ontology/` (the Skill, with subskills
  mirroring the CLI groups) stays the single source. Setup publishes
  it; it is never forked per host.
- **Registry:** `src/adapters/hosts.ts` holds one descriptor per
  host — skill install targets, config files and their formats,
  instruction bridges. Adding a host = adding a descriptor (the
  language-map decoupling, decision #19, applied to agents).
- **Engine (Track C builds it):** `novel setup [--agent <id>|all]
  [--plan]` — compute the plan, show it, apply on approval with
  backups, verify by read-back; `novel setup --verify` re-checks an
  install. One acceptance test per host before it is listed as
  supported.
- **Bridges, not copies:** hosts that don't read the shared canon
  directly get a one-line bridge (e.g. Claude Code's `CLAUDE.md`
  containing `@AGENTS.md`).

## Status

Descriptors for Pi, Codex and Claude Code are specified from
research (`verified: false` — paths to be confirmed against each
host's docs during the engine's first pass); Cursor and Gemini CLI
are stubs. The setup engine itself is Track C's build task
(roadmap decision #20).
