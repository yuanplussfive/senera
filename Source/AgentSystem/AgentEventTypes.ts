import type { AgentConfigDomainEvent } from "./AgentConfigEventTypes.js";
import type { AgentDecisionDomainEvent } from "./AgentDecisionEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSessionDomainEvent } from "./AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "./AgentToolEventTypes.js";

export type AgentDomainEvent =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentDecisionDomainEvent
  | AgentToolDomainEvent
  | AgentConfigDomainEvent;

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
