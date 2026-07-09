import {
  EventKinds,
  type ApprovalRequestedData,
  type ApprovalResolvedData,
} from "../../api/eventTypes";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import type { ApprovalRunRecord, RunRecord, TimelineStepStatus } from "./types";

const approvalStepTitleByStatus = {
  pending: "等待工具审批",
  approved: "工具审批已通过",
  denied: "工具审批已拒绝",
} as const satisfies Record<ApprovalRunRecord["status"], string>;

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
      status: data.status,
      title: data.title,
      reason: data.reason,
      rule: data.rule,
      riskSignals: data.riskSignals,
      toolName: data.subject.toolName,
      createdAt: data.createdAt,
      arguments: data.subject.arguments,
    });
    upsertStep(run, {
      id: approvalStepId(data.approvalId),
      kind: "tool",
      title: approvalStepTitleByStatus.pending,
      description: `${data.subject.toolName} · ${data.reason}`,
      status: "pending",
      startedAt: data.createdAt,
      toolName: data.subject.toolName,
      toolArgs: data.subject.arguments,
    });
  },

  [EventKinds.ApprovalResolved]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ApprovalResolvedData;
    upsertApproval(run, {
      approvalId: data.approvalId,
      status: data.status,
      title: data.title,
      reason: data.reason,
      rule: data.rule,
      riskSignals: data.riskSignals,
      toolName: data.subject.toolName,
      createdAt: data.createdAt,
      resolvedAt: data.resolvedAt,
      message: data.message,
      arguments: data.subject.arguments,
    });
    upsertStep(run, {
      id: approvalStepId(data.approvalId),
      kind: "tool",
      title: approvalStepTitleByStatus[data.status],
      description: approvalResolvedDescription(data),
      status: approvalStepStatus[data.status],
      startedAt: data.createdAt,
      endedAt: data.resolvedAt,
      toolName: data.subject.toolName,
      toolArgs: data.subject.arguments,
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
