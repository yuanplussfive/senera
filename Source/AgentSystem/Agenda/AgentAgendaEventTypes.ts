import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentAgendaSnapshot } from "./AgentAgendaTypes.js";

type AgentAgendaContext = Pick<AgentEventContext, "sessionId" | "requestId">;

export interface AgentAgendaSnapshotEventData {
  readonly snapshot: AgentAgendaSnapshot;
}

export type AgentAgendaDomainEvent = {
  kind: typeof AgentEventKinds.AgendaSnapshot;
  context: AgentAgendaContext;
  data: AgentAgendaSnapshotEventData;
};
