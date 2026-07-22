import type { PolicyClient, PolicyDecision } from "@ai-sdk/policy-opa";
import { normalizeOpaDecision } from "@ai-sdk/policy-opa";
import type { AgentPermissionAction, AgentPermissionDecision, AgentToolPermissionRequest } from "./AgentSafetyTypes.js";
import { AgentPermissionActions } from "./AgentSafetyTypes.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";

export interface AgentToolApprovalPolicyInput extends AgentToolPermissionRequest {
  messages?: readonly unknown[];
  runtimeContext?: unknown;
  signal?: AbortSignal;
}

export interface AgentToolApprovalPolicy {
  decideToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision>;
}

export interface AgentToolApprovalPolicyOptions {
  auditors?: readonly AgentToolGuardrailAuditor[];
  opa?: {
    client: PolicyClient;
    path: string;
  };
}

export class AgentCompositeToolApprovalPolicy implements AgentToolApprovalPolicy {
  private readonly manifestPolicy = new AgentManifestToolApprovalPolicy();

  constructor(private readonly options: AgentToolApprovalPolicyOptions = {}) {}

  async decideToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision> {
    const manifestDecision = await this.manifestPolicy.decideToolCall(input);
    const opaDecision = this.options.opa ? await this.decideWithOpa(input, this.options.opa) : undefined;
    const deterministicDecision = strongestPermissionDecision([opaDecision, manifestDecision]);
    if (deterministicDecision.action === AgentPermissionActions.Deny) {
      return deterministicDecision;
    }

    const guardrailDecision = await this.decideWithGuardrails(input);

    return strongestPermissionDecision([guardrailDecision, deterministicDecision]);
  }

  private async decideWithGuardrails(
    input: AgentToolApprovalPolicyInput,
  ): Promise<AgentPermissionDecision | undefined> {
    for (const auditor of this.options.auditors ?? []) {
      const decision = await auditor.auditToolCall(input);
      if (decision) {
        return decision;
      }
    }
    return undefined;
  }

  private async decideWithOpa(
    input: AgentToolApprovalPolicyInput,
    opa: NonNullable<AgentToolApprovalPolicyOptions["opa"]>,
  ): Promise<AgentPermissionDecision | undefined> {
    try {
      const result = await opa.client.evaluate(opa.path, projectOpaInput(input));
      const decision = normalizeOpaDecision(result);
      return policyDecisionToPermissionDecision(decision, input.toolName, "opa", {
        reason: readPolicyReason(result),
        rule: readPolicyRule(result),
        riskSignals: readPolicyRiskSignals(result),
      });
    } catch (error) {
      return {
        action: AgentPermissionActions.Deny,
        rule: "opa.error",
        reason: `策略引擎失败，已拒绝工具调用：${errorMessage(error)}`,
        riskSignals: [],
      };
    }
  }
}

const PermissionActionPriority = {
  [AgentPermissionActions.Allow]: 0,
  [AgentPermissionActions.Ask]: 1,
  [AgentPermissionActions.Deny]: 2,
} as const satisfies Record<AgentPermissionAction, number>;

function strongestPermissionDecision(
  decisions: readonly (AgentPermissionDecision | undefined)[],
): AgentPermissionDecision {
  const available = decisions.filter((decision): decision is AgentPermissionDecision => Boolean(decision));
  const selected = available.reduce<AgentPermissionDecision | undefined>((strongest, decision) => {
    if (!strongest) return decision;
    return PermissionActionPriority[decision.action] > PermissionActionPriority[strongest.action]
      ? decision
      : strongest;
  }, undefined);
  if (!selected) {
    throw new Error("工具审批策略没有产生决策。");
  }

  return {
    ...selected,
    riskSignals: [...new Set(available.flatMap((decision) => decision.riskSignals))],
  } as AgentPermissionDecision;
}

