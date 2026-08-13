import {
  EventKinds,
  type ChildRunCancellingData,
  type ChildRunDeadlineExtendedData,
  type ChildRunEventIdentityData,
  type ChildRunLifecycleData,
  type ChildRunMessageCreatedData,
  type ChildRunSnapshotData,
  type ChildRunStatus,
  type ChildRunWrappingUpData,
  type ExecutionResourceOutputData,
  type ExecutionResourceStateData,
  type AssistantMessageCreatedData,
  type EventEnvelope,
  type ModelStartedData,
  type PromptSummaryData,
  type RunFailedData,
  type RunCancellationProgressData,
  type ToolCallResultDetailData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallOutputData,
  type ToolCallProgressData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveBackendMessage } from "../../i18n/backendMessage";
import { summarizeToolPlan, toolPlanTitle, truncate } from "./sessionPresentation";
import { currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import { timelineScopeFromEvent, toolBatchFromEvent } from "./timelineProjection";
import { mergeToolResultPresentation, readToolResultPresentation } from "./toolResultPresentation";
import { projectToolOutput, projectToolProgress } from "./toolRuntimeProjection";
import type { RunRecord, StoreState, TimelineChildRunMessage, TimelineChildRunState, TimelineStep } from "./types";

export function applyScopedRunEvent(state: StoreState, env: EventEnvelope): boolean {
  registerChildSessionRelation(state, env);
  const parentRequestId = env.scope?.parentRequestId;
  if (!parentRequestId) return false;

  const sessionId = env.scope?.parentSessionId ?? env.sessionId;
  if (!sessionId) return true;

  const session = ensureSession(state, sessionId);
  const run = currentRun(session, parentRequestId);
  if (!run) return true;

  const scope = timelineScopeFromEvent(env);

  switch (env.kind) {
    case EventKinds.ChildRunQueued:
    case EventKinds.ChildRunStarted:
    case EventKinds.ChildRunAwaitingSupervisor:
    case EventKinds.ChildRunResumed:
    case EventKinds.ChildRunCompleted:
    case EventKinds.ChildRunPartialCompleted:
    case EventKinds.ChildRunInterrupted:
    case EventKinds.ChildRunTimedOut:
    case EventKinds.ChildRunFailed:
    case EventKinds.ChildRunCancelled: {
      projectChildRunLifecycle(run, env, env.data as ChildRunLifecycleData, scope);
      return true;
    }

    case EventKinds.ChildRunSnapshotUpdated: {
      const data = env.data as ChildRunSnapshotData;
      updateChildRunStep(run, env, data, scope, {
        checkpointAvailable: data.checkpointAvailable,
        lastActivityAt: data.snapshot.lastActivityAt,
        lastModelOutputAt: data.snapshot.lastModelOutputAt,
        modelOutputCharacters: data.snapshot.modelOutputCharacters,
        assistantTurns: data.snapshot.assistantTurns,
        toolCalls: data.snapshot.toolCalls,
        activeTools: data.snapshot.activeTools,
        artifactCount: data.snapshot.artifactUris.length,
        softDeadlineAt: data.snapshot.deadline.softDeadlineAt,
        hardDeadlineAt: data.snapshot.deadline.hardDeadlineAt,
        grantedExtensionMs: data.snapshot.deadline.grantedExtensionMs,
      });
      return true;
    }

    case EventKinds.ChildRunDeadlineExtended: {
      const data = env.data as ChildRunDeadlineExtendedData;
      updateChildRunStep(run, env, data, scope, {
        softDeadlineAt: data.softDeadlineAt,
        grantedExtensionMs: data.grantedExtensionMs,
      });
      return true;
    }

    case EventKinds.ChildRunWrappingUp: {
      const data = env.data as ChildRunWrappingUpData;
      updateChildRunStep(run, env, data, scope, { hardDeadlineAt: data.hardDeadlineAt });
      return true;
    }

    case EventKinds.ChildRunCancelling: {
      const data = env.data as ChildRunCancellingData;
      updateChildRunStep(run, env, data, scope);
      return true;
    }

    case EventKinds.RunCancellationProgress: {
      const childRunId = env.scope?.childRunId;
      if (!childRunId) return true;
      const data = env.data as RunCancellationProgressData;
      const current = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
      updateChildRunStep(
        run,
        env,
        {
          childRunId,
          agentName: env.scope?.agentName ?? "",
          status: current?.childRun?.status ?? "cancelling",
        },
        scope,
        { cancellation: { ...data, updatedAt: env.timestamp } },
      );
      return true;
    }

    case EventKinds.PromptSummary: {
      const data = env.data as PromptSummaryData;
      upsertStep(run, {
        id: scopedStepId(env, "prompt"),
        kind: "prompt",
        title: scopedStepTitle(env, frontendMessage("workflow.plan.promptRendered")),
        description: scopedStepDescription(
          env,
          frontendMessage("workflow.projection.promptTokenSummary", {
            count: data.tokenCount,
            chars: data.chars,
            lines: data.lines,
          }),
        ),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        promptChars: data.chars,
        promptLines: data.lines,
        promptTokenCount: data.tokenCount,
        scope,
      });
      return true;
    }

    case EventKinds.ModelStarted: {
      const data = env.data as ModelStartedData;
      const modelName = data.provider?.model ?? data.model;
      upsertStep(run, {
        id: scopedStepId(env, "model"),
        kind: "model",
        title: scopedStepTitle(env, frontendMessage("workflow.feed.callingModel")),
        description: scopedStepDescription(env, modelName),
        status: "running",
        startedAt: env.timestamp,
        modelName,
        scope,
      });
      return true;
    }

    case EventKinds.ModelCompleted: {
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "model"));
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        touchRun(run);
      }
      return true;
    }
    case EventKinds.ToolCallsPlanned: {
      const data = env.data as ToolCallsPlannedData;
      const toolBatch = toolBatchFromEvent(env, undefined, data.toolCount);
      upsertStep(run, {
        id: scopedStepId(env, "tool-plan", toolBatch.id),
        kind: "tool",
        title: scopedStepTitle(env, toolPlanTitle(data)),
        description: scopedStepDescription(env, summarizeToolPlan(data)),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        toolBatch,
        scope,
      });
      for (const [index, call] of (data.calls ?? []).entries()) {
        upsertStep(run, {
          id: scopedStepId(env, "tool", call.callId),
          kind: "tool",
          title: scopedStepTitle(env, frontendMessage("workflow.projection.toolCall", { toolName: call.toolName })),
          status: "pending",
          startedAt: env.timestamp,
          toolName: call.toolName,
          callId: call.callId,
          purpose: call.purpose,
          toolBatch: {
            ...toolBatch,
            index,
            size: data.toolCount,
          },
          scope,
        });
      }
      return true;
    }

    case EventKinds.ToolCallStarted: {
      const data = env.data as ToolCallStartedData;
      upsertStep(run, {
        id: scopedStepId(env, "tool", data.callId),
        kind: "tool",
        title: scopedStepTitle(env, frontendMessage("workflow.projection.toolCall", { toolName: data.toolName })),
        status: "running",
        startedAt: env.timestamp,
        toolName: data.toolName,
        toolOrigin: data.origin,
        callId: data.callId,
        toolBatch: toolBatchFromEvent(env, data),
        toolArgs: data.arguments,
        scope,
      });
      return true;
    }

    case EventKinds.ToolCallOutput: {
      const data = env.data as ToolCallOutputData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.callId));
      if (step) {
        projectToolOutput(step, data);
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ToolCallProgress: {
      const data = env.data as ToolCallProgressData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.callId));
      if (step) {
        projectToolProgress(step, data);
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ExecutionResourceOutput: {
      const data = env.data as ExecutionResourceOutputData;
      if (!data.toolCallId) return true;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.toolCallId));
      if (step) {
        projectToolOutput(step, {
          toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
          callId: data.toolCallId,
          stream: data.stream,
          outputSequence: data.cursor,
          text: data.text,
          byteLength: data.byteLength,
          totalBytes: data.totalBytes,
          resourceId: data.resourceId,
        });
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ExecutionResourceState: {
      const data = env.data as ExecutionResourceStateData;
      if (!data.toolCallId) return true;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.toolCallId));
      if (step) {
        projectToolProgress(step, {
          toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
          callId: data.toolCallId,
          progressSequence: data.cursor,
          message: data.reason ? `${data.state}: ${data.reason}` : data.state,
          resourceId: data.resourceId,
        });
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ToolCallCompleted: {
      const data = env.data as ToolCallCompletedData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.callId));
      if (step) {
        step.status = "done";
        step.toolOrigin = data.origin ?? step.toolOrigin;
        step.endedAt = env.timestamp;
        step.toolPresentation = mergeToolResultPresentation(step.toolPresentation, data.presentation);
        step.toolPreview = step.toolPresentation?.headline;
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ToolCallFailed: {
      const data = env.data as ToolCallFailedData;
      const message = resolveBackendMessage(data) ?? data.message;
      const id = scopedStepId(env, "tool", data.callId);
      const step = run.steps.find((entry) => entry.id === id);
      if (step) {
        step.status = "failed";
        step.toolOrigin = data.origin ?? step.toolOrigin;
        step.endedAt = env.timestamp;
        step.toolErrorMessage = message;
        touchRun(run);
      } else {
        upsertStep(run, {
          id,
          kind: "tool",
          title: scopedStepTitle(
            env,
            frontendMessage("workflow.projection.toolCallFailed", { toolName: data.toolName }),
          ),
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          toolName: data.toolName,
          toolOrigin: data.origin,
          callId: data.callId,
          toolBatch: toolBatchFromEvent(env, data),
          toolErrorMessage: message,
          scope,
        });
      }
      return true;
    }

    case EventKinds.ToolCallResultDetail: {
      const data = env.data as ToolCallResultDetailData;
      const step = run.steps.find((item) => item.id === scopedStepId(env, "tool", data.callId));
      if (step) {
        step.toolResult = data.value;
        step.toolOrigin = data.origin ?? step.toolOrigin;
        step.toolPresentation = mergeToolResultPresentation(
          step.toolPresentation,
          readToolResultPresentation(data.value),
        );
        step.toolPreview = step.toolPresentation?.headline ?? step.toolPreview;
        touchRun(run);
      }
      return true;
    }
    case EventKinds.AssistantMessageCreated: {
      const data = env.data as AssistantMessageCreatedData;
      if (env.scope?.role === "childAgent" && env.scope.childRunId) {
        projectChildRunAssistantMessage(run, env, data);
        return true;
      }
      const title =
        data.kind === "ask_user"
          ? frontendMessage("workflow.projection.assistantAskUser")
          : data.kind === "tool_preface"
            ? frontendMessage("workflow.projection.assistantToolPreface")
            : frontendMessage("workflow.projection.assistantFinalAnswer");
      upsertStep(run, {
        id: scopedStepId(env, "assistant-message", data.messageId),
        kind: data.kind === "tool_preface" ? "decision" : "answer",
        title: scopedStepTitle(env, title),
        description: truncate(data.content, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.kind,
        scope,
      });
      return true;
    }

    case EventKinds.RunFailed: {
      const data = env.data as RunFailedData;
      const message = resolveBackendMessage(data) ?? data.message;
      upsertStep(run, {
        id: scopedStepId(env, "error"),
        kind: "error",
        title: scopedStepTitle(env, frontendMessage("workflow.projection.runFailed")),
        description: scopedStepDescription(env, message),
        status: "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        errorMessage: message,
        scope,
      });
      return true;
    }

    case EventKinds.ModelDelta:
      return true;

    case EventKinds.ChildRunMessageCreated: {
      const data = env.data as ChildRunMessageCreatedData;
      updateChildRunStep(run, env, data, scope);
      const step = run.steps.find((entry) => entry.id === childRunStepId(data.childRunId));
      if (!step?.childRun) return true;
      upsertChildRunMessage(step.childRun, {
        id: data.messageId,
        direction: data.direction,
        kind: data.messageKind,
        content: data.content,
        createdAt: env.timestamp,
      });
      step.description = childRunActivityDescription(step.childRun);
      touchRun(run);
      return true;
    }

    case EventKinds.RunStarted:
    case EventKinds.RunCompleted:
    case EventKinds.RunCancelled:
      return true;

    default:
      return true;
  }
}

