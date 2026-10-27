/**
 * The portrait pool: OCR character portraits that are HIDDEN UNTIL BOUND.
 *
 * Producer: tools/album-portraits/portraits.py crops heads from the
 * album's plates and writes ontology/portraits.jsonl. A record with
 * `entityId: null` is an orphan: a face (and usually an OCR'd name)
 * with no character entity yet — the common case, since portrait pages
 * sit at the front of a volume before any character has appeared.
 *
 * Binding triggers (owner's decisions, 2026-10-24):
 * (a) entity birth: an orphan whose name folds (language-map fold,
 * decision #19) to exactly ONE entity auto-attaches. Ambiguous
 * (zero or several matches) or nameless orphans never auto-attach —
 * a wrong portrait on a character is a visible error; an unbound
 * portrait is just pending.
 * (b) EM merge: portraits follow the survivor (all of them; the first
 * in file order is the display default — "a name keeps its FIRST
 * portrait" is a preference, not a uniqueness constraint).
 * (c) end-of-run fallback (replaces asking the user): after all blocks
 * + the final chapter sweep + EM, when the cast is stable, characters
 * still without a portrait become reviewer tasks in
 * ontology/portrait-tasks.jsonl — for the MAIN AGENT (System 2
 * reviewer) to assign, and ONLY if that host agent supports visual
 * input. If it does not, the portrait stays unbound and hidden; the
 * user is never interrupted for portrait assignment.
 *
 * Portraits are album data, like illustrations: never canon entities,
 * never gate proposals. This module only reads/writes portraits.jsonl
 * and portrait-tasks.jsonl — it never touches the ontology bundle.
 */
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { formKey } from "../../../ground/language/nameForms.js";
import type { Entity } from "../../../ground/ontology/types.js";

/** One record of ontology/portraits.jsonl (shape shared with portraits.py). */
export interface PortraitRecord {
  /** Bound character entity id, or null while the portrait is an orphan. */
  entityId: string | null;
  /** Character name the OCR caption named (may be empty when no caption matched). */
  name: string;
  /** Crop asset path relative to the novel dir, e.g. "assets/portraits/mikoto.png". */
  portrait: string;
  sourceIllustration: string;
  sourceAsset: string;
  ocrText: string;
  ocrConfidence: number;
  matchKind: string;
  headBox?: number[];
  headScore?: number;
  imageSize?: [number, number];
}

/** One end-of-run reviewer task for a character still without a portrait. */
export interface PortraitTask {
  characterId: string;
  name: string;
  forms: string[];
  /** Orphan portraits the reviewer may match by face (empty = none to offer). */
  candidates: { portrait: string; sourceIllustration: string; ocrText: string; ocrConfidence: number }[];
  /** Always true: assigning needs eyes on the face images. */
  requiresVisualInput: true;
  /** What the run knew about the host: true / false / "unknown". */
  hostSupportsVisualInput: boolean | "unknown";
  note: string;
}