export class AgentManifestToolApprovalPolicy implements AgentToolApprovalPolicy {
  async decideToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision> {
    const approval = input.tool?.approval;
    if (approval) {
      return {
        action: approval.Mode,
        rule: `manifest.tool.${approval.Mode}`,
        reason: approval.Reason ?? manifestToolReason(input.toolName, approval.Mode),
        riskSignals: [],
      };
    }

    if (input.tool?.security?.RequiresApproval) {
      return {
        action: AgentPermissionActions.Ask,
        rule: "manifest.plugin.requires-approval",
        reason: `插件 ${input.tool.pluginName} 要求工具调用前确认。`,
        riskSignals: [],
      };
    }

    if (!input.tool) {
      return {
        action: AgentPermissionActions.Ask,
        rule: "manifest.unknown-tool",
        reason: `工具 ${input.toolName} 未在插件注册表中声明，执行前需要确认。`,
        riskSignals: [],
      };
    }

    if (input.tool.security?.TrustLevel === "Untrusted") {
      return {
        action: AgentPermissionActions.Ask,
        rule: "manifest.plugin.untrusted",
        reason: `插件 ${input.tool.pluginName} 未受信任，执行前需要确认。`,
        riskSignals: [],
      };
    }

    return {
      action: AgentPermissionActions.Allow,
      rule: "manifest.default",
      reason: `工具 ${input.toolName} 未声明需要审批。`,
      riskSignals: [],
    };
  }
}

function projectOpaInput(input: AgentToolApprovalPolicyInput): Record<string, unknown> {
  return {
    tool: {
      name: input.toolName,
      pluginName: input.tool?.pluginName,
      pluginTitle: input.tool?.pluginTitle,
      rootKind: input.tool?.rootKind,
      approval: input.tool?.approval,
      permissions: input.tool?.permissions ?? [],
      capabilities: {
        risks: input.tool?.capabilityRisks ?? [],
        effects: input.tool?.capabilityEffects ?? [],
      },
      security: input.tool?.security,
    },
    execution: input.executionPlan,
    toolCallId: input.toolCallId,
    args: input.arguments,
    visibleToolNames: input.visibleToolNames,
    runtimeContext: input.runtimeContext ?? {
      requestId: input.requestId,
      step: input.step,
    },
    messages: input.messages ?? [],
  };
}

function policyDecisionToPermissionDecision(
  decision: PolicyDecision,
  toolName: string,
  rulePrefix: string,
  metadata: {
    reason?: string;
    rule?: string;
    riskSignals?: readonly string[];
  } = {},
): AgentPermissionDecision | undefined {
  const mappings: Record<Exclude<PolicyDecision["type"], "not-applicable">, AgentPermissionAction> = {
    approved: AgentPermissionActions.Allow,
    denied: AgentPermissionActions.Deny,
    "user-approval": AgentPermissionActions.Ask,
  };
  if (decision.type === "not-applicable") {
    return undefined;
  }

  const action = mappings[decision.type];
  return {
    action,
    rule: metadata.rule ? `${rulePrefix}.${metadata.rule}` : `${rulePrefix}.${decision.type}`,
    reason: readPolicyDecisionReason(decision) ?? metadata.reason ?? policyDecisionReason(toolName, action),
    riskSignals: metadata.riskSignals ?? [],
  } as AgentPermissionDecision;
}

function readPolicyDecisionReason(decision: PolicyDecision): string | undefined {
  return "reason" in decision ? decision.reason : undefined;
}

function readPolicyReason(result: unknown): string | undefined {
  return result && typeof result === "object" && !Array.isArray(result)
    ? readString((result as Record<string, unknown>).reason)
    : undefined;
}

function readPolicyRule(result: unknown): string | undefined {
  return result && typeof result === "object" && !Array.isArray(result)
    ? readString((result as Record<string, unknown>).rule)
    : undefined;
}

function readPolicyRiskSignals(result: unknown): readonly string[] | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const value = (result as Record<string, unknown>).riskSignals;
  return Array.isArray(value) ? value.flatMap((item) => readString(item) ?? []) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function manifestToolReason(toolName: string, action: AgentPermissionAction): string {
  return `工具 ${toolName} 的 Manifest 审批模式为 ${action}。`;
}

function policyDecisionReason(toolName: string, action: AgentPermissionAction): string {
  return `策略引擎将工具 ${toolName} 判定为 ${action}。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
