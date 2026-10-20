import { EventKinds, RunActivitySpecs, type RunActivity } from "../../api/generatedEventCatalog";
import { RuntimeDiagnosticSpecs, type EventDiagnosticSpec } from "../../api/generatedRuntimeDiagnosticCatalog";
import type { EventJournalRecord } from "./eventJournalStore";
import { readJsonPointer } from "./eventJournalProjection";
import { readEventTitle } from "./eventPresentation";
import type { ToolEventOrigin } from "../../api/eventTypes";
import type {
  ModelThinkingBlock,
  RunRecord,
  SessionRuntimeSnapshot,
  TimelineStep,
  TimelineStepKind,
} from "../../store/sessionStore";
import { assistantTerminalStepKey, isAssistantMessageStep } from "../../store/session/timelineProjection";

export const RuntimeDiagnosticLanes = {
  Context: "context",
  Runtime: "runtime",
  Model: "model",
  Tools: "tools",
  Response: "response",
} as const;

export type RuntimeDiagnosticLane = (typeof RuntimeDiagnosticLanes)[keyof typeof RuntimeDiagnosticLanes];

export const RuntimeDiagnosticLaneOrder: readonly RuntimeDiagnosticLane[] = [
  RuntimeDiagnosticLanes.Context,
  RuntimeDiagnosticLanes.Runtime,
  RuntimeDiagnosticLanes.Model,
  RuntimeDiagnosticLanes.Tools,
  RuntimeDiagnosticLanes.Response,
];

export type RuntimeDiagnosticSpanStatus = "running" | "completed" | "failed" | "cancelled";
export type RuntimeDiagnosticSpanSource = "activity" | "tool" | "step";

export interface RuntimeDiagnosticSpan {
  readonly id: string;
  readonly source: RuntimeDiagnosticSpanSource;
  readonly lane: RuntimeDiagnosticLane;
  readonly kind?: TimelineStepKind;
  /** Original journal kind when the span comes from the session-wide event stream. */
  readonly eventKind?: string;
  /** Source-local sequence retained for diagnostics; it is not a global timeline clock. */
  readonly eventSequence?: number;
  readonly description?: string;
  readonly purpose?: string;
  readonly isThinking?: boolean;
  readonly status: RuntimeDiagnosticSpanStatus;
  readonly operation?: RunActivity;
  readonly label?: string;
  readonly modelName?: string;
  readonly toolName?: string;
  readonly toolOrigin?: ToolEventOrigin;
  readonly toolArguments?: unknown;
  readonly toolResult?: unknown;
  readonly toolPresentation?: import("../../api/eventTypes").ToolResultPresentation;
  readonly toolPreview?: string;
  readonly toolErrorMessage?: string;
  readonly callId?: string;
  readonly requestId: string;
  readonly step?: number;
  readonly startedAt: string;
  readonly startedAtEpoch: number;
  readonly endedAtEpoch?: number;
  readonly durationMs?: number;
  readonly track?: number;
}

export interface RuntimeDiagnosticLaneModel {
  readonly lane: RuntimeDiagnosticLane;
  readonly spans: readonly RuntimeDiagnosticSpan[];
  readonly trackCount: number;
}

export interface RuntimeDiagnosticModel {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly spans: readonly RuntimeDiagnosticSpan[];
  readonly lanes: readonly RuntimeDiagnosticLaneModel[];
  readonly startedAtEpoch?: number;
  readonly endAtEpoch?: number;
  readonly nowEpoch: number;
  readonly current?: RuntimeDiagnosticSpan;
  readonly connection: RuntimeDiagnosticHealth;
  readonly contextUsage?: RuntimeContextUsage;
  readonly sessionUsage?: RuntimeSessionUsage;
}

export interface RuntimeContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
}

export interface RuntimeSessionUsage {
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly totalMessages: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost: number;
}

export interface RuntimeUsageSnapshot {
  readonly contextUsage?: RuntimeContextUsage;
  readonly sessionUsage?: RuntimeSessionUsage;
}

export function projectRuntimeUsageFromSessionSnapshot(
  snapshot: SessionRuntimeSnapshot | undefined,
): RuntimeUsageSnapshot {
  const runtime = snapshot?.runtime;
  if (!runtime) return {};

  return {
    contextUsage: readContextUsageValue(runtime.contextUsage),
    sessionUsage: readSessionUsageValue(runtime.stats),
  };
}