export async function loadPortraits(novelDir: string): Promise<PortraitRecord[]> {
  const raw = await readFile(join(novelDir, "ontology", "portraits.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (raw === null) return [];
  return raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as PortraitRecord);
}

export async function savePortraits(novelDir: string, records: PortraitRecord[]): Promise<void> {
  await atomicMetadata(novelDir, "portraits.jsonl", records);
}

async function atomicMetadata(novelDir: string, file: string, records: unknown[]): Promise<void> {
  const target = join(novelDir, "ontology", file);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
  if (info?.isSymbolicLink()) throw new Error("Portrait metadata must not be a symlink");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

/**
 * Host visual-input capability from the environment. NOVEL_HOST_VISION=1
 * means the host agent can see images, =0 means it cannot; unset means
 * unknown — tasks are still emitted, but marked as requiring the check.
 */
export function hostVisionFromEnv(env: NodeJS.ProcessEnv = process.env): boolean | "unknown" {
  if (env.NOVEL_HOST_VISION === "1") return true;
  if (env.NOVEL_HOST_VISION === "0") return false;
  return "unknown";
}

/**
 * (a) Birth fold-match: orphans whose name folds to exactly one entity
 * attach to it. Returns the number newly bound. Zero-match and
 * multi-match orphans are left untouched (they become reviewer tasks).
 */
export function bindPortraitsAtBirth(entities: Entity[], portraits: PortraitRecord[]): number {
  const byFold = new Map<string, string[]>();
  for (const entity of entities) {
    if (entity.kind !== "Character") continue;
    for (const form of entity.names ?? []) {
      const key = formKey(form.text);
      const ids = byFold.get(key) ?? [];
      if (!ids.includes(entity.id)) ids.push(entity.id);
      byFold.set(key, ids);
    }
  }
  let bound = 0;
  for (const portrait of portraits) {
    if (portrait.entityId !== null || !portrait.name) continue;
    const matches = byFold.get(formKey(portrait.name)) ?? [];
    if (matches.length === 1) {
      portrait.entityId = matches[0];
      bound++;
    }
  }
  return bound;
}

/**
 * (b) EM-merge follow: every portrait bound to a dropped id moves to
 * the survivor. Multiple portraits per entity are allowed; file order
 * decides the display default.
 */
export function followPortraitMerges(
  pairs: { keepId: string; dropId: string }[],
  portraits: PortraitRecord[],
): number {
  let moved = 0;
  for (const { keepId, dropId } of pairs) {
    for (const portrait of portraits) {
      if (portrait.entityId === dropId) {
        portrait.entityId = keepId;
        moved++;
      }
    }
  }
  return moved;
}

export interface PortraitFinalizeResult {
  portraitsFile: boolean;
  bound: number;
  followed: number;
  /** Characters (kind=character) with no bound portrait after (a) + (b). */
  unboundCharacters: { id: string; name: string; forms: string[] }[];
  /** True when tasks were written for the reviewer. */
  tasksWritten: boolean;
  /** True when the host is known not to support visual input: no tasks, portraits stay hidden. */
  visionSkipped: boolean;
  tasks: PortraitTask[];
}

/**
 * (c) End-of-run finalization: merge-follow, then birth binding, then
 * reviewer tasks for the characters still without a portrait — unless
 * the host is known not to support visual input, in which case no
 * tasks are written and the portraits stay unbound and hidden.
 * Returns zeros (no writes) when there is no portraits file.
 */
export async function finalizePortraits(
  novelDir: string,
  opts: {
    entities: Entity[];
    mergedPairs: { keepId: string; dropId: string }[];
    hostSupportsVisualInput: boolean | "unknown";
  },
): Promise<PortraitFinalizeResult> {
  const portraits = await loadPortraits(novelDir);
  if (portraits.length === 0) {
    return { portraitsFile: false, bound: 0, followed: 0,
      unboundCharacters: opts.entities.filter((entity) => entity.kind === "Character").map((entity) => ({ id: entity.id, name: entity.names[0]?.text ?? entity.id, forms: entity.names.map((form) => form.text) })),
      tasksWritten: false, visionSkipped: opts.hostSupportsVisualInput === false, tasks: [] };
  }
  const followed = followPortraitMerges(opts.mergedPairs, portraits);
  const bound = bindPortraitsAtBirth(opts.entities, portraits);
  if (followed > 0 || bound > 0) await savePortraits(novelDir, portraits);

  const boundEntityIds = new Set(portraits.filter((p) => p.entityId !== null).map((p) => p.entityId as string));
  const characters = opts.entities.filter((e) => e.kind === "Character");
  const unboundCharacters = characters
    .filter((e) => !boundEntityIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.names[0]?.text ?? e.id, forms: (e.names ?? []).map((n) => n.text) }));

  if (opts.hostSupportsVisualInput === false) {
    await atomicMetadata(novelDir, "portrait-tasks.jsonl", []);
    return { portraitsFile: true, bound, followed, unboundCharacters, tasksWritten: false, visionSkipped: true, tasks: [] };
  }
  const orphans = portraits.filter((p) => p.entityId === null);
  const tasks: PortraitTask[] = unboundCharacters.map((c) => ({
    characterId: c.id,
    name: c.name,
    forms: c.forms,
    candidates: orphans.map((p) => ({
      portrait: p.portrait,
      sourceIllustration: p.sourceIllustration,
      ocrText: p.ocrText,
      ocrConfidence: p.ocrConfidence,
    })),
    requiresVisualInput: true as const,
    hostSupportsVisualInput: opts.hostSupportsVisualInput,
    note:
      opts.hostSupportsVisualInput === "unknown"
        ? "Act on this task only if you (the reviewing agent) can see the face images; if you cannot, leave the portrait unbound and hidden."
        : "Match the character to a candidate portrait by face; leave unbound when no candidate fits — never invent a portrait.",
  }));
  await atomicMetadata(novelDir, "portrait-tasks.jsonl", tasks);
  return { portraitsFile: true, bound, followed, unboundCharacters, tasksWritten: tasks.length > 0, visionSkipped: false, tasks };
}
