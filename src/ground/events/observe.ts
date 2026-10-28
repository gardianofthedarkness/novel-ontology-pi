import { randomUUID } from "node:crypto";
import type { DecisionModel } from "../connectors/jev.js";
import type { WorkModel } from "../connectors/llm.js";
import type { EventSink } from "./types.js";

/** Where an observed call belongs: a block, or (omitted) the whole novel. */
export interface ObservedScope { blockId?: string; faculty?: string }

/** A System 1 call is named by its first question's key prefix ("causal:…" → "causal"). */
export function decisionFaculty(questions: { key: string }[]): string {
  return (questions[0]?.key.split(":")[0] ?? "decisions").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "decisions";
}

/**
 * Report every Jev call as a started/finished `faculty.activity` pair, so the
 * live view sees the faculty fire. Telemetry never fails the call it reports.
 */
export function observeDecisions(decisions: DecisionModel, emit: EventSink, scope: ObservedScope = {}): DecisionModel {
  const run = randomUUID();
  let sequence = 0;
  return {
    modelId: decisions.modelId,
    decide: async (state, questions, options) => {
      const faculty = scope.faculty ?? decisionFaculty(questions);
      const report = (status: "started" | "completed" | "failed", callId: string) => emit({ type: "faculty.activity", ...(scope.blockId ? { blockId: scope.blockId } : {}), callId, faculty, system: "system1", status }).catch(() => {});
      const callId = `${run}:system1:${++sequence}`;
      await report("started", callId);
      try {
        const answers = await decisions.decide(state, questions, options);
        await report("completed", callId);
        return answers;
      } catch (error) {
        await report("failed", callId);
        throw error;
      }
    },
  };
}

/** The work-model twin of `observeDecisions`: one faculty name per client. */
export function observeWork(work: WorkModel, emit: EventSink, scope: ObservedScope & { faculty: string }): WorkModel {
  const run = randomUUID();
  let sequence = 0;
  return {
    modelId: work.modelId,
    generate: async (request) => {
      const report = (status: "started" | "completed" | "failed", callId: string) => emit({ type: "faculty.activity", ...(scope.blockId ? { blockId: scope.blockId } : {}), callId, faculty: scope.faculty, system: "work", status }).catch(() => {});
      const callId = `${run}:work:${++sequence}`;
      await report("started", callId);
      try {
        const result = await work.generate(request);
        await report("completed", callId);
        return result;
      } catch (error) {
        await report("failed", callId);
        throw error;
      }
    },
  };
}
