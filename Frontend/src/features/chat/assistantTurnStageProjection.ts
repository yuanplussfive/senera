import type { ChatMessage, ModelThinkingBlock, RunRecord, TimelineStep } from "../../store/sessionStore";
import { timelineToolExecutionKey } from "../../store/session/timelineProjection";
import type { AssistantTurnListItem } from "./assistantTurnProjection";

export interface AssistantTurnStage {
  id: string;
  kind: "execution" | "final";
  message?: ChatMessage;
  run?: RunRecord;
  current: boolean;
  transientContent?: string;
  transientKind?: "AssistantToolPreface" | "AssistantFinal" | "AssistantAsk";
  modelMessageIndex?: number;
  agentStep?: number;
  responseItems?: AssistantTurnResponseItem[];
  liveActivityItemId?: string;
}

interface AssistantTurnResponseItemOrder {
  id: string;
  modelContentIndex: number;
  eventSequence: number;
}

export type AssistantTurnResponseItem =
  | (AssistantTurnResponseItemOrder & { kind: "thinking"; blocks: ModelThinkingBlock[] })
  | (AssistantTurnResponseItemOrder & { kind: "message"; message: ChatMessage })
  | (AssistantTurnResponseItemOrder & { kind: "execution"; run: RunRecord });

interface StageBoundary {
  stepStart: number;
  stepEnd: number;
  startedAt?: string;
  endedAt?: string;
  identity?: string;
}

