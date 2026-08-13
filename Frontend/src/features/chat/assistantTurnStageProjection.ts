import type { ChatMessage, RunRecord, TimelineStep } from "../../store/sessionStore";
import type { AssistantTurnListItem } from "./assistantTurnProjection";

export interface AssistantTurnStage {
  id: string;
  kind: "execution" | "final";
  message?: ChatMessage;
  run?: RunRecord;
  current: boolean;
  transientContent?: string;
  transientKind?: "AssistantToolPreface" | "AssistantFinal" | "AssistantAsk";
}

interface StageBoundary {
  stepStart: number;
  stepEnd: number;
  startedAt?: string;
  endedAt?: string;
}

export function projectAssistantTurnStages(turn: AssistantTurnListItem): AssistantTurnStage[] {
  const run = turn.run;
  const messages = turn.messages;
  const prefaces = messages.filter((message) => message.kind === "AssistantToolPreface");
  const terminalMessages = messages.filter((message) => message.kind !== "AssistantToolPreface");
  const markerIndexes = readMessageStepIndexes(run, messages);
  const boundaries = readStageBoundaries(run, messages, markerIndexes);
  const stages: AssistantTurnStage[] = [];

  if (run && !turn.streaming && messages.length === 0) {
    const executionRun = projectStageRun(
      run,
      { stepStart: 0, stepEnd: run.steps.length, startedAt: run.startedAt },
      false,
    );
    if (executionRun) {
      stages.push({
        id: `stage:${turn.requestId ?? turn.key}:execution`,
        kind: "execution",
        run: executionRun,
        current: false,
      });
    }
    const output = readTerminalRunOutput(run);
    if (output) {
      stages.push({
        id: `stage:${turn.requestId ?? turn.key}:cancelled-output`,
        kind: "final",
        current: false,
        transientContent: output,
        transientKind: run.visibleKind === "ask_user" ? "AssistantAsk" : "AssistantFinal",
      });
    }
    return stages;
  }

  for (const message of prefaces) {
    const boundary = boundaries.get(message.id) ?? emptyHistoricalBoundary(run, message.createdAt);
    stages.push({
      id: `stage:${message.id}`,
      kind: "execution",
      message,
      run: projectStageRun(run, boundary, false),
      current: false,
    });
  }

  const firstTerminal = terminalMessages[0];
  if (prefaces.length === 0 && firstTerminal) {
    const terminalIndex = markerIndexes.get(firstTerminal.id) ?? run?.steps.length ?? 0;
    const boundary: StageBoundary = {
      stepStart: 0,
      stepEnd: terminalIndex,
      startedAt: run?.startedAt,
      endedAt: firstTerminal.createdAt,
    };
    const executionRun = projectStageRun(run, boundary, false);
    if (executionRun) {
      stages.push({
        id: `stage:${turn.requestId ?? turn.key}:execution`,
        kind: "execution",
        run: executionRun,
        current: false,
      });
    }
  }

  for (const message of terminalMessages) {
    stages.push({
      id: `stage:${message.id}`,
      kind: "final",
      message,
      run: undefined,
      current: false,
    });
  }

  if (!turn.streaming) return stages;

  const activeKind = run?.visibleKind === "final_answer" || run?.visibleKind === "ask_user" ? "final" : "execution";
  const displayedStage = run?.displayMessageId
    ? stages.find((stage) => stage.message?.id === run.displayMessageId)
    : undefined;
  const hasTransientMessage =
    !!run?.displayText &&
    (run.visibleKind === "tool_preface" || run.visibleKind === "final_answer" || run.visibleKind === "ask_user") &&
    !displayedStage;
  let activeStage = hasTransientMessage
    ? undefined
    : (displayedStage ?? [...stages].reverse().find((stage) => stage.kind === activeKind));
  if (!activeStage) {
    activeStage = {
      id: `stage:${turn.requestId ?? turn.key}:current`,
      kind: activeKind,
      current: false,
    };
    stages.push(activeStage);
  }

  stages.forEach((stage) => {
    stage.current = stage === activeStage;
  });

  if (run) {
    const boundary = activeStage.message
      ? (boundaries.get(activeStage.message.id) ?? emptyHistoricalBoundary(run, activeStage.message.createdAt))
      : currentStageBoundary(run);
    activeStage.run = projectStageRun(run, boundary, true);
  }

  return stages;
}

