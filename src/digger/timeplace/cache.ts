import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionAnswer, DecisionModel } from "../../ground/connectors/jev.js";
import type { WorkModel } from "../../ground/connectors/llm.js";
import type { MeteredWorkModel, UsageMeter } from "./vocabulary.js";

/**
 * Reply cache for the time-place faculty: identical prompts (same scene
 * text, same prompt version, same Jev state) reuse the stored reply. Makes
 * re-runs and resumes cost only what changed. Owner-only files; replies
 * hold ids, short source-copied words and choices — no reasoning.
 */
const CACHED = new WeakSet<DecisionAnswer[]>();
const key = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

async function read<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; }
}
async function write(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}

export function cachedWork(model: WorkModel & Partial<Pick<MeteredWorkModel, "generateWithUsage" | "generateWithInfo">>, directory: string): MeteredWorkModel {
  const folder = join(directory, "work");
  const generateWithUsage: NonNullable<MeteredWorkModel["generateWithUsage"]> = async (request) => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, `${key([model.modelId, request.system, request.prompt, request.maxTokens ?? null])}.json`);
    const hit = await read<{ content: string }>(file);
    if (hit) return { content: hit.content, usage: { promptTokens: 0, completionTokens: 0 }, cached: true };
    const result = model.generateWithUsage ? await model.generateWithUsage(request)
      : model.generateWithInfo ? await model.generateWithInfo(request).then((info) => ({ content: info.text, usage: info.usage }))
      : { content: await model.generate(request), usage: { promptTokens: null, completionTokens: null } };
    await write(file, { content: result.content });
    return { ...result, cached: false };
  };
  return { modelId: model.modelId, generate: async (request) => (await generateWithUsage(request)).content, generateWithUsage };
}

export function cachedDecisions(model: DecisionModel, directory: string): DecisionModel {
  const folder = join(directory, "decisions");
  return {
    modelId: model.modelId,
    async decide(state, questions, options) {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const file = join(folder, `${key([model.modelId, state, questions])}.json`);
      const hit = await read<DecisionAnswer[]>(file);
      if (hit) { CACHED.add(hit); return hit; }
      const answers = await model.decide(state, questions, options);
      await write(file, answers);
      return answers;
    },
  };
}

/** Count Jev calls/questions; cache hits are counted apart. */
export function meterDecisions(model: DecisionModel, usage: UsageMeter): DecisionModel {
  return {
    modelId: model.modelId,
    async decide(state, questions, options) {
      const answers = await model.decide(state, questions, options);
      if (CACHED.has(answers)) usage.cachedDecisionCalls++;
      else { usage.decisionCalls++; usage.decisionQuestions += questions.length; }
      return answers;
    },
  };
}
