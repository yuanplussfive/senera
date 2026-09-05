import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentTodoSnapshot } from "./AgentTodoTypes.js";

export interface AgentTodoListWrittenEventData {
  readonly snapshot: AgentTodoSnapshot;
}

export type AgentTodoDomainEvent = {
  readonly kind: typeof AgentEventKinds.TodoListWritten;
  readonly context: Pick<AgentEventContext, "sessionId" | "requestId">;
  readonly data: AgentTodoListWrittenEventData;
};
