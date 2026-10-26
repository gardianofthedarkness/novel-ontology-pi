import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { digest } from "./semantic.js";
import { reviewAdapter } from "./reviewAdapters.js";
import type { ReviewAdapter, ReviewDecision, ReviewFact, ReviewTarget } from "./reviewTypes.js";

interface ReviewState {
  version: 1;
  target: ReviewTarget;
  revision: string;
  seen: string[];
  evidence: Record<string, string[]>;
  decisions: ReviewDecision[];
  staged?: boolean;
  applied?: boolean;
  application?: { verified: number; held: number; rejected: number; deferredProposals: number };
}

export interface ReviewOptions {
  offset?: number;
  limit?: number;
  factId?: string;
  revision?: string;
  decisions?: unknown;
}

function pageOptions(options: ReviewOptions) {
  const offset = options.offset ?? 0, limit = options.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Review pages require offset >= 0 and limit 1..20.");
  return { offset, limit };
}

function requireEvidence(adapter: ReviewAdapter, state: ReviewState, decisions: ReviewDecision[]) {
  if (adapter.requireFullReview && adapter.facts.some(fact => !state.seen.includes(fact.id))) throw new Error("Read every current assertion page with review show before deciding or applying this packet.");
  for (const decision of decisions.filter(decision => decision.verdict === "accept")) {
    const fact = adapter.facts.find(fact => fact.id === decision.factId)!;
    if (!state.seen.includes(fact.id)) throw new Error(`Read the complete current assertion ${fact.id} with review show before accepting.`);
    const seen = state.evidence[fact.id] ?? [];
    if (!fact.requiredEvidence.length || (fact.requireAllEvidence ? fact.requiredEvidence.some(id => !seen.includes(id)) : !fact.requiredEvidence.some(id => seen.includes(id)))) {
      throw new Error(`Incomplete original evidence for ${fact.id}; use review evidence --fact '${fact.id}' and follow page.nextOffset. Previous revisions do not count.`);
    }
    if (fact.temporalReasonRequired && (!decision.temporalReason?.trim() || decision.temporalReason.length > 2000)) throw new Error("Cross-file acceptance requires an evidence-grounded temporalReason, not reading order.");
  }
}

function decisionsFrom(value: unknown, adapter: ReviewAdapter): ReviewDecision[] {
  if (!Array.isArray(value) || value.length > 50 || Buffer.byteLength(JSON.stringify(value)) > 64000) throw new Error("Use a bounded JSON array of at most 50 fact decisions / 64 KiB.");
  const allowed = new Set(["factId", "verdict", "reason", "replacement", "semanticReplacement", "temporalReason"]);
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !allowed.has(key)) || !adapter.facts.some(fact => fact.id === entry.factId) || !["accept", "hold", "reject"].includes(entry.verdict) || typeof entry.reason !== "string" || !entry.reason.trim() || entry.reason.length > 2000 || entry.temporalReason !== undefined && typeof entry.temporalReason !== "string") throw new Error("Invalid factId, verdict or reason in review decision.");
    if (entry.verdict !== "accept" && ("replacement" in entry || "semanticReplacement" in entry)) throw new Error("Only accepted assertions can have semantic corrections.");
  }
  if (new Set(value.map(entry => entry.factId)).size !== value.length) throw new Error("Duplicate fact decisions in batch.");
  return value;
}

function factRow(fact: ReviewFact, state: ReviewState) {
  const decision = state.decisions.find(decision => decision.factId === fact.id);
  return { id: fact.id, field: fact.field, value: fact.value, meaning: fact.meaning, decision: decision ?? { verdict: "hold", reason: "Unreviewed assertion; default hold." },
    ...(fact.context ? { context: fact.context } : {}),
    evidence: fact.evidence.slice(0, 3), requiredEvidence: fact.requiredEvidence, requireAllEvidence: fact.requireAllEvidence,
    temporalReasonRequired: !!fact.temporalReasonRequired,
    evidencePage: { offset: 0, total: fact.evidence.length, nextOffset: fact.evidence.length > 3 ? 3 : null } };
}

