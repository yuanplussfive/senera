export interface AgentPiCompactionProjectionPolicy {
  readonly maxIndexedCalls: number;
  readonly argumentsPreviewTokenBudget: number;
  readonly maxDisplayedCalls: number;
  readonly maxSummaryTokens: number;
  readonly maxToolIndexTokens: number;
  readonly recoveryRecentMessageCount: number;
  readonly recoveryMessageTokenBudget: number;
  readonly recoveryPreviousSummaryTokenBudget: number;
}

export const DefaultAgentPiCompactionProjectionPolicy: Readonly<AgentPiCompactionProjectionPolicy> = Object.freeze({
  maxIndexedCalls: 64,
  argumentsPreviewTokenBudget: 200,
  maxDisplayedCalls: 20,
  maxSummaryTokens: 2_048,
  maxToolIndexTokens: 2_048,
  recoveryRecentMessageCount: 12,
  recoveryMessageTokenBudget: 256,
  recoveryPreviousSummaryTokenBudget: 512,
});

export function normalizeAgentPiCompactionLimit(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
