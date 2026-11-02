import {
  EventKinds,
  type EventEnvelope,
  type ExecutionResourceOutputData,
  type ExecutionResourceStateData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallOutputData,
  type ToolCallProgressData,
  type ToolCallResultDetailData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveBackendMessage } from "../../i18n/backendMessage";
import { upsertStep } from "./sessionProjectorCore";
import { isRunTerminal, touchRun } from "./sessionRunProjection";
import { summarizeToolPlan, toolPlanTitle } from "./sessionPresentation";
import {
  scopedStepDescription,
  scopedStepId,
  scopedStepTitle,
  timelineScopeFromEvent,
  toolBatchFromEvent,
  toolCallStepId,
} from "./timelineProjection";
import { mergeToolResultPresentation } from "./toolResultPresentation";
import { projectToolOutput, projectToolProgress } from "./toolRuntimeProjection";
import type { RunRecord, TimelineStep } from "./types";

type ToolCallEventHandler = (run: RunRecord, event: EventEnvelope) => void;

/** Live, scoped, and requested history events all enrich the same call record. */
export function projectToolCallEvent(run: RunRecord, event: EventEnvelope): boolean {
  const handler = toolCallEventHandlers[event.kind];
  if (!handler) return false;
  handler(run, event);
  return true;
}

export const toolCallEventHandlers: Partial<Record<EventEnvelope["kind"], ToolCallEventHandler>> = {
  [EventKinds.ToolCallsPlanned]: (run, event) => {
    const data = event.data as ToolCallsPlannedData;
    const scoped = Boolean(event.scope?.parentRequestId);
    if (!scoped && !isRunTerminal(run) && data.modelMessageIndex !== undefined) {
      run.activeModelRequest = {
        agentStep: event.step ?? 0,
        modelMessageIndex: data.modelMessageIndex,
        eventSequence: event.sequence,
      };
    }
    const toolBatch = toolBatchFromEvent(event, undefined, data.toolCount);
    upsertStep(run, {
      id: scoped ? scopedStepId(event, "tool-plan", toolBatch.id) : `${run.requestId}-tool-plan-${toolBatch.id}`,
      kind: "tool",
      agentStep: event.step,
      modelMessageIndex: data.modelMessageIndex,
      modelContentIndex: data.calls?.find((call) => call.modelContentIndex !== undefined)?.modelContentIndex,
      eventSequence: event.sequence,
      title: scopedStepTitle(event, toolPlanTitle(data)),
      description: scoped ? scopedStepDescription(event, summarizeToolPlan(data)) : summarizeToolPlan(data),
      status: "done",
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      toolBatch,
      scope: timelineScopeFromEvent(event),
    });
    for (const [index, call] of (data.calls ?? []).entries()) {
      const step = ensureToolStep(run, event, call);
      step.modelMessageIndex = data.modelMessageIndex ?? step.modelMessageIndex;
      step.toolBatch = { ...toolBatch, index, size: data.toolCount };
    }
    touchRun(run);
  },

  [EventKinds.ToolCallStarted]: (run, event) => {
    const data = event.data as ToolCallStartedData;
    const step = ensureToolStep(run, event, data);
    if (step.status === "pending") step.status = "running";
    if (data.startedAt !== undefined || step.startedSequence === undefined) {
      step.startedAt = data.startedAt ?? event.timestamp;
    }
    step.startedSequence ??= event.sequence;
    if (data.arguments !== undefined) step.toolArgs = data.arguments;
    touchRun(run);
  },

  [EventKinds.ToolCallCompleted]: (run, event) => {
    const data = event.data as ToolCallCompletedData;
    const step = ensureToolStep(run, event, data);
    // A host-confirmed failure cannot be overwritten by a late success notification.
    if (step.toolErrorMessage === undefined) {
      step.status = "done";
      mergeTerminalTiming(step, event, data);
    }
    step.toolPresentation = mergeToolResultPresentation(step.toolPresentation, data.presentation);
    step.toolPreview = step.toolPresentation?.headline ?? step.toolPreview;
    touchRun(run);
  },

  [EventKinds.ToolCallFailed]: (run, event) => {
    const data = event.data as ToolCallFailedData;
    const step = ensureToolStep(run, event, data);
    step.status = "failed";
    mergeTerminalTiming(step, event, data);
    step.toolErrorMessage = resolveBackendMessage(data) ?? data.message;
    touchRun(run);
  },

  [EventKinds.ToolCallResultDetail]: (run, event) => {
    const data = event.data as ToolCallResultDetailData;
    const step = ensureToolStep(run, event, data);
    step.toolResult = data.value;
    step.toolResultAvailability = "available";
    if (step.status === "pending") {
      step.status = "done";
      step.endedAt = event.timestamp;
      step.completedSequence = event.sequence;
    }
    step.toolPresentation = mergeToolResultPresentation(step.toolPresentation, data.presentation);
    step.toolPreview = step.toolPresentation?.headline ?? step.toolPreview;
    touchRun(run);
  },

  [EventKinds.ToolCallOutput]: (run, event) => {
    const data = event.data as ToolCallOutputData;
    projectToolOutput(ensureToolStep(run, event, data), data);
    touchRun(run);
  },

  [EventKinds.ToolCallProgress]: (run, event) => {
    const data = event.data as ToolCallProgressData;
    projectToolProgress(ensureToolStep(run, event, data), data);
    touchRun(run);
  },

  [EventKinds.ExecutionResourceOutput]: (run, event) => {
    const data = event.data as ExecutionResourceOutputData;
    const callId = data.toolCallId;
    if (!callId) return;
    const step = run.steps.find((candidate) => candidate.id === toolCallStepId(event, callId));
    if (!step) return;
    projectToolOutput(step, {
      toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
      callId,
      stream: data.stream,
      outputSequence: data.cursor,
      text: data.text,
      byteLength: data.byteLength,
      totalBytes: data.totalBytes,
      resourceId: data.resourceId,
    });
    touchRun(run);
  },

  [EventKinds.ExecutionResourceState]: (run, event) => {
    const data = event.data as ExecutionResourceStateData;
    const callId = data.toolCallId;
    if (!callId) return;
    const step = run.steps.find((candidate) => candidate.id === toolCallStepId(event, callId));
    if (!step) return;
    projectToolProgress(step, {
      toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
      callId,
      progressSequence: data.cursor,
      message: data.reason ? `${data.state}: ${data.reason}` : data.state,
      resourceId: data.resourceId,
    });
    touchRun(run);
  },
};

