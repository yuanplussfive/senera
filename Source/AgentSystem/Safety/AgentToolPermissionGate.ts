import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import {
  AgentApprovalDecisions,
  AgentApprovalDispositions,
  AgentApprovalKinds,
  AgentApprovalStatuses,
} from "../Approvals/AgentApprovalTypes.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentPermissionActions, type AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicy, AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";

export class AgentToolPermissionDeniedError extends Error {
  constructor(
    message: string,
    readonly decision: AgentPermissionDecision,
  ) {
    super(message);
    this.name = "AgentToolPermissionDeniedError";
  }
}

export interface AgentToolPermissionGateOptions {
  policy: AgentToolApprovalPolicy;
  approvalRuntime?: AgentApprovalRuntime;
}

export interface AgentToolPermissionGateRequest extends AgentToolApprovalPolicyInput {
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export class AgentToolPermissionGate {
  constructor(private readonly options: AgentToolPermissionGateOptions) {}

  async authorize(request: AgentToolPermissionGateRequest): Promise<AgentPermissionDecision> {
    const decision = await this.options.policy.decideToolCall(request);
    const authorizers: Record<AgentPermissionDecision["action"], () => Promise<AgentPermissionDecision>> = {
      allow: async () => decision,
      deny: async () => {
        throw new AgentToolPermissionDeniedError(decision.reason, decision);
      },
      ask: async () => this.askForApproval(request, decision),
    };

    return authorizers[decision.action]();
  }

  private async askForApproval(
    request: AgentToolPermissionGateRequest,
    decision: AgentPermissionDecision,
  ): Promise<AgentPermissionDecision> {
    if (!this.options.approvalRuntime) {
      throw new Error("安全策略要求审批，但当前运行时没有审批服务。");
    }

    const resolution = await this.options.approvalRuntime.requestApproval({
      onEvent: request.onEvent,
      signal: request.signal,
      approval: {
        kind: AgentApprovalKinds.ToolCall,
        sessionId: request.sessionId,
        requestId: request.requestId,
        step: request.step,
        toolCallId: request.toolCallId,
        batchId: request.batchId,
        title: `允许工具调用：${request.toolName}`,
        reason: decision.reason,
        rule: decision.rule,
        riskSignals: decision.riskSignals,
        availableDecisions: [
          AgentApprovalDecisions.ApproveOnce,
          AgentApprovalDecisions.Deny,
          AgentApprovalDecisions.DenyAndInterrupt,
        ],
        subject: {
          kind: AgentApprovalKinds.ToolCall,
          toolName: request.toolName,
          arguments: request.arguments,
          execution: request.executionPlan,
        },
      },
    });

    if (resolution.status === AgentApprovalStatuses.Approved) {
      return {
        action: AgentPermissionActions.Allow,
        rule: decision.rule,
        reason: resolution.message ?? "用户已批准工具调用。",
        riskSignals: decision.riskSignals,
      };
    }

    if (resolution.disposition === AgentApprovalDispositions.Interrupt) {
      throw new AgentCancellationError(resolution.message ?? "用户中断了工具调用审批。");
    }

    const message =
      resolution.message ??
      (resolution.status === AgentApprovalStatuses.Expired ? "工具调用审批已过期。" : "用户拒绝了工具调用审批。");
    throw new AgentToolPermissionDeniedError(message, {
      action: AgentPermissionActions.Deny,
      rule: decision.rule,
      reason: message,
      riskSignals: decision.riskSignals,
    });
  }
}
