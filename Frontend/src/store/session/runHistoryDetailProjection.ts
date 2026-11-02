import {
  EventKinds,
  type EventEnvelope,
  type ModelCompletedData,
  type ModelStartedData,
  type RunCompletedData,
  type RunFailedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { upsertStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import { projectRunEvent } from "./runEventProjector";
import { projectToolCallEvent } from "./toolCallProjection";
import { applyScopedRunEvent, isChildRunEventKind } from "./scopedRunProjector";
import { projectRunFailureStep, settleRunExecution } from "./runLifecycleProjector";
import type { RunRecord, StoreState } from "./types";
import { scopedStepId, timelineScopeFromEvent } from "./timelineProjection";
import { projectContextBoundary } from "./contextBoundaryProjection";

/**
 * Applies only immutable diagnostic enrichment from an explicitly requested
 * historical run. Lifecycle events are intentionally absent here: a completed
 * run must never become active again merely because somebody opened it.
 */
export function projectRunHistoryDetail(run: RunRecord, events: readonly EventEnvelope[]): boolean {
  let changed = false;
  for (const event of events) {
    if ((event.scope?.parentRequestId ?? event.requestId) !== run.requestId) continue;
    changed = projectToolCallEvent(run, event) || changed;
  }
  return changed;
}

/** Compact analytics and full history share model identity, timing and metering projection. */
export function projectRunHistoryModelObservations(run: RunRecord, events: readonly EventEnvelope[]): void {
  for (const event of events) {
    if ((event.scope?.parentRequestId ?? event.requestId) !== run.requestId) continue;
    if (event.kind === EventKinds.ModelStarted) projectHistoryModelStarted(run, event);
    else if (event.kind === EventKinds.SessionCompacted) projectContextBoundary(run, event);
    else if (event.kind === EventKinds.ModelCompleted) projectHistoryModelCompleted(run, event);
    else if (event.kind === EventKinds.RunCompleted && !event.scope?.parentRequestId)
      projectHistoryRunCompleted(run, event);
  }
}

/**
 * The terminal marker means the server has exhausted this run's persisted
 * event stream. It must be applied after lifecycle diagnostics: a failed run
 * settles a previously-running tool, which then becomes eligible for a
 * truthful "result was not retained" marker.
 */
export function finalizeRunHistoryDetail(run: RunRecord): boolean {
  if (run.status === "running" || run.status === "cancelling") return false;
  const terminalStatus = { completed: "done", failed: "failed", cancelled: "cancelled" } as const;
  settleRunExecution(run, terminalStatus[run.status], run.endedAt ?? run.startedAt);
  markUnavailableHistoricalToolResults(run);
  touchRun(run);
  return true;
}

/**
 * Step traces deliberately omit prompt and memory diagnostics. Reapply only
 * the compact diagnostics and persisted child activity when a terminal run is
 * opened. Parent lifecycle events stay excluded so its run cannot be revived.
 */
export function projectRunHistoryDiagnostics(
  state: StoreState,
  run: RunRecord,
  events: readonly EventEnvelope[],
): boolean {
  let changed = false;
  for (const event of events) {
    if ((event.scope?.parentRequestId ?? event.requestId) !== run.requestId) continue;
    if (event.kind === EventKinds.SessionCompacted) {
      changed = projectContextBoundary(run, event) || changed;
      continue;
    }
    if (event.kind === EventKinds.ModelStarted) {
      changed = projectHistoryModelStarted(run, event) || changed;
      continue;
    }
    if (event.kind === EventKinds.ModelCompleted) {
      changed = projectHistoryModelCompleted(run, event) || changed;
      continue;
    }
    if (event.scope?.parentRequestId) {
      if (
        isChildRunEventKind(event.kind) ||
        HistoryDiagnosticEventKinds.has(event.kind) ||
        event.kind === EventKinds.AssistantMessageCreated ||
        event.kind === EventKinds.RunFailed
      ) {
        changed = applyScopedRunEvent(state, event) || changed;
      }
      continue;
    }
    if (event.kind === EventKinds.RunFailed) {
      projectRunFailureStep(run, event, event.data as RunFailedData);
      changed = true;
      continue;
    }
    if (event.kind === EventKinds.RunCompleted) {
      changed = projectHistoryRunCompleted(run, event) || changed;
      continue;
    }
    if (!HistoryDiagnosticEventKinds.has(event.kind)) continue;
    const revision = run.revision;
    projectRunEvent(state, event);
    changed = run.revision !== revision || changed;
  }
  return changed;
}

const HistoryDiagnosticEventKinds = new Set<EventEnvelope["kind"]>([
  EventKinds.ContinuitySnapshot,
  EventKinds.ContinuityRecallQuery,
  EventKinds.ContinuityRecallSettled,
  EventKinds.PromptSummary,
  EventKinds.PromptHarnessComposed,
  EventKinds.TodoListWritten,
  EventKinds.ModelThinkingCompleted,
  EventKinds.ApprovalRequested,
  EventKinds.ApprovalResolved,
  EventKinds.InteractionInputRequested,
  EventKinds.InteractionInputResolved,
  EventKinds.RunCancellationProgress,
]);

function projectHistoryModelStarted(run: RunRecord, event: EventEnvelope): boolean {
  const data = event.data as ModelStartedData;
  const modelName = data.provider?.model ?? data.model;
  const id = historyModelStepId(event, data.messageIndex);
  const existing = run.steps.find((step) => step.id === id);
  if (existing) {
    let changed = false;
    if (data.contextSnapshot && !existing.contextSnapshot) {
      existing.contextSnapshot = data.contextSnapshot;
      changed = true;
    }
    if (existing.modelName !== modelName) {
      existing.modelName = modelName;
      changed = true;
    }
    if (!event.scope?.parentRequestId && data.provider && run.modelProvider !== data.provider) {
      run.modelProvider = data.provider;
      changed = true;
    }
    if (changed) touchRun(run);
    return changed;
  }

  if (!event.scope?.parentRequestId && data.provider) run.modelProvider = data.provider;
  upsertStep(run, {
    id,
    kind: "model",
    agentStep: event.step,
    modelMessageIndex: data.messageIndex,
    eventSequence: event.sequence,
    title: frontendMessage("workflow.feed.callingModel"),
    description: frontendMessage("workflow.projection.stepIndex", { step: event.step ?? 0 }),
    status: "done",
    startedAt: event.timestamp,
    modelName,
    contextSnapshot: data.contextSnapshot,
    scope: timelineScopeFromEvent(event),
  });
  return true;
}

function projectHistoryModelCompleted(run: RunRecord, event: EventEnvelope): boolean {
  const data = event.data as ModelCompletedData;
  const status = data.outcome === "failed" ? "failed" : data.outcome === "cancelled" ? "cancelled" : "done";
  const id = historyModelStepId(event, data.messageIndex);
  const existing = run.steps.find((step) => step.id === id);
  let changed = false;
  if (!event.scope?.parentRequestId && data.provider && run.modelProvider !== data.provider) {
    run.modelProvider = data.provider;
    changed = true;
  }
  if (existing && data.usage !== undefined && existing.modelUsage !== data.usage) {
    existing.modelUsage = data.usage;
    changed = true;
  }
  if (existing) {
    if (data.responseModel !== undefined && existing.responseModel !== data.responseModel) {
      existing.responseModel = data.responseModel;
      changed = true;
    }
    if (data.errorMessage && existing.errorMessage !== data.errorMessage) {
      existing.errorMessage = data.errorMessage;
      changed = true;
    }
    if (existing.status !== status || existing.endedAt !== event.timestamp) {
      existing.status = status;
      existing.endedAt = event.timestamp;
      existing.completedSequence = event.sequence;
      changed = true;
    }
    if (changed) touchRun(run);
    return changed;
  }

  upsertStep(run, {
    id,
    kind: "model",
    agentStep: event.step,
    modelMessageIndex: data.messageIndex,
    eventSequence: event.sequence,
    completedSequence: event.sequence,
    title: frontendMessage("workflow.feed.callingModel"),
    description: frontendMessage("workflow.projection.stepIndex", { step: event.step ?? 0 }),
    status,
    startedAt: event.timestamp,
    endedAt: event.timestamp,
    modelName: data.provider?.model,
    modelUsage: data.usage,
    responseModel: data.responseModel,
    errorMessage: data.errorMessage,
    scope: timelineScopeFromEvent(event),
  });
  return true;
}

function projectHistoryRunCompleted(run: RunRecord, event: EventEnvelope): boolean {
  const data = event.data as RunCompletedData;
  if (data.usage === undefined || run.usage === data.usage) return false;
  run.usage = data.usage;
  touchRun(run);
  return true;
}

function historyModelStepId(event: EventEnvelope, messageIndex: number | undefined): string {
  return event.scope?.parentRequestId
    ? scopedStepId(event, "model", messageIndex ?? "request")
    : `${event.requestId}-model-${event.step ?? 0}-${messageIndex ?? "request"}`;
}

function markUnavailableHistoricalToolResults(run: RunRecord): void {
  for (const step of run.steps) {
    if (
      step.kind !== "tool" ||
      !step.callId ||
      step.toolResultAvailability === "available" ||
      step.toolResult !== undefined ||
      step.toolPresentation?.artifactUri
    )
      continue;
    step.toolResultAvailability = "unavailable";
  }
}