interface ToolCallMetadata {
  readonly callId: string;
  readonly toolName: string;
  readonly index?: number;
  readonly purpose?: string;
  readonly origin?: TimelineStep["toolOrigin"];
  readonly batchId?: string;
  readonly modelMessageIndex?: number;
  readonly modelContentIndex?: number;
}

function newToolStep(event: EventEnvelope, data: ToolCallMetadata): TimelineStep {
  return {
    id: toolCallStepId(event, data.callId),
    kind: "tool",
    agentStep: event.step,
    eventSequence: event.sequence,
    title: scopedStepTitle(event, frontendMessage("workflow.projection.toolCall", { toolName: data.toolName })),
    // A result payload alone does not prove whether execution succeeded or failed.
    status: "pending",
    startedAt: event.timestamp,
    toolName: data.toolName,
    callId: data.callId,
    toolBatch: toolBatchFromEvent(event, data),
    ...(data.purpose ? { purpose: data.purpose } : {}),
    ...(data.origin ? { toolOrigin: data.origin } : {}),
    ...(event.scope?.parentRequestId ? { scope: timelineScopeFromEvent(event) } : {}),
  };
}

function ensureToolStep(run: RunRecord, event: EventEnvelope, data: ToolCallMetadata): TimelineStep {
  const id = toolCallStepId(event, data.callId);
  const existing = run.steps.find((step) => step.id === id);
  if (existing) {
    mergeCallMetadata(existing, data);
    return existing;
  }
  const step = newToolStep(event, data);
  mergeCallMetadata(step, data);
  upsertStep(run, step);
  return step;
}

function mergeCallMetadata(step: TimelineStep, data: ToolCallMetadata): void {
  step.toolOrigin = data.origin ?? step.toolOrigin;
  if (data.purpose) step.purpose = data.purpose;
  step.modelMessageIndex = data.modelMessageIndex ?? step.modelMessageIndex;
  step.modelContentIndex = data.modelContentIndex ?? step.modelContentIndex;
  if (step.toolBatch) {
    step.toolBatch.id = data.batchId ?? step.toolBatch.id;
    step.toolBatch.index = data.index ?? step.toolBatch.index;
  }
}

function mergeTerminalTiming(
  step: TimelineStep,
  event: EventEnvelope,
  data: { readonly startedAt?: string; readonly durationMs?: number },
): void {
  step.completedSequence = event.sequence;
  step.endedAt = event.timestamp;
  if (data.startedAt !== undefined) step.startedAt = data.startedAt;
  if (data.durationMs !== undefined) step.durationMs = data.durationMs;
}
