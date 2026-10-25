import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { walkEpub } from "../../digger/intake/album/epub.js";
import { importEpubAlbum } from "../../digger/intake/album/album.js";
import { initWorkspace } from "./init.js";
import { bindWorkspaceSource, sourceHash, storedSource } from "./source.js";

export interface LibrarySource {
  id: string;
  sha256: string;
  filename: string;
  title: string;
  format: "epub" | "txt";
  registeredAt?: string;
}

export interface OrganizationEvidence {
  sourceId: string;
  field: "filename" | "title" | "text";
  quote: string;
  offset?: number;
}

export interface LibraryOrganization {
  universes: { id: string; title: string; evidence: OrganizationEvidence[] }[];
  continuities: { id: string; title: string; universeId: string; evidence: OrganizationEvidence[] }[];
  series: { id: string; title: string; evidence: OrganizationEvidence[] }[];
  assignments: {
    sourceId: string;
    seriesId: string | null;
    continuityId: string | null;
    readingOrder: number | null;
    status: "confirmed" | "unresolved";
    evidence: OrganizationEvidence[];
    note: string;
  }[];
}

interface LibraryCatalog {
  version: 1;
  generation: number;
  sources: LibrarySource[];
  organization: LibraryOrganization;
  reviews: { planId: string; decision: "approve" | "hold" | "reject"; reason: string; at: string }[];
}

interface OrganizationPlan {
  id: string;
  baseRevision: string;
  organization: LibraryOrganization;
  createdAt?: string;
}

