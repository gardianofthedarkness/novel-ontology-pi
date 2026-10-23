import type { Sentence } from "../text/sectioning.js";

export interface SourceChunk {
  core: Sentence[];
  context: Sentence[];
}

export const renderSentences = (sentences: Sentence[]): string => sentences.map(sentence => `${sentence.id}: ${sentence.text}`).join("\n");

export function expandDecisionContext(state: string, source: Sentence[], options: { margin?: number; maxBytes?: number } = {}): string | undefined {
  const visible = new Set([...state.matchAll(/^(b\d+_s\d+):/gm)].map(match => match[1]));
  const indices = source.flatMap((sentence, index) => visible.has(sentence.id) ? [index] : []);
  if (!indices.length) return undefined;
  const maxBytes = options.maxBytes ?? 16_000;
  const margin = options.margin ?? 32;
  const prefix = "READ-ONLY NEIGHBOR CONTEXT: use only to interpret the original target. Do not output neighboring sentences or change the allowed options.\n";
  const extra: Sentence[] = [];
  for (let distance = 1; distance <= margin; distance++) {
    for (const index of [indices[0] - distance, indices.at(-1)! + distance]) {
      const sentence = source[index];
      if (!sentence || visible.has(sentence.id)) continue;
      const candidate = [...extra, sentence].sort((first, second) => source.indexOf(first) - source.indexOf(second));
      if (Buffer.byteLength(`${prefix}${renderSentences(candidate)}\nORIGINAL TARGET AND QUESTIONS:\n${state}`, "utf8") <= maxBytes) extra.push(sentence);
    }
  }
  if (!extra.length) return undefined;
  extra.sort((first, second) => source.indexOf(first) - source.indexOf(second));
  return `${prefix}${renderSentences(extra)}\nORIGINAL TARGET AND QUESTIONS:\n${state}`;
}

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
