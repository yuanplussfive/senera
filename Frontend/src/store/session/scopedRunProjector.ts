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
  type AssistantMessageCreatedData,
  type EventEnvelope,
  type ModelCompletedData,
  type ModelThinkingCompletedData,
  type ModelThinkingDeltaData,
  type ModelStartedData,
  type PromptSummaryData,
  type RunFailedData,
  type RunCancellationProgressData,
} from "../../api/eventTypes";
import { readTodoSnapshotEventData } from "../../api/continuityExecutionEventValidation";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveBackendMessage } from "../../i18n/backendMessage";
import { truncate } from "./sessionPresentation";
import { currentRun, ensureSession, upsertStep, upsertStartedStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import { findOrCreateModelThinkingBlock } from "./modelThinkingBlocks";
import { timelineScopeFromEvent, scopedStepId, scopedStepTitle, scopedStepDescription } from "./timelineProjection";
import { projectToolCallEvent } from "./toolCallProjection";
import type {
  RunRecord,
  StoreState,
  TimelineChildRunMessage,
  TimelineChildRunState,
  TimelineChildRunTodo,
  TimelineChildRunTodoItem,
  TimelineChildRunTodoStatus,
  TimelineStep,
} from "./types";

const TimelineChildRunTodoStatusLookup: Readonly<Record<string, TimelineChildRunTodoStatus>> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

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
  if (projectToolCallEvent(run, env)) return true;

  switch (env.kind) {
    case EventKinds.TodoListWritten: {
      const data = readTodoSnapshotEventData(env.data);
      const childRunId = env.scope?.childRunId;
      if (!data || !childRunId) return true;
      const current = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
      const previousTodo = current?.childRun?.todo;
      const source = (env.data as { source?: unknown }).source;
      updateChildRunStep(
        run,
        env,
        {
          childRunId,
          agentName: env.scope?.agentName ?? "",
          status: current?.childRun?.status ?? "running",
        },
        scope,
        {
          todo: projectTodoState(
            {
              planObserved: previousTodo?.planObserved === true || source === "model",
              counts: { ...data.snapshot.counts },
            },
            data.snapshot.items,
          ),
        },
      );
      return true;
    }

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
      const todo = data.snapshot.control?.todo;
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
        ...(todo
          ? {
              todo: projectTodoState(
                { planObserved: todo.planObserved, counts: { ...todo.counts } },
                todo.items,
                run.steps.find((entry) => entry.id === childRunStepId(data.childRunId))?.childRun?.todo?.items,
              ),
            }
          : {}),
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
        eventSequence: env.sequence,
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
      upsertStartedStep(run, {
        id: scopedStepId(env, "model", data.messageIndex ?? "request"),
        kind: "model",
        agentStep: env.step,
        modelMessageIndex: data.messageIndex,
        eventSequence: env.sequence,
        title: scopedStepTitle(env, frontendMessage("workflow.feed.callingModel")),
        description: scopedStepDescription(env, modelName),
        status: "running",
        startedAt: env.timestamp,
        modelName,
        contextSnapshot: data.contextSnapshot,
        scope,
      });
      return true;
    }

    case EventKinds.ModelCompleted: {
      const data = env.data as ModelCompletedData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "model", data.messageIndex ?? "request"));
      if (step) {
        step.status = data.outcome === "failed" ? "failed" : data.outcome === "cancelled" ? "cancelled" : "done";
        step.modelUsage = data.usage;
        step.errorMessage = data.errorMessage;
        step.endedAt = env.timestamp;
        step.completedSequence = env.sequence;
        touchRun(run);
      }
      return true;
    }
    case EventKinds.ModelThinkingDelta: {
      if (env.scope?.role === "childAgent") {
        projectChildRunThinking(run, env, env.data as ModelThinkingDeltaData);
      }
      return true;
    }
    case EventKinds.ModelThinkingCompleted: {
      if (env.scope?.role === "childAgent") {
        projectChildRunThinking(run, env, env.data as ModelThinkingCompletedData);
      }
      return true;
    }
    case EventKinds.AssistantMessageCreated: {
      const data = env.data as AssistantMessageCreatedData;
      if (env.scope?.role === "childAgent" && env.scope.childRunId) {
        projectChildRunAssistantMessage(run, env, data);
        return true;
      }
      if (data.modelMessageIndex !== undefined) {
        run.activeModelRequest = {
          agentStep: env.step ?? 0,
          modelMessageIndex: data.modelMessageIndex,
          eventSequence: env.sequence,
        };
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
        agentStep: env.step,
        modelMessageIndex: data.modelMessageIndex,
        modelContentIndex: data.modelContentIndex,
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

function projectTodoState(
  state: Pick<TimelineChildRunTodo, "planObserved" | "counts">,
  items: readonly { content: string; status: string }[] | undefined,
  previousItems?: readonly TimelineChildRunTodoItem[],
): TimelineChildRunTodo {
  const projectedItems = items === undefined ? previousItems && [...previousItems] : (projectTodoItems(items) ?? []);
  return {
    ...state,
    ...(projectedItems ? { items: projectedItems } : {}),
  };
}

function projectTodoItems(
  items: readonly { content: string; status: string }[] | undefined,
): TimelineChildRunTodoItem[] | undefined {
  if (!items) return undefined;
  const projected = items.flatMap((item) => {
    const status = TimelineChildRunTodoStatusLookup[item.status];
    const content = item.content.trim();
    return status && content ? [{ content, status }] : [];
  });
  return projected.length > 0 ? projected : undefined;
}

function projectChildRunLifecycle(
  run: RunRecord,
  env: EventEnvelope,
  data: ChildRunLifecycleData,
  scope: TimelineStep["scope"],
): void {
  updateChildRunStep(run, env, data, scope);
  const step = run.steps.find((entry) => entry.id === childRunStepId(data.childRunId));
  if (step && step.childRun?.updatedSequence === env.sequence) {
    step.errorMessage = data.error;
    if (data.error) step.description = data.error;
    if (isTerminalChildRunStatus(data.status)) {
      step.endedAt = env.timestamp;
      step.completedSequence = env.sequence;
    }
    touchRun(run);
  }
}

function updateChildRunStep(
  run: RunRecord,
  env: EventEnvelope,
  data: Pick<
    ChildRunEventIdentityData,
    "childRunId" | "agentName" | "status" | "workItemId" | "taskDigest" | "taskLabel" | "startedAt" | "completedAt"
  >,
  scope: TimelineStep["scope"],
  statePatch: Partial<TimelineChildRunState> = {},
): void {
  const id = childRunStepId(data.childRunId);
  const current = run.steps.find((entry) => entry.id === id);
  const previous = current?.childRun;
  const updatedSequence = previous?.updatedSequence ?? current?.eventSequence;
  const older = updatedSequence !== undefined && env.sequence < updatedSequence;
  const preserveStatus =
    previous &&
    (older ||
      (isTerminalChildRunStatus(previous.status) &&
        !isTerminalChildRunStatus(data.status) &&
        env.kind !== EventKinds.ChildRunResumed));
  const status = preserveStatus ? previous.status : data.status;
  const patch: Partial<TimelineChildRunState> = {
    ...statePatch,
    ...(data.workItemId ? { workItemId: data.workItemId } : {}),
    ...(data.taskDigest ? { taskDigest: data.taskDigest } : {}),
    ...(data.taskLabel ? { taskLabel: data.taskLabel } : {}),
    ...(data.startedAt ? { startedAt: data.startedAt } : {}),
    ...(data.completedAt ? { completedAt: data.completedAt } : {}),
  };
  const childRun: TimelineChildRunState = {
    ...(older ? { ...patch, ...previous } : { ...previous, ...patch }),
    messages: current?.childRun?.messages ? [...current.childRun.messages] : [],
    id: data.childRunId,
    updatedSequence: Math.max(updatedSequence ?? env.sequence, env.sequence),
    status,
  };
  const terminal = isTerminalChildRunStatus(status);
  childRun.startedAt ??= current?.startedAt ?? env.timestamp;
  childRun.completedAt = terminal ? (childRun.completedAt ?? current?.endedAt ?? env.timestamp) : undefined;
  const stepScope = mergeChildRunStepScope(current?.scope, scope);
  upsertStep(run, {
    id,
    kind: "delegation",
    agentStep: scope?.parentAgentStep,
    modelMessageIndex: scope?.parentModelMessageIndex,
    modelContentIndex: scope?.parentModelContentIndex,
    title: childRunStatusTitle(status),
    description: childRunActivityDescription(childRun),
    status: childRunTimelineStatus(status),
    startedAt: current && Date.parse(current.startedAt) < Date.parse(env.timestamp) ? current.startedAt : env.timestamp,
    eventSequence: Math.min(current?.eventSequence ?? env.sequence, env.sequence),
    startedSequence: Math.min(current?.startedSequence ?? env.sequence, env.sequence),
    endedAt: terminal ? (current?.endedAt ?? env.timestamp) : undefined,
    completedSequence: terminal ? (current?.completedSequence ?? env.sequence) : undefined,
    scope: stepScope,
    childRun,
  });
}

function mergeChildRunStepScope(
  current: TimelineStep["scope"],
  incoming: TimelineStep["scope"],
): TimelineStep["scope"] {
  if (!current && !incoming) return undefined;
  return {
    ...current,
    ...incoming,
    parentAgentStep: incoming?.parentAgentStep ?? current?.parentAgentStep,
    parentModelMessageIndex: incoming?.parentModelMessageIndex ?? current?.parentModelMessageIndex,
    parentModelContentIndex: incoming?.parentModelContentIndex ?? current?.parentModelContentIndex,
    parentToolCallId: incoming?.parentToolCallId ?? current?.parentToolCallId,
  };
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
    ...(env.step === undefined ? {} : { agentStep: env.step }),
    ...(data.modelMessageIndex === undefined ? {} : { modelMessageIndex: data.modelMessageIndex }),
    ...(data.modelContentIndex === undefined ? {} : { modelContentIndex: data.modelContentIndex }),
    eventSequence: env.sequence,
  });
  step.description = childRunActivityDescription(step.childRun);
  touchRun(run);
  return true;
}