const EMPTY: LibraryOrganization = { universes: [], continuities: [], series: [], assignments: [] };
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const digest = (value: unknown): string => sourceHash(JSON.stringify(value));
const key = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const sourceKey = (value: unknown): value is string => typeof value === "string" && /^doc_[a-f0-9]{64}$/.test(value);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, limit = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Expected nonempty text of at most ${limit} characters.`);
  return value;
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error("Expected an array with at most 10000 entries.");
  return value;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}

async function readRegular(file: string, limit = MAX_SOURCE_BYTES): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error(`Expected a regular file of at most ${limit} bytes.`);
  const bytes = await readFile(file);
  if (bytes.length > limit) throw new Error("File grew beyond the input limit.");
  return bytes;
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function locked<Result>(directory: string, operation: () => Promise<Result>): Promise<Result> {
  const lock = join(directory, ".library.lock");
  await mkdir(lock);
  try { return await operation(); }
  finally { await rmdir(lock); }
}

async function loadCatalog(directory: string): Promise<LibraryCatalog> {
  const catalog = object(JSON.parse((await readRegular(join(directory, "catalog.json"), 16 * 1024 * 1024)).toString("utf8")));
  if (catalog.version !== 1 || !Number.isSafeInteger(catalog.generation) || Number(catalog.generation) < 0) throw new Error("Invalid library catalog version/generation.");
  const sources = rows(catalog.sources).map((raw): LibrarySource => {
    const value = object(raw);
    if (!sourceKey(value.id) || value.id !== `doc_${value.sha256}` || !/^[a-f0-9]{64}$/.test(String(value.sha256))
      || (value.format !== "epub" && value.format !== "txt")) throw new Error("Invalid library source identity.");
    const filename = text(value.filename);
    if (basename(filename) !== filename || filename.includes("\\")) throw new Error("Source filenames must be basenames.");
    return { id: value.id, sha256: String(value.sha256), filename, title: text(value.title), format: value.format,
      ...(typeof value.registeredAt === "string" && Number.isFinite(Date.parse(value.registeredAt)) ? { registeredAt: value.registeredAt } : {}) };
  });
  unique(sources.map((source) => source.id), "source identity");
  rows(catalog.reviews);
  object(catalog.organization);
  return { ...catalog, sources } as unknown as LibraryCatalog;
}

async function persist(directory: string, catalog: LibraryCatalog): Promise<string> {
  const revision = digest(catalog);
  const checkpoint = join(directory, "history", `${catalog.generation}-${revision}.json`);
  const serialized = JSON.stringify(catalog, null, 2) + "\n";
  try { await writeFile(checkpoint, serialized, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readRegular(checkpoint, 16 * 1024 * 1024)).toString("utf8") !== serialized) throw new Error("Conflicting history checkpoint; inspect before retrying.");
  }
  await atomicJson(join(directory, "catalog.json"), catalog);
  return revision;
}

function sourcePath(directory: string, source: LibrarySource): string {
  return join(directory, "sources", `${source.id}.${source.format}`);
}

async function sourceBytes(directory: string, source: LibrarySource): Promise<Buffer> {
  const bytes = await readRegular(sourcePath(directory, source));
  if (sourceHash(bytes) !== source.sha256) throw new Error(`Source ${source.id} changed; restore it before continuing.`);
  return bytes;
}

function sourceText(source: LibrarySource, bytes: Buffer): string {
  return source.format === "epub" ? walkEpub(bytes).text : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function organization(directory: string, catalog: LibraryCatalog, raw: unknown): Promise<LibraryOrganization> {
  const input = object(raw);
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));
  const texts = new Map<string, string>();
  const evidence = async (rawEvidence: unknown): Promise<OrganizationEvidence[]> => {
    const result: OrganizationEvidence[] = [];
    for (const item of rows(rawEvidence)) {
      const entry = object(item);
      const source = sources.get(String(entry.sourceId));
      if (!source) throw new Error("Evidence references an unknown source.");
      const quote = text(entry.quote, 2000);
      if (entry.field !== "filename" && entry.field !== "title" && entry.field !== "text") throw new Error("Invalid evidence field.");
      if (entry.field === "text") {
        if (!Number.isSafeInteger(entry.offset) || Number(entry.offset) < 0) throw new Error("Text evidence needs an exact nonnegative offset.");
        if (!texts.has(source.id)) texts.set(source.id, sourceText(source, await sourceBytes(directory, source)));
        if (texts.get(source.id)!.slice(Number(entry.offset), Number(entry.offset) + quote.length) !== quote) throw new Error("Text evidence does not match the source at that offset.");
        result.push({ sourceId: source.id, field: entry.field, quote, offset: Number(entry.offset) });
      } else {
        if (!source[entry.field].includes(quote)) throw new Error("Metadata evidence does not match the catalog.");
        result.push({ sourceId: source.id, field: entry.field, quote });
      }
    }
    return result;
  };
  const group = async (value: unknown) => {
    const entry = object(value);
    if (!key(entry.id)) throw new Error("Invalid group ID.");
    const support = await evidence(entry.evidence);
    if (!support.length) throw new Error("Groups need source evidence.");
    return { id: entry.id, title: text(entry.title), evidence: support };
  };
  const universes = await Promise.all(rows(input.universes).map(group));
  const continuities = await Promise.all(rows(input.continuities).map(async (value) => {
    const entry = object(value);
    if (!universes.some((universe) => universe.id === entry.universeId)) throw new Error("Continuity references an unknown universe.");
    return { ...await group(value), universeId: String(entry.universeId) };
  }));
  const series = await Promise.all(rows(input.series).map(group));
  unique(universes.map((entry) => entry.id), "universe ID");
  unique(continuities.map((entry) => entry.id), "continuity ID");
  unique(series.map((entry) => entry.id), "series ID");
  const assignments: LibraryOrganization["assignments"] = [];
  for (const value of rows(input.assignments)) {
    const entry = object(value);
    if (!sources.has(String(entry.sourceId))) throw new Error("Assignment references an unknown source.");
    if (entry.status !== "confirmed" && entry.status !== "unresolved") throw new Error("Assignment status must be confirmed or unresolved.");
    if (entry.seriesId !== null && !series.some((item) => item.id === entry.seriesId)) throw new Error("Assignment references an unknown series.");
    if (entry.continuityId !== null && !continuities.some((item) => item.id === entry.continuityId)) throw new Error("Assignment references an unknown continuity.");
    if (entry.readingOrder !== null && (entry.seriesId === null || typeof entry.readingOrder !== "number" || !Number.isFinite(entry.readingOrder) || entry.readingOrder < 0)) throw new Error("Reading order must be null or a nonnegative number within a series.");
    const support = await evidence(entry.evidence);
    if (entry.status === "confirmed" && (!support.length || !support.some((item) => item.sourceId === entry.sourceId))) throw new Error("Confirmed assignments require evidence from that source.");
    if (typeof entry.note !== "string" || entry.note.length > 2000) throw new Error("Assignments need a note of at most 2000 characters.");
    assignments.push({ sourceId: String(entry.sourceId), seriesId: entry.seriesId as string | null,
      continuityId: entry.continuityId as string | null, readingOrder: entry.readingOrder as number | null,
      status: entry.status, evidence: support, note: entry.note });
  }
  unique(assignments.map((entry) => entry.sourceId), "assignment");
  if (assignments.length !== sources.size) throw new Error("Plan must account for every source; use unresolved assignments for uncertainty.");
  const ordered = assignments.filter((entry) => entry.status === "confirmed" && entry.readingOrder !== null);
  unique(ordered.map((entry) => `${entry.seriesId}:${entry.continuityId}:${entry.readingOrder}`), "reading position within a series/continuity");
  return { universes, continuities, series, assignments };
}

export async function libraryInit(path: string) {
  const directory = resolve(path);
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  for (const name of ["sources", "inputs", "plans", "history", "workspaces"]) await mkdir(join(directory, name), { mode: 0o700 });
  const catalog: LibraryCatalog = { version: 1, generation: 0, sources: [], organization: EMPTY, reviews: [] };
  return { status: "initialized", directory, revision: await persist(directory, catalog) };
}

export async function libraryAdd(directory: string, file: string, title?: string) {
  return locked(directory, async () => {
    const catalog = await loadCatalog(directory);
    const extension = extname(file).toLowerCase();
    if (extension !== ".epub" && extension !== ".txt") throw new Error("Library sources must be EPUB or UTF-8 .txt files.");
    const bytes = await readRegular(file);
    const hash = sourceHash(bytes);
    const id = `doc_${hash}`;
    const existing = catalog.sources.find((source) => source.id === id);
    if (existing) {
      await sourceBytes(directory, existing);
      if (title !== undefined && title !== existing.title) throw new Error("Identical content is already registered; do not relabel an existing source silently.");
      return { status: "already_registered", source: existing, revision: digest(catalog) };
    }
    const format = extension === ".epub" ? "epub" : "txt";
    const detected = format === "epub" ? walkEpub(bytes).title : null;
    if (format === "txt") new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const source: LibrarySource = { id, sha256: hash, filename: text(basename(file)), title: text(title ?? detected ?? basename(file)), format, registeredAt: new Date().toISOString() };
    try { await writeFile(sourcePath(directory, source), bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await sourceBytes(directory, source);
    }
    const next: LibraryCatalog = { ...catalog, generation: catalog.generation + 1,
      sources: [...catalog.sources, source], organization: { ...catalog.organization, assignments: [
        ...catalog.organization.assignments, { sourceId: id, seriesId: null, continuityId: null,
          readingOrder: null, status: "unresolved", evidence: [], note: "Not organized yet." },
      ] } };
    return { status: "registered", source, revision: await persist(directory, next) };
  });
}

export async function libraryShow(directory: string, scope?: { kind: "series" | "universe" | "continuity"; id: string }) {
  const catalog = await loadCatalog(directory);
  let selected = catalog.organization.assignments;
  if (scope) {
    const groups = scope.kind === "series" ? catalog.organization.series : scope.kind === "universe" ? catalog.organization.universes : catalog.organization.continuities;
    if (!groups.some((group) => group.id === scope.id)) throw new Error("Unknown library scope.");
    selected = selected.filter((entry) => entry.status === "confirmed" && (
      scope.kind === "series" ? entry.seriesId === scope.id : scope.kind === "continuity" ? entry.continuityId === scope.id
        : catalog.organization.continuities.some((continuity) => continuity.id === entry.continuityId && continuity.universeId === scope.id)
    ));
  }
  selected = [...selected].sort((left, right) => (left.readingOrder ?? Infinity) - (right.readingOrder ?? Infinity) || left.sourceId.localeCompare(right.sourceId));
  const selectedIds = new Set(selected.map((entry) => entry.sourceId));
  const relevantContinuities = catalog.organization.continuities.filter((entry) => selected.some((assignment) => assignment.continuityId === entry.id));
  const restrictEvidence = <Group extends { evidence: OrganizationEvidence[] }>(entry: Group): Group => ({
    ...entry, evidence: entry.evidence.filter((item) => selectedIds.has(item.sourceId)),
  });
  const scopedOrganization = scope ? {
    universes: catalog.organization.universes.filter((entry) => relevantContinuities.some((continuity) => continuity.universeId === entry.id)).map(restrictEvidence),
    continuities: relevantContinuities.map(restrictEvidence),
    series: catalog.organization.series.filter((entry) => selected.some((assignment) => assignment.seriesId === entry.id)).map(restrictEvidence),
    assignments: selected.map(restrictEvidence),
  } : catalog.organization;
  return { version: 1, revision: digest(catalog), generation: catalog.generation,
    organization: scopedOrganization, sources: selected.map((assignment) => ({
      ...catalog.sources.find((source) => source.id === assignment.sourceId)!, assignment,
      workspace: resolve(directory, "workspaces", assignment.sourceId),
      referenceNamespace: `${assignment.sourceId}:`,
    })), unresolved: catalog.organization.assignments.filter((entry) => entry.status === "unresolved").length };
}

export async function libraryEvidence(directory: string, id: string, offset = 0, limit = 1500) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("Evidence needs offset >= 0 and limit 1–2000.");
  const catalog = await loadCatalog(directory);
  const source = catalog.sources.find((entry) => entry.id === id);
  if (!source) throw new Error("Unknown source ID.");
  const original = sourceText(source, await sourceBytes(directory, source));
  if (offset > original.length) throw new Error("Evidence offset exceeds source length.");
  return { source, revision: digest(catalog), offset, text: original.slice(offset, offset + limit),
    nextOffset: offset + limit < original.length ? offset + limit : null, totalChars: original.length };
}

export async function libraryPropose(directory: string, proposal: string | object, revision: string) {
  return locked(directory, async () => {
    const catalog = await loadCatalog(directory);
    if (digest(catalog) !== revision) throw new Error("Stale library revision; inspect and re-propose.");
    const raw = typeof proposal === "string" ? (await readRegular(proposal, 2 * 1024 * 1024)).toString("utf8") : JSON.stringify(proposal);
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error("Organization proposal exceeds 2 MiB.");
    const input = JSON.parse(raw);
    const proposed = await organization(directory, catalog, input);
    const body = { baseRevision: revision, organization: proposed };
    const plan: OrganizationPlan = { id: `plan_${digest(body)}`, ...body, createdAt: new Date().toISOString() };
    const target = join(directory, "plans", `${plan.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
    return { status: "pending_review", planId: plan.id, revision: digest(body), ...body };
  });
}

