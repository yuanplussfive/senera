import {
  AgentPermissionActions,
  type AgentPermissionAction,
  type AgentPermissionDecision,
} from "./AgentSafetyTypes.js";

export const AgentExecutionApprovalModes = {
  AlwaysAsk: "always_ask",
  Agent: "agent",
  FullAccess: "full_access",
} as const;

export const AgentExecutionApprovalModeValues = [
  AgentExecutionApprovalModes.AlwaysAsk,
  AgentExecutionApprovalModes.Agent,
  AgentExecutionApprovalModes.FullAccess,
] as const;

export type AgentExecutionApprovalMode = (typeof AgentExecutionApprovalModeValues)[number];

export const AgentExecutionSandboxModes = {
  WorkspaceWrite: "workspace-write",
  DangerFullAccess: "danger-full-access",
} as const;

export const AgentExecutionApprovalPolicies = {
  OnRequest: "on-request",
  Never: "never",
} as const;

export const AgentExecutionApprovalReviewers = {
  User: "user",
  Guardrail: "guardrail",
  None: "none",
} as const;

export interface AgentExecutionPermissionProfile {
  readonly sandbox: (typeof AgentExecutionSandboxModes)[keyof typeof AgentExecutionSandboxModes];
  readonly approvalPolicy: (typeof AgentExecutionApprovalPolicies)[keyof typeof AgentExecutionApprovalPolicies];
  readonly reviewer: (typeof AgentExecutionApprovalReviewers)[keyof typeof AgentExecutionApprovalReviewers];
}

export const AgentExecutionPermissionProfiles = {
  [AgentExecutionApprovalModes.AlwaysAsk]: {
    sandbox: AgentExecutionSandboxModes.WorkspaceWrite,
    approvalPolicy: AgentExecutionApprovalPolicies.OnRequest,
    reviewer: AgentExecutionApprovalReviewers.User,
  },
  [AgentExecutionApprovalModes.Agent]: {
    sandbox: AgentExecutionSandboxModes.WorkspaceWrite,
    approvalPolicy: AgentExecutionApprovalPolicies.OnRequest,
    reviewer: AgentExecutionApprovalReviewers.Guardrail,
  },
  [AgentExecutionApprovalModes.FullAccess]: {
    sandbox: AgentExecutionSandboxModes.DangerFullAccess,
    approvalPolicy: AgentExecutionApprovalPolicies.Never,
    reviewer: AgentExecutionApprovalReviewers.None,
  },
} as const satisfies Record<AgentExecutionApprovalMode, AgentExecutionPermissionProfile>;

const AgentExecutionApprovalActionProjection = {
  [AgentExecutionApprovalModes.AlwaysAsk]: {
    [AgentPermissionActions.Allow]: AgentPermissionActions.Allow,
    [AgentPermissionActions.Ask]: AgentPermissionActions.Ask,
    [AgentPermissionActions.Deny]: AgentPermissionActions.Deny,
  },
  [AgentExecutionApprovalModes.Agent]: {
    [AgentPermissionActions.Allow]: AgentPermissionActions.Allow,
    [AgentPermissionActions.Ask]: AgentPermissionActions.Allow,
    [AgentPermissionActions.Deny]: AgentPermissionActions.Deny,
  },
  [AgentExecutionApprovalModes.FullAccess]: {
    [AgentPermissionActions.Allow]: AgentPermissionActions.Allow,
    [AgentPermissionActions.Ask]: AgentPermissionActions.Allow,
    [AgentPermissionActions.Deny]: AgentPermissionActions.Deny,
  },
} as const satisfies Record<AgentExecutionApprovalMode, Record<AgentPermissionAction, AgentPermissionAction>>;

export function resolveAgentExecutionPermissionProfile(
  mode: AgentExecutionApprovalMode,
): AgentExecutionPermissionProfile {
  return AgentExecutionPermissionProfiles[mode];
}

export function projectAgentExecutionApprovalDecision(
  decision: AgentPermissionDecision,
  mode: AgentExecutionApprovalMode,
): AgentPermissionDecision {
  const action = AgentExecutionApprovalActionProjection[mode][decision.action];
  if (action === decision.action) return decision;
  return {
    ...decision,
    action,
    rule: `execution.approval_mode.${mode}:${decision.rule}`,
  } as AgentPermissionDecision;
}
