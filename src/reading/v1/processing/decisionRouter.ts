export interface DecisionRouteMetrics {
  processed: number;
  initialAccepted: number;
  initiallyUnresolved: number;
  retries: number;
  retryRecovered: number;
  escalated: number;
  system2Resolved: number;
  unresolved: number;
  failures: number;
  retrySkipped: number;
  initialMs: number;
  retryMs: number;
  system2Ms: number;
  initialInputBytes: number;
  retryInputBytes: number;
  initialQuestions: number;
  retryQuestions: number;
}

export interface DecisionRetryPolicy {
  enabled?: boolean;
  maxRetries?: number;
  contextMargin?: number;
  maxContextBytes?: number;
  timeoutMs?: number;
}

export interface DecisionRouterOptions extends DecisionRetryPolicy {
  maxRetryCalls?: number;
  concurrency?: number;
  faculties?: Record<string, DecisionRetryPolicy>;
}

export interface RoutedDecision<Result> {
  value: Result;
  stage: "initial" | "retry" | "system2" | "unresolved";
}

export class DecisionRouter {
  readonly metrics: Record<string, DecisionRouteMetrics> = {};
  private retryCalls = 0;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(readonly options: DecisionRouterOptions = {}) {
    for (const [name, value, maximum] of [["maxRetries", options.maxRetries ?? 1, 2], ["maxRetryCalls", options.maxRetryCalls ?? 128, 1024], ["contextMargin", options.contextMargin ?? 32, 128], ["maxContextBytes", options.maxContextBytes ?? 16_000, 64_000], ["concurrency", options.concurrency ?? 4, 16], ["timeoutMs", options.timeoutMs ?? 15_000, 120_000]] as const) {
      if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`Invalid decision router ${name}`);
    }
    if (options.concurrency === 0 || options.timeoutMs === 0) throw new Error("Decision router concurrency and timeout must be positive");
    for (const policy of Object.values(options.faculties ?? {})) {
      new DecisionRouter({ ...policy, faculties: undefined });
    }
  }

  policyFor(faculty: string): DecisionRetryPolicy {
    const { faculties, ...defaults } = this.options;
    const policy = { ...defaults, ...faculties?.[faculty] };
    if (this.options.enabled === false) policy.enabled = false;
    return policy;
  }

  contextWindow(faculties: string[]): number {
    if ((this.options.maxRetryCalls ?? 128) === 0) return 0;
    return Math.max(0, ...faculties.map(faculty => {
      const policy = this.policyFor(faculty);
      return policy.enabled === false ? 0 : (policy.contextMargin ?? 32) * (policy.maxRetries ?? 1);
    }));
  }

  async route<Result>(task: {
    faculty: string;
    initial: () => Promise<Result>;
    accept: (value: Result) => boolean;
    retry?: (attempt: number) => { inputBytes: number; questions?: number; run: (signal: AbortSignal) => Promise<Result> } | undefined;
    fallback?: () => Promise<Result>;
    acceptFallback?: (value: Result) => boolean;
    initialInputBytes?: number;
    initialMs?: number;
    initialQuestions?: number;
  }): Promise<RoutedDecision<Result>> {
    const metrics = this.metrics[task.faculty] ??= {
      processed: 0, initialAccepted: 0, initiallyUnresolved: 0, retries: 0, retryRecovered: 0,
      escalated: 0, system2Resolved: 0, unresolved: 0, failures: 0, retrySkipped: 0,
      initialMs: 0, retryMs: 0, system2Ms: 0, initialInputBytes: 0, retryInputBytes: 0,
      initialQuestions: 0, retryQuestions: 0,
    };
    metrics.processed++;
    metrics.initialInputBytes += task.initialInputBytes ?? 0;
    metrics.initialQuestions += task.initialQuestions ?? 1;
    const policy = this.policyFor(task.faculty);
    let started = performance.now();
    let value: Result;
    try { value = await task.initial(); } catch {
      metrics.failures++;
      metrics.unresolved++;
      metrics.initiallyUnresolved++;
      metrics.initialMs += task.initialMs ?? Math.round(performance.now() - started);
      throw new Error(`Faculty ${task.faculty} initial decision unavailable; review required`);
    }
    metrics.initialMs += task.initialMs ?? Math.round(performance.now() - started);
    if (task.accept(value)) { metrics.initialAccepted++; return { value, stage: "initial" }; }
    metrics.initiallyUnresolved++;
    if (policy.enabled !== false) {
      for (let attempt = 1; attempt <= (policy.maxRetries ?? 1); attempt++) {
        if (!task.retry || this.retryCalls >= (this.options.maxRetryCalls ?? 128)) { metrics.retrySkipped++; break; }
        const retry = task.retry(attempt);
        if (!retry || retry.inputBytes > (policy.maxContextBytes ?? 16_000)) { metrics.retrySkipped++; break; }
        this.retryCalls++;
        metrics.retries++;
        metrics.retryInputBytes += retry.inputBytes;
        metrics.retryQuestions += retry.questions ?? 1;
        if (this.active >= (this.options.concurrency ?? 4)) await new Promise<void>(resolve => this.waiting.push(resolve));
        else this.active++;
        started = performance.now();
        try {
          value = await retry.run(AbortSignal.timeout(policy.timeoutMs ?? 15_000));
          if (task.accept(value)) { metrics.retryRecovered++; return { value, stage: "retry" }; }
        } catch { metrics.failures++; } finally {
          metrics.retryMs += Math.round(performance.now() - started);
          const next = this.waiting.shift();
          if (next) next(); else this.active--;
        }
      }
    }
    if (task.fallback) {
      metrics.escalated++;
      started = performance.now();
      try {
        const candidate = await task.fallback();
        value = candidate;
        if ((task.acceptFallback ?? task.accept)(candidate)) { metrics.system2Resolved++; return { value: candidate, stage: "system2" }; }
      } catch { metrics.failures++; } finally { metrics.system2Ms += Math.round(performance.now() - started); }
    }
    metrics.unresolved++;
    return { value, stage: "unresolved" };
  }
}