export async function libraryPlan(directory: string, id: string) {
  if (!/^plan_[a-f0-9]{64}$/.test(id)) throw new Error("Invalid plan ID.");
  const catalog = await loadCatalog(directory);
  const plan = JSON.parse((await readRegular(join(directory, "plans", `${id}.json`), 2 * 1024 * 1024)).toString("utf8")) as OrganizationPlan;
  const revision = digest({ baseRevision: plan.baseRevision, organization: plan.organization });
  if (plan.id !== id || revision !== id.slice(5)) throw new Error("Plan changed since review.");
  return { ...plan, revision, stale: plan.baseRevision !== digest(catalog) };
}

export async function libraryDecide(directory: string, id: string, revision: string, decision: string, reason: string) {
  if (!/^plan_[a-f0-9]{64}$/.test(id) || revision !== id.slice(5)) throw new Error("Invalid plan ID/review revision.");
  if (decision !== "approve" && decision !== "hold" && decision !== "reject") throw new Error("Decision must be approve, hold or reject.");
  text(reason, 2000);
  return locked(directory, async () => {
    const catalog = await loadCatalog(directory);
    const plan = JSON.parse((await readRegular(join(directory, "plans", `${id}.json`), 2 * 1024 * 1024)).toString("utf8")) as OrganizationPlan;
    if (plan.id !== id || digest({ baseRevision: plan.baseRevision, organization: plan.organization }) !== revision) throw new Error("Plan changed since review.");
    if (plan.baseRevision !== digest(catalog)) throw new Error("Stale library revision; inspect and re-propose.");
    const checked = await organization(directory, catalog, plan.organization);
    for (const source of catalog.sources) await sourceBytes(directory, source);
    const next: LibraryCatalog = { ...catalog, generation: catalog.generation + 1,
      organization: decision === "approve" ? checked : catalog.organization,
      reviews: [...catalog.reviews, { planId: id, decision, reason, at: new Date().toISOString() }] };
    return { status: decision, revision: await persist(directory, next), appliedOrganization: decision === "approve",
      unresolved: next.organization.assignments.filter((entry) => entry.status === "unresolved").length };
  });
}

