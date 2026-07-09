import type { AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";

export interface AgentBamlToolRiskAuditProfile {
  readonly riskScale: readonly AgentBamlToolRiskScaleItem[];
  readonly decisionRubric: readonly AgentBamlToolRiskDecisionRule[];
  readonly concernCatalog: readonly AgentBamlToolRiskConcern[];
}

export interface AgentBamlToolRiskScaleItem {
  readonly level: string;
  readonly meaning: string;
}

export interface AgentBamlToolRiskDecisionRule {
  readonly decision: string;
  readonly when: readonly string[];
}

export interface AgentBamlToolRiskConcern {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export type AgentBamlToolRiskAuditPromptStage =
  | {
      readonly stage: "auditToolRisk";
    }
  | {
      readonly stage: "repairToolRiskAudit";
      readonly invalidAudit: string;
      readonly issues: readonly string[];
    };

export interface AgentBamlToolRiskAuditPromptInput {
  readonly request: {
    readonly requestId: string;
    readonly step: number;
    readonly toolCallId?: string;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly visibleToolNames?: "all" | readonly string[];
  };
  readonly tool?: AgentToolApprovalPolicyInput["tool"];
  readonly runtimeContext?: unknown;
  readonly messages?: readonly unknown[];
  readonly profile: AgentBamlToolRiskAuditProfile;
}

export function buildBamlToolRiskAuditPromptJson(
  input: AgentBamlToolRiskAuditPromptInput,
  directive: AgentBamlToolRiskAuditPromptStage = {
    stage: "auditToolRisk",
  },
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

export function projectToolRiskAuditPromptInput(options: {
  readonly input: AgentToolApprovalPolicyInput;
  readonly profile: AgentBamlToolRiskAuditProfile;
}): AgentBamlToolRiskAuditPromptInput {
  return {
    request: {
      requestId: options.input.requestId,
      step: options.input.step,
      toolCallId: options.input.toolCallId,
      toolName: options.input.toolName,
      arguments: options.input.arguments,
      visibleToolNames: options.input.visibleToolNames,
    },
    tool: options.input.tool,
    runtimeContext: options.input.runtimeContext,
    messages: options.input.messages,
    profile: options.profile,
  };
}