export function mergeRuntimeUsageSnapshots(
  current: RuntimeUsageSnapshot,
  retained: RuntimeUsageSnapshot,
): RuntimeUsageSnapshot {
  const currentContext = current.contextUsage;
  const retainedContext = retained.contextUsage;
  const contextUsage =
    retainedContext &&
    (!currentContext ||
      (currentContext.tokens === null &&
        currentContext.percent === null &&
        currentContext.contextWindow === retainedContext.contextWindow))
      ? retainedContext
      : currentContext;
  const sessionUsage = current.sessionUsage ?? retained.sessionUsage;

  return {
    ...(contextUsage ? { contextUsage } : {}),
    ...(sessionUsage ? { sessionUsage } : {}),
  };
}

export type RuntimeDiagnosticHealth = "healthy" | "active" | "failed" | "cancelled" | "unknown";

const LaneByActivityCategory = {
  context: RuntimeDiagnosticLanes.Context,
  runtime: RuntimeDiagnosticLanes.Runtime,
  model: RuntimeDiagnosticLanes.Model,
  output: RuntimeDiagnosticLanes.Response,
} as const;

type DiagnosticLifecycleState = "started" | "completed" | "failed";

interface DiagnosticSpanCandidate {
  readonly identity: string;
  readonly source: RuntimeDiagnosticSpanSource;
  readonly label: string;
  readonly eventSequence?: number;
  readonly toolOrigin?: ToolEventOrigin;
  readonly toolArguments?: unknown;
  readonly state: DiagnosticLifecycleState;
  readonly requestId: string;
  readonly step?: number;
  readonly startedAt: string;
  readonly startedAtEpoch: number;
  readonly endedAtEpoch?: number;
  readonly durationMs?: number;
}

export function projectRuntimeDiagnostic(
  records: readonly EventJournalRecord[],
  options: {
    readonly nowEpoch?: number;
    readonly pausedAt?: number;
    readonly activeSessionId?: string | null;
    readonly requestId?: string;
  } = {},
): RuntimeDiagnosticModel {
  const nowEpoch = options.nowEpoch ?? Date.now();
  const visibleRecords = records.filter(
    (record) => options.pausedAt === undefined || record.localSequence <= options.pausedAt,
  );
  const sessionRecords = options.activeSessionId
    ? visibleRecords.filter((record) => record.sessionId === options.activeSessionId)
    : visibleRecords;
  const requestId = options.requestId ?? readLatestRequestId(sessionRecords);
  const scopedRecords = requestId ? sessionRecords.filter((record) => record.requestId === requestId) : [];
  const spans = projectSpans(scopedRecords, requestId);
  const sortedSpans = [...spans.values()].sort(compareSpans);
  const lanes = RuntimeDiagnosticLaneOrder.map((lane) =>
    projectLane(
      lane,
      sortedSpans.filter((span) => span.lane === lane),
      nowEpoch,
    ),
  );
  const laidOutSpans = lanes.flatMap((lane) => lane.spans).sort(compareSpans);
  const startedAtEpoch =
    laidOutSpans.length > 0 ? Math.min(...laidOutSpans.map((span) => span.startedAtEpoch)) : undefined;
  const endAtEpoch =
    laidOutSpans.length > 0
      ? Math.max(
          ...laidOutSpans.map((span) =>
            span.status === "running" ? nowEpoch : spanEndEpoch(span, span.startedAtEpoch),
          ),
        )
      : undefined;

  return {
    requestId,
    sessionId: options.activeSessionId ?? scopedRecords.find((record) => record.sessionId)?.sessionId,
    spans: laidOutSpans,
    lanes,
    startedAtEpoch,
    endAtEpoch,
    nowEpoch,
    current: readCurrentSpan(laidOutSpans),
    connection: readConnectionHealth(visibleRecords),
    contextUsage: readLatestContextUsage(sessionRecords),
    sessionUsage: readLatestSessionUsage(sessionRecords),
  };
}

/**
 * Rebuilds the same console model from the durable session run projection.
 * The transport journal is intentionally short-lived; historical runs must
 * remain inspectable after the journal has rotated or the page has refreshed.
 */
