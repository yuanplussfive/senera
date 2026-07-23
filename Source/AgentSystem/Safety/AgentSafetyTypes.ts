import type {
  PluginRootKind,
  PluginSecurityManifest,
  ToolApprovalManifest,
  ToolSearchCapabilityRiskManifest,
} from "../Types/PluginManifestTypes.js";
import type { AgentToolExecutionPlan } from "../ToolRuntime/AgentToolExecutionPlan.js";

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
  visibleToolNames?: readonly string[];
  tool?: AgentToolSafetyMetadata;
}

export interface AgentToolSafetyMetadata {
  pluginName: string;
  pluginTitle?: string;
  rootKind: PluginRootKind;
  approval?: ToolApprovalManifest;
  permissions: readonly string[];
  capabilityRisks: readonly ToolSearchCapabilityRiskManifest[];
  capabilityEffects: readonly string[];
  security?: PluginSecurityManifest;
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