export async function libraryHistory(directory: string) {
  await loadCatalog(directory);
  return { checkpoints: (await readdir(join(directory, "history"))).filter((name) => /^\d+-[a-f0-9]{64}\.json$/.test(name)).sort((left, right) => parseInt(left) - parseInt(right)) };
}

export function libraryReviewItems(organization: LibraryOrganization): { type: string; value: unknown }[] {
  return [
    ...organization.universes.map(value => ({ type: "universe", value })),
    ...organization.continuities.map(value => ({ type: "continuity", value })),
    ...organization.series.map(value => ({ type: "series", value })),
    ...organization.assignments.map(value => ({ type: "assignment", value })),
  ];
}

export function libraryPage(items: { type: string; value: unknown }[], offset = 0, limit = 10) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Library pages need a valid offset and limit 1–20.");
  return { page: { offset, limit, total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }, items: items.slice(offset, offset + limit) };
}

export interface LibraryView {
  revision: string;
  sources: { id: string; title: string; filename: string }[];
  organization: {
    universes: { id: string; title: string }[];
    continuities: { id: string; title: string; universeId: string }[];
    series: { id: string; title: string }[];
    assignments: { sourceId: string; seriesId: string | null; continuityId: string | null; readingOrder: number | null; status: "confirmed" | "unresolved" }[];
  };
  plans: { id: string; state: "proposed" | "held"; organization: LibraryView["organization"] }[];
  events: { id: string; type: string; timestamp: string; planId?: string; sourceIds: string[] }[];
  omittedPlans: number;
  totalEvents: number;
}

