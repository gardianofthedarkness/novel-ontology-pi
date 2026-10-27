import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { closest, distance, graphSchema, PROPERTY_ALIASES, type ErrorReport, type Suggestion } from "../ground/errors.js";
import { reviewAdapter } from "../solidifier/merge/reviewAdapters.js";
import { REVIEW_OPTIONS } from "./commands/extract/reviewCommands.js";
import type { ChangeSet } from "../solidifier/merge/changeset.js";

/**
 * Evidence-based diagnosis (the rustc idea, for agents): after a command
 * fails, look at the actual state it touched — the query's own MATCH
 * pattern and the graph schema, the packet's real facts, the workspace's
 * ids and merge log, the directories nearby — and attach what was observed
 * (`notes`), where the problem is (`span`) and graded fixes (`suggestions`,
 * each a full corrected command when one can be built). Read-only and
 * best-effort: a diagnosis never changes anything, and a failure here never
 * hides the original error.
 */
const jsonl = async <T>(path: string): Promise<T[]> => (await readFile(path, "utf8").catch(() => "")).split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } });
const isDir = (path: string) => stat(path).then((info) => info.isDirectory(), () => false);
const isWorkspace = (path: string) => stat(join(path, "ontology", "manifest.json")).then(() => true, () => false);
const replaceArg = (argv: string[], index: number, value: string) => argv.map((entry, at) => (at === index ? value : entry));
const flagIndex = (argv: string[], name: string) => argv.indexOf(name);

function add(report: ErrorReport, extra: { notes?: string[]; suggestions?: Suggestion[]; span?: ErrorReport["span"] }) {
  if (extra.notes?.length) report.notes = [...(report.notes ?? []), ...extra.notes];
  if (extra.suggestions?.length) report.suggestions = [...(report.suggestions ?? []), ...extra.suggestions];
  if (extra.span && !report.span) report.span = extra.span;
}

/** The workspace (or library) argument: the first existing directory among the command's arguments. */
async function workspaceArg(argv: string[]): Promise<{ index: number; path: string } | null> {
  for (const [index, value] of argv.entries()) if (index > 0 && value.startsWith("/") && await isDir(value)) return { index, path: value };
  return null;
}