function readTerminalRunOutput(run: RunRecord): string {
  if (run.visibleKind !== "final_answer" && run.visibleKind !== "ask_user" && run.visibleKind !== "tool_preface") {
    return "";
  }
  return (run.visibleText || run.displayText || run.streamingRaw).trim();
}

function readStageBoundaries(
  run: RunRecord | undefined,
  messages: readonly ChatMessage[],
  markerIndexes: ReadonlyMap<string, number>,
): Map<string, StageBoundary> {
  const result = new Map<string, StageBoundary>();
  if (!run) return result;

  const markers = messages.map((message) => ({ message, index: markerIndexes.get(message.id) }));
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    if (marker.index === undefined) continue;
    const nextMarker = markers.slice(index + 1).find((candidate) => candidate.index !== undefined);
    result.set(marker.message.id, {
      stepStart: marker.index + 1,
      stepEnd: nextMarker?.index ?? run.steps.length,
      startedAt: marker.message.createdAt,
      endedAt: nextMarker?.message.createdAt,
    });
  }

  return result;
}

function readMessageStepIndexes(run: RunRecord | undefined, messages: readonly ChatMessage[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!run) return result;

  let searchStart = 0;
  for (const message of messages) {
    const exactId = `${run.requestId}-assistant-message-${message.id}`;
    const exactIndex = run.steps.findIndex((step, index) => index >= searchStart && step.id === exactId);
    const index = exactIndex >= 0 ? exactIndex : findCompatibleMarkerIndex(run, message, searchStart);
    if (index === undefined) continue;
    result.set(message.id, index);
    searchStart = index + 1;
  }
  return result;
}

function findCompatibleMarkerIndex(run: RunRecord, message: ChatMessage, searchStart: number): number | undefined {
  const expectedKind = message.kind === "AssistantToolPreface" ? "decision" : "answer";
  const candidates = run.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => index >= searchStart && step.kind === expectedKind)
    .filter(({ step }) => message.kind !== "AssistantFinal" || step.decisionKind !== "ask_user")
    .filter(({ step }) => message.kind !== "AssistantAsk" || step.decisionKind === "ask_user");
  if (candidates.length === 0) return undefined;

  const messageTime = Date.parse(message.createdAt);
  if (!Number.isFinite(messageTime)) return candidates[0]?.index;
  return candidates.reduce((best, candidate) => {
    const bestTime = Date.parse(best.step.startedAt);
    const candidateTime = Date.parse(candidate.step.startedAt);
    if (!Number.isFinite(bestTime)) return candidate;
    if (!Number.isFinite(candidateTime)) return best;
    return Math.abs(candidateTime - messageTime) < Math.abs(bestTime - messageTime) ? candidate : best;
  }).index;
}

function emptyHistoricalBoundary(run: RunRecord | undefined, startedAt?: string): StageBoundary {
  const boundary = run?.steps.length ?? 0;
  return {
    stepStart: boundary,
    stepEnd: boundary,
    startedAt,
    endedAt: startedAt,
  };
}

function currentStageBoundary(run: RunRecord): StageBoundary {
  const displayMarkerId = run.displayMessageId
    ? `${run.requestId}-assistant-message-${run.displayMessageId}`
    : undefined;
  let markerIndex = displayMarkerId ? run.steps.findIndex((step) => step.id === displayMarkerId) : -1;
  if (markerIndex < 0) {
    const expectedKind = run.visibleKind === "final_answer" || run.visibleKind === "ask_user" ? "answer" : "decision";
    for (let index = run.steps.length - 1; index >= 0; index -= 1) {
      if (run.steps[index]?.kind === expectedKind) {
        markerIndex = index;
        break;
      }
    }
  }
  const stepStart = markerIndex >= 0 ? markerIndex + 1 : 0;
  return {
    stepStart,
    stepEnd: run.steps.length,
    startedAt: markerIndex >= 0 ? run.steps[markerIndex]?.startedAt : run.startedAt,
  };
}