export function projectRuntimeDiagnosticFromRun(
  run: RunRecord,
  options: {
    readonly nowEpoch?: number;
    readonly sessionUsage?: RuntimeSessionUsage;
    readonly contextUsage?: RuntimeContextUsage;
  } = {},
): RuntimeDiagnosticModel {
  const nowEpoch = options.nowEpoch ?? Date.now();
  const candidates = projectRunSpans(run).map((span) => normalizeRunSpanStatus(span, run));
  const sortedSpans = candidates.sort(compareSpans);
  const lanes = RuntimeDiagnosticLaneOrder.map((lane) =>
    projectLane(
      lane,
      sortedSpans.filter((span) => span.lane === lane),
      nowEpoch,
    ),
  );
  const laidOutSpans = lanes.flatMap((lane) => lane.spans).sort(compareSpans);
  const startedAtEpoch =
    laidOutSpans.length > 0 ? Math.min(...laidOutSpans.map((span) => span.startedAtEpoch)) : undefined;
  const endAtEpoch =
    laidOutSpans.length > 0
      ? Math.max(
          ...laidOutSpans.map((span) =>
            span.status === "running" ? nowEpoch : spanEndEpoch(span, span.startedAtEpoch),
          ),
        )
      : undefined;

  return {
    requestId: run.requestId,
    spans: laidOutSpans,
    lanes,
    startedAtEpoch,
    endAtEpoch,
    nowEpoch,
    current: readCurrentSpan(laidOutSpans),
    connection:
      run.status === "failed"
        ? "failed"
        : run.status === "cancelled"
          ? "cancelled"
          : run.status === "running" || run.status === "cancelling"
            ? "active"
            : "healthy",
    contextUsage: options.contextUsage,
    sessionUsage: options.sessionUsage,
  };
}

/**
 * Projects the complete session trajectory. Durable run steps provide the
 * user/model/tool stream, while the journal contributes prompt, continuity,
 * orchestration and learning-side events that are not run steps themselves.
 */
export function projectRuntimeConversationSpans(
  records: readonly EventJournalRecord[],
  runs: readonly RunRecord[],
  options: {
    readonly pausedAt?: number;
    readonly activeSessionId?: string | null;
  } = {},
): readonly RuntimeDiagnosticSpan[] {
  const visibleRecords = records.filter(
    (record) => options.pausedAt === undefined || record.localSequence <= options.pausedAt,
  );
  const sessionRecords = options.activeSessionId
    ? visibleRecords.filter((record) => record.sessionId === options.activeSessionId)
    : visibleRecords;
  // `runs` already comes from the active session store. Do not intersect it
  // with the bounded journal: the journal can rotate before a durable run is
  // rendered, which would silently remove that run from the conversation trail.
  const sessionRuns = runs;
  const runSpans = sessionRuns.flatMap((run) => projectRunSpans(run).map((span) => normalizeRunSpanStatus(span, run)));
  const journalSpans = sessionRecords
    .filter(shouldIncludeConversationRecord)
    .map(spanFromConversationRecord)
    .filter((span): span is RuntimeDiagnosticSpan => span !== undefined);
  return [...runSpans, ...journalSpans].sort(compareSpans);
}

const ConversationNoiseKinds: ReadonlySet<string> = new Set([
  EventKinds.SessionSnapshot,
  EventKinds.SessionRuntimeStatus,
  EventKinds.RunStarted,
  EventKinds.RunActivityChanged,
  EventKinds.RunCompleted,
  EventKinds.ModelDelta,
  EventKinds.ModelThinkingDelta,
  EventKinds.ModelThinkingCompleted,
  EventKinds.ToolCallOutput,
  EventKinds.ToolCallProgress,
  EventKinds.ToolCallResultDetail,
]);

const RunBackedConversationKinds: ReadonlySet<string> = new Set([
  EventKinds.ModelStarted,
  EventKinds.ModelCompleted,
  EventKinds.ToolCallsPlanned,
  EventKinds.ToolCallStarted,
  EventKinds.ToolCallCompleted,
  EventKinds.ToolCallFailed,
  EventKinds.AssistantMessageCreated,
]);

function shouldIncludeConversationRecord(record: EventJournalRecord): boolean {
  if (record.stage !== "projected" || ConversationNoiseKinds.has(record.kind)) return false;
  // The durable run projection owns model/tool/message lifecycles. Keeping
  // their journal echoes here would render a second copy of the same event.
  if (RunBackedConversationKinds.has(record.kind)) return false;
  if (record.summary) return true;
  return record.phase === "prompt" || record.phase === "run" || record.phase === "orchestration";
}

function spanFromConversationRecord(record: EventJournalRecord): RuntimeDiagnosticSpan | undefined {
  const startedAtEpoch = record.observedAtEpoch;
  if (!Number.isFinite(startedAtEpoch)) return undefined;
  const requestId = record.requestId ?? `session:${record.sessionId ?? "unknown"}`;
  const status = conversationRecordStatus(record);
  return {
    id: `journal:${record.id}`,
    source: "step",
    lane: conversationRecordLane(record),
    kind: conversationRecordStepKind(record.kind),
    eventKind: record.kind,
    eventSequence: record.sequence ?? record.localSequence,
    label: readEventTitle(record),
    description: conversationRecordDescription(record),
    requestId,
    startedAt: record.observedAt,
    startedAtEpoch,
    ...(status === "running" ? {} : { endedAtEpoch: startedAtEpoch, durationMs: 0 }),
    status,
  };
}

