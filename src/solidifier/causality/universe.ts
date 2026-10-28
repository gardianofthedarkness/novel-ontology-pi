import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { libraryShow } from "../../ground/workspace/library.js";
import { sourceHash } from "../../ground/workspace/source.js";
import type { Entity } from "../../ground/ontology/types.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import { digest } from "../merge/semantic.js";
import { causalSource } from "./evidence.js";
import { checkCausalLinks } from "./checklist.js";
import type { CausalCandidate } from "./candidates.js";
import { loadCausalityUniverse, unitDossier, type CausalUnit, type CausalityUniverse } from "./units.js";
import { calendarEntry, compareOnCalendar, describeEntry, loadCalendar, type CalendarEntry } from "../calendar/calendar.js";
import { BundleStore } from "../../ground/connectors/bundle.js";

export interface UniverseBinding { sourceId: string; workspace: string; inputSha256: string }
export interface UniverseBindingConfig { directory: string; bindings: UniverseBinding[] }
interface Endpoint { sourceId: string; unitId: string }
interface OriginalUnit { unit: CausalUnit; sentences: Sentence[]; sourceHash: string; assignment: unknown; entities: Entity[] }
interface UniverseProposal {
  id: string;
  from: Endpoint;
  to: Endpoint;
  supportRevision: string;
  method: "jev" | "agent";
  confidence?: number;
  reason?: string;
}
interface UniversePacket {
  id: string;
  universeId: string;
  contextRevision: string;
  createdAt: string;
  proposals: UniverseProposal[];
}
export interface UniverseDecision { proposalId: string; verdict: "accept" | "hold" | "reject"; reason: string; temporalReason?: string }
interface DecisionRecord extends UniverseDecision {
  packetId: string;
  universeId: string;
  from: Endpoint;
  to: Endpoint;
  supportRevision: string;
  at: string;
}
interface UniverseLedger { version: 1; generation: number; decisions: DecisionRecord[] }
export interface UniverseContext {
  bindings?: UniverseBindingConfig;
  directory: string;
  universeId: string;
  revision: string;
  catalogRevision: string;
  universe: CausalityUniverse;
  originals: Map<string, OriginalUnit>;
  hints: Map<string, string[]>;
  coverage: { sourceId: string; title: string; units: number; status: "available" | "unprocessed" }[];
  /** Each book's workspace, for reading its story time against the universe calendar. */
  workspaces?: Map<string, string>;
}

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const packetIdentifier = /^uc_[a-f0-9]{64}$/;
const qualifiedIdentifier = /^(doc_[a-f0-9]{64})::(.{1,512})$/;
const ledgerPath = (directory: string) => join(directory, "causality", "state.json");
export const qualifyCausalUnit = (sourceId: string, unitId: string): string => `${sourceId}::${unitId}`;
export function causalEndpoint(value: string): Endpoint {
  const matched = value.match(qualifiedIdentifier);
  if (!matched) throw new Error("Use a source-qualified causal ID from the universe candidate list.");
  return { sourceId: matched[1], unitId: matched[2] };
}
const qualifiedEndpoint = (endpoint: Endpoint) => qualifyCausalUnit(endpoint.sourceId, endpoint.unitId);

async function jsonFile<Value>(path: string, fallback?: Value): Promise<Value> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Expected a bounded regular JSON file.");
    return JSON.parse(await readFile(path, "utf8")) as Value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
async function mutate<Result>(directory: string, operation: () => Promise<Result>): Promise<Result> {
  const lock = join(directory, ".library.lock");
  await mkdir(lock);
  try { return await operation(); }
  finally { await rmdir(lock); }
}
async function ledger(directory: string): Promise<UniverseLedger> {
  const result = await jsonFile<UniverseLedger>(ledgerPath(directory), { version: 1, generation: 0, decisions: [] });
  if (result.version !== 1 || !Number.isSafeInteger(result.generation) || result.generation < 0 || !Array.isArray(result.decisions)) throw new Error("Invalid universe causal ledger.");
  return result;
}
export async function universeBindings(env: NodeJS.ProcessEnv = process.env): Promise<UniverseBindingConfig | undefined> {
  return env.NOVEL_CAUSAL_BINDINGS ? jsonFile<UniverseBindingConfig>(env.NOVEL_CAUSAL_BINDINGS) : undefined;
}

