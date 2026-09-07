import type { AgentMemoryRecordedTurn, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentTurnValueClassification } from "./AgentTurnValueClassifier.js";

export interface AgentContinuityLearningGateConfig {
  readonly enabled: boolean;
  readonly deferredDelayMs: number;
  readonly turnValueClassifierEnabled: boolean;
}

export type AgentContinuityLearningMode = "immediate" | "deferred" | "skip";

export interface AgentContinuityLearningDecision {
  readonly mode: AgentContinuityLearningMode;
  readonly reason: "disabled" | "unproductive_classified" | "explicit_memory" | "runtime_evidence" | "ordinary_turn";
  readonly deferredUntilMs?: number;
}

/** Keeps extraction event-driven while allowing only learned, high-confidence skips. */
export function decideAgentContinuityLearning(
  turn: AgentMemoryRecordedTurn,
  config: AgentContinuityLearningGateConfig,
  classification?: AgentTurnValueClassification,
): AgentContinuityLearningDecision {
  if (!config.enabled) return { mode: "immediate", reason: "disabled" };

  if (turn.sources.some(isExplicitMemoryEvidence)) {
    return { mode: "immediate", reason: "explicit_memory" };
  }

  if (turn.sources.some(isRuntimeEvidence)) {
    return { mode: "immediate", reason: "runtime_evidence" };
  }

  if (config.turnValueClassifierEnabled && classification?.label === "unproductive") {
    return { mode: "skip", reason: "unproductive_classified" };
  }

  return {
    mode: "deferred",
    reason: "ordinary_turn",
    deferredUntilMs: turn.episode.completedAtMs + Math.max(0, config.deferredDelayMs),
  };
}

function isRuntimeEvidence(source: AgentMemorySourceRecord): boolean {
  return source.sourceKind === "tool_evidence" || source.sourceKind === "artifact";
}

function isExplicitMemoryEvidence(source: AgentMemorySourceRecord): boolean {
  if (source.sourceKind !== "tool_evidence") return false;
  const evidence = source.metadata.evidence;
  return Boolean(
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    (evidence as Record<string, unknown>).kind === "continuity_write",
  );
}
