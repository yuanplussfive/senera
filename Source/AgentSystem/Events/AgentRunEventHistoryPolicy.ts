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
  AgentEventPhases.Run,
]);

const RunEventHistoryExcludedKinds = new Set<AgentEventKind>([
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ToolCallResultDetail,
]);

const RunEventHistoryDataProjectors = new Map<AgentEventKind, RunEventHistoryDataProjector>([
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
