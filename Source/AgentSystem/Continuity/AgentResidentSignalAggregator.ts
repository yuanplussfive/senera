import { AgentToolAssessmentStatuses } from "../ToolRuntime/AgentToolResultOutcome.js";
import { localizeAgentToolPerceptionObject } from "../ToolRuntime/AgentToolPerceptionComposer.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type {
  AgentResidentBearing,
  AgentResidentStateSignals,
  AgentResidentUserSentiment,
} from "./AgentResidentState.js";

/**
 * Deterministic, order-independent accumulation of the host-observable fields
 * a resident stance needs: tool success/failure counts and the focus object.
 * Shared between the end-of-turn aggregator and the in-turn live stance tracker
 * so a stance always uses the same per-result rule.
 */
export interface AgentResidentSignalCounts {
  toolSuccessCount: number;
  toolFailureCount: number;
  focusedObject?: string;
}

export const EmptyAgentResidentSignalCounts: AgentResidentSignalCounts = Object.freeze({
  toolSuccessCount: 0,
  toolFailureCount: 0,
});

/** Inspects one executed tool result and folds it into running stance counts. */
export function addAgentResidentSignal(
  counts: AgentResidentSignalCounts,
  result: ExecutedToolCallResult,
): AgentResidentSignalCounts {
  switch (result.outcome?.assessment?.status) {
    case AgentToolAssessmentStatuses.Success:
      return {
        toolSuccessCount: counts.toolSuccessCount + 1,
        toolFailureCount: counts.toolFailureCount,
        focusedObject: counts.focusedObject ?? localizeAgentToolPerceptionObject(result.arguments),
      };
    case AgentToolAssessmentStatuses.Failure:
      return {
        toolSuccessCount: counts.toolSuccessCount,
        toolFailureCount: counts.toolFailureCount + 1,
        ...(counts.focusedObject ? { focusedObject: counts.focusedObject } : {}),
      };
    default:
      return counts;
  }
}

/**
 * Builds the structural resident-state signals for one completed turn, purely
 * from host-observable artifacts. Nothing here is model output: tool outcomes
 * are read off `executedTools`, the focus object comes from the same
 * perception localizer the composer uses, and sentiment/direction fields
 * default only when no evidence exists (never fabricated).
 */
export interface AgentResidentSignalAggregationInput {
  readonly bearing: AgentResidentBearing;
  readonly executedTools: readonly ExecutedToolCallResult[];
  /** Stark positive/negative user feedback, if any was actually observed. */
  readonly userSentiment?: AgentResidentUserSentiment;
  /** True only when the user directed a brand-new activity this turn. */
  readonly newTaskRequested?: boolean;
  /** True only when the turn completed the activity the resident was on. */
  readonly taskConcluded?: boolean;
}

export function aggregateResidentStateSignals(input: AgentResidentSignalAggregationInput): AgentResidentStateSignals {
  const counts = input.executedTools.reduce(addAgentResidentSignal, EmptyAgentResidentSignalCounts);
  return composeAgentResidentStanceSignals({
    bearing: input.bearing,
    counts,
    userSentiment: input.userSentiment ?? "absent",
    newTaskRequested: input.newTaskRequested ?? false,
    taskConcluded: input.taskConcluded ?? false,
  });
}

/** Composes full signals from pre-accumulated counts, mirroring `aggregateResidentStateSignals`. */
export function composeAgentResidentStanceSignals(input: {
  readonly bearing: AgentResidentBearing;
  readonly counts: AgentResidentSignalCounts;
  readonly userSentiment?: AgentResidentUserSentiment;
  readonly newTaskRequested?: boolean;
  readonly taskConcluded?: boolean;
}): AgentResidentStateSignals {
  return {
    bearing: input.bearing,
    userSentiment: input.userSentiment ?? "absent",
    newTaskRequested: input.newTaskRequested ?? false,
    taskConcluded: input.taskConcluded ?? false,
    toolSuccessCount: input.counts.toolSuccessCount,
    toolFailureCount: input.counts.toolFailureCount,
    ...(input.counts.focusedObject ? { focusedObject: input.counts.focusedObject } : {}),
  };
}
