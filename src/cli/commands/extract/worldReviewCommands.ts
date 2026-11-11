import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeEntities, htmlToText, resolveEpubPath } from "../../../reading/album/epub.js";
import { unzipAll } from "../../../reading/album/zip.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";

/**
 * The review CLI's reading side (docs/v3/design.html#world-ontology §7, Track B W5): what a main agent reads to answer the world's
 * held items — the v2 reading of a card, a scene or a line (`novel reading`), the world log (`novel world log`), the
 * original EPUB as published (`novel source epub`) — and the developer's side of the review: the held items of a run
 * into the pool by scene (`novel world held`), answers into pins under the laws (`novel world apply`). Read-only except
 * the pool and the pins; no model calls.
 */
const readJson = async <T>(path: string): Promise<T | null> => JSON.parse(await readFile(path, "utf8").catch(() => "null")) as T | null;
const readJsonl = async (path: string) => (await readFile(path, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
const clip = (text: string, length = 300) => ([...text].length > length ? `${[...text].slice(0, length - 1).join("")}…` : text);
const repository = async () => { let dir = dirname(fileURLToPath(import.meta.url)); for (let n = 0; n < 6; n++) { if (await readFile(join(dir, "package.json"), "utf8").then(() => true, () => false) && await readdir(join(dir, "engine")).then(() => true, () => false)) return dir; dir = dirname(dir); } throw new Error("The repository's world-engine was not found."); };
const review = async () => import(pathToFileURL(join(await repository(), "engine", "review", "review.mjs")).href) as Promise<{
  holdForReview(novelDir: string, options: { run?: string | null; budget?: number; name?: (id: string) => string }): Promise<Record<string, unknown>>;
  applyAnswers(novelDir: string): Promise<Record<string, unknown>>;
  latestRun(novelDir: string): Promise<string | null>;
}>;

interface Reading {
  scenes: { id: string; sentences: string[]; place?: string | null }[];
  cards: { id: string; kind: string; first: string; sentences: string[]; people: { id: string; how: string[] }[] }[];
  kinds?: Record<string, { kind: string; confidence?: number }>;
  roles?: Record<string, { kind?: string; who?: { id: string; confidence?: number } | null; to?: { id: string } | null }>;
  chart: { entities: { id: string; proper?: string[]; names?: string[]; category?: string }[] };
  slots?: { id: string; label: string }[];
  time?: { scenes?: { scene: string; when?: unknown }[] };
}

/** The v2 reading the director last played from (stage/director/reading-path.json), else the manifest's. */
async function readingOf(novelDir: string): Promise<Reading> {
  const recorded = await readJson<{ path: string }>(join(novelDir, "stage", "director", "reading-path.json"));
  const manifest = await readJson<{ v2Reading?: { out?: string } }>(join(novelDir, "ontology", "manifest.json"));
  const path = recorded?.path ?? (manifest?.v2Reading?.out ? join(manifest.v2Reading.out, "v2", "data.json") : null);
  const reading = path ? await readJson<Reading>(path) : null;
  if (!reading) throw new Error(`No v2 reading for ${novelDir}: the director records the one it plays from in stage/director/reading-path.json.`);
  return reading;
}

/** `novel reading <dir> card|scene|line <id>`: the reading of a card, a scene or a line, with its text. */
export async function readingShow(novelDir: string, kind: string, id: string): Promise<Record<string, unknown>> {
  if (!["card", "scene", "line"].includes(kind) || !id) throw new Error("Usage: novel reading <novel-dir> card|scene|line <id>");
  const reading = await readingOf(novelDir), text = await loadWorkspaceSentences(novelDir);
  const names = new Map<string, string>([...reading.chart.entities.map((entity) => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id] as [string, string]), ...(reading.slots ?? []).map((slot) => [slot.id, slot.label] as [string, string])]);
  const name = (who: string | undefined | null) => (who ? `${names.get(who) ?? who} (${who})` : null);
  const sceneOf = new Map(reading.scenes.flatMap((scene) => scene.sentences.map((sentence) => [sentence, scene.id] as [string, string])));
  const lineOf = (sentence: string) => {
    const role = reading.roles?.[sentence], kindOf = reading.kinds?.[sentence];
    return { line: sentence, text: text.get(sentence)?.text ?? "", kind: kindOf?.kind ?? null, ...(kindOf?.confidence !== undefined ? { kindSure: kindOf.confidence } : {}), ...(role?.who ? (role.kind === "spoken" ? { speaker: name(role.who.id), speakerSure: role.who.confidence ?? null } : { who: name(role.who.id), whoSure: role.who.confidence ?? null }) : {}), ...(role?.to ? { to: name(role.to.id) } : {}) };
  };
  if (kind === "line") {
    if (!text.has(id)) throw new Error(`No line ${id}.`);
    const card = reading.cards.find((entry) => entry.sentences.includes(id));
    return { ...lineOf(id), scene: sceneOf.get(id) ?? null, card: card?.id ?? null };
  }
  if (kind === "card") {
    const card = reading.cards.find((entry) => entry.id === id || `${entry.kind}:${entry.first}` === id || entry.first === id.replace(/^[a-z]+:/, ""));
    if (!card) throw new Error(`No card ${id}: a card id looks like action:b0000_s0214 or dialogue:b0000_s0300.`);
    return { card: card.id, kind: card.kind, scene: sceneOf.get(card.first) ?? null, people: card.people.map((person) => ({ who: name(person.id), how: person.how })), lines: card.sentences.map(lineOf) };
  }
  const scene = reading.scenes.find((entry) => entry.id === id);
  if (!scene) throw new Error(`No scene ${id}.`);
  const script = await readJson<{ scenes: { id: string; present?: string[]; place?: string; at?: unknown }[] }>(join(novelDir, "stage", "world", "script.json"));
  const own = script?.scenes.find((entry) => entry.id === id);
  return { scene: id, place: own?.place ?? scene.place ?? null, at: own?.at ?? reading.time?.scenes?.find((entry) => entry.scene === id)?.when ?? null, present: (own?.present ?? []).map(name),
    cards: reading.cards.filter((card) => sceneOf.get(card.first) === id).map((card) => ({ card: card.id, kind: card.kind, first: clip(text.get(card.first)?.text ?? "", 80) })),
    lines: scene.sentences.length, text: scene.sentences.map((sentence) => `${sentence} ${clip(text.get(sentence)?.text ?? "", 160)}`) };
}

/** `novel world log <dir> --scene|--person|--card <id> [--run <id>]`: the world log's records for a scene, a person or a card. */
export async function worldLogShow(novelDir: string, by: { scene?: string; person?: string; card?: string; run?: string }): Promise<Record<string, unknown>> {
  const run = by.run ?? await (await review()).latestRun(novelDir);
  if (!run) throw new Error("No director run yet: the world log is written by one.");
  if (!by.scene && !by.person && !by.card) throw new Error("Usage: novel world log <novel-dir> --scene <id> | --person <id> | --card <id> [--run <id>]");
  const rows = (await readJsonl(join(novelDir, "stage", "world", "log", `${run}.jsonl`))).filter((row) => (!by.scene || row.scene === by.scene) && (!by.person || row.who === by.person || (row.parties as string[] | undefined)?.includes(by.person)) && (!by.card || row.card === by.card));
  const director = await readJson<{ scenes: { scene: string; cards: { card: string; laws?: unknown[] }[]; laws?: unknown[]; world?: unknown[] }[] }>(join(novelDir, "stage", "director", "run.json"));
  const laws = (director?.scenes ?? []).filter((scene) => !by.scene || scene.scene === by.scene).flatMap((scene) => [...(scene.laws ?? []).map((law) => ({ scene: scene.scene, ...(law as object) })), ...scene.cards.filter((card) => !by.card || card.card === by.card).flatMap((card) => (card.laws ?? []).map((law) => ({ scene: scene.scene, card: card.card, ...(law as object) })))]);
  return { run, records: rows.length, log: rows.slice(0, 200), laws: laws.slice(0, 100) };
}

/** The EPUB a workspace was read from: the job's album input for it (its runtime's NOVEL_JOB.json), else one in its source folder. */
async function epubOf(novelDir: string): Promise<string> {
  const dir = resolve(novelDir);
  for (const job of [join(dir, "..", "..", "runtime", "NOVEL_JOB.json"), join(dir, "..", "runtime", "NOVEL_JOB.json")]) {
    const found = (await readJson<{ volumes?: { workspace?: string; album?: { epub?: string } }[] }>(job))?.volumes?.find((volume) => volume.workspace && resolve(volume.workspace) === dir)?.album?.epub;
    if (found) return found;
  }
  const local = (await readdir(join(dir, "source")).catch(() => [] as string[])).find((file) => file.toLowerCase().endsWith(".epub"));
  if (local) return join(dir, "source", local);
  throw new Error(`No EPUB known for ${novelDir}.`);
}

/**
 * `novel source epub <dir> [--doc N] [--grep <regex>] [--offset N] [--limit N]`: the original EPUB as published, its
 * spine documents in reading order as text: the list, one document's paragraphs (paged), or every paragraph matching.
 */
export async function sourceEpub(novelDir: string, options: { doc?: number; grep?: string; offset?: number; limit?: number }): Promise<Record<string, unknown>> {
  const files = unzipAll(await readFile(await epubOf(novelDir))), canon = new Map([...files.keys()].map((key) => [key.toLowerCase(), key])), canonPath = (key: string) => canon.get(key.toLowerCase()) ?? key;
  const attr = (tag: string, name: string) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i")))?.[1] ?? null;
  const opfPath = canonPath(attr(files.get("META-INF/container.xml")?.toString("utf8") ?? "", "full-path") ?? ""), opf = files.get(opfPath)?.toString("utf8") ?? "", opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = new Map([...opf.matchAll(/<item\s+[^>]*>/gi)].map(([tag]) => [attr(tag, "id"), { href: attr(tag, "href"), type: attr(tag, "media-type") ?? "" }]));
  const spine = [...opf.matchAll(/<itemref\s+[^>]*>/gi)].map(([tag]) => manifest.get(attr(tag, "idref"))).filter((item) => item?.href && (/html|xml/i.test(item.type) || /\.(x?html?|xml)$/i.test(item.href))).map((item) => canonPath(resolveEpubPath(opfDir, item!.href!))).filter((key) => files.has(key));
  const paragraphs = (key: string) => htmlToText(files.get(key)!.toString("utf8")).split("\n").map((line) => line.trim()).filter(Boolean);
  const titleOf = (key: string) => decodeEntities((files.get(key)!.toString("utf8").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, "")).trim() || null;
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200), offset = Math.max(options.offset ?? 0, 0);
  if (options.grep !== undefined) {
    if (!options.grep || options.grep.length > 200) throw new Error("--grep needs a regular expression of 1–200 characters.");
    const regex = new RegExp(options.grep, "u"), hits = spine.flatMap((key, doc) => paragraphs(key).map((text, n) => ({ doc, paragraph: n, text })).filter((entry) => regex.test(entry.text)));
    return { pattern: options.grep, total: hits.length, hits: hits.slice(offset, offset + limit).map((hit) => ({ ...hit, text: clip(hit.text, 400) })) };
  }
  if (options.doc === undefined) return { docs: spine.map((key, doc) => ({ doc, title: titleOf(key), paragraphs: paragraphs(key).length })) };
  if (!Number.isInteger(options.doc) || options.doc < 0 || options.doc >= spine.length) throw new Error(`--doc is a document number from 0 to ${spine.length - 1}.`);
  const all = paragraphs(spine[options.doc]);
  return { doc: options.doc, title: titleOf(spine[options.doc]), paragraphs: all.length, offset, shown: all.slice(offset, offset + limit) };
}