function conversationRecordStatus(record: EventJournalRecord): RuntimeDiagnosticSpanStatus {
  if (record.layer === "error" || /(?:failed|blocked)$/u.test(record.kind)) return "failed";
  if (/(?:cancelled|cancelling)$/u.test(record.kind)) return "cancelled";
  if (/(?:started|requested)$/u.test(record.kind)) return "running";
  return "completed";
}

function conversationRecordLane(record: EventJournalRecord): RuntimeDiagnosticLane {
  if (record.phase === "prompt") return RuntimeDiagnosticLanes.Context;
  if (record.phase === "model") return RuntimeDiagnosticLanes.Model;
  if (record.phase === "tool") return RuntimeDiagnosticLanes.Tools;
  if (record.phase === "run" || record.phase === "orchestration") return RuntimeDiagnosticLanes.Runtime;
  return RuntimeDiagnosticLanes.Runtime;
}

function conversationRecordStepKind(kind: string): TimelineStepKind | undefined {
  if (kind.startsWith("continuity.")) return "recall";
  if (kind.startsWith("prompt.")) return "harness";
  if (kind.startsWith("execution.") || kind.startsWith("workflow.")) return "delegation";
  if (kind.startsWith("approval.")) return "decision";
  return undefined;
}

function conversationRecordDescription(record: EventJournalRecord): string | undefined {
  const projection = readProjectedProjection(record);
  const value =
    readString(readJsonPointer(projection, "/data/model")) ??
    readString(readJsonPointer(projection, "/data/provider/model")) ??
    readString(readJsonPointer(projection, "/data/original")) ??
    readString(readJsonPointer(projection, "/data/content")) ??
    record.summary;
  return value;
}

/**
 * Projects the durable run trace into one ordered stream. Reasoning blocks are
 * merged by model request, so each request owns one stable thinking event even
 * when the transport delivered many deltas/content blocks.
 */
function projectRunSpans(run: RunRecord): RuntimeDiagnosticSpan[] {
  const steps = deduplicateAssistantTerminalSteps(run.steps);
  return [
    ...steps.map((step) => spanFromTimelineStep(run, step)),
    ...(run.activities ?? []).map((activity) => spanFromActivity(run.requestId, activity)),
    ...projectThinkingSpans(run),
  ].filter((span): span is RuntimeDiagnosticSpan => span !== undefined);
}

function deduplicateAssistantTerminalSteps(steps: readonly TimelineStep[]): readonly TimelineStep[] {
  const selected = new Map<string, TimelineStep>();
  const result: TimelineStep[] = [];
  for (const step of steps) {
    const key = assistantTerminalStepKey(step);
    if (!key) {
      result.push(step);
      continue;
    }
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, step);
      result.push(step);
      continue;
    }
    if (preferAssistantMessageStep(step, existing)) {
      const index = result.indexOf(existing);
      if (index >= 0) result[index] = step;
      selected.set(key, step);
    }
  }
  return result;
}

function preferAssistantMessageStep(candidate: TimelineStep, current: TimelineStep): boolean {
  const candidateIsLive = isAssistantMessageStep(candidate);
  const currentIsLive = isAssistantMessageStep(current);
  if (candidateIsLive !== currentIsLive) return candidateIsLive;
  return candidate.id.localeCompare(current.id) < 0;
}

function spanFromTimelineStep(run: RunRecord, step: TimelineStep): RuntimeDiagnosticSpan | undefined {
  if (step.status === "pending") return undefined;
  // ToolCallsPlanned is a batch metadata step, not an executable event. A
  // linear stream should contain only the individual calls with a call id.
  if (step.kind === "tool") {
    const toolIdentity = step.toolName?.trim() || step.toolOrigin?.tool?.trim() || step.toolOrigin?.name?.trim();
    if (!step.callId?.trim() || !toolIdentity) return undefined;
  }
  const startedAtEpoch = parseTimestamp(step.startedAt);
  if (startedAtEpoch === undefined) return undefined;
  const status = toRunSpanStatus(step.status);
  const source: RuntimeDiagnosticSpanSource = step.kind === "tool" ? "tool" : "step";
  const lane = step.kind === "tool" ? RuntimeDiagnosticLanes.Tools : timelineStepLane(step);
  const description = timelineStepDescription(run, step);
  return {
    id: `run:${run.requestId}:${step.id}`,
    source,
    lane,
    kind: step.kind,
    eventSequence: step.startedSequence ?? step.eventSequence ?? step.completedSequence,
    status,
    ...(source === "tool"
      ? {
          toolName: step.toolName,
          toolOrigin: step.toolOrigin,
          toolArguments: step.toolArgs,
          toolResult: step.toolResult,
          toolPresentation: step.toolPresentation,
          toolPreview: step.toolPreview,
          toolErrorMessage: step.toolErrorMessage,
          callId: step.callId,
        }
      : { label: step.title }),
    requestId: run.requestId,
    step: step.agentStep,
    startedAt: step.startedAt,
    ...(description ? { description } : {}),
    ...(step.kind === "model" && (step.modelName ?? run.modelProvider?.model)
      ? { modelName: step.modelName ?? run.modelProvider?.model }
      : {}),
    ...(step.purpose ? { purpose: step.purpose } : {}),
    startedAtEpoch,
    endedAtEpoch: parseTimestamp(step.endedAt ?? ""),
    durationMs: readTimelineDuration(step),
  };
}