function scopedStepId(env: EventEnvelope, slot: string, detail?: string | number): string {
  return [
    env.scope?.workflowName,
    env.scope?.role,
    env.scope?.jobId,
    env.scope?.childRunId,
    env.requestId,
    env.step ?? 0,
    slot,
    detail,
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(":");
}

function projectChildRunLifecycle(
  run: RunRecord,
  env: EventEnvelope,
  data: ChildRunLifecycleData,
  scope: TimelineStep["scope"],
): void {
  updateChildRunStep(run, env, data, scope);
  const step = run.steps.find((entry) => entry.id === childRunStepId(data.childRunId));
  if (step && data.error) {
    step.description = data.error;
    step.errorMessage = data.error;
    touchRun(run);
  }
}

function updateChildRunStep(
  run: RunRecord,
  env: EventEnvelope,
  data: { childRunId: string; agentName: string; status: ChildRunStatus },
  scope: TimelineStep["scope"],
  statePatch: Partial<TimelineChildRunState> = {},
): void {
  const id = childRunStepId(data.childRunId);
  const current = run.steps.find((entry) => entry.id === id);
  const childRun: TimelineChildRunState = {
    ...current?.childRun,
    messages: current?.childRun?.messages ? [...current.childRun.messages] : [],
    ...statePatch,
    id: data.childRunId,
    status: data.status,
  };
  const terminal = isTerminalChildRunStatus(data.status);
  upsertStep(run, {
    id,
    kind: "delegation",
    title: childRunStatusTitle(data.status),
    description: childRunActivityDescription(childRun),
    status: childRunTimelineStatus(data.status),
    startedAt: current?.startedAt ?? env.timestamp,
    ...(terminal ? { endedAt: env.timestamp } : {}),
    scope,
    childRun,
  });
}

function upsertChildRunMessage(state: TimelineChildRunState, message: TimelineChildRunMessage): void {
  const index = state.messages.findIndex((entry) => entry.id === message.id);
  if (index >= 0) {
    state.messages[index] = message;
  } else {
    state.messages.push(message);
  }
  state.messages.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function projectChildRunAssistantMessage(
  run: RunRecord,
  env: EventEnvelope,
  data: AssistantMessageCreatedData,
): boolean {
  const childRunId = env.scope?.childRunId;
  if (!childRunId) return false;
  let step = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
  if (!step?.childRun) {
    updateChildRunStep(
      run,
      env,
      {
        childRunId,
        agentName: env.scope?.agentName ?? "",
        status: data.terminal ? "completed" : "running",
      },
      timelineScopeFromEvent(env),
    );
    step = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
  }
  if (!step?.childRun) return true;
  if (!data.content) return true;
  const kind: TimelineChildRunMessage["kind"] =
    data.kind === "ask_user" ? "decision" : data.kind === "tool_preface" ? "progress" : "response";
  upsertChildRunMessage(step.childRun, {
    id: `assistant:${data.messageId}`,
    direction: "child_to_parent",
    kind,
    content: data.content,
    createdAt: env.timestamp,
  });
  step.description = childRunActivityDescription(step.childRun);
  touchRun(run);
  return true;
}

function registerChildSessionRelation(state: StoreState, env: EventEnvelope): void {
  if (!isChildRunEventKind(env.kind)) return;
  const data = env.data as Partial<ChildRunEventIdentityData>;
  const childSessionId = data.childSessionId;
  const parentSessionId = env.scope?.parentSessionId ?? env.sessionId;
  if (
    typeof childSessionId !== "string" ||
    childSessionId.length === 0 ||
    typeof parentSessionId !== "string" ||
    parentSessionId.length === 0 ||
    childSessionId === parentSessionId
  ) {
    return;
  }
  state.childSessionParentIds[childSessionId] = parentSessionId;
  hideChildSessionFromTopLevel(state, childSessionId);
}

function isChildRunEventKind(kind: EventEnvelope["kind"]): boolean {
  return (
    kind === EventKinds.ChildRunQueued ||
    kind === EventKinds.ChildRunStarted ||
    kind === EventKinds.ChildRunAwaitingSupervisor ||
    kind === EventKinds.ChildRunResumed ||
    kind === EventKinds.ChildRunMessageCreated ||
    kind === EventKinds.ChildRunSnapshotUpdated ||
    kind === EventKinds.ChildRunDeadlineExtended ||
    kind === EventKinds.ChildRunWrappingUp ||
    kind === EventKinds.ChildRunCancelling ||
    kind === EventKinds.ChildRunCompleted ||
    kind === EventKinds.ChildRunPartialCompleted ||
    kind === EventKinds.ChildRunInterrupted ||
    kind === EventKinds.ChildRunTimedOut ||
    kind === EventKinds.ChildRunFailed ||
    kind === EventKinds.ChildRunCancelled
  );
}

function hideChildSessionFromTopLevel(state: StoreState, childSessionId: string): void {
  state.sessionOrder = state.sessionOrder.filter((id) => id !== childSessionId);
  if (state.activeSessionId !== childSessionId) return;
  state.activeSessionId = state.sessionOrder.find((id) => !state.childSessionParentIds[id]) ?? null;
}

function childRunStepId(childRunId: string): string {
  return `child-run:${childRunId}`;
}

function childRunTimelineStatus(status: ChildRunStatus): TimelineStep["status"] {
  switch (status) {
    case "queued":
    case "awaiting_supervisor":
      return "pending";
    case "running":
    case "wrapping_up":
      return "running";
    case "cancelling":
      return "cancelling";
    case "failed":
    case "timed_out":
      return "failed";
    case "partial_completed":
    case "interrupted":
      return "done";
    case "completed":
    case "cancelled":
      return "done";
  }
}

function childRunStatusTitle(status: ChildRunStatus): string {
  return frontendMessage(
    (
      {
        queued: "workflow.step.status.pending",
        running: "workflow.run.status.running",
        wrapping_up: "workflow.childRun.status.wrappingUp",
        cancelling: "workflow.run.status.cancelling",
        awaiting_supervisor: "workflow.childRun.status.awaitingSupervisor",
        completed: "workflow.run.status.completed",
        partial_completed: "workflow.childRun.status.partialCompleted",
        interrupted: "workflow.childRun.status.interrupted",
        timed_out: "workflow.childRun.status.timedOut",
        failed: "workflow.run.status.failed",
        cancelled: "workflow.run.status.cancelled",
      } as const
    )[status],
  );
}

function childRunActivityDescription(state: TimelineChildRunState): string | undefined {
  const details: string[] = [];
  const cancellation = childRunCancellationDescription(state.cancellation);
  if (cancellation) details.push(cancellation);
  if (state.activeTools && state.activeTools.length > 0) {
    details.push(
      state.activeTools.length === 1
        ? `${frontendMessage("workflow.childRun.usingTool")} ${state.activeTools[0]}`
        : frontendMessage("workflow.childRun.parallelTools", { count: state.activeTools.length }),
    );
  }
  const latestMessage = state.messages.at(-1);
  if (latestMessage?.content) details.push(truncate(latestMessage.content, 120));
  return details.length > 0 ? details.join(" · ") : undefined;
}

function childRunCancellationDescription(cancellation: TimelineChildRunState["cancellation"]): string | undefined {
  if (!cancellation) return undefined;
  const title = frontendMessage(
    cancellation.stage === "completed"
      ? "run.cancellation.completed"
      : cancellation.stage === "failed"
        ? "run.cancellation.failed"
        : cancellation.stage === "settlement_delayed"
          ? "run.cancellation.delayed"
          : "run.cancellation.started",
  );
  const component = cancellation.component
    ? frontendMessage(
        cancellation.component === "agent_loop"
          ? "run.cancellation.component.agent_loop"
          : "run.cancellation.component.pi_session",
      )
    : undefined;
  const duration = cancellation.durationMs === undefined ? undefined : `${cancellation.durationMs}ms`;
  const message = resolveBackendMessage(cancellation);
  return [title, component, duration, message].filter(Boolean).join(" · ");
}

function isTerminalChildRunStatus(status: ChildRunStatus): boolean {
  return (
    status === "completed" ||
    status === "partial_completed" ||
    status === "interrupted" ||
    status === "timed_out" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function scopedStepTitle(env: EventEnvelope, title: string): string {
  const owner = env.scope?.role === "merge" ? frontendMessage("workflow.scope.merge") : env.scope?.agentName;
  return owner ? `${owner} · ${title}` : title;
}

function scopedStepDescription(env: EventEnvelope, description?: string): string | undefined {
  const workflowName = env.scope?.workflowName;
  if (!workflowName) return description;
  return description ? `${workflowName} · ${description}` : workflowName;
}
