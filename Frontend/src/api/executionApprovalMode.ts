export const ExecutionApprovalModes = {
  AlwaysAsk: "always_ask",
  Agent: "agent",
  FullAccess: "full_access",
} as const;

export type ExecutionApprovalMode = (typeof ExecutionApprovalModes)[keyof typeof ExecutionApprovalModes];

export function isExecutionApprovalMode(value: unknown): value is ExecutionApprovalMode {
  return Object.values(ExecutionApprovalModes).some((mode) => mode === value);
}
