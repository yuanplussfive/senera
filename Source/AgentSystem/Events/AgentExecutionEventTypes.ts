import type { AgentModelDomainEvent } from "./AgentModelEventTypes.js";
import type { AgentPlannerDomainEvent } from "./AgentPlannerEventTypes.js";
import type { AgentPromptDomainEvent } from "./AgentPromptEventTypes.js";
import type { AgentRunDomainEvent } from "./AgentRunEventTypes.js";

export type AgentExecutionDomainEvent =
  | AgentRunDomainEvent
  | AgentPromptDomainEvent
  | AgentPlannerDomainEvent
  | AgentModelDomainEvent;

