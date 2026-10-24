import { createHash } from "node:crypto";
import type { WorkModel } from "../../ground/connectors/llm.js";

export interface FacultyCall {
  faculty: string;
  status: "started" | "completed" | "failed";
  inputBytes: number;
  queueMs: number;
  durationMs?: number;
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
        const base = { faculty, inputBytes: bytes, queueMs: Math.round(began - queuedAt) };
        this.observe({ ...base, status: "started" });
        const signal = AbortSignal.timeout(this.options.timeoutMs ?? 45_000);
        void Promise.resolve().then(() => this.work.generate({ ...request, signal })).then(value => {
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