/** `novel world held <dir> [--run <id>] [--budget N]`: a run's held items into the pool, one batch per scene, by reach. */
export async function worldHeld(novelDir: string, options: { run?: string; budget?: number }): Promise<Record<string, unknown>> {
  const reading = await readingOf(novelDir).catch(() => null);
  const names = new Map<string, string>(reading ? [...reading.chart.entities.map((entity) => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id] as [string, string]), ...(reading.slots ?? []).map((slot) => [slot.id, slot.label] as [string, string])] : []);
  return (await review()).holdForReview(novelDir, { run: options.run ?? null, budget: options.budget ?? 12, name: (id) => names.get(id) ?? id });
}

/** `novel world apply <dir>`: the agent's answers into pins, under the laws (what they turn back returns to the pool). */
export async function worldApply(novelDir: string): Promise<Record<string, unknown>> {
  return (await review()).applyAnswers(novelDir);
}

const canon = async () => import(pathToFileURL(join(await repository(), "engine", "review", "canon.mjs")).href) as Promise<{
  toCanon(novelDir: string, options: { run: string; reading: Reading }): Promise<Record<string, unknown>>;
  undoCanon(novelDir: string, options: { run: string }): Promise<Record<string, unknown>>;
}>;
const graphAgain = async (novelDir: string) => { const { buildGraphFromBundle } = await import("../../../ground/connectors/ladybug.js"); await buildGraphFromBundle(join(novelDir, "ontology"), join(novelDir, "ontology", "graph.lbug")); };

/** `novel world canon <dir> [--run <id>]`: what a director run settled, into canon by its gates (the director does it after each run). */
export async function worldCanon(novelDir: string, options: { run?: string }): Promise<Record<string, unknown>> {
  const run = options.run ?? await (await review()).latestRun(novelDir);
  if (!run) throw new Error("No director run to take into canon.");
  const result = await (await canon()).toCanon(novelDir, { run, reading: await readingOf(novelDir) });
  await graphAgain(novelDir);
  return { run, ...result };
}

/** `novel world undo <dir> --run <id>`: a run's writes to canon taken back, each record to what it replaced. */
export async function worldUndo(novelDir: string, options: { run?: string }): Promise<Record<string, unknown>> {
  if (!options.run) throw new Error("Usage: novel world undo <novel-dir> --run <id>");
  const result = await (await canon()).undoCanon(novelDir, { run: options.run });
  await graphAgain(novelDir);
  return { run: options.run, ...result };
}
