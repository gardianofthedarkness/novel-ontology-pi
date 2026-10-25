import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CharacterStateAtPoint, DialogueTurn } from "../../ground/ontology/types.js";
import type { ChangeProposal } from "../../solidifier/merge/changeset.js";
import { candidateNodeId, type EntityCandidate } from "./entityCandidates.js";

export interface WorkingDraft {
  version: 1;
  blockId: string;
  chapterIndex: number;
  stage: "miniloop" | "extraction" | "gate";
  patchId: string;
  updatedAt: string;
  proposals: ChangeProposal[];
  sceneSpans: string[][];
  dialogueUnits: string[][];
  turns: DialogueTurn[];
  dialogueCards?: { id: string; sentenceIds: string[]; participantNames: string[]; unresolvedNames: string[] }[];
  completedScenes: number;
  totalScenes: number;
  statePreview?: CharacterStateAtPoint[];
  /** Entities found by faculties so far, ahead of extraction (see entityCandidates.ts). */
  entityCandidates?: EntityCandidate[];
}

export async function saveWorkingDraft(novelDir: string, draft: WorkingDraft): Promise<void> {
  if (!/^b[0-9]+$/.test(draft.blockId)) throw new Error("Invalid draft block ID");
  const directory = join(novelDir, "working");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const target = join(directory, `${draft.blockId}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(draft), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

export function touchedDraftIds(previous: WorkingDraft, current: WorkingDraft): string[] {
  const ids: string[] = [];
  const old = new Map(previous.proposals.map(proposal => [proposal.id, JSON.stringify(proposal)]));
  for (const proposal of current.proposals) {
    if (old.get(proposal.id) === JSON.stringify(proposal)) continue;
    const payload = proposal.payload as Record<string, unknown>;
    const id = payload.needsExtraction ? `draft:${proposal.id}` : payload.id ?? payload.characterId ?? payload.entityId;
    if (typeof id === "string") ids.push(id);
  }
  const spans = new Set(previous.sceneSpans.map(span => JSON.stringify(span)));
  for (const span of current.sceneSpans.slice(current.completedScenes)) if (!spans.has(JSON.stringify(span))) ids.push(`draft:${current.blockId}:scene:${span[0]}`);
  const units = new Set(previous.dialogueUnits.map(unit => JSON.stringify(unit)));
  for (const unit of current.dialogueUnits) if (!units.has(JSON.stringify(unit))) ids.push(`draft:${current.blockId}:dialogue:${unit[0]}`);
  const cards = new Map(previous.dialogueCards?.map(card => [card.id, JSON.stringify(card)]) ?? []);
  for (const card of current.dialogueCards ?? []) if (cards.get(card.id) !== JSON.stringify(card)) ids.push(`draft:${current.blockId}:dialogue:${card.sentenceIds[0]}`);
  // New or changed candidates: a known entity is announced under its own id
  // (it lights up in place); a new one under its draft candidate id.
  const candidates = new Map(previous.entityCandidates?.map(candidate => [candidate.key, JSON.stringify(candidate)]) ?? []);
  for (const candidate of current.entityCandidates ?? []) if (candidates.get(candidate.key) !== JSON.stringify(candidate)) ids.push(candidateNodeId(current.blockId, candidate));
  return [...new Set(ids)];
}
