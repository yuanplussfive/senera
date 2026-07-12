import {
  EventKinds,
  type ApprovalRequestedData,
  type ApprovalResolvedData,
  type ApprovalSubjectData,
  type ExecutionFallbackStartedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import type { ApprovalRunRecord, RunRecord, TimelineStepStatus } from "./types";

const approvalStepStatus = {
  approved: "done",
  denied: "failed",
} as const satisfies Record<ApprovalResolvedData["status"], TimelineStepStatus>;

export const runApprovalEventHandlers = {
  [EventKinds.ApprovalRequested]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ApprovalRequestedData;
    upsertApproval(run, {
      approvalId: data.approvalId,
      approvalKind: data.approvalKind,
      status: data.status,
      title: data.title,
      reason: data.reason,
      rule: data.rule,
      riskSignals: data.riskSignals,
      subject: data.subject,
      createdAt: data.createdAt,
    });
    upsertStep(run, {
      id: approvalStepId(data.approvalId),
      kind: "tool",
      title: approvalStepTitle(data.subject, data.status),
      description: `${data.subject.toolName} · ${data.reason}`,
      status: "pending",
      startedAt: data.createdAt,
      toolName: data.subject.toolName,
      toolArgs: approvalToolArguments(data.subject),
    });
  },

  [EventKinds.ApprovalResolved]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ApprovalResolvedData;
    upsertApproval(run, {
      approvalId: data.approvalId,
      approvalKind: data.approvalKind,
      status: data.status,
      title: data.title,
      reason: data.reason,
      rule: data.rule,
      riskSignals: data.riskSignals,
      subject: data.subject,
      createdAt: data.createdAt,
      resolvedAt: data.resolvedAt,
      message: data.message,
      scope: data.scope,
    });
    upsertStep(run, {
      id: approvalStepId(data.approvalId),
      kind: "tool",
      title: approvalStepTitle(data.subject, data.status),
      description: approvalResolvedDescription(data),
      status: approvalStepStatus[data.status],
      startedAt: data.createdAt,
      endedAt: data.resolvedAt,
      toolName: data.subject.toolName,
      toolArgs: approvalToolArguments(data.subject),
    });
  },

  [EventKinds.ExecutionFallbackStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ExecutionFallbackStartedData;
    upsertStep(run, {
      id: executionFallbackStepId(data),
      kind: "tool",
      title: frontendMessage("workflow.projection.executionFallbackStarted"),
      description: `${data.pluginName} · ${data.toolName} · ${data.rule}`,
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      toolName: data.toolName,
      callId: data.toolCallId,
      detailJson: data,
    });
  },
} satisfies RunEventHandlerMap;

function approvalStepId(approvalId: string): string {
  return `approval-${approvalId}`;
}

function upsertApproval(run: RunRecord, approval: ApprovalRunRecord): void {
  const approvals = run.approvals ?? [];
  const index = approvals.findIndex((item) => item.approvalId === approval.approvalId);
  if (index >= 0) {
    approvals[index] = { ...approvals[index], ...approval };
  } else {
    approvals.push(approval);
  }
  run.approvals = approvals;
  touchRun(run);
}

function approvalResolvedDescription(data: ApprovalResolvedData): string {
  return [data.subject.toolName, data.message || data.reason].filter(Boolean).join(" · ");
}

function approvalStepTitle(subject: ApprovalSubjectData, status: ApprovalRunRecord["status"]): string {
  const target =
    subject.kind === "execution_fallback"
      ? frontendMessage("workflow.projection.approvalTargetFallback")
      : frontendMessage("workflow.projection.approvalTargetTool");
  const statusLabel =
    status === "pending"
      ? frontendMessage("workflow.projection.approvalPending")
      : status === "approved"
        ? frontendMessage("workflow.projection.approvalGranted")
        : frontendMessage("workflow.projection.approvalDenied");
  return `${target}${statusLabel}`;
}

function approvalToolArguments(subject: ApprovalSubjectData): Record<string, unknown> | undefined {
  return subject.kind === "tool_call" ? subject.arguments : undefined;
}

function executionFallbackStepId(data: ExecutionFallbackStartedData): string {
  return `execution-fallback-${data.toolCallId ?? data.approvalId ?? data.toolName}`;
}
