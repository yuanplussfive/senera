import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentExecutionLedger,
  AgentExecutionLedgerSnapshot,
  AgentExecutionStep,
} from "./AgentExecutionLedgerTypes.js";

type ExecutionEventContext = Required<Pick<AgentEventContext, "sessionId" | "requestId">>;

export interface AgentExecutionEventData {
  readonly snapshot: AgentExecutionLedgerSnapshot;
  readonly execution: AgentExecutionLedger;
  readonly step?: AgentExecutionStep;
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