export async function review(operation: string, target: ReviewTarget, options: ReviewOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  if (!["show", "evidence", "decide", "apply"].includes(operation)) throw new Error("Use review show|evidence|decide|apply.");
  if (target.scope === "book" && !/^cs_[a-zA-Z0-9_-]{1,512}$/.test(target.packetId)) throw new Error("Invalid book review packet ID.");
  target = { ...target, directory: resolve(target.directory) };
  const directory = join(target.directory, "review");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error("Review state must be a private regular directory.");
  const lock = join(directory, ".lock");
  await mkdir(lock).catch(error => { if (error.code === "EEXIST") throw new Error("Another review command is active; retry after it finishes."); throw error; });
  try {
    const adapter = await reviewAdapter(target, env);
    const path = join(directory, `${digest(target)}.json`);
    let state: ReviewState = { version: 1, target, revision: adapter.revision, seen: [], evidence: {}, decisions: [] };
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("Invalid review state file.");
      const previous = JSON.parse(await readFile(path, "utf8")) as ReviewState;
      if (previous.version !== 1 || digest(previous.target) !== digest(target)) throw new Error("Review state belongs to another target.");
      if (previous.revision === adapter.revision || previous.applied) state = previous;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const save = async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
        if (["decide", "apply"].includes(operation)) await appendFile(join(directory, "history.jsonl"), JSON.stringify({ at: new Date().toISOString(), operation, ...state }) + "\n", { mode: 0o600 });
        await rename(temporary, path);
      }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    };
    const base = { id: target.packetId, scope: target.scope, ...(target.universeId ? { universeId: target.universeId } : {}), policy: "review-v1", revision: adapter.revision, stale: adapter.stale,
      totalFacts: adapter.facts.length, accepted: state.decisions.filter(decision => decision.verdict === "accept").length, held: adapter.facts.filter(fact => !state.decisions.some(decision => decision.factId === fact.id && decision.verdict !== "hold")).length, rejected: state.decisions.filter(decision => decision.verdict === "reject").length,
      ...state.application, applied: !!(adapter.applied || state.applied), ...(state.applied ? { reviewRevision: state.revision } : {}), defaultVerdict: "hold" };
    if (operation === "show") {
      const { offset, limit } = pageOptions(options);
      const facts = [];
      for (const fact of adapter.facts.slice(offset, offset + limit)) {
        const row = factRow(fact, state);
        if (Buffer.byteLength(JSON.stringify({ ...base, facts: [...facts, row] })) > 28000) break;
        facts.push(row);
        state.seen = [...new Set([...state.seen, fact.id])];
        state.evidence[fact.id] = [...new Set([...(state.evidence[fact.id] ?? []), ...row.evidence.map(entry => entry.id)])];
      }
      if (!facts.length && adapter.facts.length > offset) throw new Error("One assertion exceeds the review budget; hold it, never truncate its value.");
      await save();
      return { ...base, facts, page: { offset, limit: facts.length, total: adapter.facts.length, nextOffset: offset + facts.length < adapter.facts.length ? offset + facts.length : null } };
    }
    if (operation === "evidence") {
      if (adapter.stale) throw new Error("Stale packet; nominate and review a fresh revision.");
      const fact = adapter.facts.find(fact => fact.id === options.factId);
      if (!fact) throw new Error("Use --fact <id> from review show.");
      const { offset, limit } = pageOptions(options);
      const sentences = [];
      for (const sentence of fact.evidence.slice(offset, offset + limit)) {
        if (Buffer.byteLength(JSON.stringify([...sentences, sentence])) > 24000) break;
        sentences.push(sentence);
      }
      if (!sentences.length && fact.evidence.length > offset) throw new Error("One source sentence exceeds the evidence budget; hold it, never truncate.");
      state.evidence[fact.id] = [...new Set([...(state.evidence[fact.id] ?? []), ...sentences.map(entry => entry.id)])];
      await save();
      return { ...base, factId: fact.id, sentences, page: { offset, limit: sentences.length, total: fact.evidence.length, nextOffset: offset + sentences.length < fact.evidence.length ? offset + sentences.length : null } };
    }
    if (adapter.applied || state.applied) throw new Error("Packet already applied; do not apply or decide twice.");
    if (adapter.stale || options.revision !== adapter.revision) throw new Error("Stale review revision or canonical context; read current review show/evidence again.");
    if (operation === "decide") {
      const updates = decisionsFrom(options.decisions, adapter);
      const merged = new Map(state.decisions.map(decision => [decision.factId, decision]));
      updates.forEach(decision => {
        const previous = merged.get(decision.factId);
        merged.set(decision.factId, decision.verdict === "accept" && !("replacement" in decision) && !("semanticReplacement" in decision) && previous && "replacement" in previous ? { ...decision, replacement: previous.replacement } : decision);
      });
      requireEvidence(adapter, state, [...merged.values()]);
      state.decisions = await adapter.validate([...merged.values()]);
      state.staged = true;
      await save();
      return { ...base, accepted: state.decisions.filter(decision => decision.verdict === "accept").length, held: adapter.facts.length - state.decisions.filter(decision => decision.verdict !== "hold").length, rejected: state.decisions.filter(decision => decision.verdict === "reject").length, staged: true, applied: false };
    }
    if (!state.staged) throw new Error("Record explicit decisions with review decide before applying; no auto-approval.");
    requireEvidence(adapter, state, state.decisions);
    const decisions = await adapter.validate(state.decisions);
    const result = await adapter.apply(decisions);
    state.applied = true;
    state.application = { verified: result.verified, held: result.held, rejected: result.rejected, deferredProposals: result.deferredProposals };
    await save();
    return { ...base, ...result, applied: true, proof: { policy: "review-v1", revision: adapter.revision, inspectedFactIds: state.seen,
      acceptedFactIds: decisions.filter(decision => decision.verdict === "accept").map(decision => decision.factId),
      verifiedSourceFacts: decisions.filter(decision => decision.verdict === "accept").map(decision => decision.factId) } };
  } finally { await rmdir(lock); }
}
