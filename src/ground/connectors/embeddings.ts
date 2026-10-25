/**
 * Embeddings — scoped activation, causality only.
 *
 * The Oct 21, 2026 graph-first deferral still governs every other faculty:
 * nothing in this module is read by retrieval, EM, or the merge gate. The
 * causality faculty (src/solidifier/causality/) is the sole consumer, using
 * vectors only to nominate candidate pairs for Jev adjudication. Jev — never
 * a vector score — decides whether a CAUSES link exists.
 *
 * The client speaks the OpenAI-compatible `/v1/embeddings` wire format so a
 * local CPU model server (the ratified default) and any hosted OpenAI-style
 * endpoint are both reachable by configuration alone: EMBEDDING_PROVIDER /
 * EMBEDDING_MODEL / EMBEDDING_DIMENSION / EMBEDDING_BASE_URL /
 * EMBEDDING_API_KEY. No hosted vector database, no new service: vectors are
 * stored as a rebuildable JSONL sidecar under the novel's ontology directory
 * (embeddings.jsonl) and the model + dimension are recorded in the bundle
 * manifest (fields pre-existing in bundle.ts).
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One embeddable search unit: an event or a dialogue card. */
export type EmbeddingUnitKind = "event" | "dialogue";

export interface Embedder {
  readonly model: string;
  /** Dimension once known (null until the first call confirms it). */
  dimension: number | null;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingsOptions {
  provider: string | null;
  model: string | null;
  dimension: number | null;
  baseUrl: string | null;
  apiKey: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Well-known OpenAI-compatible base URLs, by provider name. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
};

/** Resolve the embeddings base URL, or null when nothing is configured. */
export function resolveEmbeddingsBaseUrl(opts: Pick<EmbeddingsOptions, "provider" | "baseUrl">): string | null {
  if (opts.baseUrl) return opts.baseUrl.replace(/\/+$/, "");
  if (opts.provider && DEFAULT_BASE_URLS[opts.provider.toLowerCase()]) return DEFAULT_BASE_URLS[opts.provider.toLowerCase()];
  return null;
}

/**
 * Build an embedder from resolved configuration, or null when nothing is
 * configured at all (no model, no provider, no base URL). Throws when the
 * configuration is partial in a way that cannot be resolved (model without a
 * reachable base URL) so a misconfiguration fails fast instead of silently
 * degrading the faculty to graph-only candidates.
 */
export function loadEmbedder(
  opts: EmbeddingsOptions,
  fetchFn: typeof fetch = fetch,
): Embedder | null {
  const baseUrl = resolveEmbeddingsBaseUrl(opts);
  if (!opts.model && !opts.provider && !baseUrl) return null;
  if (!baseUrl) {
    throw new Error(
      `Embeddings misconfigured: provider "${opts.provider ?? ""}" has no known base URL — set EMBEDDING_BASE_URL.`,
    );
  }
  return new OpenAICompatibleEmbedder(baseUrl, opts.model ?? "embeddings", opts.dimension, opts.apiKey, fetchFn);
}

/** OpenAI-compatible embeddings client with the same retry posture as the work model. */
export class OpenAICompatibleEmbedder implements Embedder {
  dimension: number | null;
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    dimension: number | null,
    private readonly apiKey: string | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.dimension = dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        let response: Response;
        try {
          response = await this.fetchFn(`${this.baseUrl}/embeddings`, {
            method: "POST",
            headers,
            body: JSON.stringify({ input: texts, model: this.model }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Embeddings request failed: HTTP ${response.status}`);
          await sleep(500 * (attempt + 1));
          continue;
        }
        if (!response.ok) throw new Error(`Embeddings request failed: HTTP ${response.status}`);
        const body = (await response.json()) as {
          data?: { embedding?: number[]; index?: number }[];
        };
        const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (rows.length !== texts.length) {
          throw new Error(`Embeddings response returned ${rows.length} vectors for ${texts.length} inputs`);
        }
        const vectors = rows.map((row) => {
          if (!Array.isArray(row.embedding)) throw new Error("Embeddings response missing vector data");
          return row.embedding;
        });
        const dimension = vectors[0].length;
        if (!vectors.every((vector) => vector.length === dimension)) {
          throw new Error("Embeddings response vectors have inconsistent dimensions");
        }
        if (this.dimension !== null && this.dimension !== dimension) {
          throw new Error(`Embeddings dimension mismatch: configured ${this.dimension}, model returned ${dimension}`);
        }
        this.dimension = dimension;
        return vectors;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && /dimension|vector data|returned \d+ vectors/.test(error.message)) throw error;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Embeddings request failed");
  }
}

/** Cosine similarity between two same-length vectors (0 when either is zero). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Top-K most similar candidates to a query vector, excluding given ids. */
export function topKSimilar(
  query: number[],
  candidates: { id: string; vector: number[] }[],
  k: number,
  excludeIds: ReadonlySet<string> = new Set(),
): { id: string; score: number }[] {
  return candidates
    .filter((candidate) => !excludeIds.has(candidate.id))
    .map((candidate) => ({ id: candidate.id, score: cosineSimilarity(query, candidate.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Sidecar store: <ontologyDir>/embeddings.jsonl, one JSON record per line.
// Rebuildable: deleting the file only loses cached vectors; the faculty
// re-embeds from bundle text on the next run.
// ---------------------------------------------------------------------------

export interface EmbeddingRecord {
  id: string;
  kind: EmbeddingUnitKind;
  model: string;
  dimension: number;
  vector: number[];
}

export const EMBEDDING_SIDECAR_FILE = "embeddings.jsonl";

export async function loadEmbeddingSidecar(ontologyDir: string): Promise<Map<string, EmbeddingRecord>> {
  const records = new Map<string, EmbeddingRecord>();
  let text: string;
  try {
    text = await readFile(join(ontologyDir, EMBEDDING_SIDECAR_FILE), "utf8");
  } catch {
    return records;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as EmbeddingRecord;
      if (record.id && Array.isArray(record.vector)) records.set(record.id, record);
    } catch {
      // Skip a corrupt line; the unit re-embeds on the next run.
    }
  }
  return records;
}

export async function appendEmbeddingSidecar(ontologyDir: string, records: EmbeddingRecord[]): Promise<void> {
  if (records.length === 0) return;
  await mkdir(ontologyDir, { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await appendFile(join(ontologyDir, EMBEDDING_SIDECAR_FILE), lines, "utf8");
}

/** Record the embedding model + dimension in the bundle manifest (read-modify-write). */
export async function updateManifestEmbedding(ontologyDir: string, model: string, dimension: number): Promise<void> {
  const path = join(ontologyDir, "manifest.json");
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    // Missing or corrupt manifest: write a fresh one with just these fields
    // rather than failing the faculty for a metadata update.
  }
  manifest.embeddingModel = model;
  manifest.embeddingDimension = dimension;
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