export function projectAssistantTurnStages(turn: AssistantTurnListItem): AssistantTurnStage[] {
  const responseStages = projectModelResponseStages(turn);
  if (responseStages) return responseStages;

  const run = turn.run;
  const messages = turn.messages;
  const prefaces = messages.filter((message) => message.kind === "AssistantToolPreface");
  const terminalMessages = messages.filter((message) => message.kind !== "AssistantToolPreface");
  const markerIndexes = readMessageStepIndexes(run, messages);
  const boundaries = readStageBoundaries(run, messages, markerIndexes);
  const stages: AssistantTurnStage[] = [];
  const executionBoundaries = new Map<string, StageBoundary>();

  if (run && !turn.streaming && messages.length === 0) {
    appendExecutionStages(stages, executionBoundaries, turn, run, {
      stepStart: 0,
      stepEnd: run.steps.length,
      startedAt: run.startedAt,
    });
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

  const leadingBoundary = messages.length > 0 ? readLeadingExecutionBoundary(run, messages, markerIndexes) : undefined;
  if (leadingBoundary) {
    appendExecutionStages(stages, executionBoundaries, turn, run, leadingBoundary);
  }

  for (const message of prefaces) {
    const boundary = boundaries.get(message.id) ?? emptyHistoricalBoundary(run, message.createdAt);
    appendExecutionStages(stages, executionBoundaries, turn, run, boundary, message);
  }

  for (const message of terminalMessages) {
    const markerIndex = markerIndexes.get(message.id);
    stages.push({
      id: readStageId(turn, { identity: readStepIdentity(run, markerIndex) }, `message:${message.id}`),
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
  const latestExecutionStage = [...stages].reverse().find((stage) => stage.kind === "execution");
  const fallbackActiveStage = [...stages].reverse().find((stage) => stage.kind === activeKind);
  let activeStage = hasTransientMessage
    ? undefined
    : run?.visibleKind === "tool_calls"
      ? latestExecutionStage
      : (displayedStage ?? fallbackActiveStage);
  if (!activeStage) {
    activeStage = {
      id: readStageId(turn, run ? currentStageBoundary(run) : undefined, "current"),
      kind: activeKind,
      current: false,
    };
    stages.push(activeStage);
  }

  stages.forEach((stage) => {
    stage.current = stage === activeStage;
  });

  if (run) {
    const boundary = executionBoundaries.get(activeStage.id) ?? currentStageBoundary(run);
    activeStage.run = projectStageRun(run, boundary, true);
  }

  return stages;
}

function projectModelResponseStages(turn: AssistantTurnListItem): AssistantTurnStage[] | undefined {
  const run = turn.run;
  if (
    !run ||
    (!run.steps.some((step) => step.modelMessageIndex !== undefined) &&
      !run.thinkingBlocks?.length &&
      !run.activeModelRequest)
  ) {
    return undefined;
  }
  if (
    run.steps.some(
      (step) =>
        isRootModelResponseStep(step) &&
        isStageExecutionStep(step) &&
        (step.agentStep === undefined || step.modelMessageIndex === undefined),
    )
  ) {
    return undefined;
  }

  const markerIndexes = readMessageStepIndexes(run, turn.messages);
  const messagesByResponse = new Map<string, ChatMessage[]>();
  const identities = new Map<string, ResponseIdentity>();
  const registerIdentity = (identity: ResponseIdentity): void => {
    const key = readResponseKey(identity.agentStep, identity.modelMessageIndex);
    const current = identities.get(key);
    identities.set(key, {
      ...identity,
      firstSequence: Math.min(current?.firstSequence ?? Number.MAX_SAFE_INTEGER, identity.firstSequence),
    });
  };
  for (const message of turn.messages) {
    const markerIndex = markerIndexes.get(message.id);
    const marker = markerIndex === undefined ? undefined : run.steps[markerIndex];
    const modelMessageIndex = marker?.modelMessageIndex;
    if (modelMessageIndex === undefined) return undefined;
    const agentStep = marker?.agentStep ?? 0;
    const key = readResponseKey(agentStep, modelMessageIndex);
    registerIdentity({ agentStep, modelMessageIndex, firstSequence: marker?.eventSequence ?? Number.MAX_SAFE_INTEGER });
    const responseMessages = messagesByResponse.get(key) ?? [];
    responseMessages.push(message);
    messagesByResponse.set(key, responseMessages);
  }

  for (const step of run.steps) {
    if (!isRootModelResponseStep(step) || step.modelMessageIndex === undefined) continue;
    registerIdentity({
      agentStep: step.agentStep ?? 0,
      modelMessageIndex: step.modelMessageIndex,
      firstSequence: step.startedSequence ?? step.eventSequence ?? Number.MAX_SAFE_INTEGER,
    });
  }
  for (const block of run.thinkingBlocks ?? []) {
    registerIdentity({
      agentStep: block.step,
      modelMessageIndex: block.messageIndex,
      firstSequence: block.eventSequence ?? Number.MAX_SAFE_INTEGER,
    });
  }
  if (run.activeModelRequest) {
    registerIdentity({
      agentStep: run.activeModelRequest.agentStep,
      modelMessageIndex: run.activeModelRequest.modelMessageIndex,
      firstSequence: run.activeModelRequest.eventSequence,
    });
  }

  const orderedResponses = [...identities.values()].sort(compareResponseIdentities);
  const activeResponse = run.activeModelRequest
    ? readResponseKey(run.activeModelRequest.agentStep, run.activeModelRequest.modelMessageIndex)
    : readResponseKey(orderedResponses.at(-1)?.agentStep ?? 0, orderedResponses.at(-1)?.modelMessageIndex ?? -1);

  const stages: AssistantTurnStage[] = orderedResponses.map(({ agentStep, modelMessageIndex }) => {
    const responseKey = readResponseKey(agentStep, modelMessageIndex);
    const responseMessages = messagesByResponse.get(responseKey) ?? [];
    const childRunIds = new Set(
      run.steps
        .filter(
          (step) =>
            step.kind === "delegation" &&
            step.childRun &&
            step.scope?.parentAgentStep === agentStep &&
            step.scope.parentModelMessageIndex === modelMessageIndex,
        )
        .map((step) => step.childRun!.id),
    );
    const responseSteps = run.steps
      .filter((step) => {
        const belongsToParentResponse =
          step.agentStep === agentStep && step.modelMessageIndex === modelMessageIndex && isRootModelResponseStep(step);
        const belongsToChildRun = step.scope?.childRunId && childRunIds.has(step.scope.childRunId);
        return isStageExecutionStep(step) && (belongsToParentResponse || belongsToChildRun);
      })
      .sort(compareResponseSteps);
    const blocks = [...(run.thinkingBlocks ?? [])]
      .filter((block) => block.step === agentStep && block.messageIndex === modelMessageIndex && block.content.trim())
      .sort((left, right) => left.contentIndex - right.contentIndex || left.id.localeCompare(right.id));
    const hasVisibleResponseContent = responseMessages.length > 0 || blocks.length > 0;
    const live = turn.streaming && responseKey === activeResponse;
    const responseItems = coalesceAdjacentThinkingItems(
      [
        ...blocks.map((block) => ({
          id: `thinking:${block.id}`,
          kind: "thinking" as const,
          modelContentIndex: block.contentIndex,
          eventSequence: block.eventSequence ?? Number.MAX_SAFE_INTEGER,
          blocks: [block],
        })),
        ...responseMessages.map((message) => {
          const markerIndex = markerIndexes.get(message.id);
          const marker = markerIndex === undefined ? undefined : run.steps[markerIndex];
          return {
            id: `message:${message.id}`,
            kind: "message" as const,
            modelContentIndex: marker?.modelContentIndex ?? Number.MAX_SAFE_INTEGER,
            eventSequence: marker?.eventSequence ?? Number.MAX_SAFE_INTEGER,
            message,
          };
        }),
        ...projectResponseExecutionItems(
          run,
          agentStep,
          modelMessageIndex,
          responseSteps,
          live,
          hasVisibleResponseContent,
        ),
      ].sort(compareResponseItems),
    );
    const message = responseMessages.at(-1);
    const execution = responseSteps.length > 0;
    const kind = message?.kind === "AssistantToolPreface" || (!message && execution) ? "execution" : "final";
    const stageRun =
      responseSteps.length > 0 || live
        ? projectModelResponseRun(run, agentStep, modelMessageIndex, responseSteps, live)
        : undefined;

    return {
      id: `stage:${turn.requestId ?? turn.key}:step:${agentStep}:model:${modelMessageIndex}`,
      kind,
      message,
      run: stageRun,
      current: live,
      modelMessageIndex,
      agentStep,
      responseItems,
    };
  });

  const activeIndex = stages.findIndex((stage) => stage.current);
  const activeStage = stages[activeIndex];
  if (activeStage?.responseItems?.length === 0) {
    const previousStage = [...stages.slice(0, activeIndex)]
      .reverse()
      .find((stage) => (stage.responseItems?.length ?? 0) > 0);
    const previousItem = previousStage?.responseItems?.at(-1);
    if (previousStage && previousItem) previousStage.liveActivityItemId = previousItem.id;
  }

  return stages;
}

interface ResponseIdentity {
  readonly agentStep: number;
  readonly modelMessageIndex: number;
  readonly firstSequence: number;
}

function readResponseKey(agentStep: number, modelMessageIndex: number): string {
  return `${agentStep}:${modelMessageIndex}`;
}

function compareResponseIdentities(left: ResponseIdentity, right: ResponseIdentity): number {
  return (
    left.agentStep - right.agentStep ||
    left.modelMessageIndex - right.modelMessageIndex ||
    left.firstSequence - right.firstSequence
  );
}

function compareResponseItems(left: AssistantTurnResponseItem, right: AssistantTurnResponseItem): number {
  const leftHasContentIndex = left.modelContentIndex !== Number.MAX_SAFE_INTEGER;
  const rightHasContentIndex = right.modelContentIndex !== Number.MAX_SAFE_INTEGER;
  if (leftHasContentIndex && rightHasContentIndex && left.modelContentIndex !== right.modelContentIndex) {
    return left.modelContentIndex - right.modelContentIndex;
  }
  return (
    left.eventSequence - right.eventSequence ||
    left.modelContentIndex - right.modelContentIndex ||
    left.id.localeCompare(right.id)
  );
}

function coalesceAdjacentThinkingItems(items: AssistantTurnResponseItem[]): AssistantTurnResponseItem[] {
  return items.reduce<AssistantTurnResponseItem[]>((ordered, item) => {
    const previous = ordered.at(-1);
    if (previous?.kind === "thinking" && item.kind === "thinking") {
      previous.blocks.push(...item.blocks);
      return ordered;
    }
    ordered.push(item);
    return ordered;
  }, []);
}

function projectResponseExecutionItems(
  run: RunRecord,
  agentStep: number,
  modelMessageIndex: number,
  steps: readonly TimelineStep[],
  live: boolean,
  hasVisibleResponseContent: boolean,
): AssistantTurnResponseItem[] {
  const parentSteps = steps.filter((step) => !step.scope?.childRunId || (step.kind === "delegation" && step.childRun));
  const childSteps = steps.filter((step) => Boolean(step.scope?.childRunId));
  const projected: AssistantTurnResponseItem[] = [];
  const consumed = new Set<string>();

  for (const delegation of parentSteps) {
    if (delegation.kind !== "delegation" || !delegation.childRun) continue;
    const scopedSteps = childSteps.filter(
      (step) => step.id !== delegation.id && step.scope?.childRunId === delegation.childRun?.id,
    );
    const relatedSteps = [delegation, ...scopedSteps];
    for (const step of relatedSteps) consumed.add(step.id);
    projected.push(
      createExecutionResponseItem(
        run,
        agentStep,
        modelMessageIndex,
        relatedSteps,
        live,
        delegation.modelContentIndex ?? delegation.scope?.parentModelContentIndex,
      ),
    );
  }

  const toolBatches = new Map<string, TimelineStep[]>();
  for (const step of parentSteps) {
    if (step.kind !== "tool" || !step.callId || !step.toolName) continue;
    const identity = timelineToolExecutionKey(step);
    const group = toolBatches.get(identity) ?? [];
    group.push(step);
    toolBatches.set(identity, group);
  }
  for (const batchSteps of toolBatches.values()) {
    for (const step of batchSteps) consumed.add(step.id);
    projected.push(createExecutionResponseItem(run, agentStep, modelMessageIndex, batchSteps, live));
  }

  for (const step of parentSteps) {
    if (consumed.has(step.id) || (step.kind === "tool" && !step.toolName)) continue;
    projected.push(createExecutionResponseItem(run, agentStep, modelMessageIndex, [step], live));
  }

  if (live && projected.length === 0 && !hasVisibleResponseContent && (run.liveActivity || steps.length > 0)) {
    projected.push(createExecutionResponseItem(run, agentStep, modelMessageIndex, [], live, Number.MAX_SAFE_INTEGER));
  }
  return projected;
}

function createExecutionResponseItem(
  run: RunRecord,
  agentStep: number,
  modelMessageIndex: number,
  steps: TimelineStep[],
  live: boolean,
  explicitContentIndex?: number,
): AssistantTurnResponseItem {
  const orderedSteps = [...steps].sort(compareResponseSteps);
  const contentIndex =
    explicitContentIndex ??
    orderedSteps.find((step) => step.modelContentIndex !== undefined)?.modelContentIndex ??
    Number.MAX_SAFE_INTEGER;
  const firstSequence = orderedSteps.reduce(
    (minimum, step) => Math.min(minimum, step.startedSequence ?? step.eventSequence ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
  const batchId = orderedSteps[0]?.toolBatch?.id;
  const sharesBatchIdentity = batchId && orderedSteps.every((step) => step.toolBatch?.id === batchId);
  const identity = sharesBatchIdentity
    ? `batch:${batchId}`
    : orderedSteps.map((step) => step.id).join("+") || "live-activity";
  return {
    id: `execution:${identity}`,
    kind: "execution",
    modelContentIndex: contentIndex,
    eventSequence: firstSequence,
    run: projectModelResponseRun(run, agentStep, modelMessageIndex, orderedSteps, live),
  };
}

function compareResponseSteps(left: TimelineStep, right: TimelineStep): number {
  const leftSequence = left.startedSequence ?? left.eventSequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.startedSequence ?? right.eventSequence ?? Number.MAX_SAFE_INTEGER;
  return (
    leftSequence - rightSequence ||
    (left.modelContentIndex ?? Number.MAX_SAFE_INTEGER) - (right.modelContentIndex ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
}

function projectModelResponseRun(
  run: RunRecord,
  agentStep: number,
  modelMessageIndex: number,
  steps: TimelineStep[],
  live: boolean,
): RunRecord {
  return {
    ...run,
    status: live ? run.status : historicalRunStatus(run.status),
    endedAt: live ? undefined : latestRecordEnd(steps, undefined),
    steps,
    activities: live ? run.activities : [],
    liveActivity: live ? run.liveActivity : undefined,
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    displayMessageId: undefined,
    visibleKind: "unknown",
    outputState: "pending",
    decisionMode: "none",
    plannedDecisionMode: undefined,
    activeModelRequest:
      live &&
      run.activeModelRequest?.agentStep === agentStep &&
      run.activeModelRequest.modelMessageIndex === modelMessageIndex
        ? run.activeModelRequest
        : undefined,
    thinkingBlocks: run.thinkingBlocks?.filter(
      (block) => block.step === agentStep && block.messageIndex === modelMessageIndex,
    ),
  };
}

function appendExecutionStages(
  stages: AssistantTurnStage[],
  executionBoundaries: Map<string, StageBoundary>,
  turn: AssistantTurnListItem,
  run: RunRecord | undefined,
  boundary: StageBoundary,
  message?: ChatMessage,
): void {
  const executionRun = projectStageRun(run, boundary, false);
  if (!message && !executionRun) return;
  const id = readStageId(turn, boundary, message ? `message:${message.id}` : "execution");
  stages.push({
    id,
    kind: "execution",
    message,
    run: executionRun,
    current: false,
  });
  executionBoundaries.set(id, boundary);
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
      identity: readStepIdentity(run, marker.index),
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

function readLeadingExecutionBoundary(
  run: RunRecord | undefined,
  messages: readonly ChatMessage[],
  markerIndexes: ReadonlyMap<string, number>,
): StageBoundary | undefined {
  if (!run) return undefined;

  const firstMarker = messages
    .map((message) => markerIndexes.get(message.id))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => left - right)[0];
  const stepEnd = firstMarker ?? run.steps.length;
  if (!run.steps.slice(0, stepEnd).some(isStageExecutionStep)) return undefined;

  return {
    stepStart: 0,
    stepEnd,
    startedAt: run.startedAt,
    endedAt: firstMarker === undefined ? undefined : run.steps[firstMarker]?.startedAt,
    identity: `leading:${readStepIdentity(run, firstMarker) ?? "start"}`,
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
    identity: readStepIdentity(run, markerIndex),
  };
}

function readStageId(
  turn: AssistantTurnListItem,
  boundary: Pick<StageBoundary, "identity"> | undefined,
  fallback: string,
): string {
  return `stage:${turn.requestId ?? turn.key}:${boundary?.identity ?? fallback}`;
}

function readStepIdentity(run: RunRecord | undefined, index: number | undefined): string | undefined {
  if (index === undefined || index < 0) return undefined;
  const step = run?.steps[index];
  return step ? `step:${step.id}` : undefined;
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

function isRootModelResponseStep(step: TimelineStep): boolean {
  return !step.scope?.parentRequestId && !step.scope?.childRunId;
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
