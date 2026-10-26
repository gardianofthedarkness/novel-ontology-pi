export interface ReviewTarget {
  directory: string;
  packetId: string;
  scope: "book" | "universe" | "library";
  universeId?: string;
}

export interface ReviewDecision {
  factId: string;
  verdict: "accept" | "hold" | "reject";
  reason: string;
  temporalReason?: string;
  replacement?: unknown;
  semanticReplacement?: unknown;
}

export interface ReviewEvidence { id: string; text: string }

export interface ReviewFact {
  id: string;
  field: string;
  value: unknown;
  meaning: unknown;
  evidence: ReviewEvidence[];
  requiredEvidence: string[];
  requireAllEvidence: boolean;
  temporalReasonRequired?: boolean;
  context?: unknown;
}

export interface ReviewAdapter {
  revision: string;
  stale: boolean;
  applied: boolean;
  facts: ReviewFact[];
  requireFullReview?: boolean;
  validate(decisions: ReviewDecision[]): Promise<ReviewDecision[]>;
  apply(decisions: ReviewDecision[]): Promise<{ verified: number; held: number; rejected: number; deferredProposals: number; result: unknown }>;
}
