/**
 * Decision model interface — Jev (TypeSafe AI "System One") or compatible.
 *
 * Jev generates no text. Send it a compact state + typed questions; it
 * returns probabilities/distributions in ~70-500 ms. Three primitives:
 *  - noul:   yes/no question       -> probability 0..1
 *  - choice: fixed candidate set   -> distribution + confidence (ONE pick)
 *  - score:  ordered scale (2-10)  -> distribution over levels
 *
 * Context limit is ~32k tokens, so questions always carry a compact state
 * summary, never raw chapter text. Pin the model version (e.g. jev-1.13.0)
 * in the novel manifest — do not float on "latest" when thresholds are tuned.
 */
import { loadConfig } from "../../cli/config.js";
import { resolveJevKey } from "./secrets.js";

export type DecisionPrimitive = "noul" | "choice" | "score";

export interface DecisionQuestion {
  /** Stable key the calling patch uses to read its answer back. */
  key: string;
  primitive: DecisionPrimitive;
  /** What is being asked, in plain language. */
  instructions: string;
  /** Decision criteria / rubric, kept short. */
  criteria?: string;
  /** choice only: the fixed candidate set (max 255). */
  options?: string[];
  /** choice only: what an option means, when its label does not say it (sent as that option's criterion). */
  optionHints?: Record<string, string>;
  /** score only: ordered level labels, 2..10 of them. */
  levels?: string[];
}

export interface DecisionAnswer {
  key: string;
  /** noul: the probability. choice: the winning option. score: the level. */
  value: number | string;
  /** Full distribution when the model returns one. */
  distribution?: Record<string, number>;
  /** The model's own confidence, 0..1, when reported. */
  confidence?: number;
}

/** Pictures a question looks at (PNG, base64), each named in the state by its key. */
export type DecisionImages = Record<string, string>;

export interface DecisionModel {
  readonly modelId: string;
  /**
   * Evaluate a BATCH of questions against one shared state snapshot.
   * One API call per window — never one call per question.
   * `images` (experimental at TypeSafe, "danger zone"): the state becomes
   * { state, <name>: "<name>_image" } with one image asset per name.
   */
  decide(state: string, questions: DecisionQuestion[], options?: { signal?: AbortSignal; images?: DecisionImages }): Promise<DecisionAnswer[]>;
}

export interface JevConfig {
  apiKey: string;
  endpoint: string; // default https://api.typesafe.ai/v1/systemone
  model: string; // pinned, e.g. "jev-1.13.0"
}

/** Live Jev client. Translates the internal question shape to the System One wire format; keys resolve through src/connectors/secrets.ts. */
export class JevClient implements DecisionModel {
  readonly modelId: string;
  constructor(private cfg: JevConfig) {
    this.modelId = cfg.model;
  }

