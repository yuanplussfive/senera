import crypto from "node:crypto";
import { normalizeOpaDecision, type PolicyClient } from "@ai-sdk/policy-opa";
import { type AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import {
  AgentApprovalDecisions,
  AgentApprovalDispositions,
  AgentApprovalKinds,
  AgentApprovalStatuses,
} from "../Approvals/AgentApprovalTypes.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import {
  type SeneraProcessFallbackAuthorization,
  type SeneraProcessFallbackAuthorizationRequest,
  type SeneraProcessFallbackAuthorizer,
} from "../Execution/SeneraProcessFallbackAuthorization.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "../Execution/SeneraExecutionTypes.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentSeneraOpaPolicyClient } from "./AgentSeneraOpaPolicyClient.js";
import { AgentToolApprovalPolicyArtifactContract } from "./AgentToolApprovalPolicyArtifact.js";

export interface AgentExecutionFallbackAuthorizerOptions {
  readonly registry: AgentPluginRegistry;
  readonly approvalRuntime?: AgentApprovalRuntime;
  readonly policyClient?: PolicyClient;
}

export class AgentExecutionFallbackAuthorizer implements SeneraProcessFallbackAuthorizer {
  private readonly policyClient: PolicyClient;
  private readonly sessionGrants = new Set<string>();

  constructor(private readonly options: AgentExecutionFallbackAuthorizerOptions) {
    this.policyClient =
      options.policyClient ??
      new AgentSeneraOpaPolicyClient({
        registry: options.registry,
      });
  }

  async authorize(request: SeneraProcessFallbackAuthorizationRequest): Promise<SeneraProcessFallbackAuthorization> {
    const rawDecision = await this.evaluate(request);
    const decision = normalizeOpaDecision(rawDecision);
    const metadata = readPolicyMetadata(rawDecision);

    if (decision.type === "approved") {
      return metadata;
    }
    if (decision.type === "denied" || decision.type === "not-applicable") {
      throw fallbackDenied(request, metadata);
    }

    const fingerprint = fallbackGrantFingerprint(request, metadata.rule);
    if (this.sessionGrants.has(fingerprint)) {
      return {
        ...metadata,
        rule: `${metadata.rule}.session_grant`,
        scope: "session",
      };
    }

    const approvalRuntime = this.options.approvalRuntime;
    if (!approvalRuntime) {
      throw fallbackDenied(request, {
        ...metadata,
        reason: `${metadata.reason} 当前运行时没有审批服务。`,
      });
    }

    const subject = request.context.subject;
    const resolution = await approvalRuntime.requestApproval({
      onEvent: request.context.onEvent,
      signal: request.signal,
      approval: {
        kind: AgentApprovalKinds.ExecutionFallback,
        sessionId: request.context.sessionId,
        requestId: request.context.requestId,
        step: request.context.step,
        toolCallId: request.context.toolCallId,
        batchId: request.context.batchId,
        title: `允许 ${subject.pluginTitle} 在本机运行`,
        reason: metadata.reason,
        rule: metadata.rule,
        riskSignals: metadata.riskSignals,
        availableDecisions: [
          AgentApprovalDecisions.ApproveOnce,
          AgentApprovalDecisions.ApproveSession,
          AgentApprovalDecisions.Deny,
          AgentApprovalDecisions.DenyAndInterrupt,
        ],
        subject: {
          kind: AgentApprovalKinds.ExecutionFallback,
          ...subject,
          fromBackend: request.fromBackend,
          toBackend: request.toBackend,
          failureReason: request.reason,
        },
      },
    });
    if (resolution.status !== AgentApprovalStatuses.Approved) {
      if (resolution.disposition === AgentApprovalDispositions.Interrupt) {
        throw new AgentCancellationError(resolution.message ?? "用户中断了本地回退审批。");
      }
      throw fallbackDenied(request, {
        ...metadata,
        reason: resolution.message ?? "用户拒绝了本地回退审批。",
      });
    }

    const scope = resolution.scope ?? "once";
    if (scope === "session") {
      this.sessionGrants.add(fingerprint);
    }
    return {
      ...metadata,
      reason: resolution.message ?? metadata.reason,
      approvalId: resolution.approvalId,
      scope,
    };
  }

  private async evaluate(request: SeneraProcessFallbackAuthorizationRequest): Promise<unknown> {
    try {
      const subject = request.context.subject;
      return await this.policyClient.evaluate(AgentToolApprovalPolicyArtifactContract.entrypoints.executionFallback, {
        tool: {
          name: subject.toolName,
          plugin: {
            manifestDigest: subject.manifestDigest,
          },
        },
        execution: {
          boundary: subject.boundary,
          network: subject.network,
          workspace: subject.workspace,
          from: request.fromBackend,
          to: request.toBackend,
          reason: request.reason,
        },
      });
    } catch (error) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "本地回退策略执行失败，已拒绝在宿主运行插件。",
        {
          toolName: request.context.subject.toolName,
          pluginName: request.context.subject.pluginName,
          policyError: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error : undefined,
      );
    }
  }
}

function readPolicyMetadata(result: unknown): SeneraProcessFallbackAuthorization & {
  readonly riskSignals: readonly string[];
} {
  const record = readRecord(result);
  return {
    rule: readString(record.rule) ?? "execution.fallback.unknown",
    reason: readString(record.reason) ?? "执行边界降级没有返回可用原因。",
    riskSignals: Array.isArray(record.riskSignals)
      ? record.riskSignals.flatMap((value) => readString(value) ?? [])
      : [],
  };
}

function fallbackDenied(
  request: SeneraProcessFallbackAuthorizationRequest,
  decision: SeneraProcessFallbackAuthorization,
): SeneraExecutionError {
  return new SeneraExecutionError(
    SeneraExecutionErrorCodes.SandboxUnavailable,
    decision.reason,
    {
      pluginName: request.context.subject.pluginName,
      toolName: request.context.subject.toolName,
      fromBackend: request.fromBackend,
      toBackend: request.toBackend,
      rule: decision.rule,
    },
    request.error,
  );
}

function fallbackGrantFingerprint(request: SeneraProcessFallbackAuthorizationRequest, rule: string): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        sessionId: request.context.sessionId,
        subject: request.context.subject,
        fromBackend: request.fromBackend,
        toBackend: request.toBackend,
        rule,
      }),
    )
    .digest("hex");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
