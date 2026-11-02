import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventPhases,
  type AgentEventKind,
  type AgentEventPhase,
  getAgentEventSpec,
} from "./AgentEventCatalog.js";
import type { AgentEventEnvelope } from "./AgentEventBase.js";
import { agentStringOrEmpty, agentUnknownRecordOrEmpty } from "../Core/AgentUnknownValue.js";
import { projectAgentToolResultForDisplay } from "../Core/AgentToolArgumentProjection.js";
import { readAgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import { compactAgentExecutionEventData } from "../Goals/AgentExecutionEventTypes.js";

type RunEventHistoryDataProjector = (data: unknown) => unknown;

const RunEventHistoryPhases = new Set<AgentEventPhase>([
  AgentEventPhases.Prompt,
  AgentEventPhases.Model,
  AgentEventPhases.Decision,
  AgentEventPhases.Tool,
  AgentEventPhases.Approval,
  AgentEventPhases.Orchestration,
  AgentEventPhases.Run,
]);

const RunEventHistoryExcludedKinds = new Set<AgentEventKind>([
  AgentEventKinds.RunActivityChanged,
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ModelThinkingDelta,
]);

/**
 * Session-phase kinds that still belong in the durable conversation log: a
 * user's rating annotates one turn and must come back with history replay,
 * while the transport-level session events around it do not.
 */
const RunEventHistoryIncludedSessionKinds = new Set<AgentEventKind>([
  AgentEventKinds.FeedbackRecorded,
  AgentEventKinds.SessionCompacted,
]);

const RunEventHistoryDataProjectors = new Map<AgentEventKind, RunEventHistoryDataProjector>([
  [AgentEventKinds.ExecutionCreated, compactAgentExecutionEventData],
  [AgentEventKinds.ExecutionStepStarted, compactAgentExecutionEventData],
  [AgentEventKinds.ExecutionStepCompleted, compactAgentExecutionEventData],
  [AgentEventKinds.ExecutionBlocked, compactAgentExecutionEventData],
  [AgentEventKinds.ExecutionCompleted, compactAgentExecutionEventData],
  [AgentEventKinds.ToolCallResultDetail, projectToolCallResultDetailForHistory],
  [
    AgentEventKinds.ModelCompleted,
    (data) => ({
      ...agentUnknownRecordOrEmpty(data),
      text: "",
    }),
  ],
  [
    AgentEventKinds.RunFailed,
    (data) => {
      const record = agentUnknownRecordOrEmpty(data);
      const localizedMessage = readAgentLocalizedMessage(record.localizedMessage);
      return {
        message: agentStringOrEmpty(record.message),
        code: readOptionalString(record.code),
        ...(localizedMessage ? { localizedMessage } : {}),
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
  if (RunEventHistoryIncludedSessionKinds.has(envelope.kind)) return true;
  return RunEventHistoryPhases.has(spec.phase);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectToolCallResultDetailForHistory(data: unknown): unknown {
  const record = agentUnknownRecordOrEmpty(data);
  const result = projectAgentToolResultForDisplay(record.value);
  return {
    detailId: agentStringOrEmpty(record.detailId),
    index: readEventIndex(record.index),
    toolName: agentStringOrEmpty(record.toolName),
    callId: agentStringOrEmpty(record.callId),
    ...(readOptionalString(record.batchId) ? { batchId: readOptionalString(record.batchId) } : {}),
    ...(record.presentation === undefined ? {} : { presentation: record.presentation }),
    value: result.value,
    ...(record.origin === undefined ? {} : { origin: record.origin }),
  };
}

function readEventIndex(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