export async function loadUniverseContext(directory: string, universeId: string, config?: UniverseBindingConfig): Promise<UniverseContext> {
  if (!identifier.test(universeId)) throw new Error("Invalid universe ID.");
  directory = resolve(directory);
  const catalog = await libraryShow(directory, { kind: "universe", id: universeId });
  if (!catalog.sources.length) throw new Error("Universe causality needs reviewed, confirmed continuity membership first.");
  if (config && resolve(config.directory) !== directory) throw new Error("Universe bindings belong to another library.");
  if (config && (new Set(config.bindings.map(binding => binding.sourceId)).size !== config.bindings.length || new Set(config.bindings.map(binding => resolve(binding.workspace))).size !== config.bindings.length)) throw new Error("Universe bindings must be one-to-one.");
  const originals = new Map<string, OriginalUnit>(), hints = new Map<string, string[]>();
  const units: CausalUnit[] = [];
  const relations: CausalityUniverse["relations"] = [];
  const coverage: UniverseContext["coverage"] = [];
  const fingerprints: unknown[] = [];
  const workspaces = new Map<string, string>();
  for (const source of catalog.sources) {
    const binding = config?.bindings.find(entry => entry.sourceId === source.id);
    if (config && !binding) throw new Error("Reviewed source is not assigned to this host.");
    const workspace = resolve(binding?.workspace ?? source.workspace);
    workspaces.set(source.id, workspace);
    try {
      if (!(await lstat(workspace)).isDirectory() || await realpath(workspace) !== workspace) throw new Error("Causal workspace must be a canonical regular directory.");
    } catch (error) {
      if (!binding && (error as NodeJS.ErrnoException).code === "ENOENT") { coverage.push({ sourceId: source.id, title: source.title, units: 0, status: "unprocessed" }); fingerprints.push([source.id, "unprocessed"]); continue; }
      throw error;
    }
    if (!binding) {
      const identity = await jsonFile<{ documentId: string }>(join(workspace, "ontology", "library-source.json"));
      if (identity.documentId !== source.id) throw new Error("Prepared workspace identity differs from its library source.");
    }
    const local = await loadCausalityUniverse(workspace);
    for (const relation of local.relations.filter(entry => ["CAUSES", "CAUSED_BY"].includes(entry.type))) relations.push({ ...relation,
      fromId: qualifyCausalUnit(source.id, relation.type === "CAUSED_BY" ? relation.toId : relation.fromId),
      toId: qualifyCausalUnit(source.id, relation.type === "CAUSED_BY" ? relation.fromId : relation.toId), type: "CAUSES" });
    const current = [...local.byId.values()];
    const graphHashes: string[] = [];
    for (const file of ["entities", "events", "scenes", "relations", "state-changes"]) graphHashes.push(await readFile(join(workspace, "ontology", `${file}.jsonl`)).then(sourceHash, error => { if (error.code === "ENOENT") return "missing"; throw error; }));
    if (!current.length) { coverage.push({ sourceId: source.id, title: source.title, units: 0, status: "unprocessed" }); fingerprints.push([source.id, graphHashes]); continue; }
    const original = await causalSource(workspace);
    if (binding && original.hash !== binding.inputSha256) throw new Error("Assigned book source changed; restore it before universe causality.");
    const sentenceMap = new Map(original.sentences.map(sentence => [sentence.id, sentence]));
    const entities = (await readFile(join(workspace, "ontology", "entities.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Entity);
    const entityMap = new Map(entities.map(entity => [entity.id, entity]));
    for (const unit of current) {
      const id = qualifyCausalUnit(source.id, unit.id);
      const passages = unit.sentenceIds.flatMap(sentenceId => sentenceMap.has(sentenceId) ? [sentenceMap.get(sentenceId)!] : []);
      const qualified: CausalUnit = { ...unit, id, sceneId: unit.sceneId ? qualifyCausalUnit(source.id, unit.sceneId) : null,
        actors: unit.actors.map(actor => qualifyCausalUnit(source.id, actor)), locationId: unit.locationId ? qualifyCausalUnit(source.id, unit.locationId) : null,
        sentenceIds: unit.sentenceIds.map(sentenceId => qualifyCausalUnit(source.id, sentenceId)),
        text: passages.map(sentence => sentence.text).join("\n"),
        origin: { sourceId: source.id, title: source.title, continuityId: source.assignment.continuityId!, seriesId: source.assignment.seriesId, readingOrder: source.assignment.readingOrder } };
      units.push(qualified);
      originals.set(id, { unit, sentences: passages, sourceHash: original.hash, assignment: { ...source.assignment, universeId },
        entities: [...new Set([...unit.actors, ...(unit.locationId ? [unit.locationId] : [])])].flatMap(entityId => entityMap.has(entityId) ? [entityMap.get(entityId)!] : []) });
      const tokens = new Set<string>();
      for (const entityId of [...unit.actors, ...(unit.locationId ? [unit.locationId] : [])]) {
        const entity = entityMap.get(entityId);
        if (!entity) continue;
        for (const name of entity.names) {
          const normalized = name.text.normalize("NFKC").trim();
          if (normalized) tokens.add(`${source.assignment.continuityId}:${entity.kind}:${normalized}`);
        }
      }
      hints.set(id, [...tokens]);
    }
    coverage.push({ sourceId: source.id, title: source.title, units: current.length, status: "available" });
    fingerprints.push([source.id, original.hash, graphHashes]);
  }
  const universe: CausalityUniverse = { units, byId: new Map(units.map(unit => [unit.id, unit])), scenes: [], events: [], relations, stateChanges: [], sceneIndexInChapter: new Map(), sceneEvents: new Map(), eventScene: new Map() };
  return { directory, universeId, bindings: config, revision: digest({ catalog: catalog.revision, fingerprints, ledgerGeneration: (await ledger(directory)).generation }), catalogRevision: catalog.revision, universe, originals, hints, coverage, workspaces };
}

async function requireFresh(context: UniverseContext) {
  const current = await loadUniverseContext(context.directory, context.universeId, context.bindings);
  if (current.revision !== context.revision) throw new Error("Universe source or membership changed; inspect a fresh revision.");
}

function pair(context: UniverseContext, fromId: string, toId: string) {
  const from = context.universe.byId.get(fromId), to = context.universe.byId.get(toId);
  if (!from || !to) throw new Error("Causal endpoints must be canonical events/dialogue cards in the reviewed universe.");
  if (from.origin!.sourceId === to.origin!.sourceId) throw new Error("Use the per-book causality commands for same-file links.");
  if (from.origin!.continuityId !== to.origin!.continuityId) throw new Error("Causal links cannot cross continuities, even within one universe.");
  const originals = [context.originals.get(fromId)!, context.originals.get(toId)!];
  const available = originals.every(entry => entry.unit.sentenceIds.length > 0 && entry.unit.sentenceIds.every(id => entry.sentences.some(sentence => sentence.id === id)));
  const supportRevision = digest({ universeId: context.universeId, from, to, originals });
  return { from, to, originals, available, supportRevision };
}
function latestDecisions(state: UniverseLedger) {
  return [...new Map(state.decisions.map(entry => [`${entry.packetId}:${entry.proposalId}`, entry])).values()];
}
/**
 * Where each causal unit sits on the universe calendar (the one clock): its
 * scene's period, the narrowest when it has several. Null when the calendar
 * has not been built or the scene has no placed period.
 */
async function calendarPositions(context: UniverseContext): Promise<(unitId: string) => CalendarEntry | null> {
  const calendar = await loadCalendar({ root: context.directory, universeId: context.universeId }).catch(() => null);
  if (!calendar) return () => null;
  const periodsOf = new Map<string, Map<string, string[]>>();
  for (const [sourceId, workspace] of context.workspaces ?? []) {
    const relations = await new BundleStore(join(workspace, "ontology")).loadFile<{ fromId: string; toId: string; type: string }>("relations.jsonl").catch(() => []);
    const scenes = new Map<string, string[]>();
    for (const relation of relations) if (relation.type === "OCCURS_DURING") scenes.set(relation.fromId, [...scenes.get(relation.fromId) ?? [], relation.toId]);
    periodsOf.set(sourceId, scenes);
  }
  return (unitId) => {
    const unit = context.universe.byId.get(unitId);
    const sourceId = unit?.origin?.sourceId;
    if (!unit?.sceneId || !sourceId) return null;
    // Universe units carry qualified scene ids (`<source>::<scene>`).
    const sceneId = unit.sceneId.startsWith(`${sourceId}::`) ? unit.sceneId.slice(sourceId.length + 2) : unit.sceneId;
    const placed = (periodsOf.get(sourceId)?.get(sceneId) ?? []).map((timeId) => calendarEntry(calendar, sourceId, timeId)).filter((entry): entry is CalendarEntry => !!entry);
    return placed.sort((first, second) => (first.span.end - first.span.start) - (second.span.end - second.span.start))[0] ?? null;
  };
}

async function candidates(context: UniverseContext) {
  const state = await ledger(context.directory);
  // The universe calendar orders units across books: a cause never comes after its effect on it.
  const onCalendar = await calendarPositions(context);
  const linked = new Set<string>();
  for (const decision of latestDecisions(state).filter(entry => entry.universeId === context.universeId && entry.verdict === "accept")) {
    try {
      const fromId = qualifiedEndpoint(decision.from), toId = qualifiedEndpoint(decision.to);
      if (pair(context, fromId, toId).supportRevision === decision.supportRevision) linked.add([fromId, toId].sort().join("|"));
    } catch {}
  }
  const index = new Map<string, string[]>();
  for (const [unitId, names] of context.hints) for (const name of names) index.set(name, [...index.get(name) ?? [], unitId]);
  const nominated = new Map<string, CausalCandidate>();
  let truncated = false;
  let inspectedPairs = 0;
  nomination: for (const ids of index.values()) {
    const bySource = new Map<string, string[]>();
    for (const id of ids) {
      const sourceId = context.universe.byId.get(id)!.origin!.sourceId;
      const bucket = bySource.get(sourceId) ?? []; bucket.push(id); bySource.set(sourceId, bucket);
    }
    const buckets = [...bySource.values()];
    for (let first = 0; first < buckets.length; first++) for (let second = first + 1; second < buckets.length; second++) for (const firstId of buckets[first]) for (const secondId of buckets[second]) {
      if (++inspectedPairs > 100000) { truncated = true; break nomination; }
      const endpoints = [firstId, secondId].sort();
      const from = context.universe.byId.get(endpoints[0])!, to = context.universe.byId.get(endpoints[1])!;
      if (from.origin!.continuityId !== to.origin!.continuityId || linked.has(endpoints.join("|"))) continue;
      const [first, second] = [onCalendar(endpoints[0]), onCalendar(endpoints[1])];
      const order = first && second ? compareOnCalendar(first, second) : null;
      for (const [fromId, toId] of [endpoints, [...endpoints].reverse()]) {
        // Against the calendar: the cause would come after its effect.
        if (order !== null && (fromId === endpoints[0] ? order : -order) === 1) continue;
        const key = `${fromId}|${toId}`;
        const previous = nominated.get(key);
        if (previous) previous.codeScore++;
        else if (nominated.size < 5000) nominated.set(key, { fromId, toId, legs: ["cross-file-name-hint-not-identity", ...(order !== null ? ["calendar-order"] : [])], codeScore: 1, orderAmbiguous: order === null });
        else truncated = true;
      }
    }
  }
  const ordered = [...nominated.values()].sort((left, right) => right.codeScore - left.codeScore || left.fromId.localeCompare(right.fromId) || left.toId.localeCompare(right.toId));
  return { items: ordered.slice(0, 500), truncated: truncated || ordered.length > 500 };
}
function pageOptions(offset = 0, limit = 10) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Universe causal pages require offset >= 0 and limit 1..20.");
  return { offset, limit };
}
export async function universeCandidates(context: UniverseContext, offset = 0, limit = 10) {
  pageOptions(offset, limit);
  const nominated = await candidates(context);
  const onCalendar = await calendarPositions(context);
  const when = (unitId: string) => { const entry = onCalendar(unitId); return entry ? describeEntry(entry) : "not on the calendar"; };
  const items = nominated.items.slice(offset, offset + limit).map(candidate => ({ ...candidate, calendar: { from: when(candidate.fromId), to: when(candidate.toId), order: candidate.orderAmbiguous ? "unordered" : "cause first" },
    from: { ...causalEndpoint(candidate.fromId), title: context.universe.byId.get(candidate.fromId)!.origin!.title, summary: context.universe.byId.get(candidate.fromId)!.summary.slice(0, 240) },
    to: { ...causalEndpoint(candidate.toId), title: context.universe.byId.get(candidate.toId)!.origin!.title, summary: context.universe.byId.get(candidate.toId)!.summary.slice(0, 240) } }));
  return { universeId: context.universeId, revision: context.revision, coverage: context.coverage, candidates: items, exhaustive: false, candidateCap: 500, truncated: nominated.truncated,
    page: { offset, limit, total: nominated.items.length, nextOffset: offset + limit < nominated.items.length ? offset + limit : null },
    policy: "Cross-file name overlap nominates only; identities are NOT merged. The universe calendar orders units across books (a direction against it is not nominated); where it cannot, both directions are tested. Reading order is NOT story time. Same continuity required." };
}
export async function universeEvidence(context: UniverseContext, fromId: string, toId: string, options: { packetId?: string; offset?: number; limit?: number } = {}) {
  const { offset, limit } = pageOptions(options.offset, options.limit);
  const proof = pair(context, fromId, toId);
  let packetRevision: string | null = null;
  if (options.packetId) {
    const inspected = await universePacket(context, options.packetId);
    if (!inspected.packet.proposals.some(proposal => qualifiedEndpoint(proposal.from) === fromId && qualifiedEndpoint(proposal.to) === toId)) throw new Error("Endpoints are not a proposal in this packet.");
    if (inspected.stale) throw new Error("Causal packet is stale; nominate and review a fresh revision.");
    packetRevision = inspected.revision;
  }
  const sentences = proof.originals.flatMap((entry, index) => entry.sentences.map(sentence => ({ ...sentence, id: qualifyCausalUnit(index ? proof.to.origin!.sourceId : proof.from.origin!.sourceId, sentence.id), sourceId: index ? proof.to.origin!.sourceId : proof.from.origin!.sourceId })));
  return { fromId, toId, revision: digest({ support: proof.supportRevision, packetRevision }), packetId: options.packetId ?? null, available: proof.available,
    requiredSentenceIds: [...new Set([...proof.from.sentenceIds, ...proof.to.sentenceIds])], sentences: sentences.slice(offset, offset + limit),
    page: { offset, limit, total: sentences.length, nextOffset: offset + limit < sentences.length ? offset + limit : null } };
}
async function savePacket(context: UniverseContext, proposals: UniverseProposal[]) {
  await requireFresh(context);
  const body = { universeId: context.universeId, contextRevision: context.revision, createdAt: new Date().toISOString(), proposals };
  const packet: UniversePacket = { id: `uc_${digest(body)}`, ...body };
  await mkdir(join(context.directory, "causality", "packets"), { recursive: true, mode: 0o700 });
  await writeFile(join(context.directory, "causality", "packets", `${packet.id}.json`), JSON.stringify(packet, null, 2), { flag: "wx", mode: 0o600 });
  return { packetId: packet.id, revision: digest({ packet, generation: (await ledger(context.directory)).generation }), status: "pending_review", proposed: proposals.length };
}
export async function universePacket(context: UniverseContext, packetId: string) {
  if (!packetIdentifier.test(packetId)) throw new Error("Invalid universe causal packet ID.");
  const packet = await jsonFile<UniversePacket>(join(context.directory, "causality", "packets", `${packetId}.json`));
  const { id, ...body } = packet;
  if (id !== packetId || id !== `uc_${digest(body)}` || packet.universeId !== context.universeId) throw new Error("Universe causal packet changed or belongs to another universe.");
  const state = await ledger(context.directory);
  return { packet, revision: digest({ packet, generation: state.generation }), stale: context.revision !== packet.contextRevision,
    decisions: latestDecisions(state).filter(entry => entry.packetId === packetId) };
}
export async function universePropose(context: UniverseContext, fromId: string, toId: string, reason: string) {
  if (!reason?.trim() || reason.length > 2000) throw new Error("A bounded source-grounded causal reason is required.");
  const proof = pair(context, fromId, toId);
  if (!proof.available) throw new Error("Both original endpoint passages must be available; missing provenance must be held.");
  return mutate(context.directory, () => savePacket(context, [{ id: `up_${digest({ fromId, toId })}`, from: causalEndpoint(fromId), to: causalEndpoint(toId), supportRevision: proof.supportRevision, method: "agent", reason }]));
}
export async function universeSweep(context: UniverseContext, decisions: DecisionModel, offset = 0, limit = 10) {
  pageOptions(offset, limit);
  const pool = await candidates(context);
  const nominated = pool.items.slice(offset, offset + limit);
  const checked: CausalCandidate[] = [];
  let budget = 16000;
  for (const candidate of nominated) {
    const proof = pair(context, candidate.fromId, candidate.toId);
    const cost = unitDossier(proof.from).length + unitDossier(proof.to).length + 1800;
    if (!proof.available || cost > budget) continue;
    budget -= cost;
    checked.push(candidate);
  }
  const verdicts = await checkCausalLinks(decisions, checked, context.universe);
  const proposals = verdicts.filter(verdict => verdict.verdict === "confident").map(verdict => ({ id: `up_${digest({ fromId: verdict.fromId, toId: verdict.toId })}`, from: causalEndpoint(verdict.fromId), to: causalEndpoint(verdict.toId), supportRevision: pair(context, verdict.fromId, verdict.toId).supportRevision, method: "jev" as const, confidence: verdict.causalScore }));
  const packet = proposals.length ? await mutate(context.directory, () => savePacket(context, proposals)) : null;
  return { packetId: packet?.packetId ?? null, revision: packet?.revision ?? null, nominated: nominated.length, checked: checked.length, proposed: proposals.length,
    uncertain: verdicts.filter(verdict => verdict.verdict === "uncertain").length, rejected: verdicts.filter(verdict => verdict.verdict === "rejected").length,
    deferred: nominated.length - checked.length, maxContextCharacters: 16000, embeddingLeg: false, coverage: context.coverage,
    nextOffset: offset + limit < pool.items.length ? offset + limit : null, truncated: pool.truncated, complete: false };
}
export async function universeDecide(context: UniverseContext, packetId: string, revision: string, decisions: UniverseDecision[]) {
  return mutate(context.directory, async () => {
    await requireFresh(context);
    const inspected = await universePacket(context, packetId);
    if (inspected.stale || inspected.revision !== revision) throw new Error("Stale causal review revision; inspect current source and packet again.");
    if (!Array.isArray(decisions) || decisions.length !== inspected.packet.proposals.length || new Set(decisions.map(decision => decision.proposalId)).size !== decisions.length) throw new Error("Decide every proposal exactly once; hold unresolved links explicitly.");
    const records: DecisionRecord[] = [];
    const acceptedPairs = new Set<string>();
    for (const decision of decisions) {
      const proposal = inspected.packet.proposals.find(entry => entry.id === decision.proposalId);
      if (!proposal || !["accept", "hold", "reject"].includes(decision.verdict) || typeof decision.reason !== "string" || !decision.reason.trim() || decision.reason.length > 2000) throw new Error("Invalid causal decision or reason.");
      const proof = pair(context, qualifiedEndpoint(proposal.from), qualifiedEndpoint(proposal.to));
      if (decision.verdict === "accept") {
        if (!proof.available || proof.supportRevision !== proposal.supportRevision) throw new Error("Causal endpoint evidence is missing or changed.");
        if (typeof decision.temporalReason !== "string" || !decision.temporalReason.trim() || decision.temporalReason.length > 2000) throw new Error("Cross-file acceptance needs an explicit evidence-grounded temporal/directional reason, not volume reading order.");
        const pairKey = [qualifiedEndpoint(proposal.from), qualifiedEndpoint(proposal.to)].sort().join("|");
        if (acceptedPairs.has(pairKey)) throw new Error("Cannot accept contradictory directions for the same pair.");
        acceptedPairs.add(pairKey);
      }
      records.push({ ...decision, packetId, universeId: context.universeId, from: proposal.from, to: proposal.to, supportRevision: proposal.supportRevision, at: new Date().toISOString() });
    }
    const state = await ledger(context.directory);
    const adjacency = new Map<string, Set<string>>();
    const addEdge = (from: string, to: string) => adjacency.set(from, new Set([...(adjacency.get(from) ?? []), to]));
    for (const relation of context.universe.relations) addEdge(relation.fromId, relation.toId);
    const replaced = new Set(records.map(record => `${record.packetId}:${record.proposalId}`));
    for (const entry of latestDecisions(state).filter(entry => entry.universeId === context.universeId && entry.verdict === "accept" && !replaced.has(`${entry.packetId}:${entry.proposalId}`))) {
      try { if (pair(context, qualifiedEndpoint(entry.from), qualifiedEndpoint(entry.to)).supportRevision === entry.supportRevision) addEdge(qualifiedEndpoint(entry.from), qualifiedEndpoint(entry.to)); } catch {}
    }
    for (const record of records.filter(record => record.verdict === "accept")) {
      const from = qualifiedEndpoint(record.from), to = qualifiedEndpoint(record.to);
      const pending = [to], visited = new Set<string>();
      while (pending.length) {
        const next = pending.pop()!;
        if (next === from) throw new Error("This acceptance creates a causal cycle; hold contradictory directions.");
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(...adjacency.get(next) ?? []);
      }
      addEdge(from, to);
    }
    const next: UniverseLedger = { version: 1, generation: state.generation + 1, decisions: [...state.decisions, ...records] };
    await mkdir(join(context.directory, "causality", "history"), { recursive: true, mode: 0o700 });
    await writeFile(join(context.directory, "causality", "history", `${next.generation}-${digest(next)}.json`), JSON.stringify(next), { flag: "wx", mode: 0o600 });
    await atomicJson(ledgerPath(context.directory), next);
    return { packetId, generation: next.generation, applied: records.filter(record => record.verdict === "accept").length, held: records.filter(record => record.verdict === "hold").length, rejected: records.filter(record => record.verdict === "reject").length, scope: "universe-ledger", bookDatabasesModified: false };
  });
}

export async function universeCausalView(directory: string, config?: UniverseBindingConfig) {
  const catalog = await libraryShow(directory);
  const state = await ledger(directory);
  const contextCache = new Map<string, UniverseContext | null>();
  const links: { id: string; universeId: string; from: Endpoint; to: Endpoint; state: "canon" | "proposed" | "held"; stale: boolean }[] = [];
  const names = await readdir(join(directory, "causality", "packets")).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  const packets = await Promise.all(names.filter(name => /^uc_[a-f0-9]{64}\.json$/.test(name)).map(name => jsonFile<UniversePacket>(join(directory, "causality", "packets", name))));
  packets.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  let invalidPackets = 0;
  for (const packet of packets.slice(-100)) {
    const { id, ...body } = packet;
    if (id !== `uc_${digest(body)}`) { invalidPackets++; continue; }
    if (!contextCache.has(packet.universeId)) contextCache.set(packet.universeId, await loadUniverseContext(directory, packet.universeId, config).catch(() => null));
    const context = contextCache.get(packet.universeId);
    for (const proposal of packet.proposals) {
      const decision = state.decisions.filter(entry => entry.packetId === packet.id && entry.proposalId === proposal.id).at(-1);
      if (decision?.verdict === "reject") continue;
      let valid = false;
      try { valid = !!context && pair(context, qualifiedEndpoint(proposal.from), qualifiedEndpoint(proposal.to)).supportRevision === proposal.supportRevision; } catch {}
      const stale = !valid || !decision && context?.revision !== packet.contextRevision;
      links.push({ id: `${packet.id}:${proposal.id}`, universeId: packet.universeId, from: proposal.from, to: proposal.to, state: stale || decision?.verdict === "hold" ? "held" : decision?.verdict === "accept" ? "canon" : "proposed", stale });
    }
  }
  const events = packets.slice(-100).filter(packet => packet.id === `uc_${digest(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== "id")))}`).map(packet => ({
    id: `universe-causal:${packet.id}`, type: "library.causality.proposed", timestamp: packet.createdAt, sourceIds: [...new Set(packet.proposals.flatMap(proposal => [proposal.from.sourceId, proposal.to.sourceId]))],
  }));
  for (const [index, decision] of state.decisions.entries()) events.push({ id: `universe-causal-decision:${index}`, type: `library.causality.${decision.verdict}`, timestamp: decision.at, sourceIds: [decision.from.sourceId, decision.to.sourceId] });
  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  return { revision: digest({ catalog: catalog.revision, state, links }), links, events: events.slice(-100), totalEvents: packets.length + state.decisions.length, totalPackets: packets.length, invalidPackets, omittedPackets: Math.max(0, packets.length - 100), generation: state.generation };
}