function projectStageRun(run: RunRecord | undefined, boundary: StageBoundary, live: boolean): RunRecord | undefined {
  if (!run) return undefined;
  const stageEndedAt = live ? undefined : (boundary.endedAt ?? run.endedAt);
  const stageSettled = !live && (stageEndedAt !== undefined || !isLiveRunStatus(run.status));
  const steps = run.steps
    .slice(boundary.stepStart, boundary.stepEnd)
    .filter(isStageExecutionStep)
    .map((step) => (stageSettled ? settleHistoricalRecord(step, stageEndedAt, run.status) : step));
  const activities = run.activities
    ?.filter(
      (activity) =>
        isInStageWindow(activity.startedAt, boundary.startedAt, boundary.endedAt) ||
        (live && activity.status === "running" && activity.activity === run.liveActivity),
    )
    .map((activity) => (stageSettled ? settleHistoricalRecord(activity, stageEndedAt, run.status) : activity));
  if (!live && steps.length === 0 && (!activities || activities.length === 0)) return undefined;

  return {
    ...run,
    status: live ? run.status : historicalRunStatus(run.status),
    // Stage slices share the request clock. A phase boundary scopes content, not elapsed time.
    startedAt: run.startedAt,
    endedAt: live ? undefined : (stageEndedAt ?? latestRecordEnd(steps, activities)),
    steps,
    activities,
    liveActivity: live ? run.liveActivity : undefined,
    approvals: live ? run.approvals : [],
    interactionInputs: live ? run.interactionInputs : [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    displayMessageId: undefined,
    visibleKind: "unknown",
    outputState: "pending",
    decisionMode: "none",
    plannedDecisionMode: undefined,
  };
}

function settleHistoricalRecord<
  TRecord extends { status: TimelineStep["status"]; startedAt: string; endedAt?: string; durationMs?: number },
>(record: TRecord, stageEndedAt?: string, runStatus: RunRecord["status"] = "completed"): TRecord {
  if (record.status === "done" || record.status === "failed") return record;
  const endedAt = record.endedAt ?? stageEndedAt ?? record.startedAt;
  const started = Date.parse(record.startedAt);
  const ended = Date.parse(endedAt);
  return {
    ...record,
    status: stageEndedAt !== undefined || runStatus === "completed" ? "done" : "failed",
    endedAt,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : record.durationMs,
  };
}

function historicalRunStatus(status: RunRecord["status"]): RunRecord["status"] {
  if (status === "failed" || status === "cancelled") return status;
  return "completed";
}

function isLiveRunStatus(status: RunRecord["status"]): boolean {
  return status === "running" || status === "cancelling";
}

function latestRecordEnd(
  steps: readonly TimelineStep[],
  activities: NonNullable<RunRecord["activities"]> | undefined,
): string | undefined {
  return [...steps, ...(activities ?? [])]
    .map((record) => record.endedAt)
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
}

function isStageExecutionStep(step: TimelineStep): boolean {
  return step.kind === "tool" || step.kind === "delegation" || step.kind === "retry" || step.kind === "error";
}

function isInStageWindow(value: string, startedAt?: string, endedAt?: string): boolean {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const start = startedAt ? Date.parse(startedAt) : Number.NEGATIVE_INFINITY;
  const end = endedAt ? Date.parse(endedAt) : Number.POSITIVE_INFINITY;
  return (
    time >= (Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY) &&
    time < (Number.isFinite(end) ? end : Number.POSITIVE_INFINITY)
  );
}