function timelineStepDescription(run: RunRecord, step: TimelineStep): string | undefined {
  if (step.kind === "understand") return run.input.trim() || undefined;
  if (step.kind === "answer" || step.kind === "decision") {
    const messageContent = readString(isRecord(step.detailJson) ? step.detailJson.content : undefined);
    return (
      messageContent ?? (step.description?.trim() || run.displayText.trim() || run.visibleText.trim() || undefined)
    );
  }
  return step.description?.trim() || undefined;
}

function projectThinkingSpans(run: RunRecord): RuntimeDiagnosticSpan[] {
  const blocks = run.thinkingBlocks ?? [];
  const groups = new Map<string, ModelThinkingBlock[]>();
  for (const block of blocks) {
    if (!block.content.trim()) continue;
    const key = `${block.step}:${block.messageIndex}`;
    const group = groups.get(key);
    if (group) group.push(block);
    else groups.set(key, [block]);
  }
  return [...groups.values()]
    .map((group) => spanFromThinkingStream(run, group))
    .filter((span): span is RuntimeDiagnosticSpan => span !== undefined);
}

function spanFromThinkingStream(
  run: RunRecord,
  blocks: readonly ModelThinkingBlock[],
): RuntimeDiagnosticSpan | undefined {
  const firstBlock = blocks[0];
  if (!firstBlock) return undefined;
  const content = [...blocks]
    .sort(
      (left, right) => left.contentIndex - right.contentIndex || (left.eventSequence ?? 0) - (right.eventSequence ?? 0),
    )
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!content) return undefined;
  const modelStep = run.steps.find(
    (step) =>
      step.kind === "model" && step.agentStep === firstBlock.step && step.modelMessageIndex === firstBlock.messageIndex,
  );
  const startedAt = modelStep?.startedAt ?? run.startedAt;
  const startedAtEpoch = parseTimestamp(startedAt);
  if (startedAtEpoch === undefined) return undefined;
  const modelStatus = modelStep ? toRunSpanStatus(modelStep.status) : undefined;
  const status: RuntimeDiagnosticSpanStatus =
    modelStatus === "failed" || modelStatus === "cancelled"
      ? modelStatus
      : modelStatus === "running" || blocks.some((block) => block.status === "streaming")
        ? "running"
        : blocks.some((block) => block.status === "interrupted")
          ? "cancelled"
          : "completed";
  const endedAt = status === "running" ? undefined : (modelStep?.endedAt ?? run.endedAt);
  const endedAtEpoch = endedAt ? parseTimestamp(endedAt) : undefined;
  return {
    id: `run:${run.requestId}:thinking:${firstBlock.step}:${firstBlock.messageIndex}`,
    source: "step",
    lane: RuntimeDiagnosticLanes.Model,
    kind: "model",
    eventSequence: Math.min(...blocks.map((block) => block.eventSequence ?? Number.MAX_SAFE_INTEGER)),
    isThinking: true,
    label: readThinkingPreview(content),
    description: content,
    requestId: run.requestId,
    step: firstBlock.step,
    startedAt,
    startedAtEpoch,
    ...(endedAtEpoch === undefined ? {} : { endedAtEpoch }),
    ...(endedAtEpoch === undefined ? {} : { durationMs: Math.max(0, endedAtEpoch - startedAtEpoch) }),
    status,
  };
}

function readThinkingPreview(content: string): string {
  const normalized = content.replace(/\s+/gu, " ").trim();
  const firstSentence = normalized.match(/^(.+?(?:[。！？!?](?:\s|$)|$))/u)?.[1]?.trim() ?? normalized;
  const clipped = firstSentence.length > 96 ? `${firstSentence.slice(0, 93).trimEnd()}...` : firstSentence;
  return normalized.length > firstSentence.length && !clipped.endsWith("...") ? `${clipped}...` : clipped;
}

