import type { Sentence } from "../text/sectioning.js";

export interface SourceChunk {
  core: Sentence[];
  context: Sentence[];
}

export const renderSentences = (sentences: Sentence[]): string => sentences.map(sentence => `${sentence.id}: ${sentence.text}`).join("\n");

export function sourceChunks(sentences: Sentence[], options: { maxBytes?: number; maxSentences?: number; margin?: number } = {}): SourceChunk[] {
  const maxBytes = options.maxBytes ?? 6_000;
  const chunks: SourceChunk[] = [];
  let offset = 0;
  while (offset < sentences.length) {
    const core: Sentence[] = [];
    while (offset + core.length < sentences.length && core.length < (options.maxSentences ?? 32)) {
      const next = sentences[offset + core.length];
      if (Buffer.byteLength(renderSentences([...core, next]), "utf8") > maxBytes) break;
      core.push(next);
    }
    if (!core.length) throw new Error("A source sentence exceeds the faculty context budget; original text was not truncated");
    let before = Math.min(options.margin ?? 4, offset);
    let after = Math.min(options.margin ?? 4, sentences.length - offset - core.length);
    let context = sentences.slice(offset - before, offset + core.length + after);
    while (Buffer.byteLength(renderSentences(context), "utf8") > maxBytes && (before || after)) {
      if (before >= after && before) before--; else after--;
      context = sentences.slice(offset - before, offset + core.length + after);
    }
    chunks.push({ core, context });
    offset += core.length;
  }
  return chunks;
}

export function jsonObject(raw: string): Record<string, unknown> {
  const clean = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const value: unknown = JSON.parse(clean);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Faculty response must be a JSON object");
  return value as Record<string, unknown>;
}
