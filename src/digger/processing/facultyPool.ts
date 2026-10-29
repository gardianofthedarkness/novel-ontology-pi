import { createHash } from "node:crypto";
import type { WorkModel } from "../../ground/connectors/llm.js";
import type { WorkModelUsage } from "../../ground/connectors/workModel.js";

export interface FacultyCall {
  faculty: string;
  callId?: string;
  system?: "system2" | "work";
  status: "started" | "completed" | "failed";
  inputBytes: number;
  queueMs: number;
  durationMs?: number;
}

/** Work-model (DeepSeek) tokens of one faculty: what extraction actually spends. */
export interface WorkUsage { calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; unmetered: number }
/** Usage per faculty, shared by every pool of a run. */
export type UsageLedger = Record<string, WorkUsage>;

export function usageTotal(ledger: UsageLedger): WorkUsage {
  const total: WorkUsage = { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, unmetered: 0 };
  for (const entry of Object.values(ledger)) for (const key of Object.keys(total) as (keyof WorkUsage)[]) total[key] += entry[key];
  return total;
}

function meter(ledger: UsageLedger | undefined, faculty: string, usage: WorkModelUsage | null) {
  if (!ledger) return;
  const entry = ledger[faculty] ??= { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, unmetered: 0 };
  entry.calls++;
  if (!usage || usage.promptTokens === null) { entry.unmetered++; return; }
  entry.promptTokens += usage.promptTokens;
  entry.cachedTokens += usage.cachedTokens ?? 0;
  entry.completionTokens += usage.completionTokens ?? 0;
}

export class FacultyPool {
  private active = 0;
  private normalActive = 0;
  private submitted = 0;
  private queue: { priority: number; start: () => void }[] = [];
  private cache = new Map<string, Promise<string>>();
  readonly metrics = { calls: 0, cacheHits: 0, peakActive: 0, maxInputBytes: 0, failures: 0 };

  constructor(private work: WorkModel, private options: {
    concurrency?: number;
    maxCalls?: number;
    maxInputBytes?: number;
    timeoutMs?: number;
    onCall?: (call: FacultyCall) => void;
    usage?: UsageLedger;
  } = {}) {
    if (!Number.isInteger(options.concurrency ?? 4) || (options.concurrency ?? 4) < 1 || (options.concurrency ?? 4) > 16) throw new Error("Faculty concurrency must be an integer from 1 to 16");
  }

  generate(faculty: string, request: Parameters<WorkModel["generate"]>[0], priority = 0): Promise<string> {
    const bytes = Buffer.byteLength(request.system + request.prompt, "utf8");
    if (bytes > (this.options.maxInputBytes ?? 24_000)) return Promise.reject(new Error("Faculty input exceeds its byte budget; split the source without truncation"));
    const key = createHash("sha256").update(JSON.stringify([this.work.modelId, faculty, request.system, request.prompt, request.maxTokens, request.jsonSchema])).digest("hex");
    const existing = this.cache.get(key);
    if (existing) { this.metrics.cacheHits++; return existing; }
    if (++this.submitted > (this.options.maxCalls ?? 256)) return Promise.reject(new Error("Faculty call budget exhausted"));
    const queuedAt = performance.now();
    const pending = new Promise<string>((resolve, reject) => {
      const start = () => {
        this.active++;
        if (priority < 2) this.normalActive++;
        this.metrics.calls++;
        this.metrics.peakActive = Math.max(this.metrics.peakActive, this.active);
        this.metrics.maxInputBytes = Math.max(this.metrics.maxInputBytes, bytes);
        const began = performance.now();
        const base = { faculty, callId: `${faculty}:${this.metrics.calls}`, system: priority >= 2 ? "system2" as const : "work" as const, inputBytes: bytes, queueMs: Math.round(began - queuedAt) };
        this.observe({ ...base, status: "started" });
        const signal = AbortSignal.timeout(this.options.timeoutMs ?? 45_000);
        // A model that reports usage (the HTTP connector) is metered per faculty; others count as unmetered calls.
        const work = this.work as WorkModel & { generateWithInfo?: (request: Parameters<WorkModel["generate"]>[0]) => Promise<{ text: string; usage: WorkModelUsage }> };
        void Promise.resolve().then(() => work.generateWithInfo
          ? work.generateWithInfo({ ...request, signal }).then(result => { meter(this.options.usage, faculty, result.usage); return result.text; })
          : this.work.generate({ ...request, signal }).then(text => { meter(this.options.usage, faculty, null); return text; })).then(value => {
          this.observe({ ...base, status: "completed", durationMs: Math.round(performance.now() - began) });
          resolve(value);
        }, () => {
          this.metrics.failures++;
          this.cache.delete(key);
          this.observe({ ...base, status: "failed", durationMs: Math.round(performance.now() - began) });
          reject(new Error(`Faculty ${faculty} request failed; unresolved work requires review`));
        }).finally(() => { this.active--; if (priority < 2) this.normalActive--; this.drain(); });
      };
      this.queue.push({ priority, start });
      this.queue.sort((left, right) => right.priority - left.priority);
      this.drain();
    });
    this.cache.set(key, pending);
    return pending;
  }

  private drain(): void {
    const concurrency = this.options.concurrency ?? 4;
    const normalLimit = Math.max(1, concurrency - 1);
    while (this.active < concurrency && this.queue.length) {
      const index = this.queue.findIndex(entry => entry.priority >= 2 || this.normalActive < normalLimit);
      if (index < 0) break;
      this.queue.splice(index, 1)[0].start();
    }
  }

  private observe(call: FacultyCall): void {
    try { this.options.onCall?.(call); } catch {}
  }
}
