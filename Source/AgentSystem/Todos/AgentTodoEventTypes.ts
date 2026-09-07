import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentTodoSnapshot, AgentTodoWriteSource } from "./AgentTodoTypes.js";

export interface AgentTodoListWrittenEventData {
  readonly snapshot: AgentTodoSnapshot;
  readonly source: AgentTodoWriteSource;
}

export type AgentTodoDomainEvent = {
  readonly kind: typeof AgentEventKinds.TodoListWritten;
  readonly context: Pick<AgentEventContext, "sessionId" | "requestId">;
  readonly data: AgentTodoListWrittenEventData;
};
