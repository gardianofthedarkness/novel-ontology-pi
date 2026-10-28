import { NovelError } from "../../ground/errors.js";
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
  /** The facts each page showed in this revision, by offset: what "the rest of this page" means. */
  pages?: Record<string, string[]>;
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

/** Why a fact cannot be accepted yet (null: it can). */
function acceptProblem(state: ReviewState, fact: ReviewFact, decision?: ReviewDecision): string | null {
  if (!state.seen.includes(fact.id)) return `Read the complete current assertion ${fact.id} with review show before accepting.`;
  const seen = state.evidence[fact.id] ?? [];
  if (!fact.requiredEvidence.length || (fact.requireAllEvidence ? fact.requiredEvidence.some(id => !seen.includes(id)) : !fact.requiredEvidence.some(id => seen.includes(id)))) {
    return `Incomplete original evidence for ${fact.id}; use review evidence --fact '${fact.id}' and follow page.nextOffset. Previous revisions do not count.`;
  }
  if (fact.temporalReasonRequired && (!decision?.temporalReason?.trim() || decision.temporalReason.length > 2000)) return "Cross-file acceptance requires an evidence-grounded temporalReason, not reading order.";
  return null;
}

function requireEvidence(adapter: ReviewAdapter, state: ReviewState, decisions: ReviewDecision[]) {
  if (adapter.requireFullReview && adapter.facts.some(fact => !state.seen.includes(fact.id))) throw new Error("Read every current assertion page with review show before deciding or applying this packet.");
  for (const decision of decisions.filter(decision => decision.verdict === "accept")) {
    const problem = acceptProblem(state, adapter.facts.find(fact => fact.id === decision.factId)!, decision);
    if (problem) throw new Error(problem);
  }
}

/**
 * {rest: "accept", offset, reason}: accept the facts of the page read at that
 * offset that this batch does not name and nothing decided before. A page
 * never read accepts nothing, so leaving a fact out never accepts it.
 */
function restOfPage(value: unknown): { rests: { offset: number; reason: string }[]; explicit: unknown } {
  if (!Array.isArray(value) || value.length > 50) return { rests: [], explicit: value };
  const rests: { offset: number; reason: string }[] = [];
  const explicit = value.filter((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !("rest" in item)) return true;
    const entry = item as Record<string, unknown>;
    const unknown = Object.keys(entry).find(key => !["rest", "offset", "reason"].includes(key));
    const problem = unknown ? `has an unknown field ${JSON.stringify(unknown)} (a page entry is {rest: "accept", offset, reason})`
      : entry.rest !== "accept" ? `has rest ${JSON.stringify(entry.rest)}; only "accept" is allowed (facts left out already stay on hold)`
      : !Number.isSafeInteger(entry.offset) || (entry.offset as number) < 0 ? "needs the offset of the page it accepts"
      : typeof entry.reason !== "string" || !entry.reason.trim() ? "needs a non-empty reason"
      : entry.reason.length > 2000 ? "has a reason over 2000 characters"
      : rests.some(rest => rest.offset === entry.offset) ? `repeats page ${entry.offset}` : null;
    if (problem) throw new NovelError(`Decision #${index + 1} ${problem}.`, { aspect: "review", code: "DECISION_INVALID", hint: 'Accept the rest of a page you read with {"rest":"accept","offset":<that page\'s offset>,"reason":"..."}.' });
    rests.push({ offset: entry.offset as number, reason: entry.reason as string });
    return false;
  });
  return { rests, explicit };
}