function spanFromActivity(
  requestId: string,
  activity: NonNullable<RunRecord["activities"]>[number],
): RuntimeDiagnosticSpan | undefined {
  if (activity.status === "pending") return undefined;
  const startedAtEpoch = parseTimestamp(activity.startedAt);
  if (startedAtEpoch === undefined || !isRunActivity(activity.activity)) return undefined;
  return {
    id: `activity:${requestId}:${activity.id}`,
    source: "activity",
    lane: activityLane(activity.activity),
    status: toRunSpanStatus(activity.status),
    operation: activity.activity,
    requestId,
    step: activity.step,
    eventSequence: activity.eventSequence,
    startedAt: activity.startedAt,
    startedAtEpoch,
    endedAtEpoch: parseTimestamp(activity.endedAt ?? ""),
    durationMs: readTimelineDuration(activity),
  };
}

function normalizeRunSpanStatus(span: RuntimeDiagnosticSpan, run: RunRecord): RuntimeDiagnosticSpan {
  const terminalStatus =
    run.status === "cancelled"
      ? "cancelled"
      : run.status === "failed"
        ? "failed"
        : run.status === "completed"
          ? "completed"
          : undefined;
  if (!terminalStatus || span.status !== "running") return span;
  return {
    ...span,
    status: terminalStatus,
    endedAtEpoch: span.endedAtEpoch ?? parseTimestamp(run.endedAt ?? ""),
  };
}

function timelineStepLane(step: TimelineStep): RuntimeDiagnosticLane {
  if (step.kind === "prompt" || step.kind === "understand") return RuntimeDiagnosticLanes.Context;
  if (step.kind === "model") return RuntimeDiagnosticLanes.Model;
  if (step.kind === "answer") return RuntimeDiagnosticLanes.Response;
  if (step.kind === "error") return RuntimeDiagnosticLanes.Response;
  return RuntimeDiagnosticLanes.Runtime;
}

function toRunSpanStatus(status: TimelineStep["status"]): RuntimeDiagnosticSpanStatus {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "done") return "completed";
  return "running";
}

function readTimelineDuration(value: Pick<TimelineStep, "startedAt" | "endedAt" | "durationMs">): number | undefined {
  if (typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0) {
    return value.durationMs;
  }
  if (!value.endedAt) return undefined;
  const startedAt = Date.parse(value.startedAt);
  const endedAt = Date.parse(value.endedAt);
  return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
    ? endedAt - startedAt
    : undefined;
}

function readLatestSessionUsage(records: readonly EventJournalRecord[]): RuntimeSessionUsage | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const usage = readSessionUsageValue(readJsonPointer(record.projection, "/data/runtime/stats"));
    if (usage) return usage;
  }
  return undefined;
}

function readLatestContextUsage(records: readonly EventJournalRecord[]): RuntimeContextUsage | undefined {
  let unknown: RuntimeContextUsage | undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const value = readContextUsageValue(readJsonPointer(record.projection, "/data/runtime/contextUsage"));
    if (!value) continue;
    if (value.tokens !== null || value.percent !== null) {
      if (!unknown || unknown.contextWindow === value.contextWindow) return value;
      return unknown;
    }
    unknown ??= value;
  }
  return unknown;
}

function readContextUsageValue(value: unknown): RuntimeContextUsage | undefined {
  if (!isRecord(value)) return undefined;
  const contextWindow = readFiniteNumber(value.contextWindow);
  if (contextWindow === undefined || contextWindow <= 0) return undefined;
  return {
    tokens: readNullableFiniteNumber(value.tokens),
    contextWindow,
    percent: readNullableFiniteNumber(value.percent),
  };
}

function readSessionUsageValue(value: unknown): RuntimeSessionUsage | undefined {
  if (!isRecord(value) || !isRecord(value.tokens)) return undefined;
  const tokens = value.tokens;
  return {
    userMessages: readNonNegativeNumber(value.userMessages),
    assistantMessages: readNonNegativeNumber(value.assistantMessages),
    toolCalls: readNonNegativeNumber(value.toolCalls),
    toolResults: readNonNegativeNumber(value.toolResults),
    totalMessages: readNonNegativeNumber(value.totalMessages),
    tokens: {
      input: readNonNegativeNumber(tokens.input),
      output: readNonNegativeNumber(tokens.output),
      cacheRead: readNonNegativeNumber(tokens.cacheRead),
      cacheWrite: readNonNegativeNumber(tokens.cacheWrite),
      total: readNonNegativeNumber(tokens.total),
    },
    cost: readNonNegativeNumber(value.cost),
  };
}

