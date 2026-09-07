import type { AgentModelDomainEvent } from "./AgentModelEventTypes.js";
import type { AgentPromptDomainEvent } from "./AgentPromptEventTypes.js";
import type { AgentRunDomainEvent } from "./AgentRunEventTypes.js";
import type { AgentExecutionResourceDomainEvent } from "../ExecutionResources/AgentExecutionResourceEventTypes.js";

export type AgentExecutionDomainEvent =
  AgentRunDomainEvent | AgentPromptDomainEvent | AgentModelDomainEvent | AgentExecutionResourceDomainEvent;
