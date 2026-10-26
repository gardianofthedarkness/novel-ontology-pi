import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cutBlocks } from "../../digger/intake/blocks.js";
import { sectionBlock, type Sentence } from "../../digger/intake/sectioning.js";
import { sourceHash, storedSource } from "../../ground/workspace/source.js";
import { loadChangeSet } from "../merge/changesetStore.js";
import { digest } from "../merge/semantic.js";
import type { OntEvent, Scene } from "../../ground/ontology/types.js";
import { loadCausalityUniverse } from "./units.js";

export async function causalSource(novelDir: string) {
  const bound = await storedSource(novelDir);
  const entries = await readdir(join(novelDir, "source"), { withFileTypes: true });
  if (entries.some(entry => !entry.isFile()) || !bound && entries.length !== 1) throw new Error("Causal review needs one unambiguous original source.");
  const path = join(novelDir, "source", bound?.file ?? entries[0].name);
  if (!(await lstat(path)).isFile()) throw new Error("Original source must be a regular file.");
  const original = await readFile(path, "utf8");
  const hash = sourceHash(original);
  if (bound && bound.sha256 !== hash) throw new Error("Original source changed; restore before causal review.");
  const sentences = cutBlocks(original, bound?.blockSize).flatMap(block => sectionBlock(block.text, block.index).sentences);
  return { hash, sentences };
}

export async function causalityEvidence(novelDir: string, fromId: string, toId: string, options: { changesetId?: string; offset?: number; limit?: number } = {}) {
  const offset = options.offset ?? 0, limit = options.limit ?? 12;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Causal evidence pages require offset >= 0 and limit 1..20.");
  if (options.changesetId && !/^cs_[a-zA-Z0-9_-]+$/.test(options.changesetId)) throw new Error("Invalid changeset ID.");
  const packet = options.changesetId ? await loadChangeSet(novelDir, options.changesetId) : null;
  const universe = await loadCausalityUniverse(novelDir, {
    events: packet?.proposals.filter(proposal => proposal.kind === "create_event").map(proposal => proposal.payload as OntEvent),
    scenes: packet?.proposals.filter(proposal => proposal.kind === "create_scene").map(proposal => proposal.payload as Scene),
  });
  const from = universe.byId.get(fromId), to = universe.byId.get(toId);
  if (!from || !to || fromId === toId) throw new Error("Evidence needs two distinct known event/dialogue endpoints.");
  const { hash, sentences: sourceSentences } = await causalSource(novelDir);
  const required = [...new Set([...from.sentenceIds, ...to.sentenceIds])];
  const wanted = new Set(required);
  const sentences: Sentence[] = [];
  sourceSentences.forEach((sentence, index) => {
    if ([sourceSentences[index - 1], sentence, sourceSentences[index + 1]].some(nearby => nearby && wanted.has(nearby.id))) sentences.push(sentence);
  });
  const found = new Set(sentences.map(sentence => sentence.id));
  const missing = required.filter(id => !found.has(id));
  const available = from.sentenceIds.length > 0 && to.sentenceIds.length > 0 && missing.length === 0;
  const revision = digest({ from, to, source: hash, packet: packet ? { id: packet.id, createdAt: packet.createdAt, proposals: packet.proposals, reviewSource: packet.reviewSource } : null });
  return { fromId, toId, changesetId: packet?.id ?? null, revision, available, missingSentenceIds: missing, requiredSentenceIds: required,
    from: { kind: from.kind, summary: from.summary, chapterIndex: from.chapterIndex }, to: { kind: to.kind, summary: to.summary, chapterIndex: to.chapterIndex },
    sentences: sentences.slice(offset, offset + limit), page: { offset, limit, total: sentences.length, nextOffset: offset + limit < sentences.length ? offset + limit : null } };
}
