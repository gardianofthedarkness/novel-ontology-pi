/**
 * The Adaptor — host descriptors (roadmap decisions #20/#21).
 *
 * ONE adaptor makes the Skill + CLI installable into every popular
 * agent host. Following the pattern proven by REA (morluto/rea —
 * `npx rea-agents setup`): a single canonical skill, a registry of
 * per-host descriptors, and a setup flow that plans, asks, applies
 * with backups, and verifies. Per-host differences live ONLY in
 * these descriptors — the same decoupling as the language maps
 * (src/ground/language/languageMap.ts): swap or add a host by
 * adding data, never by editing the engine.
 *
 * This module is the registry and the data. The setup engine
 * (plan → approve → apply-with-backup → verify, one acceptance
 * test per host) is Track C's build; descriptors marked
 * verified:false carry research-based paths that the engine's
 * first pass must confirm against the host's own docs.
 */

export type ConfigFormat = "json" | "toml" | "yaml" | "markdown";

export interface HostConfigFile {
  /** Path as written by setup; ~ is the user's home. */
  path: string;
  scope: "project" | "global";
  format: ConfigFormat;
  /** What setup registers in this file. */
  purpose: string;
}

export interface AgentHost {
  /** Stable selection id, e.g. "claude-code". */
  id: string;
  label: string;
  /** "specified": paths researched and structured. "stub": known
   *  host, descriptor to be completed when its setup lands. */
  status: "specified" | "stub";
  /** Whether these paths were confirmed against the host's docs. */
  verified: boolean;
  /** Where setup installs the canonical Skill (skills/novel-ontology). */
  skillTargets: { scope: "project" | "global"; path: string }[];
  /** Host config files setup registers the CLI into. */
  configFiles: HostConfigFile[];
  /** Instruction bridge file, when the host does not read the
   *  shared canon (AGENTS.md) directly. */
  instructionsBridge?: string;
  notes: string;
}

const REGISTRY = new Map<string, AgentHost>();

export const registerAgentHost = (host: AgentHost): AgentHost => {
  REGISTRY.set(host.id, host);
  return host;
};

export const listAgentHosts = (): AgentHost[] => [...REGISTRY.values()];

export const getAgentHost = (id: string): AgentHost => {
  const host = REGISTRY.get(id);
  if (!host) {
    throw new Error(
      `unknown agent host "${id}" — registered hosts: ${[...REGISTRY.keys()].join(", ")}`,
    );
  }
  return host;
};

registerAgentHost({
  id: "pi",
  label: "Pi (earendil-works/pi-coding-agent)",
  status: "specified",
  verified: false,
  skillTargets: [
    { scope: "project", path: ".pi/skills" },
    { scope: "global", path: "~/.pi/agent/skills" },
  ],
  configFiles: [
    {
      path: "~/.pi/agent/settings.json",
      scope: "global",
      format: "json",
      purpose: "Host settings; the CLI itself is driven through the Skill, no MCP registration needed.",
    },
  ],
  notes:
    "The project's home host: the Skill + CLI bundle was designed Pi-first (SKILL.md is the workflow contract; tools/pi-review already drives the CLI from Pi). Setup mainly installs the Skill and walks key entry (novel jev login).",
});

registerAgentHost({
  id: "codex",
  label: "Codex (OpenAI)",
  status: "specified",
  verified: false,
  skillTargets: [
    { scope: "project", path: ".agents/skills" },
    { scope: "global", path: "$CODEX_HOME/skills" },
  ],
  configFiles: [
    {
      path: "$CODEX_HOME/config.toml",
      scope: "global",
      format: "toml",
      purpose: "Host config (default ~/.codex/config.toml). TOML must be edited preserving comments and existing entries — REA's setup acceptance tests treat comment preservation as a hard requirement; ours will too.",
    },
  ],
  notes:
    "Codex reads the shared .agents/skills canon directly (the layout REA's own repo uses for its skills), so setup is a publish step plus config verification.",
});

registerAgentHost({
  id: "claude-code",
  label: "Claude Code (Anthropic)",
  status: "specified",
  verified: false,
  skillTargets: [
    { scope: "project", path: ".claude/skills" },
    { scope: "global", path: "~/.claude/skills" },
  ],
  configFiles: [
    {
      path: ".mcp.json",
      scope: "project",
      format: "json",
      purpose: "Project MCP registration, if/when the CLI grows an MCP surface; strict-JSON editing (no comments, no trailing commas).",
    },
    {
      path: "~/.claude.json",
      scope: "global",
      format: "json",
      purpose: "Global host config; setup edits must be surgical and backed up.",
    },
  ],
  instructionsBridge: "CLAUDE.md",
  notes:
    "Claude Code does not read AGENTS.md when a CLAUDE.md exists; the adaptor writes CLAUDE.md as a one-line bridge (@AGENTS.md) so the shared canon stays the single source — the one-canon pattern used across multi-agent repos.",
});

registerAgentHost({
  id: "cursor",
  label: "Cursor",
  status: "stub",
  verified: false,
  skillTargets: [{ scope: "project", path: ".agents/skills" }],
  configFiles: [],
  notes:
    "Reads the shared .agents/skills canon and AGENTS.md directly; native .cursor rules bridge to be specified when its setup lands.",
});

registerAgentHost({
  id: "gemini-cli",
  label: "Gemini CLI",
  status: "stub",
  verified: false,
  skillTargets: [{ scope: "global", path: "~/.gemini/skills" }],
  configFiles: [
    {
      path: "~/.gemini/settings.json",
      scope: "global",
      format: "json",
      purpose: "Host settings / MCP registration; workspace-trust behavior must be handled by setup (REA ships a dedicated acceptance test for it).",
    },
  ],
  notes: "Descriptor to be completed when its setup lands.",
});
