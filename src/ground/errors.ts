import { LADYBUG_DDL } from "./ontology/schema.js";

/**
 * CLI error reports for agents and scripts. Every failure prints one JSON
 * object on stderr and exits with the code of its aspect, so a caller knows
 * WHAT kind of thing went wrong and what to do, not just that it failed:
 *
 *   { "error": "<message>", "aspect": "query", "code": "QUERY_UNKNOWN_PROPERTY",
 *     "hint": "…", "next": ["<command>", …], "details": { … } }
 *
 * Aspects (exit code): usage (2) — arguments or options; path (3) — a
 * directory or file that is not a workspace/library/source; not_found (3) —
 * an id that does not exist; query (4) — Cypher the graph cannot run; graph
 * (4) — the graph is missing or older than the schema; review (5) — a gate
 * decision the packet does not accept; stale (5) — the packet or context
 * changed since it was read; evidence (5) — original evidence not read in
 * full; conflict (5) — the fact contradicts stored canon (exists, loops,
 * second parent, order); source (5) — the stored original is missing or
 * changed; model (6) — credentials or a model call; budget (6) — a run
 * window or call budget; internal (1) — anything else (a bug to report).
 *
 * Throw `NovelError` where the aspect is known; plain errors are classified
 * by message so the 400+ existing throw sites report usefully too.
 */
export type ErrorAspect = "usage" | "path" | "not_found" | "query" | "graph" | "review" | "stale" | "evidence" | "conflict" | "source" | "model" | "budget" | "internal";
/** Where the problem is: an argument of the command (0 = the verb), a decision in a batch, or text inside an argument (a query). */
export type ErrorSpan = { argument: number; text: string } | { decision: number; factId?: string | null } | { argument: number; text: string; offset: number; length: number };
/**
 * A fix, with how safe it is to apply (as rustc grades its suggestions):
 * machine-applicable — the corrected command is certainly what was meant;
 * maybe-incorrect — likely right, check it against the evidence first;
 * has-placeholders — the shape is right, fill in the <…> parts.
 */
export interface Suggestion { message: string; applicability: "machine-applicable" | "maybe-incorrect" | "has-placeholders"; command?: string[] }
export interface ErrorInfo {
  aspect: ErrorAspect; code: string; hint?: string; next?: string[]; details?: Record<string, unknown>;
  span?: ErrorSpan;
  /** What the system observed while diagnosing (evidence for the suggestions). */
  notes?: string[];
  suggestions?: Suggestion[];
}
export interface ErrorReport extends ErrorInfo { error: string; /** `novel explain <code>` prints the long explanation. */ explain?: string }

export const EXIT_CODES: Record<ErrorAspect, number> = { internal: 1, usage: 2, path: 3, not_found: 3, query: 4, graph: 4, review: 5, stale: 5, evidence: 5, conflict: 5, source: 5, model: 6, budget: 6 };

export class NovelError extends Error {
  constructor(message: string, readonly info: ErrorInfo) { super(message); this.name = "NovelError"; }
}

/** The graph's tables as agents can query them: node properties and relationship endpoints. */
export function graphSchema(): { nodes: Record<string, string[]>; relationships: Record<string, string> } {
  const nodes: Record<string, string[]> = {}, relationships: Record<string, string> = {};
  for (const statement of LADYBUG_DDL) {
    const node = statement.match(/CREATE NODE TABLE IF NOT EXISTS (\w+)\(([\s\S]*)\)\s*$/);
    if (node) { nodes[node[1]] = node[2].split(",").map((part) => part.trim().split(/\s+/)[0]).filter((column) => column && column !== "PRIMARY"); continue; }
    const rel = statement.match(/CREATE REL TABLE IF NOT EXISTS (\w+)\(([\s\S]*)\)\s*$/);
    if (rel) {
      const pairs = [...rel[2].matchAll(/FROM (\w+) TO (\w+)/g)].map((match) => `${match[1]}->${match[2]}`);
      const props = rel[2].split(",").map((part) => part.trim()).filter((part) => !part.startsWith("FROM")).map((part) => part.split(/\s+/)[0]);
      relationships[rel[1]] = `${[...new Set(pairs)].join(" | ")}${props.length ? ` {${props.join(", ")}}` : ""}`;
    }
  }
  return { nodes, relationships };
}

