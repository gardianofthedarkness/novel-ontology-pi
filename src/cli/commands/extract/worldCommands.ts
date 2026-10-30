import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { LANDSCAPE_TYPES } from "../../../ground/stage/landscape.js";
import type { LandscapePick } from "../../../digger/stage/landscape.js";

/**
 * The world's review pool (docs/world-first-design.md §11): what the world-first loop flags — a merge it made on world
 * evidence, presence it is unsure of, a dialogue or an actor the laws reject, two people whose traces run too alike —
 * waits in stage/world/pool.jsonl. Every few items make a batch (stage/world/batches/<id>.json) that the main agent is
 * sent while the world goes on. The agent answers each item from the original text (`novel source grep|similar`,
 * `novel query`) with `novel world answer`; the world stops at its next scene, applies the answers under its laws, and
 * an answer that breaks a law goes back to the pool for the next batch.
 */
export interface PoolItem {
  id: string;
  kind: "identity" | "presence" | "dialogue" | "actor" | "trace" | "landscape";
  scene: string | null;
  subjects: string[];
  names: string[];
  question: string;
  options: string[];
  evidence: string[];
  status: "open" | "batched" | "answered" | "applied" | "failed";
  batch?: string | null;
  attempts: number;
  note?: string;
  at: string;
}
export interface PoolAnswer { batch: string; item: string; verdict: string; reason: string; at: string }