function projectSpans(
  records: readonly EventJournalRecord[],
  requestId: string | undefined,
): Map<string, RuntimeDiagnosticSpan> {
  const spans = new Map<string, RuntimeDiagnosticSpan>();
  if (!requestId) return spans;

  for (const record of records) {
    const diagnostic = readDiagnosticSpec(record.kind);
    const projection = readProjectedProjection(record);
    if (!diagnostic || !projection) continue;
    const candidate = readSpanCandidate(record, projection, diagnostic, requestId);
    if (!candidate) continue;

    const id = `${candidate.source}:${candidate.identity}`;
    const existing = spans.get(id);
    if (!existing) {
      spans.set(id, createSpan(id, candidate));
      continue;
    }
    const updated = mergeSpan(existing, candidate);
    if (updated) spans.set(id, updated);
  }
  return spans;
}

function readSpanCandidate(
  record: EventJournalRecord,
  projection: Record<string, unknown>,
  diagnostic: EventDiagnosticSpec,
  requestId: string,
): DiagnosticSpanCandidate | undefined {
  const identity = readString(readJsonPointer(projection, diagnostic.idPointer));
  const label = readString(readJsonPointer(projection, diagnostic.labelPointer));
  const startedAt = readString(readJsonPointer(projection, diagnostic.startedAtPointer));
  const startedAtEpoch = startedAt ? parseTimestamp(startedAt) : undefined;
  const state = readDiagnosticState(projection, diagnostic);
  if (!identity || !label || !startedAt || startedAtEpoch === undefined || !state) return undefined;

  if (diagnostic.source === "activity" && !isRunActivity(label)) return undefined;

  return {
    identity,
    source: diagnostic.source,
    label,
    eventSequence: record.sequence ?? record.localSequence,
    toolOrigin: diagnostic.source === "tool" ? readToolOrigin(projection) : undefined,
    toolArguments: diagnostic.source === "tool" ? readJsonPointer(projection, "/data/arguments") : undefined,
    state,
    requestId,
    step: record.step,
    startedAt,
    startedAtEpoch,
    endedAtEpoch: state === "started" ? undefined : record.observedAtEpoch,
    durationMs:
      state === "started" ? undefined : readDuration(readJsonPointer(projection, diagnostic.durationMsPointer)),
  };
}

function readDiagnosticState(
  projection: Record<string, unknown>,
  diagnostic: EventDiagnosticSpec,
): DiagnosticLifecycleState | undefined {
  if (diagnostic.fixedState) return diagnostic.fixedState;
  if (!diagnostic.statePointer) return undefined;
  const state = readString(readJsonPointer(projection, diagnostic.statePointer));
  return isDiagnosticLifecycleState(state) ? state : undefined;
}

function createSpan(id: string, candidate: DiagnosticSpanCandidate): RuntimeDiagnosticSpan {
  const lane = candidate.source === "tool" ? RuntimeDiagnosticLanes.Tools : activityLane(candidate.label);
  return {
    id,
    source: candidate.source,
    lane,
    status: toSpanStatus(candidate.state),
    eventSequence: candidate.eventSequence,
    ...(candidate.source === "tool"
      ? { toolName: candidate.label, callId: candidate.identity }
      : { operation: candidate.label as RunActivity }),
    requestId: candidate.requestId,
    step: candidate.step,
    startedAt: candidate.startedAt,
    startedAtEpoch: candidate.startedAtEpoch,
    endedAtEpoch: candidate.endedAtEpoch,
    durationMs: candidate.durationMs,
    toolOrigin: candidate.toolOrigin,
    toolArguments: candidate.toolArguments,
  };
}

function mergeSpan(
  existing: RuntimeDiagnosticSpan,
  candidate: DiagnosticSpanCandidate,
): RuntimeDiagnosticSpan | undefined {
  if (existing.startedAt !== candidate.startedAt || existing.startedAtEpoch !== candidate.startedAtEpoch) {
    return undefined;
  }
  const existingLabel = existing.source === "tool" ? existing.toolName : existing.operation;
  if (existingLabel !== candidate.label) return undefined;
  const nextStatus = toSpanStatus(candidate.state);
  if (existing.status !== "running" && nextStatus === "running") return existing;
  return {
    ...existing,
    status: nextStatus,
    eventSequence: candidate.eventSequence ?? existing.eventSequence,
    step: candidate.step ?? existing.step,
    endedAtEpoch: candidate.endedAtEpoch ?? existing.endedAtEpoch,
    durationMs: candidate.durationMs,
    toolOrigin: candidate.toolOrigin ?? existing.toolOrigin,
    toolArguments: candidate.toolArguments ?? existing.toolArguments,
  };
}

function readToolOrigin(projection: Record<string, unknown>): ToolEventOrigin | undefined {
  const value = readJsonPointer(projection, "/data/origin");
  if (!isRecord(value) || (value.kind !== "system" && value.kind !== "mcp") || typeof value.name !== "string") {
    return undefined;
  }
  return {
    kind: value.kind,
    name: value.name,
    ...(typeof value.capability === "string" ? { capability: value.capability } : {}),
    ...(typeof value.server === "string" ? { server: value.server } : {}),
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
  };
}

