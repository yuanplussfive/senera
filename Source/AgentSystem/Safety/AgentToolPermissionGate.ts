import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import {
  AgentApprovalDecisions,
  AgentApprovalDispositions,
  AgentApprovalKinds,
  AgentApprovalStatuses,
} from "../Approvals/AgentApprovalTypes.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentPermissionActions, type AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicy, AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";
import {
  AgentExecutionApprovalModes,
  AgentExecutionApprovalReviewers,
  projectAgentExecutionApprovalDecision,
  resolveAgentExecutionPermissionProfile,
  type AgentExecutionApprovalMode,
} from "./AgentExecutionApprovalMode.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentSessionApprovalLeaseStore } from "./AgentSessionApprovalLeaseStore.js";
import { AgentToolSemanticAuditModes, type AgentToolSemanticAuditMode } from "../Types/AgentRuntimeConfigTypes.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";

export class AgentToolPermissionDeniedError extends AgentBaseError {
  constructor(
    message: string,
    readonly decision: AgentPermissionDecision,
  ) {
    super(message);
  }
}

export interface AgentToolPermissionGateOptions {
  policy: AgentToolApprovalPolicy;
  sessionApprovals: AgentSessionApprovalLeaseStore;
  approvalRuntime?: AgentApprovalRuntime;
  semanticAuditMode?: AgentToolSemanticAuditMode;
  toolPlanningMode: AgentModelToolPlanningMode;
}

export interface AgentToolPermissionGateRequest extends AgentToolApprovalPolicyInput {
  approvalMode: AgentExecutionApprovalMode;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export class AgentToolPermissionGate {
  constructor(private readonly options: AgentToolPermissionGateOptions) {}

  async authorize(request: AgentToolPermissionGateRequest): Promise<AgentPermissionDecision> {
    const policyDecision = await this.options.policy.decideToolCall(request, {
      includeSemanticAuditors: shouldRunSemanticAudit(
        this.options.semanticAuditMode ?? AgentToolSemanticAuditModes.ApprovalSensitive,
        request.approvalMode,
        this.options.toolPlanningMode,
      ),
    });
    if (policyDecision.action === AgentPermissionActions.Ask && this.hasSessionApprovalLease(request, policyDecision)) {
      return {
        ...policyDecision,
        action: AgentPermissionActions.Allow,
        rule: `approval.session_lease:${policyDecision.rule}`,
        reason: agentErrorMessage("approval.sessionLeaseMatched"),
      };
    }
    const decision =
      request.executionPlan?.backend === "local" && request.approvalMode !== AgentExecutionApprovalModes.FullAccess
        ? policyDecision
        : projectAgentExecutionApprovalDecision(policyDecision, request.approvalMode);
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
      throw new AgentLocalizedError("approval.serviceUnavailable");
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
        title: agentErrorMessage("approval.toolCallTitle", { toolName: request.toolName }),
        reason: decision.reason,
        rule: decision.rule,
        riskSignals: decision.riskSignals,
        availableDecisions: [
          AgentApprovalDecisions.ApproveOnce,
          AgentApprovalDecisions.ApproveSession,
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
      if (resolution.scope === "session") this.rememberSessionApprovalLease(request, decision);
      return {
        action: AgentPermissionActions.Allow,
        rule: decision.rule,
        reason: resolution.message ?? agentErrorMessage("approval.toolCallApproved"),
        riskSignals: decision.riskSignals,
      };
    }

    if (resolution.disposition === AgentApprovalDispositions.Interrupt) {
      throw new AgentCancellationError(resolution.message ?? agentErrorMessage("approval.toolCallInterrupted"));
    }

    const message =
      resolution.message ??
      (resolution.status === AgentApprovalStatuses.Expired
        ? agentErrorMessage("approval.toolCallExpired")
        : agentErrorMessage("approval.toolCallDenied"));
    throw new AgentToolPermissionDeniedError(message, {
      action: AgentPermissionActions.Deny,
      rule: decision.rule,
      reason: message,
      riskSignals: decision.riskSignals,
    });
  }

  private hasSessionApprovalLease(request: AgentToolPermissionGateRequest, decision: AgentPermissionDecision): boolean {
    return this.options.sessionApprovals.has(request.sessionId, sessionApprovalLeaseKey(request, decision));
  }

  private rememberSessionApprovalLease(
    request: AgentToolPermissionGateRequest,
    decision: AgentPermissionDecision,
  ): void {
    this.options.sessionApprovals.grant(request.sessionId, sessionApprovalLeaseKey(request, decision));
  }
}

function shouldRunSemanticAudit(
  mode: AgentToolSemanticAuditMode,
  approvalMode: AgentExecutionApprovalMode,
  toolPlanningMode: AgentModelToolPlanningMode,
): boolean {
  if (toolPlanningMode !== "baml") return false;
  if (mode === AgentToolSemanticAuditModes.Disabled) return false;
  return resolveAgentExecutionPermissionProfile(approvalMode).reviewer === AgentExecutionApprovalReviewers.User;
}

function sessionApprovalLeaseKey(request: AgentToolPermissionGateRequest, decision: AgentPermissionDecision): string {
  return sha256HexOfCanonicalJson({
    toolName: request.toolName,
    rule: decision.rule,
    riskSignals: [...decision.riskSignals].sort(),
    execution: request.executionPlan
      ? {
          target: request.executionPlan.target,
          backend: request.executionPlan.backend,
          network: request.executionPlan.network,
          workspaceMount: request.executionPlan.workspaceMount,
        }
      : undefined,
    permissions: [...(request.tool?.permissions ?? [])].sort(),
    effects: [...(request.tool?.capabilityEffects ?? [])].sort(),
  });
}