export const distance = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const current = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; }
  }
  return row[b.length];
};
export const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
/** Closest known names (snake_case variants first). */
export function closest(name: string, known: string[], count = 3): string[] {
  const exact = known.filter((candidate) => candidate === snake(name) || candidate.toLowerCase() === name.toLowerCase());
  const ranked = [...new Set(known)].map((candidate) => ({ candidate, score: distance(snake(name), candidate) })).sort((first, second) => first.score - second.score).filter((entry) => entry.score <= Math.max(2, Math.floor(name.length / 2))).map((entry) => entry.candidate);
  return [...new Set([...exact, ...ranked])].slice(0, count);
}

/** Workspace/library and packet arguments of the failing command, to build next commands. */
function argsOf(command: string[]) {
  const [verb, operation] = command;
  const dir = command.find((value, index) => index > 0 && value.startsWith("/") && !/\.(txt|epub|json)$/i.test(value)) ?? (operation && !operation.startsWith("--") && ["query", "search", "inspect", "init", "match", "recall"].includes(verb) ? operation : command[2]);
  const packet = command.find((value) => /^(cs_|uc_|ua_|plan_)/.test(value));
  const flag = (name: string) => { const index = command.indexOf(name); return index >= 0 ? command[index + 1] : undefined; };
  return { verb, operation, dir, packet, scope: flag("--scope") ?? "book", universe: flag("--universe") };
}

/** Properties agents reach for that the graph names differently. */
export const PROPERTY_ALIASES: Record<string, string> = {
  name: "canonical_name", names: "canonical_name (aliases are not in the graph)", canonicalName: "canonical_name", aliases: "canonical_name (aliases are not in the graph)",
  kind: "label(n)", type: "label(n) / label(r)", _label: "label(n)", label: "label(n)",
  location_id: "the LOCATED_AT relationship: (s:Scene)-[:LOCATED_AT]->(l:Location)", locationId: "the LOCATED_AT relationship: (s:Scene)-[:LOCATED_AT]->(l:Location)",
  summary: "summary_en", chapter: "chapter_index", chapterIndex: "chapter_index", primary_actors: "the PARTICIPATES_IN relationship: (c:Character)-[:PARTICIPATES_IN]->(e:Event)", entity_id: "id",
};
const QUERY_TIPS = "Ladybug Cypher: label(n) instead of n:Label in WHERE or type(r); string literals in single quotes; properties are snake_case (canonical_name, chapter_index, summary_en). Source text is not in the graph: use novel search or the evidence pages.";

