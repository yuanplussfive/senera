import type { AgentConfigDomainEvent } from "../Config/AgentConfigEventTypes.js";
import type { AgentDecisionDomainEvent } from "../Decision/AgentDecisionEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSessionDomainEvent } from "../Session/AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";

export type AgentDomainEvent =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentDecisionDomainEvent
  | AgentToolDomainEvent
  | AgentConfigDomainEvent;

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
