import {
  libraryAdd, libraryDecide, libraryEvidence, libraryHistory, libraryInit,
  libraryPage, libraryPlan, libraryPrepare, libraryPropose, libraryReviewItems, libraryShow,
} from "../../../ground/workspace/library.js";

export async function libraryCommand(args: string[]): Promise<unknown> {
  const [operation, directory, ...rest] = args;
  if (!directory || directory.startsWith("--")) throw new Error("Usage: novel library init|add|show|evidence|propose|decide|prepare|history <library-dir> ...");
  const allowed: Record<string, string[]> = {
    init: [], add: ["--title"], show: ["--series", "--universe", "--continuity", "--offset", "--limit"],
    evidence: ["--offset", "--limit"], propose: ["--revision", "--organization"],
    decide: ["--revision", "--decision", "--reason"], plan: ["--offset", "--limit"], prepare: [], history: [],
  };
  if (!Object.hasOwn(allowed, operation)) throw new Error("Unknown library operation.");
  const values: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (!argument.startsWith("--")) { values.push(argument); continue; }
    const value = rest[++index];
    if (!allowed[operation].includes(argument) || !value || value.startsWith("--") || flags.has(argument)) throw new Error(`Invalid or duplicate library flag ${argument}.`);
    flags.set(argument, value);
  }
  const requireValue = (name: string): string => {
    const value = flags.get(name);
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const count = operation === "init" || operation === "show" || operation === "history" || operation === "propose" && flags.has("--organization") ? 0 : 1;
  if (values.length !== count) throw new Error(`library ${operation} expects ${count} argument(s) after the library path.`);
  if (operation === "init") return libraryInit(directory);
  if (operation === "add") return libraryAdd(directory, values[0], flags.get("--title"));
  if (operation === "show") {
    const scopes = [...flags.entries()].filter(([name]) => ["--series", "--universe", "--continuity"].includes(name));
    if (scopes.length > 1) throw new Error("Choose one series, universe or continuity scope.");
    const entry = scopes[0];
    const data = await libraryShow(directory, entry ? { kind: entry[0].slice(2) as "series" | "universe" | "continuity", id: entry[1] } : undefined);
    if (!flags.has("--offset") && !flags.has("--limit")) return data;
    const groups = libraryReviewItems({ ...data.organization, assignments: [] });
    return { revision: data.revision, generation: data.generation, unresolved: data.unresolved,
      ...libraryPage([...groups, ...data.sources.map(value => ({ type: "source", value }))], Number(flags.get("--offset") ?? 0), Number(flags.get("--limit") ?? 10)) };
  }
  if (operation === "evidence") return libraryEvidence(directory, values[0], flags.has("--offset") ? Number(flags.get("--offset")) : 0, flags.has("--limit") ? Number(flags.get("--limit")) : 1500);
  if (operation === "propose") {
    const raw = flags.get("--organization");
    if (raw !== undefined && Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error("Organization proposal exceeds 2 MiB.");
    const proposal = raw === undefined ? values[0] : JSON.parse(raw);
    if (raw !== undefined && (!proposal || typeof proposal !== "object" || Array.isArray(proposal))) throw new Error("Inline organization must be a JSON object.");
    return libraryPropose(directory, proposal, requireValue("--revision"));
  }
  if (operation === "plan") {
    const data = await libraryPlan(directory, values[0]);
    if (!flags.has("--offset") && !flags.has("--limit")) return data;
    return { id: data.id, revision: data.revision, baseRevision: data.baseRevision, stale: data.stale,
      ...libraryPage(libraryReviewItems(data.organization), Number(flags.get("--offset") ?? 0), Number(flags.get("--limit") ?? 10)) };
  }
  if (operation === "decide") return libraryDecide(directory, values[0], requireValue("--revision"), requireValue("--decision"), requireValue("--reason"));
  if (operation === "prepare") return libraryPrepare(directory, values[0]);
  return libraryHistory(directory);
}
