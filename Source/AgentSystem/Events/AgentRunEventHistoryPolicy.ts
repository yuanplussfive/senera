import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventPhases,
  type AgentEventKind,
  type AgentEventPhase,
  getAgentEventSpec,
} from "./AgentEventCatalog.js";
import type { AgentEventEnvelope } from "./AgentEventBase.js";

type RunEventHistoryDataProjector = (data: unknown) => unknown;

const RunEventHistoryPhases = new Set<AgentEventPhase>([
  AgentEventPhases.Prompt,
  AgentEventPhases.Model,
  AgentEventPhases.Decision,
  AgentEventPhases.Tool,
  AgentEventPhases.Approval,
  AgentEventPhases.Run,
]);

const RunEventHistoryExcludedKinds = new Set<AgentEventKind>([
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ToolCallResultDetail,
]);

const RunEventHistoryDataProjectors = new Map<AgentEventKind, RunEventHistoryDataProjector>([
  [AgentEventKinds.PiTrace, projectPiTraceForHistory],
  [
    AgentEventKinds.ModelCompleted,
    (data) => ({
      ...readRecord(data),
      text: "",
    }),
  ],
  [
    AgentEventKinds.RunFailed,
    (data) => {
      const record = readRecord(data);
      return {
        message: readString(record.message),
        code: readOptionalString(record.code),
      };
    },
  ],
]);

const PiTraceHistoryPayloadKeys = [
  "durationMs",
  "decisionSource",
  "firstTokenMs",
  "requestCharacters",
  "responseCharacters",
  "stage",
  "status",
  "providerId",
  "model",
  "callId",
  "toolCallId",
  "batchId",
  "entryId",
  "sessionEntryId",
  "kind",
  "storage",
] as const;

export const AgentRunEventHistoryReplayChunkSize = 120;

export function projectAgentRunEventForHistory(envelope: AgentEventEnvelope): AgentEventEnvelope | undefined {
  if (!shouldPersistRunEvent(envelope)) {
    return undefined;
  }

  const projector = RunEventHistoryDataProjectors.get(envelope.kind);
  return {
    ...envelope,
    data: projector ? projector(envelope.data) : envelope.data,
  };
}

function shouldPersistRunEvent(envelope: AgentEventEnvelope): boolean {
  if (envelope.channel !== AgentEventChannels.AgentEvent) {
    return false;
  }
  if (!envelope.sessionId || !envelope.requestId) {
    return false;
  }
  if (RunEventHistoryExcludedKinds.has(envelope.kind)) {
    return false;
  }

  const spec = getAgentEventSpec(envelope.kind);
  return RunEventHistoryPhases.has(spec.phase);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectPiTraceForHistory(data: unknown): unknown {
  const trace = readRecord(data);
  const payload = readRecord(trace.payload);
  const projectedPayload = Object.fromEntries(
    PiTraceHistoryPayloadKeys.flatMap((key) => {
      const value = payload[key];
      return isHistoryScalar(value) ? [[key, value] as const] : [];
    }),
  );
  const error = projectTraceError(payload.error ?? payload.message);
  if (error) projectedPayload.error = error;

  return {
    source: readString(trace.source),
    eventType: readString(trace.eventType),
    summary: readString(trace.summary),
    payload: Object.keys(projectedPayload).length > 0 ? projectedPayload : undefined,
  };
}

function isHistoryScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function projectTraceError(value: unknown): string | undefined {
  if (typeof value === "string") return readOptionalString(value);
  return readOptionalString(readRecord(value).message);
}