  async decide(state: string, questions: DecisionQuestion[], options: { signal?: AbortSignal; images?: DecisionImages } = {}): Promise<DecisionAnswer[]> {
    if (!this.cfg.apiKey) {
      throw new Error(
        "Jev API key missing. Run `novel jev login`, or set TYPESAFE_API_KEY (never hard-code the key).",
      );
    }
    const images = Object.entries(options.images ?? {});
    const body = JSON.stringify({
      model: this.cfg.model,
      state: images.length ? { state, ...Object.fromEntries(images.map(([name]) => [name, `${name}_image`])) } : state,
      ...(images.length ? { assets: Object.fromEntries(images.map(([name, png]) => [`${name}_image`, { type: "image", format: "png", data_base64: png }])) } : {}),
      questions: toWireQuestions(questions),
    });
    // Retry policy mirrors the work-LLM client: transient failures only
    // (429/529 per the provider docs, other 5xx, network), max 3 attempts.
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const res = await fetch(this.cfg.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cfg.apiKey}`,
            ...(images.length ? { "TypeSafe-Danger-Zone-Images": "true" } : {}),
          },
          body,
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          const payload = (await res.json()) as { answers?: Record<string, WireAnswer> };
          return fromWireAnswers(questions, payload.answers ?? {});
        }
        const detail = (await res.text()).slice(0, 300);
        const err = new Error(`Jev request failed: ${res.status} ${detail}`);
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } catch (err) {
        options.signal?.throwIfAborted();
        if (err instanceof Error && (err.message.startsWith("Jev request failed: 4") || err.message.startsWith("Jev response"))) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      }
    }
    throw lastError ?? new Error("Jev request failed after 3 attempts");
  }
}

interface WireAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
}

function withRubric(q: DecisionQuestion): string {
  return q.criteria ? `${q.instructions} Criteria: ${q.criteria}` : q.instructions;
}

/**
 * Internal questions are an array with stable keys; the wire format is
 * a map of named questions whose `criteria` is an option->description
 * map. Option/level labels describe themselves, and the free-text
 * rubric rides along in the instructions.
 */
function toWireQuestions(
  questions: DecisionQuestion[],
): Record<string, Record<string, unknown>> {
  const wire: Record<string, Record<string, unknown>> = {};
  for (const q of questions) {
    if (q.primitive === "noul") {
      wire[q.key] = { type: "noul", instructions: withRubric(q) };
    } else if (q.primitive === "choice") {
      wire[q.key] = {
        type: "choice",
        instructions: withRubric(q),
        criteria: Object.fromEntries((q.options ?? []).map((o) => [o, q.optionHints?.[o] ?? o])),
      };
    } else {
      wire[q.key] = {
        type: "score",
        instructions: withRubric(q),
        criteria: Object.fromEntries((q.levels ?? []).map((l) => [l, l])),
      };
    }
  }
  return wire;
}

function fromWireAnswers(
  questions: DecisionQuestion[],
  answers: Record<string, WireAnswer>,
): DecisionAnswer[] {
  return questions.map((q) => {
    const a = answers[q.key];
    if (!a) {
      throw new Error(`Jev response is missing an answer for question "${q.key}"`);
    }
    if (q.primitive === "noul") {
      if (typeof a.noul !== "number" || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) throw new Error(`Jev response has an invalid probability for question "${q.key}"`);
      // The probability IS the value; patches read it directly.
      return { key: q.key, value: a.noul };
    }
    if (q.primitive === "choice") {
      return {
        key: q.key,
        value: a.choice ?? "",
        distribution: a.probabilities,
        confidence: a.confidence,
      };
    }
    return { key: q.key, value: a.score ?? 0, confidence: a.confidence };
  });
}

/**
 * Build a live client from the environment + secure store. The model
 * and endpoint come from loadConfig; the key resolves env -> store ->
 * JEV_API_KEY_ENV indirection (see secrets.ts) and is never printed.
 */
export function jevFromEnv(env: NodeJS.ProcessEnv = process.env): JevClient {
  const resolved = resolveJevKey(env);
  if (!resolved) {
    throw new Error(
      "Jev API key missing. Run `novel jev login` to store it securely, or set TYPESAFE_API_KEY.",
    );
  }
  const cfg = loadConfig(env);
  return new JevClient({
    apiKey: resolved.key,
    endpoint: cfg.decisionModel.endpoint,
    model: cfg.decisionModel.model,
  });
}

/**
 * Deterministic decision model for tests and dry runs.
 * Answers come from a test-supplied table keyed by question key,
 * so miniloop gates, recursion and change-set accumulation can be
 * verified with zero model spend.
 */
export class MockDecisionModel implements DecisionModel {
  readonly modelId = "mock-jev";
  constructor(
    private table: Record<string, DecisionAnswer["value"]> = {},
    private defaultConfidence = 0.99,
  ) {}
  async decide(_state: string, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> {
    return questions.map((q) => ({
      key: q.key,
      value: this.table[q.key] ?? (q.primitive === "noul" ? 0 : (q.options?.[0] ?? "")),
      confidence: this.defaultConfidence,
    }));
  }
}