const folder = (novelDir: string) => join(novelDir, "stage", "world");
const readLines = async <T>(path: string) => (await readFile(path, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
async function requireWorldFirst(novelDir: string) {
  const manifest = JSON.parse(await readFile(join(novelDir, "ontology", "manifest.json"), "utf8").catch(() => "{}")) as { worldFirst?: boolean };
  if (!manifest.worldFirst) throw new Error(`${novelDir} is not a world-first workspace: its facts go through the review gate (novel review), not the world's pool.`);
}

/** The pool now: each item as last written. */
export async function loadPool(novelDir: string): Promise<PoolItem[]> {
  const items = new Map<string, PoolItem>();
  for (const item of await readLines<PoolItem>(join(folder(novelDir), "pool.jsonl"))) items.set(item.id, item);
  return [...items.values()];
}
export const loadAnswers = (novelDir: string) => readLines<PoolAnswer>(join(folder(novelDir), "answers.jsonl"));

/** Items into the pool (new, or a new state of one already there). */
export async function writePool(novelDir: string, items: PoolItem[]) {
  if (!items.length) return;
  await mkdir(folder(novelDir), { recursive: true, mode: 0o700 });
  await appendFile(join(folder(novelDir), "pool.jsonl"), items.map((item) => JSON.stringify(item)).join("\n") + "\n", { mode: 0o600 });
}

/**
 * The question for a landscape Jev is unsure of (a world-first book's manifold, `novel stage landscape`): what the
 * ground of a city, district or street mostly looks like. Its id follows the pick's inputs, so a place asked again with
 * more to go on is a new question.
 */
export function landscapeItem(placeId: string, pick: LandscapePick): PoolItem {
  const top = Object.entries(pick.probabilities ?? {}).sort((first, second) => second[1] - first[1]).slice(0, 3).map(([type, p]) => `${type} ${Math.round(p * 100)}%`).join(", ");
  return { id: `wi_${createHash("sha256").update(`landscape|${placeId}|${pick.inputs}`).digest("hex").slice(0, 16)}`, kind: "landscape", scene: null, subjects: [placeId], names: [pick.label],
    question: `Seen from above, what does the ground of ${pick.label} mostly look like, as the novel tells it (its era, what stands there)? Jev picked ${pick.type} at ${Math.round((pick.confidence ?? 0) * 100)}%. Its places with no landscape of their own take this ground.`,
    options: [...LANDSCAPE_TYPES, "none"], evidence: [`Jev: ${top || pick.type}`], status: "open", attempts: 0, at: new Date().toISOString() };
}

/** A batch of open items for the main agent: written, and the items marked as in it. */
export async function makeBatch(novelDir: string, items: PoolItem[]): Promise<{ id: string; items: string[] }> {
  const id = `wb_${randomUUID().replace(/-/g, "").slice(0, 16)}`, batch = { id, createdAt: new Date().toISOString(), items: items.map((item) => item.id) };
  await mkdir(join(folder(novelDir), "batches"), { recursive: true, mode: 0o700 });
  await writeFile(join(folder(novelDir), "batches", `${id}.json`), JSON.stringify(batch, null, 1), { mode: 0o600 });
  await writePool(novelDir, items.map((item) => ({ ...item, status: "batched", batch: id, at: new Date().toISOString() })));
  return batch;
}

export async function worldPool(novelDir: string): Promise<Record<string, unknown>> {
  await requireWorldFirst(novelDir);
  const items = await loadPool(novelDir), answers = await loadAnswers(novelDir);
  const count = (status: PoolItem["status"]) => items.filter((item) => item.status === status).length;
  const batches = [...new Set(items.filter((item) => item.batch && item.status === "batched").map((item) => item.batch!))];
  return { open: count("open"), batched: count("batched"), answered: count("answered"), applied: count("applied"), failed: count("failed"),
    waiting: batches.map((id) => ({ batch: id, items: items.filter((item) => item.batch === id && item.status === "batched").length, answered: answers.filter((answer) => answer.batch === id).length })),
    next: batches.length ? `novel world batch ${novelDir} ${batches[0]}` : null };
}

export async function worldBatch(novelDir: string, batchId: string): Promise<Record<string, unknown>> {
  await requireWorldFirst(novelDir);
  if (!/^wb_[a-f0-9]{16}$/.test(batchId)) throw new Error("A world batch id looks like wb_ and 16 hex digits.");
  const batch = JSON.parse(await readFile(join(folder(novelDir), "batches", `${batchId}.json`), "utf8").catch(() => "null")) as { id: string; items: string[] } | null;
  if (!batch) throw new Error(`No world batch ${batchId}; see novel world pool ${novelDir}.`);
  const items = await loadPool(novelDir), answers = await loadAnswers(novelDir);
  return {
    batch: batch.id,
    how: `Check each item against the original text (novel source grep <book> <regex>, novel source similar <book> <text>, novel query <book> 'MATCH …'), then answer it: novel world answer <book> ${batch.id} <item> <one of its options> --reason "<why, citing sentence ids>". The world applies the answers under its laws; one that breaks a law comes back in a later batch.`,
    items: batch.items.map((id) => items.find((item) => item.id === id)).filter(Boolean).map((item) => ({ item: item!.id, kind: item!.kind, scene: item!.scene, names: item!.names, question: item!.question, options: item!.options, evidence: item!.evidence, ...(item!.note ? { note: item!.note } : {}), answered: answers.find((answer) => answer.batch === batch.id && answer.item === item!.id)?.verdict ?? null })),
  };
}

export async function worldAnswer(novelDir: string, batchId: string, itemId: string, verdict: string, reason: string): Promise<Record<string, unknown>> {
  await requireWorldFirst(novelDir);
  const item = (await loadPool(novelDir)).find((entry) => entry.id === itemId);
  if (!item || item.batch !== batchId) throw new Error(`Item ${itemId} is not in batch ${batchId}; see novel world batch ${novelDir} ${batchId}.`);
  if (item.status !== "batched") throw new Error(`Item ${itemId} is ${item.status}, not waiting for an answer.`);
  if (!item.options.includes(verdict)) throw new Error(`Answer with one of: ${item.options.map((option) => JSON.stringify(option)).join(", ")}.`);
  if (!reason.trim() || reason.length > 600) throw new Error("--reason is required (at most 600 characters): why, citing sentence ids.");
  const answer: PoolAnswer = { batch: batchId, item: itemId, verdict, reason: reason.trim(), at: new Date().toISOString() };
  await appendFile(join(folder(novelDir), "answers.jsonl"), JSON.stringify(answer) + "\n", { mode: 0o600 });
  await writePool(novelDir, [{ ...item, status: "answered", at: answer.at }]);
  return { ...answer, note: "The world applies it at its next scene, under its laws." };
}
