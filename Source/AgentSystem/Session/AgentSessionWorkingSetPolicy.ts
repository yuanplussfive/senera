export const AgentSessionWorkingSetDefaults = {
  MaxIdleSessions: 32,
} as const;

export interface AgentSessionWorkingSetPolicy {
  readonly maxIdleSessions: number;
}

export function resolveAgentSessionWorkingSetPolicy(
  input: Partial<AgentSessionWorkingSetPolicy> = {},
): AgentSessionWorkingSetPolicy {
  const maxIdleSessions = input.maxIdleSessions ?? AgentSessionWorkingSetDefaults.MaxIdleSessions;
  if (!Number.isSafeInteger(maxIdleSessions) || maxIdleSessions < 0) {
    throw new Error(`Session working-set maxIdleSessions must be a non-negative safe integer: ${maxIdleSessions}`);
  }
  return { maxIdleSessions };
}
