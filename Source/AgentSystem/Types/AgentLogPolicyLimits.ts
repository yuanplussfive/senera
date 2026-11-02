/** Shared protocol bounds for workspace-local log persistence and queries. */
export const AgentLogPolicyLimits = {
  minimumDetailMaxBytes: 128,
  maximumQueryCursorLength: 4_096,
  maximumQueryPageSize: 1_000,
  maximumTailLineCount: 2_000,
} as const;
