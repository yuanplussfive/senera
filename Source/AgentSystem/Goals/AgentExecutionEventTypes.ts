import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentExecutionEventRecord,
  AgentExecutionLedger,
  AgentExecutionStep,
} from "./AgentExecutionLedgerTypes.js";

type ExecutionEventContext = Required<Pick<AgentEventContext, "sessionId" | "requestId">>;

/**
 * Execution events are a change stream, not a ledger snapshot. Keeping the
 * stable execution identity and lifecycle fields here prevents every tool
 * transition from serializing the entire plan accumulated so far.
 */
export type AgentExecutionEventSummary = Omit<AgentExecutionLedger, "steps">;

export interface AgentExecutionEventData {
  readonly execution: AgentExecutionEventSummary;
  readonly step?: AgentExecutionStep;
}

export function projectAgentExecutionEventData(event: AgentExecutionEventRecord): AgentExecutionEventData {
  return {
    execution: projectAgentExecutionEventSummary(event.execution),
    ...(event.step ? { step: event.step } : {}),
  };
}

/**
 * Old durable event rows may still contain the former `snapshot` payload.
 * Normalize them at the history boundary, so persisted compatibility does
 * not keep imposing the old wire cost on every future replay.
 */
export function compactAgentExecutionEventData(data: unknown): unknown {
  if (!isRecord(data) || !isRecord(data.execution)) return data;
  const { steps: _steps, ...execution } = data.execution;
  return {
    execution,
    ...(Object.hasOwn(data, "step") ? { step: data.step } : {}),
  };
}

export type AgentExecutionLedgerDomainEvent =
  | { kind: typeof AgentEventKinds.ExecutionCreated; context: ExecutionEventContext; data: AgentExecutionEventData }
  | {
      kind: typeof AgentEventKinds.ExecutionStepStarted;
      context: ExecutionEventContext;
      data: AgentExecutionEventData;
    }
  | {
      kind: typeof AgentEventKinds.ExecutionStepCompleted;
      context: ExecutionEventContext;
      data: AgentExecutionEventData;
    }
  | { kind: typeof AgentEventKinds.ExecutionBlocked; context: ExecutionEventContext; data: AgentExecutionEventData }
  | {
      kind: typeof AgentEventKinds.ExecutionCompleted;
      context: ExecutionEventContext;
      data: AgentExecutionEventData;
    };

function projectAgentExecutionEventSummary(execution: AgentExecutionLedger): AgentExecutionEventSummary {
  const { steps: _steps, ...summary } = execution;
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
