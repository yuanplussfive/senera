import type { ToolApprovalManifest, ToolSearchCapabilityRiskManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentExtensionOwnerKind } from "../Types/AgentExtensionRuntimeTypes.js";
import type { AgentToolExecutionPlan } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";

export const AgentPermissionActions = {
  Allow: "allow",
  Ask: "ask",
  Deny: "deny",
} as const;

export type AgentPermissionAction = (typeof AgentPermissionActions)[keyof typeof AgentPermissionActions];

export interface AgentToolPermissionRequest {
  sessionId: string;
  requestId: string;
  toolCallId?: string;
  batchId?: string;
  step: number;
  toolName: string;
  arguments: Record<string, unknown>;
  executionPlan?: AgentToolExecutionPlan;
  toolAccessGrant: AgentToolAccessGrant;
  tool?: AgentToolSafetyMetadata;
}

export interface AgentToolSafetyMetadata {
  extensionName: string;
  extensionTitle?: string;
  ownerKind: AgentExtensionOwnerKind;
  approval?: ToolApprovalManifest;
  permissions: readonly string[];
  capabilityRisks: readonly ToolSearchCapabilityRiskManifest[];
  capabilityEffects: readonly string[];
  security?: {
    TrustLevel?: "System" | "Local" | "External" | "Untrusted";
    RequiresApproval?: boolean;
  };
  executionTargets?: readonly string[];
}

export type AgentPermissionDecision =
  | {
      action: typeof AgentPermissionActions.Allow;
      rule: string;
      reason: string;
      riskSignals: readonly string[];
    }
  | {
      action: typeof AgentPermissionActions.Ask;
      rule: string;
      reason: string;
      riskSignals: readonly string[];
    }
  | {
      action: typeof AgentPermissionActions.Deny;
      rule: string;
      reason: string;
      riskSignals: readonly string[];
    };
