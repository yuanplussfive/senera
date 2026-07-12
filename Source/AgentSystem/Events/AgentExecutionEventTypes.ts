import type { AgentModelDomainEvent } from "./AgentModelEventTypes.js";
import type { AgentPlannerDomainEvent } from "./AgentPlannerEventTypes.js";
import type { AgentPromptDomainEvent } from "./AgentPromptEventTypes.js";
import type { AgentRunDomainEvent } from "./AgentRunEventTypes.js";
import type { SeneraExecutionDomainEvent } from "../Execution/SeneraExecutionEventTypes.js";

export type AgentExecutionDomainEvent =
  | AgentRunDomainEvent
  | AgentPromptDomainEvent
  | AgentPlannerDomainEvent
  | AgentModelDomainEvent
  | SeneraExecutionDomainEvent;