/** Describe any thrown value as an agent-readable report. */
export function describeError(error: unknown, command: string[] = []): ErrorReport {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");
  const args = argsOf(command);
  const reviewNext = args.packet && args.dir ? [`novel review show ${args.dir} ${args.packet} --scope ${args.scope}${args.universe ? ` --universe ${args.universe}` : ""} --offset 0 --limit 20`] : undefined;
  if (error instanceof NovelError) return { error: message, ...error.info, ...(error.info.aspect === "review" && !error.info.next && reviewNext ? { next: reviewNext } : {}), explain: `novel explain ${error.info.code}` };
  const report = (aspect: ErrorAspect, code: string, extra: Omit<ErrorInfo, "aspect" | "code"> = {}): ErrorReport => ({ error: message, aspect, code, ...extra, explain: `novel explain ${code}` });
  let match: RegExpMatchArray | null;

  if ((match = message.match(/^Usage: ([\s\S]+)/))) return report("usage", "USAGE", { hint: `Expected: ${match[1].split("\n")[0]}`, next: ["novel help"] });
  if (/not a novel workspace|novel directory not found|no ontology\/manifest\.json/i.test(message)) return report("path", "WORKSPACE_NOT_FOUND", { hint: "The directory is not a novel workspace. Use an assigned workspace path (NOVEL_JOB.json volumes[].workspace) or create one with novel init.", details: { path: args.dir } });
  if (/graph store not found|build it first/i.test(message)) return report("graph", "GRAPH_MISSING", { hint: "The query graph has not been built for this workspace.", next: args.dir ? [`novel graph build ${args.dir}/ontology`] : undefined });
  if ((match = message.match(/Table (\w+) does not exist/))) {
    const schema = graphSchema();
    if (schema.nodes[match[1]] || schema.relationships[match[1]]) return report("graph", "GRAPH_OUTDATED", { hint: `${match[1]} exists in the current schema but not in this graph: it was built by an older version. Rebuild it.`, next: args.dir ? [`novel graph build ${args.dir}/ontology`] : undefined });
    const guesses = closest(match[1], [...Object.keys(schema.nodes), ...Object.keys(schema.relationships)]);
    const special = /^(Entity|Node)$/i.test(match[1]) ? `There is no ${match[1]} table: entities are stored per kind (${Object.keys(schema.nodes).slice(0, 5).join(", ")}, …). ` : /^(Sentence|Block|Text|Source)$/i.test(match[1]) ? "Source text is not in the graph: use novel search <book> <text> or read the evidence pages. " : "";
    const relationship = /^[A-Z_]+$/.test(match[1]) ? `Relationship tables: ${Object.keys(schema.relationships).join(", ")}. ` : `Node tables: ${Object.keys(schema.nodes).join(", ")}. `;
    return report("query", "QUERY_UNKNOWN_TABLE", { hint: `${special}${guesses.length ? `Did you mean ${guesses.join(" or ")}? ` : ""}${relationship}${QUERY_TIPS}`, details: { table: match[1], schema } });
  }
  if ((match = message.match(/Cannot find property (\S+) for (\w+)/))) {
    const schema = graphSchema();
    const every = [...new Set(Object.values(schema.nodes).flat())];
    const alias = PROPERTY_ALIASES[match[1]];
    const guesses = alias ? [alias] : closest(match[1], every);
    return report("query", "QUERY_UNKNOWN_PROPERTY", { hint: `No property ${match[1]} on ${match[2]}.${guesses.length ? ` Use ${guesses.join(" or ")}.` : ""} ${QUERY_TIPS}`, details: { property: match[1], variable: match[2], schema } });
  }
  if ((match = message.match(/function (\w+) does not exist/i))) return report("query", "QUERY_UNKNOWN_FUNCTION", { hint: `${match[1]}() is not available.${/^type$/i.test(match[1]) ? " Use label(r) for a relationship's type." : ""} ${QUERY_TIPS}`, details: { function: match[1] } });
  if (/Parser exception|Binder exception|Variable .* is not in scope|Catalog exception/.test(message)) return report("query", "QUERY_INVALID", { hint: QUERY_TIPS, details: { schema: graphSchema() } });
  if (/must start with MATCH|read-only|write clauses/i.test(message) && args.verb === "query") return report("query", "QUERY_NOT_READ_ONLY", { hint: "novel query runs one read-only MATCH … RETURN statement." });

  if (/Stale .*revision|revision .*stale|changed since|Stored places changed/i.test(message)) return report("stale", "STALE_REVISION", { hint: "The packet or canonical context changed after you read it. Read the current pages again and decide with the new revision.", next: reviewNext });
  if (/Incomplete original evidence|evidence pages? (first|must)|Read every|read the evidence/i.test(message)) return report("evidence", "EVIDENCE_INCOMPLETE", { hint: "Read every evidence page of the fact (novel review evidence … --fact <id>, following page.nextOffset) before accepting it.", next: reviewNext });
  if (/Decision #\d+|Invalid, duplicate or unknown fact decision|Duplicate decisions|at most \d+ fact decisions|Unknown semantic fact|Invalid factId|explicit decisions/i.test(message)) return report("review", "DECISION_INVALID", { hint: "Each decision is {factId (from review show), verdict: accept|hold|reject, reason (non-empty)}; at most 50 per call; each factId once.", next: reviewNext });
  if (/already (applied|linked|exists|has a parent)|A CAUSES link already exists|exactly one parent|loop|cycle|contradict|same entity|two parents|refused/i.test(message)) return report("conflict", "CONFLICTS_WITH_CANON", { hint: "The assertion contradicts stored canon or repeats it. Hold it with the reason; do not force it." });
  if (/Original source changed|source provenance mismatch|unambiguous stored source|stored source|Source text changed/i.test(message)) return report("source", "SOURCE_MISMATCH", { hint: "The stored original is missing, ambiguous or changed; facts cite it, so restore it rather than editing records." });
  if ((match = message.match(/(?:Invalid|Unknown|duplicate)[^.]*? option (--?[\w-]+|\S+)/i))) return report("usage", "UNKNOWN_OPTION", { hint: `${match[1]} is not an option here (or is repeated, or has no value).`, details: { option: match[1] } });
  // Gate refusals of a decision or edit as stated (review, changeset decide/revise/facts).
  if (args.verb === "review" || args.verb === "changeset" && ["decide", "revise", "facts", "show"].includes(args.operation ?? "")) {
    if (/Duplicate proposal ids/.test(message)) return report("review", "PACKET_DUPLICATE_IDS", { hint: "The packet has duplicate proposal ids: follow the metadata-only repair in references/repair.md; keep it held, keep every fact.", next: reviewNext });
    if (/must|cannot|conflict|Invalid|requires|not allowed/i.test(message)) return report("review", "DECISION_REFUSED", { hint: "The gate refused this decision or edit as stated. Change only the affected fact (or hold it with a reason); corrections may not invent ids or names.", next: reviewNext });
  }
  if (args.verb === "library" && /must|account for|Invalid|requires/i.test(message)) return report("review", "PLAN_INVALID", { hint: "The organization plan does not satisfy the schema (references/organization.md): every source needs an assignment, using unresolved where uncertain." });
  if (args.verb === "causality" && /endpoint|unit/i.test(message)) return report("usage", "CAUSAL_ENDPOINTS", { hint: "Causal endpoints are event or dialogue-card ids (evt_…, dialogue:…), never scene or entity ids; take them from novel causality candidates." });
  if (/no album/i.test(message)) return report("not_found", "ALBUM_NOT_IMPORTED", { hint: "This workspace has no imported album (EPUB pictures). Album import is optional and only for EPUB sources when the job allows it." });
  if (/API[ _]KEY|credential|Unauthorized|401|403|login/i.test(message)) return report("model", "CREDENTIALS", { hint: "A model or Jev credential is missing or rejected. Credentials are entered securely by the owner, never in chat or commands." });
  if (/timed? ?out|ECONNRESET|ETIMEDOUT|rate limit|429|503|model call failed/i.test(message)) return report("model", "MODEL_UNAVAILABLE", { hint: "A model call failed; retry later or with a smaller limit. Nothing was applied by the failed call." });
  if (/budget|Run window|limit reached|exhausted/i.test(message)) return report("budget", "BUDGET_EXHAUSTED", { hint: "A run window or call budget is used up. Report what was done; continue only within the owner's limits." });
  if (/(^|\b)(no|unknown) (entity|proposal|unit id|relation type|library scope|universe|scene|event|packet|changeset|place|timeline|branch|fact|source|chapter|character|plan)\b/i.test(message) || /not found|does not exist|Unknown .* id/i.test(message)) return report("not_found", "ID_NOT_FOUND", { hint: "The id does not exist here. Find real ids with novel query <book> 'MATCH (c:Character) RETURN c.id, c.canonical_name' or novel search, or from the packet's review pages." });
  if (/ENOENT|no such file/i.test(message)) return report("path", "FILE_NOT_FOUND", { hint: "A file or directory does not exist. Use the absolute paths from NOVEL_JOB.json." });
  if (/EEXIST|already exists/i.test(message)) return report("conflict", "ALREADY_EXISTS", { hint: "The target already exists; pick a new path or use the existing one." });
  if (/^(Invalid|Unknown option|Expected|Supply|needs|requires|must)\b|--[a-z-]+ (must|needs)|must be/i.test(message)) return report("usage", "INVALID_ARGUMENT", { hint: "An argument or option value is not valid for this command.", next: ["novel help"] });
  return report("internal", "INTERNAL", { hint: "Unexpected failure. Nothing more can be inferred from it; report it with the command." });
}
