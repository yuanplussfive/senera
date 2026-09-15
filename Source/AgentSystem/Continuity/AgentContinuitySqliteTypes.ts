import type {
  AgentContinuityAuthority,
  AgentContinuityObservation,
  AgentContinuityRule,
  AgentContinuityRuleMaturity,
  AgentContinuityScopeRef,
  AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import type { AgentContinuityGraphRelationCandidate } from "./AgentContinuityGraphTypes.js";

export type AgentContinuityLearningStage = "facts" | "rules";
export type AgentContinuityLearningStageStatus = "pending" | "running" | "retry" | "completed" | "failed";

export interface AgentContinuityLearningClaim {
  readonly episodeUri: string;
  readonly stage: AgentContinuityLearningStage;
  readonly attempt: number;
}

export type AgentContinuityLearningClaimTransition = "committed" | "superseded";

export interface AgentContinuityLearningJob {
  readonly episodeUri: string;
  readonly stage: AgentContinuityLearningStage;
  readonly status: AgentContinuityLearningStageStatus;
  readonly attempts: number;
  readonly nextAttemptAtMs: number;
  readonly lastError: string;
  readonly facts: readonly string[];
  readonly needsRulePass: boolean;
  readonly updatedAtMs: number;
}

export interface AgentContinuityRuleDraft {
  readonly targetRuleUri?: string;
  readonly replaceTarget?: boolean;
  readonly title: string;
  readonly condition: AgentContinuityRule["condition"];
  readonly action: AgentContinuityRule["action"];
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly temporal: AgentContinuityRule["temporal"];
  readonly sourceRefs: readonly string[];
}

export interface AgentContinuityFactLearningResult {
  readonly observations: readonly AgentContinuityObservation[];
  readonly facts: readonly string[];
  readonly relations: readonly AgentContinuityGraphRelationCandidate[];
  readonly needsRulePass: boolean;
}

export interface AgentContinuityRuleLearningResult {
  readonly signals: readonly AgentContinuitySignal[];
  readonly rules: readonly AgentContinuityRuleDraft[];
}

export interface AgentContinuityFactHead {
  readonly factKey: string;
  readonly claim: string;
  readonly observationUri: string;
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  /** When the current claim version became authoritative; resets on claim changes. */
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly sourceRefs: readonly string[];
  readonly status: "active" | "superseded" | "retracted";
  readonly supportCount: number;
  readonly supportMass: number;
  readonly maturity: AgentContinuityRuleMaturity;
  /** Active lineage of paraphrase merges: the surviving factKey this head folded into. */
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentContinuityFactHistoryEntry {
  readonly id: string;
  readonly factKey: string;
  readonly scope: AgentContinuityScopeRef;
  readonly observationUri: string;
  readonly operation: "created" | "reinforced" | "superseded" | "retracted";
  readonly claim: string;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly occurredAt: string;
  readonly supersededBy: string | null;
  readonly sourceRefs: readonly string[];
}