// ── queries ──────────────────────────────────────────────────────────────────
function queryArg(argv: string[]) { const index = argv[0] === "query" ? 2 : -1; return index > 0 && argv[index] ? { index, text: argv[index] } : null; }
/** Variables bound to a table in MATCH patterns: (c:Character), [r:CAUSES]. */
function bindings(query: string): Map<string, string> {
  const bound = new Map<string, string>();
  for (const match of query.matchAll(/[([]\s*(\w+)\s*:\s*(\w+)/g)) if (!bound.has(match[1])) bound.set(match[1], match[2]);
  return bound;
}

async function diagnoseQuery(report: ErrorReport, argv: string[]) {
  const query = queryArg(argv);
  if (!query) return;
  const schema = graphSchema();
  const bound = bindings(query.text);
  const rewrite = (from: string | RegExp, to: string) => query.text.replace(from, to);
  const at = (text: string) => ({ argument: query.index, text, offset: query.text.indexOf(text), length: text.length });
  let match: RegExpMatchArray | null;
  if (report.code === "QUERY_UNKNOWN_PROPERTY" && (match = report.error.match(/Cannot find property (\S+) for (\w+)/))) {
    const [, property, variable] = match;
    const table = bound.get(variable);
    const columns = table ? schema.nodes[table] ?? [] : [...new Set(Object.values(schema.nodes).flat())];
    const notes = [table ? `${variable} is bound to ${table} in the MATCH pattern; ${table} has: ${columns.join(", ")}.` : `${variable} has no table in the MATCH pattern, so its kind is unknown; properties across tables: ${columns.slice(0, 20).join(", ")}.`];
    const alias = PROPERTY_ALIASES[property];
    const span = at(`${variable}.${property}`);
    if (alias && /^label\(/.test(alias)) add(report, { notes, span, suggestions: [{ message: `A node's kind is its label: use label(${variable})`, applicability: "machine-applicable", command: replaceArg(argv, query.index, rewrite(new RegExp(`\\b${variable}\\.${property}\\b`, "g"), `label(${variable})`)) }] });
    else if (alias && /relationship/.test(alias)) add(report, { notes: [...notes, `${property} is not a column: ${alias}.`], span, suggestions: [{ message: `Follow the relationship instead (${alias})`, applicability: "has-placeholders", command: replaceArg(argv, query.index, property.startsWith("location") ? "MATCH (s:Scene)-[:LOCATED_AT]->(l:Location) RETURN s.id, l.canonical_name" : "MATCH (c:Character)-[:PARTICIPATES_IN]->(e:Event) RETURN e.id, c.canonical_name") }] });
    else {
      const target = alias?.split(" ")[0] ?? closest(property, columns, 1)[0];
      if (target && columns.includes(target)) {
        const certain = !!alias || distance(property.toLowerCase(), target) <= 2 || target === property.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        add(report, { notes, span, suggestions: [{ message: `Use ${variable}.${target}`, applicability: certain && table ? "machine-applicable" : "maybe-incorrect", command: replaceArg(argv, query.index, rewrite(new RegExp(`\\b${variable}\\.${property}\\b`, "g"), `${variable}.${target}`)) }] });
      } else add(report, { notes, span });
    }
  }
  if (report.code === "QUERY_UNKNOWN_FUNCTION" && /function TYPE/i.test(report.error)) {
    add(report, { span: at((query.text.match(/\btype\s*\(/i) ?? ["type("])[0]), suggestions: [{ message: "Use label(r) for a relationship's type", applicability: "machine-applicable", command: replaceArg(argv, query.index, rewrite(/\btype\s*\(/gi, "label(")) }] });
  }
  if (report.code === "QUERY_INVALID" && (match = query.text.match(/\b(WHERE|AND|OR|NOT)\s+(\w+)\s*:\s*(\w+)/i))) {
    const fixed = query.text.replace(/\b(WHERE|AND|OR|NOT)\s+(\w+)\s*:\s*(\w+)/gi, (_, keyword, variable, label) => `${keyword} label(${variable}) = '${label}'`);
    add(report, { notes: ["`n:Label` works only inside a MATCH pattern; in WHERE, test label(n)."], span: at(match[0]), suggestions: [{ message: "Test the label with label(n) = 'Label'", applicability: "machine-applicable", command: replaceArg(argv, query.index, fixed) }] });
  }
  if (report.code === "QUERY_UNKNOWN_TABLE" && (match = report.error.match(/Table (\w+) does not exist/))) {
    const missing = match[1];
    const span = at(`:${missing}`);
    if (/^(Entity|Node)$/i.test(missing)) {
      add(report, { notes: [`Entities are stored per kind: ${Object.keys(schema.nodes).filter((name) => /Character|Location|Organization|Item|Concept|TimePoint/.test(name)).join(", ")}.`], span,
        suggestions: [{ message: "Match any kind (drop the label) and read label(n)", applicability: "maybe-incorrect", command: replaceArg(argv, query.index, rewrite(new RegExp(`:\\s*${missing}\\b`, "g"), "")) }] });
    } else if (/^[A-Z_]+$/.test(missing)) {
      // A relationship: list the ones that join the tables this pattern binds.
      const pattern = query.text.match(new RegExp(`\\(\\s*(\\w+)?\\s*(?::\\s*(\\w+))?[^)]*\\)\\s*-\\s*\\[[^\\]]*:${missing}[^\\]]*\\]\\s*->?\\s*\\(\\s*(\\w+)?\\s*(?::\\s*(\\w+))?`));
      const from = pattern?.[2] ?? (pattern?.[1] ? bound.get(pattern[1]) : undefined), to = pattern?.[4] ?? (pattern?.[3] ? bound.get(pattern[3]) : undefined);
      const fitting = Object.entries(schema.relationships).filter(([, ends]) => (!from || ends.includes(`${from}->`)) && (!to || ends.includes(`->${to}`)));
      add(report, { span, notes: [fitting.length ? `Relationships ${from ? `from ${from} ` : ""}${to ? `to ${to} ` : ""}in the graph: ${fitting.map(([name, ends]) => `${name} (${ends})`).join("; ")}.` : `No relationship joins ${from ?? "?"} to ${to ?? "?"} in the graph${from === "Event" && to === "Scene" || from === "Scene" && to === "Event" ? " (events belong to scenes through shared source sentences, which the graph does not store)" : ""}.`],
        suggestions: fitting.length === 1 ? [{ message: `Use ${fitting[0][0]}`, applicability: "maybe-incorrect", command: replaceArg(argv, query.index, rewrite(new RegExp(`:${missing}\\b`, "g"), `:${fitting[0][0]}`)) }] : [] });
    } else {
      const guess = closest(missing, Object.keys(schema.nodes), 1)[0];
      add(report, { span, suggestions: guess ? [{ message: `Use ${guess}`, applicability: "maybe-incorrect", command: replaceArg(argv, query.index, rewrite(new RegExp(`:${missing}\\b`, "g"), `:${guess}`)) }] : [] });
    }
  }
}

// ── graph, paths, ids ────────────────────────────────────────────────────────
async function diagnoseGraph(report: ErrorReport, argv: string[]) {
  const workspace = await workspaceArg(argv);
  if (!workspace) return;
  const graph = await stat(join(workspace.path, "ontology", "graph.lbug")).catch(() => null);
  const bundle = await stat(join(workspace.path, "ontology", "entities.jsonl")).catch(() => null);
  add(report, { notes: [graph ? `graph.lbug was built ${graph.mtime.toISOString()}${bundle && bundle.mtimeMs > graph.mtimeMs ? `; the bundle changed after (${bundle.mtime.toISOString()})` : ""}.` : "There is no ontology/graph.lbug in this workspace."],
    suggestions: [{ message: "Rebuild the graph from the bundle, then run the command again", applicability: "machine-applicable", command: ["graph", "build", join(workspace.path, "ontology")] }] });
}

async function diagnosePath(report: ErrorReport, argv: string[]) {
  const index = argv.findIndex((value, at) => at > 0 && value.startsWith("/") && report.error.includes(value)) ;
  const path = index > 0 ? argv[index] : (report.error.match(/(\/[^\s'"]+)/) ?? [])[1];
  if (!path) return;
  const candidates: string[] = [];
  if (await isDir(path)) {
    for (const child of (await readdir(path).catch(() => [] as string[])).slice(0, 200)) if (await isWorkspace(join(path, child))) candidates.push(join(path, child));
    for (const child of (await readdir(join(path, "workspaces")).catch(() => [] as string[])).slice(0, 50)) if (await isWorkspace(join(path, "workspaces", child))) candidates.push(join(path, "workspaces", child));
  }
  const parent = dirname(path);
  for (const sibling of (await readdir(parent).catch(() => [] as string[])).slice(0, 200)) if (join(parent, sibling) !== path && await isWorkspace(join(parent, sibling))) candidates.push(join(parent, sibling));
  const ranked = [...new Set(candidates)].sort((first, second) => distance(basename(first), basename(path)) - distance(basename(second), basename(path))).slice(0, 5);
  add(report, { span: index > 0 ? { argument: index, text: path } : undefined,
    notes: [ranked.length ? `Workspaces near ${path}: ${ranked.join(", ")}.` : `No workspace was found in or next to ${path}.`],
    suggestions: index > 0 && ranked.length === 1 ? [{ message: `Use the workspace ${ranked[0]}`, applicability: "maybe-incorrect", command: replaceArg(argv, index, ranked[0]) }] : [] });
}

async function diagnoseId(report: ErrorReport, argv: string[]) {
  const id = (report.error.match(/\b((?:char|loc|org|item|concept|evt|scene|tl|tp)_[\w:-]+)/) ?? [])[1];
  const workspace = await workspaceArg(argv);
  if (!id || !workspace) return;
  const index = argv.indexOf(id);
  const merges = (await jsonl<{ event?: { type?: string; keepId?: string; dropId?: string } }>(join(workspace.path, "events.jsonl"))).map((record) => record.event).filter((event) => event?.type === "entity.merged");
  const mergedInto = (start: string) => { let at = start; const seen = new Set<string>(); for (let event = merges.find((entry) => entry?.dropId === at); event && !seen.has(at); event = merges.find((entry) => entry?.dropId === at)) { seen.add(at); at = event.keepId!; } return at === start ? null : at; };
  const keep = mergedInto(id);
  if (keep) { add(report, { span: index > 0 ? { argument: index, text: id } : undefined, notes: [`${id} was merged into ${keep} (entity.merged in the event log); ${keep} now holds its names and facts.`], suggestions: index > 0 ? [{ message: `Use ${keep}`, applicability: "machine-applicable", command: replaceArg(argv, index, keep) }] : [] }); return; }
  const file = /^(evt)_/.test(id) ? "events" : /^scene_/.test(id) ? "scenes" : "entities";
  const records = await jsonl<{ id: string; names?: { text: string; kind?: string }[]; summaryEn?: string }>(join(workspace.path, "ontology", `${file}.jsonl`));
  const label = (record: { names?: { text: string; kind?: string }[]; summaryEn?: string }) => record.names?.find((name) => name.kind === "canonical")?.text ?? record.names?.[0]?.text ?? record.summaryEn?.slice(0, 30) ?? "";
  const prefix = id.replace(/_[^_]*$/, "_");
  const near = records.filter((record) => record.id.startsWith(prefix)).map((record) => ({ record, score: distance(record.id, id) })).sort((first, second) => first.score - second.score).slice(0, 5);
  add(report, { span: index > 0 ? { argument: index, text: id } : undefined,
    notes: [`${records.length} ${file} are stored here${near.length ? `; nearest ids: ${near.map(({ record }) => `${record.id}${label(record) ? ` (${label(record)})` : ""}`).join(", ")}` : ""}. ${id} is not among them and no merge removed it.`] });
}

// ── review decisions ────────────────────────────────────────────────────────
const VERDICTS: Record<string, "accept" | "hold" | "reject"> = { accept: "accept", accepted: "accept", approve: "accept", approved: "accept", yes: "accept", ok: "accept", true: "accept", hold: "hold", held: "hold", defer: "hold", deferred: "hold", skip: "hold", unknown: "hold", unsure: "hold", reject: "reject", rejected: "reject", deny: "reject", denied: "reject", no: "reject", false: "reject" };

async function diagnoseDecisions(report: ErrorReport, argv: string[]) {
  const workspace = await workspaceArg(argv);
  const packet = argv.find((value) => /^(cs_|uc_|ua_|plan_)/.test(value));
  if (!workspace || !packet) return;
  const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const scope = (flag("--scope") ?? "book") as "book" | "universe" | "library";
  // The facts as the gate itself sees them (every scope: block, causal, time-place, atlas, library).
  let facts: string[] = [];
  let summary = `${packet}`;
  try {
    const adapter = await reviewAdapter({ directory: workspace.path, packetId: packet, scope, ...(flag("--universe") ? { universeId: flag("--universe") } : {}) });
    facts = adapter.facts.map((fact) => fact.id);
    summary = `${packet}${adapter.applied ? " is already applied and" : ""}${adapter.stale ? " is stale and" : ""} has ${facts.length} reviewable facts (ids like ${facts.slice(0, 2).join(", ")})`;
  } catch (error) { summary = `${packet} could not be opened for review: ${(error as Error).message}`; }
  if (scope === "book") {
    const changeset = JSON.parse(await readFile(join(workspace.path, "changesets", `${packet}.json`), "utf8").catch(() => "null")) as ChangeSet | null;
    if (changeset) summary = `${packet} is ${changeset.status} with ${changeset.proposals.length} proposals${facts.length ? ` and ${facts.length} reviewable facts (ids like ${facts.slice(0, 2).join(", ")})` : ""}`;
    else summary = `No packet ${packet} in ${workspace.path}/changesets`;
  }
  const notes = [`${summary}.`];
  const at = flagIndex(argv, "--decisions");
  if (at < 0 || !argv[at + 1]) { add(report, { notes }); return; }
  let decisions: unknown;
  try { decisions = JSON.parse(argv[at + 1]); } catch (error) { add(report, { notes: [...notes, `--decisions is not valid JSON: ${(error as Error).message}.`], span: { argument: at + 1, text: argv[at + 1].slice(0, 80) } }); return; }
  if (!Array.isArray(decisions)) { add(report, { notes: [...notes, "--decisions must be a JSON array."] }); return; }
  if (decisions.length > 50) { add(report, { notes: [...notes, `${decisions.length} decisions in one call; the gate takes at most 50.`], suggestions: [{ message: "Send the first 50, then the rest in further calls (same revision)", applicability: "machine-applicable", command: replaceArg(argv, at + 1, JSON.stringify(decisions.slice(0, 50))) }] }); return; }
  const fixed: unknown[] = [];
  const seen = new Set<string>();
  let fixable = true, first: number | null = null;
  const problems: string[] = [];
  for (const [index, entry] of decisions.entries()) {
    const decision = entry && typeof entry === "object" ? { ...(entry as Record<string, unknown>) } : null;
    if (!decision) { problems.push(`#${index + 1} is not an object`); fixable = false; first ??= index; continue; }
    const factId = String(decision.factId ?? "");
    if (facts.length && !facts.includes(factId)) {
      const guesses = facts.filter((id) => !seen.has(id)).map((id) => ({ id, score: distance(id, factId) })).sort((a, b) => a.score - b.score).slice(0, 3);
      problems.push(`#${index + 1} factId ${factId || "(missing)"} is not in ${packet}; closest: ${guesses.map((guess) => guess.id).join(", ")}`);
      first ??= index;
      if (guesses[0] && guesses[0].score <= 3 && (!guesses[1] || guesses[1].score > guesses[0].score)) decision.factId = guesses[0].id; else fixable = false;
    }
    if (seen.has(String(decision.factId))) { problems.push(`#${index + 1} repeats ${decision.factId}; the later one is dropped`); first ??= index; continue; }
    seen.add(String(decision.factId));
    const verdict = VERDICTS[String(decision.verdict ?? "").toLowerCase()];
    if (decision.verdict !== verdict) { first ??= index; if (verdict) { problems.push(`#${index + 1} verdict ${JSON.stringify(decision.verdict)} means ${verdict}`); decision.verdict = verdict; } else { problems.push(`#${index + 1} verdict ${JSON.stringify(decision.verdict)} is not accept, hold or reject`); fixable = false; } }
    if (typeof decision.reason !== "string" || !decision.reason.trim()) { problems.push(`#${index + 1} has no reason`); first ??= index; fixable = false; decision.reason = "<why, from the source>"; }
    fixed.push(decision);
  }
  add(report, { notes: [...notes, ...(problems.length ? [`Found: ${problems.join("; ")}.`] : [])], span: first !== null ? { decision: first, factId: (decisions[first] as { factId?: string } | null)?.factId ?? null } : undefined,
    suggestions: problems.length ? [{ message: fixable ? "The same batch with these fixes (check each corrected factId against its review page first)" : "The same batch with what could be fixed; fill in the <…> parts", applicability: fixable ? "maybe-incorrect" : "has-placeholders", command: replaceArg(argv, at + 1, JSON.stringify(fixed)) }] : [] });
}

// ── causality endpoints, usage ──────────────────────────────────────────────
async function diagnoseEndpoints(report: ErrorReport, argv: string[]) {
  const workspace = await workspaceArg(argv);
  if (!workspace) return;
  const scenes = await jsonl<{ id: string; sentenceIds: string[] }>(join(workspace.path, "ontology", "scenes.jsonl"));
  const events = await jsonl<{ id: string; summaryEn?: string; evidence?: { sentenceIds?: string[] } }>(join(workspace.path, "ontology", "events.jsonl"));
  const notes: string[] = [];
  for (const [index, value] of argv.entries()) {
    const scene = scenes.find((entry) => entry.id === value);
    if (!scene) continue;
    const inside = new Set(scene.sentenceIds);
    const members = events.filter((event) => (event.evidence?.sentenceIds ?? []).some((id) => inside.has(id))).slice(0, 6);
    notes.push(`Argument ${index} (${value}) is a scene; its events: ${members.map((event) => `${event.id}${event.summaryEn ? ` (${event.summaryEn.slice(0, 24)})` : ""}`).join(", ") || "none stored"}.`);
  }
  if (notes.length) add(report, { notes, suggestions: [{ message: "Name two events (or dialogue cards) instead of scenes", applicability: "has-placeholders", command: argv.map((value) => scenes.some((scene) => scene.id === value) ? "<evt_…>" : value) }] });
}

/** A mistyped or misplaced option: point at it and offer the closest real one. */
function diagnoseOption(report: ErrorReport, argv: string[]) {
  const option = String(report.details?.option ?? "");
  const index = argv.lastIndexOf(option);
  const known = argv[0] === "review" ? REVIEW_OPTIONS[argv[1]] ?? [] : [...new Set((report.error.match(/--[a-z][a-z-]*/g) ?? []))].filter((name) => name !== option);
  const notes: string[] = [];
  const suggestions: Suggestion[] = [];
  if (!option.startsWith("--") && index > 0 && argv[index - 1]?.startsWith("--")) notes.push(`${option} follows ${argv[index - 1]} as a value, so an earlier argument is probably missing or out of place.`);
  if (argv[0] === "review" && (!argv[3] || argv[3].startsWith("--"))) notes.push("review needs <root> <packet> before its options; the packet id is missing.");
  const guess = option.startsWith("--") ? closest(option.slice(2), known.map((name) => name.slice(2)), 1)[0] : undefined;
  if (guess && index > 0) suggestions.push({ message: `Use --${guess}`, applicability: distance(option.slice(2), guess) <= 2 ? "machine-applicable" : "maybe-incorrect", command: replaceArg(argv, index, `--${guess}`) });
  if (known.length) notes.push(`Options here: ${known.join(", ")}.`);
  add(report, { span: index > 0 ? { argument: index, text: option } : undefined, notes, suggestions });
}

function diagnoseUsage(report: ErrorReport, argv: string[]) {
  const usage = (report.error.match(/^Usage: ([^\n]+)/) ?? [])[1];
  if (!usage) return;
  const forms = usage.split(/\s+\|\s+/).map((form) => form.trim().replace(/^novel\s+/, "").split(/\s+/));
  const form = forms.find((tokens) => tokens[0] === argv[0] && (!tokens[1] || tokens[1].startsWith("<") || tokens[1].startsWith("[") || tokens[1] === argv[1])) ?? forms[0];
  const flags = [...new Set(usage.match(/--[a-z][a-z-]*/g) ?? [])];
  const suggestions: Suggestion[] = [];
  const notes: string[] = [];
  let span: ErrorReport["span"];
  for (const [index, value] of argv.entries()) {
    if (!value.startsWith("--") || flags.includes(value) || value === "--pretty") continue;
    const guess = closest(value.slice(2), flags.map((flag) => flag.slice(2)), 1)[0];
    span ??= { argument: index, text: value };
    notes.push(`${value} is not an option of this command${flags.length ? `; options: ${flags.join(", ")}` : ""}.`);
    if (guess) suggestions.push({ message: `Use --${guess}`, applicability: distance(value.slice(2), guess) <= 2 ? "machine-applicable" : "maybe-incorrect", command: replaceArg(argv, index, `--${guess}`) });
  }
  // Positional arguments the form requires (before its first optional part), against those given.
  const valueFlags = new Set([...usage.matchAll(/(--[a-z][a-z-]*)\s+(<[^>]+>|[A-Za-z][\w|-]*)/g)].map((match) => match[1]));
  const positional = argv.filter((value, index) => !value.startsWith("--") && !(index > 0 && valueFlags.has(argv[index - 1])));
  const optionalAt = form.findIndex((token) => token.startsWith("["));
  const head = optionalAt < 0 ? form : form.slice(0, optionalAt);
  // Placeholders only: not options, not an option's value, not "…".
  const required = head.filter((token, index) => !token.startsWith("--") && !head[index - 1]?.startsWith("--") && token !== "..." && token !== "…");
  if (!span && positional.length < required.length) {
    const missing = required.slice(positional.length);
    span = { argument: argv.length, text: "" };
    notes.push(`Missing ${missing.join(" ")} after \`${["novel", ...argv].join(" ")}\`.`);
    suggestions.push({ message: "Complete the command", applicability: "has-placeholders", command: [...argv, ...missing] });
  }
  add(report, { span, notes, suggestions });
}

async function diagnosePlan(report: ErrorReport, argv: string[]) {
  const workspace = await workspaceArg(argv);
  const at = flagIndex(argv, "--organization");
  if (!workspace || at < 0) return;
  const catalog = JSON.parse(await readFile(join(workspace.path, "catalog.json"), "utf8").catch(() => "null")) as { sources?: { id: string; title?: string }[] } | null;
  let plan: { assignments?: { sourceId: string }[] } | null = null;
  try { plan = JSON.parse(argv[at + 1]); } catch { add(report, { notes: ["--organization is not valid JSON."], span: { argument: at + 1, text: argv[at + 1]?.slice(0, 80) ?? "" } }); return; }
  const assigned = new Set((plan?.assignments ?? []).map((entry) => entry.sourceId));
  const missing = (catalog?.sources ?? []).filter((source) => !assigned.has(source.id));
  if (missing.length) add(report, { notes: [`${missing.length} source(s) have no assignment: ${missing.slice(0, 6).map((source) => `${source.id}${source.title ? ` (${source.title.replace(/\s+/g, " ").slice(0, 24)})` : ""}`).join(", ")}. Give each one, with status "unresolved" where uncertain.`] });
}

/** Attach evidence, a span and graded suggestions to a report (best-effort, bounded in time). */
export async function diagnose(report: ErrorReport, argv: string[], timeoutMs = 2000): Promise<ErrorReport> {
  const enriched: ErrorReport = { ...report };
  const work = (async () => {
    if (enriched.aspect === "query") await diagnoseQuery(enriched, argv);
    if (enriched.aspect === "graph") await diagnoseGraph(enriched, argv);
    if (enriched.code === "WORKSPACE_NOT_FOUND" || enriched.code === "FILE_NOT_FOUND") await diagnosePath(enriched, argv);
    if (enriched.code === "ID_NOT_FOUND") await diagnoseId(enriched, argv);
    if (["DECISION_INVALID", "DECISION_REFUSED", "STALE_REVISION"].includes(enriched.code)) await diagnoseDecisions(enriched, argv);
    if (enriched.code === "CAUSAL_ENDPOINTS") await diagnoseEndpoints(enriched, argv);
    if (enriched.code === "USAGE") diagnoseUsage(enriched, argv);
    if (enriched.code === "UNKNOWN_OPTION") diagnoseOption(enriched, argv);
    if (enriched.code === "PLAN_INVALID") await diagnosePlan(enriched, argv);
  })();
  try { await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]); }
  catch (error) { enriched.notes = [...(enriched.notes ?? []), `(diagnosis stopped: ${(error as Error).message})`]; }
  return enriched;
}