function projectLane(
  lane: RuntimeDiagnosticLane,
  spans: readonly RuntimeDiagnosticSpan[],
  nowEpoch: number,
): RuntimeDiagnosticLaneModel {
  const tracks: number[] = [];
  const laidOutSpans = spans.map((span) => {
    const start = span.startedAtEpoch;
    const end = spanEndEpoch(span, span.status === "running" ? nowEpoch : start);
    let track = tracks.findIndex((lastEnd) => lastEnd <= start);
    if (track === -1) {
      track = tracks.length;
      tracks.push(end);
    } else {
      tracks[track] = end;
    }
    return { ...span, track };
  });
  return { lane, spans: laidOutSpans, trackCount: Math.max(1, tracks.length) };
}

function readCurrentSpan(spans: readonly RuntimeDiagnosticSpan[]): RuntimeDiagnosticSpan | undefined {
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    if (spans[index]?.status === "running") return spans[index];
  }
  return spans.at(-1);
}

function readLatestRequestId(records: readonly EventJournalRecord[]): string | undefined {
  return [...records]
    .reverse()
    .find((record) => record.requestId && readDiagnosticSpec(record.kind) && readProjectedProjection(record))
    ?.requestId;
}

function readConnectionHealth(records: readonly EventJournalRecord[]): RuntimeDiagnosticHealth {
  const lifecycle = [...records].reverse().find((record) => record.stage === "lifecycle");
  if (!lifecycle) return "unknown";
  if (lifecycle.kind === "socket.open") return "healthy";
  if (lifecycle.kind === "socket.connecting" || lifecycle.kind === "socket.retry_scheduled") return "active";
  if (lifecycle.kind === "socket.error" || lifecycle.kind === "socket.closed") return "failed";
  return "unknown";
}

function readProjectedProjection(record: EventJournalRecord): Record<string, unknown> | undefined {
  if (record.stage !== "projected" || record.projectionOmitted || !record.projection) return undefined;
  return record.projection;
}

function readDiagnosticSpec(kind: string): EventDiagnosticSpec | undefined {
  if (!Object.prototype.hasOwnProperty.call(RuntimeDiagnosticSpecs, kind)) return undefined;
  return RuntimeDiagnosticSpecs[kind as keyof typeof RuntimeDiagnosticSpecs];
}

function activityLane(activity: string): RuntimeDiagnosticLane {
  const category = RunActivitySpecs[activity as RunActivity].category;
  return LaneByActivityCategory[category];
}

function isRunActivity(value: string): value is RunActivity {
  return Object.prototype.hasOwnProperty.call(RunActivitySpecs, value);
}

function toSpanStatus(state: DiagnosticLifecycleState): RuntimeDiagnosticSpanStatus {
  return state === "started" ? "running" : state;
}

function readDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableFiniteNumber(value: unknown): number | null {
  return value === null ? null : (readFiniteNumber(value) ?? null);
}

function readNonNegativeNumber(value: unknown): number {
  const number = readFiniteNumber(value);
  return number === undefined ? 0 : Math.max(0, number);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseTimestamp(value: string): number | undefined {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : undefined;
}

function spanEndEpoch(span: RuntimeDiagnosticSpan, fallbackEpoch: number): number {
  if (span.durationMs !== undefined) return span.startedAtEpoch + span.durationMs;
  return span.endedAtEpoch ?? fallbackEpoch;
}

function compareSpans(left: RuntimeDiagnosticSpan, right: RuntimeDiagnosticSpan): number {
  const timeOrder = left.startedAtEpoch - right.startedAtEpoch;
  if (timeOrder !== 0) return timeOrder;
  const kindOrder = timelineSpanOrder(left) - timelineSpanOrder(right);
  return kindOrder || left.id.localeCompare(right.id);
}

function timelineSpanOrder(span: RuntimeDiagnosticSpan): number {
  if (span.source === "tool") return 70;
  if (span.source === "activity") return 90;
  if (span.isThinking) return 45;
  switch (span.kind) {
    case "understand":
      return 10;
    case "prompt":
    case "recall":
    case "harness":
      return 20;
    case "model":
      return 40;
    case "delegation":
    case "decision":
      return 60;
    case "answer":
      return 80;
    case "error":
      return 85;
    default:
      return 50;
  }
}

function isDiagnosticLifecycleState(value: string | undefined): value is DiagnosticLifecycleState {
  return value === "started" || value === "completed" || value === "failed";
}
