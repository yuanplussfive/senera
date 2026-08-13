import { EventKinds, RunActivitySpecs, type RunActivity } from "../../api/generatedEventCatalog";
import { RuntimeDiagnosticSpecs, type EventDiagnosticSpec } from "../../api/generatedRuntimeDiagnosticCatalog";
import type { EventJournalRecord } from "./eventJournalStore";
import { readJsonPointer } from "./eventJournalProjection";
import type { ToolEventOrigin } from "../../api/eventTypes";

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

export type RuntimeDiagnosticSpanStatus = "running" | "completed" | "failed";
export type RuntimeDiagnosticSpanSource = "activity" | "tool";

export interface RuntimeDiagnosticSpan {
  readonly id: string;
  readonly source: RuntimeDiagnosticSpanSource;
  readonly lane: RuntimeDiagnosticLane;
  readonly status: RuntimeDiagnosticSpanStatus;
  readonly operation?: RunActivity;
  readonly toolName?: string;
  readonly toolOrigin?: ToolEventOrigin;
  readonly toolArguments?: unknown;
  readonly callId?: string;
  readonly requestId: string;
  readonly step?: number;
  readonly startedAt: string;
  readonly startedAtEpoch: number;
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

export type RuntimeDiagnosticHealth = "healthy" | "active" | "failed" | "unknown";

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
  readonly toolOrigin?: ToolEventOrigin;
  readonly toolArguments?: unknown;
  readonly state: DiagnosticLifecycleState;
  readonly requestId: string;
  readonly step?: number;
  readonly startedAt: string;
  readonly startedAtEpoch: number;
  readonly durationMs?: number;
}

export function projectRuntimeDiagnostic(
  records: readonly EventJournalRecord[],
  options: { readonly nowEpoch?: number; readonly pausedAt?: number; readonly activeSessionId?: string | null } = {},
): RuntimeDiagnosticModel {
  const nowEpoch = options.nowEpoch ?? Date.now();
  const visibleRecords = records.filter(
    (record) => options.pausedAt === undefined || record.localSequence <= options.pausedAt,
  );
  const sessionRecords = options.activeSessionId
    ? visibleRecords.filter((record) => record.sessionId === options.activeSessionId)
    : visibleRecords;
  const requestId = readLatestRequestId(sessionRecords);
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

export function projectRuntimeUsage(
  records: readonly EventJournalRecord[],
  options: { readonly pausedAt?: number; readonly activeSessionId?: string | null } = {},
): RuntimeUsageSnapshot {
  const visibleRecords = records.filter(
    (record) => options.pausedAt === undefined || record.localSequence <= options.pausedAt,
  );
  const sessionRecords = options.activeSessionId
    ? visibleRecords.filter((record) => record.sessionId === options.activeSessionId)
    : visibleRecords;
  return {
    contextUsage: readLatestContextUsage(sessionRecords),
    sessionUsage: readLatestSessionUsage(sessionRecords),
  };
}

function readLatestSessionUsage(records: readonly EventJournalRecord[]): RuntimeSessionUsage | undefined {
  for (const record of [...records].reverse()) {
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const stats = readJsonPointer(record.projection, "/data/runtime/stats");
    if (!isRecord(stats)) continue;
    const tokens = readJsonPointer(stats, "/tokens");
    if (!isRecord(tokens)) continue;
    return {
      userMessages: readNonNegativeNumber(stats.userMessages),
      assistantMessages: readNonNegativeNumber(stats.assistantMessages),
      toolCalls: readNonNegativeNumber(stats.toolCalls),
      toolResults: readNonNegativeNumber(stats.toolResults),
      totalMessages: readNonNegativeNumber(stats.totalMessages),
      tokens: {
        input: readNonNegativeNumber(tokens.input),
        output: readNonNegativeNumber(tokens.output),
        cacheRead: readNonNegativeNumber(tokens.cacheRead),
        cacheWrite: readNonNegativeNumber(tokens.cacheWrite),
        total: readNonNegativeNumber(tokens.total),
      },
      cost: readNonNegativeNumber(stats.cost),
    };
  }
  return undefined;
}

function readLatestContextUsage(records: readonly EventJournalRecord[]): RuntimeContextUsage | undefined {
  for (const record of [...records].reverse()) {
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const value = readJsonPointer(record.projection, "/data/runtime/contextUsage");
    if (!isRecord(value)) continue;
    const contextWindow = readFiniteNumber(value.contextWindow);
    if (contextWindow === undefined || contextWindow <= 0) continue;
    const tokens = readNullableFiniteNumber(value.tokens);
    const percent = readNullableFiniteNumber(value.percent);
    return { tokens, contextWindow, percent };
  }
  return undefined;
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
    toolOrigin: diagnostic.source === "tool" ? readToolOrigin(projection) : undefined,
    toolArguments: diagnostic.source === "tool" ? readJsonPointer(projection, "/data/arguments") : undefined,
    state,
    requestId,
    step: record.step,
    startedAt,
    startedAtEpoch,
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
    ...(candidate.source === "tool"
      ? { toolName: candidate.label, callId: candidate.identity }
      : { operation: candidate.label as RunActivity }),
    requestId: candidate.requestId,
    step: candidate.step,
    startedAt: candidate.startedAt,
    startedAtEpoch: candidate.startedAtEpoch,
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
    step: candidate.step ?? existing.step,
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
  return span.durationMs === undefined ? fallbackEpoch : span.startedAtEpoch + span.durationMs;
}

function compareSpans(left: RuntimeDiagnosticSpan, right: RuntimeDiagnosticSpan): number {
  return left.startedAtEpoch - right.startedAtEpoch || left.id.localeCompare(right.id);
}

function isDiagnosticLifecycleState(value: string | undefined): value is DiagnosticLifecycleState {
  return value === "started" || value === "completed" || value === "failed";
}