function decisionsFrom(value: unknown, adapter: ReviewAdapter): ReviewDecision[] {
  if (!Array.isArray(value) || value.length > 50 || Buffer.byteLength(JSON.stringify(value)) > 64000) throw new Error("Use a bounded JSON array of at most 50 fact decisions / 64 KiB.");
  const allowed = new Set(["factId", "verdict", "reason", "replacement", "semanticReplacement", "temporalReason"]);
  for (const [index, entry] of value.entries()) {
    // Name the decision and the problem, so only that entry is fixed.
    const problem = !entry || typeof entry !== "object" || Array.isArray(entry) ? "is not an object {factId, verdict, reason}"
      : Object.keys(entry).find(key => !allowed.has(key)) ? `has an unknown field ${JSON.stringify(Object.keys(entry).find(key => !allowed.has(key)))} (fields: ${[...allowed].join(", ")})`
      : !adapter.facts.some(fact => fact.id === entry.factId) ? `has unknown factId ${JSON.stringify(entry.factId)} (use ids from this packet's review pages)`
      : !["accept", "hold", "reject"].includes(entry.verdict) ? `(${entry.factId}) has verdict ${JSON.stringify(entry.verdict)}; use accept, hold or reject`
      : typeof entry.reason !== "string" || !entry.reason.trim() ? `(${entry.factId}) needs a non-empty reason`
      : entry.reason.length > 2000 ? `(${entry.factId}) has a reason over 2000 characters`
      : entry.temporalReason !== undefined && typeof entry.temporalReason !== "string" ? `(${entry.factId}) has a temporalReason that is not text` : null;
    if (problem) throw new NovelError(`Decision #${index + 1} ${problem}.`, { aspect: "review", code: "DECISION_INVALID", hint: "Each decision is {factId, verdict: accept|hold|reject, reason}, or {rest: \"accept\", offset, reason} for the rest of a page you read; fix this one and resend the batch.", details: { index, factId: entry && typeof entry === "object" ? (entry as { factId?: unknown }).factId ?? null : null } });
    if (entry.verdict !== "accept" && ("replacement" in entry || "semanticReplacement" in entry)) throw new Error("Only accepted assertions can have semantic corrections.");
  }
  const factIds = value.map(entry => entry.factId);
  const duplicate = factIds.find((id, index) => factIds.indexOf(id) !== index);
  if (duplicate) throw new NovelError(`Duplicate fact decisions in batch: ${JSON.stringify(duplicate)} appears more than once; keep one decision per factId.`, { aspect: "review", code: "DECISION_INVALID", hint: "Each decision is {factId, verdict: accept|hold|reject, reason}; remove the duplicate and resend the batch." });
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
      state.pages = { ...state.pages, [String(offset)]: facts.map(fact => fact.id) };
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
      const { rests, explicit } = restOfPage(options.decisions);
      const updates = decisionsFrom(explicit, adapter);
      const restAccepted: string[] = [], restLeft: { factId: string; problem: string }[] = [];
      for (const rest of rests) {
        const page = state.pages?.[String(rest.offset)];
        if (!page) throw new NovelError(`No page at offset ${rest.offset} was read in this revision; its rest cannot be accepted.`, { aspect: "review", code: "DECISION_INVALID", hint: `Read it with review show --offset ${rest.offset}, then accept its rest.` });
        for (const factId of page) {
          const fact = adapter.facts.find(entry => entry.id === factId);
          if (!fact || updates.some(decision => decision.factId === factId) || state.decisions.some(decision => decision.factId === factId)) continue;
          // A fact that still needs more evidence or its own temporal reason stays on hold and is named.
          const problem = acceptProblem(state, fact);
          if (problem) { restLeft.push({ factId, problem }); continue; }
          updates.push({ factId, verdict: "accept", reason: rest.reason });
          restAccepted.push(factId);
        }
      }
      const merged = new Map(state.decisions.map(decision => [decision.factId, decision]));
      updates.forEach(decision => {
        const previous = merged.get(decision.factId);
        merged.set(decision.factId, decision.verdict === "accept" && !("replacement" in decision) && !("semanticReplacement" in decision) && previous && "replacement" in previous ? { ...decision, replacement: previous.replacement } : decision);
      });
      const all = [...merged.values()];
      requireEvidence(adapter, state, all);
      let validated: ReviewDecision[];
      try { validated = await adapter.validate(all); }
      catch (error) {
        if (!restAccepted.length) throw error;
        // The named decisions must stand on their own; a rest fact the faculty refuses stays on hold and is named.
        let kept = all.filter(decision => !restAccepted.includes(decision.factId));
        validated = await adapter.validate(kept);
        for (const factId of [...restAccepted]) {
          const trial = [...kept, all.find(decision => decision.factId === factId)!];
          try { validated = await adapter.validate(trial); kept = trial; }
          catch (refusal) { restAccepted.splice(restAccepted.indexOf(factId), 1); restLeft.push({ factId, problem: (refusal as Error).message }); }
        }
      }
      state.decisions = validated;
      state.staged = true;
      await save();
      return { ...base, accepted: state.decisions.filter(decision => decision.verdict === "accept").length, held: adapter.facts.length - state.decisions.filter(decision => decision.verdict !== "hold").length, rejected: state.decisions.filter(decision => decision.verdict === "reject").length, staged: true, applied: false,
        ...(rests.length ? { restAccepted: restAccepted.length, ...(restLeft.length ? { restLeftOnHold: restLeft.slice(0, 20), restLeftOnHoldTotal: restLeft.length } : {}) } : {}) };
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
