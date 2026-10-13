export const AgentSessionRecoveryModes = {
  Retry: "retry",
  Continue: "continue",
} as const;

export type AgentSessionRecoveryMode = (typeof AgentSessionRecoveryModes)[keyof typeof AgentSessionRecoveryModes];

const RecoverableRunStatuses = new Set(["failed", "cancelled"]);

/** One policy for admission, live terminal events, and history snapshots. */
export function readAgentSessionRecoveryModes(status: string): AgentSessionRecoveryMode[] {
  return RecoverableRunStatuses.has(status) ? Object.values(AgentSessionRecoveryModes) : [];
}

/** The only user input used when resuming a failed turn from its checkpoint. */
export const AgentSessionContinuationInput = "continue";

export interface AgentSessionRunRecovery {
  readonly mode: AgentSessionRecoveryMode;
  readonly sourceRequestId: string;
}