export async function libraryView(directory: string): Promise<LibraryView> {
  const catalog = await loadCatalog(directory);
  const revision = digest(catalog);
  const cleanText = (value: string) => value.replace(/[\u0000-\u001f]/g, " ").slice(0, 500);
  const project = (value: LibraryOrganization): LibraryView["organization"] => ({
    universes: value.universes.map(({ id, title }) => ({ id, title: cleanText(title) })),
    continuities: value.continuities.map(({ id, title, universeId }) => ({ id, title: cleanText(title), universeId })),
    series: value.series.map(({ id, title }) => ({ id, title: cleanText(title) })),
    assignments: value.assignments.map(({ sourceId, seriesId, continuityId, readingOrder, status }) => ({ sourceId, seriesId, continuityId, readingOrder, status })),
  });
  const events: LibraryView["events"] = catalog.sources.flatMap((source) => source.registeredAt ? [{
    id: `library:source:${source.id}`, type: "library.source.registered", timestamp: source.registeredAt, sourceIds: [source.id],
  }] : []);
  const files = (await readdir(join(directory, "plans"))).filter((file) => /^plan_[a-f0-9]{64}\.json$/.test(file)).sort();
  const plans: LibraryView["plans"] = [];
  const reviewed = new Map(catalog.reviews.map((review, index) => [review.planId, { ...review, index }]));
  const rankedFiles = files.length <= 100 ? files : (await Promise.all(files.map(async file => ({ file, modified: (await lstat(join(directory, "plans", file))).mtimeMs })))).sort((left, right) => right.modified - left.modified || left.file.localeCompare(right.file)).map(entry => entry.file);
  const selectedFiles = files.length <= 100 ? files : [...new Set([
    ...rankedFiles.slice(0, 100), ...(catalog.reviews.at(-1)?.decision === "hold" ? [`${catalog.reviews.at(-1)!.planId}.json`] : []),
  ])];
  for (const file of selectedFiles) {
    const plan = JSON.parse((await readRegular(join(directory, "plans", file), 2 * 1024 * 1024)).toString("utf8")) as OrganizationPlan;
    if (plan.id !== file.slice(0, -5) || `plan_${digest({ baseRevision: plan.baseRevision, organization: plan.organization })}` !== plan.id) throw new Error("Library plan integrity failure.");
    if (plan.createdAt && Number.isFinite(Date.parse(plan.createdAt))) events.push({
      id: `library:plan:${plan.id}`, type: "library.plan.proposed", timestamp: plan.createdAt,
      planId: plan.id, sourceIds: plan.organization.assignments.map((entry) => entry.sourceId),
    });
    const review = reviewed.get(plan.id);
    if (!review && plan.baseRevision === revision || review?.decision === "hold" && review.index === catalog.reviews.length - 1) {
      plans.push({ id: plan.id, state: review?.decision === "hold" ? "held" : "proposed", organization: project(plan.organization) });
    }
  }
  for (const [index, review] of catalog.reviews.entries()) events.push({
    id: `library:review:${index}:${review.planId}`, type: `library.plan.${review.decision === "approve" ? "approved" : review.decision === "reject" ? "rejected" : "held"}`,
    timestamp: review.at, planId: review.planId, sourceIds: catalog.sources.map((source) => source.id),
  });
  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  return { revision, sources: catalog.sources.map(({ id, title, filename }) => ({ id, title: cleanText(title), filename: cleanText(filename) })),
    organization: project(catalog.organization), plans, events, totalEvents: catalog.sources.filter(source => source.registeredAt).length + files.length + catalog.reviews.length,
    omittedPlans: Math.max(0, files.length - selectedFiles.length) };
}

