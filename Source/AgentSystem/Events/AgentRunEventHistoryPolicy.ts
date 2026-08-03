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
import { readAgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";

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
  AgentEventKinds.RunActivityChanged,
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ToolCallResultDetail,
]);

const RunEventHistoryDataProjectors = new Map<AgentEventKind, RunEventHistoryDataProjector>([
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
  return RunEventHistoryPhases.has(spec.phase);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