function projectChildRunThinking(
  run: RunRecord,
  env: EventEnvelope,
  data: ModelThinkingDeltaData | ModelThinkingCompletedData,
): void {
  const childRunId = env.scope?.childRunId;
  if (!childRunId) return;

  let step = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
  if (!step?.childRun) {
    updateChildRunStep(
      run,
      env,
      {
        childRunId,
        agentName: env.scope?.agentName ?? "",
        status: step?.childRun?.status ?? "running",
      },
      timelineScopeFromEvent(env),
    );
    step = run.steps.find((entry) => entry.id === childRunStepId(childRunId));
  }
  if (!step?.childRun) return;

  const childRun = step.childRun;
  const blocks = (childRun.thinkingBlocks ??= []);
  const block = findOrCreateModelThinkingBlock(blocks, {
    step: env.step ?? 0,
    messageIndex: data.messageIndex,
    contentIndex: data.contentIndex,
    eventSequence: env.sequence,
  });

  if ("delta" in data) {
    block.content += data.delta;
    block.status = "streaming";
  } else {
    block.content = data.content;
    block.status = data.status;
  }
  childRun.lastActivityAt = env.timestamp;
  childRun.lastModelOutputAt = env.timestamp;
  step.description = childRunActivityDescription(childRun);
  touchRun(run);
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

export function isChildRunEventKind(kind: EventEnvelope["kind"]): boolean {
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
