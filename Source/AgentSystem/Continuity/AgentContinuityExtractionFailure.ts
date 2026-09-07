import {
  formatAgentModelFailure,
  mapAgentModelFailure,
  type AgentModelFailureDiagnostic,
} from "../ModelEndpoints/AgentModelFailureMapper.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export type AgentContinuityExtractionMode = "native" | "baml";
export type AgentContinuityExtractionStage = "facts" | "rules";

export interface AgentContinuityExtractionAttemptFailure {
  readonly mode: AgentContinuityExtractionMode;
  readonly diagnostic: AgentModelFailureDiagnostic;
}

export class AgentContinuityExtractionFailure extends AgentBaseError {
  readonly stage: AgentContinuityExtractionStage;
  readonly attempts: readonly AgentContinuityExtractionAttemptFailure[];

  constructor(
    stage: AgentContinuityExtractionStage,
    attempts: readonly AgentContinuityExtractionAttemptFailure[],
    cause?: unknown,
  ) {
    super(formatAgentContinuityExtractionFailure(stage, attempts), cause === undefined ? undefined : { cause });
    this.stage = stage;
    this.attempts = attempts;
  }
}

export function createContinuityExtractionAttemptFailure(
  mode: AgentContinuityExtractionMode,
  error: unknown,
): AgentContinuityExtractionAttemptFailure {
  return { mode, diagnostic: mapAgentModelFailure(error) };
}

export function formatAgentContinuityExtractionFailure(
  stage: AgentContinuityExtractionStage,
  attempts: readonly AgentContinuityExtractionAttemptFailure[],
): string {
  const details = attempts
    .map((attempt) => `${attempt.mode}=${formatAgentModelFailure(attempt.diagnostic)}`)
    .join("; ");
  return `${stage}: ${details}`;
}