export async function libraryPrepare(directory: string, id: string) {
  return locked(directory, async () => {
    const catalog = await loadCatalog(directory);
    const source = catalog.sources.find((entry) => entry.id === id);
    if (!source) throw new Error("Unknown source ID.");
    const bytes = await sourceBytes(directory, source);
    const workspace = resolve(directory, "workspaces", source.id);
    const result = async (storedInput: string) => {
      const text = await readFile(storedInput, "utf8");
      const inputDirectory = resolve(directory, "inputs", source.id);
      await mkdir(inputDirectory, { recursive: true, mode: 0o700 });
      const input = join(inputDirectory, basename(storedInput));
      try { await writeFile(input, text, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (sourceHash(await readFile(input)) !== sourceHash(text)) throw new Error("Prepared input changed; restore it before continuing.");
      }
      return { workspace, input, storedInput, sourceId: source.id, referenceNamespace: `${source.id}:`,
        next: { command: "novel ingest", args: [workspace, input] }, modelCalls: 0 };
    };
    let exists = false;
    try {
      const stat = await lstat(workspace);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Workspace must be a regular directory, not a symlink.");
      exists = true;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (exists) {
      const identity = JSON.parse(await readFile(join(workspace, "ontology", "library-source.json"), "utf8"));
      const bound = await storedSource(workspace);
      if (identity.documentId !== source.id || !bound) throw new Error("Workspace identity mismatch; explicit migration required.");
      const input = join(workspace, "source", bound.file);
      await bindWorkspaceSource(workspace, input);
      return { status: "already_prepared", ...await result(input) };
    }
    const temporary = join(resolve(directory), "workspaces", `.prepare-${randomUUID()}`);
    try {
      await initWorkspace(temporary);
      let relativeInput = "source/document.txt";
      if (source.format === "epub") {
        await importEpubAlbum(temporary, sourcePath(directory, source));
        const album = JSON.parse(await readFile(join(temporary, "ontology", "album.json"), "utf8"));
        relativeInput = album.sourceText;
      } else {
        await writeFile(join(temporary, relativeInput), sourceText(source, bytes), { flag: "wx" });
      }
      await bindWorkspaceSource(temporary, join(temporary, relativeInput));
      await writeFile(join(temporary, "ontology", "library-source.json"), JSON.stringify({ version: 1, documentId: source.id, sha256: source.sha256 }) + "\n", { flag: "wx" });
      await rename(temporary, workspace);
      return { status: "prepared", ...await result(join(workspace, relativeInput)) };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}
