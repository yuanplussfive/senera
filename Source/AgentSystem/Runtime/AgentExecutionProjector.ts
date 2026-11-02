import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { StepTrace } from "../Core/AgentStepTrace.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolSearchObservation } from "../ToolSearch/AgentToolSearchUsageMemory.js";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";

export type AgentTerminalResult = {
  kind: "FinalAnswer";
  content: string;
};

export interface AgentProjectedTerminalResult {
  event: Extract<AgentDomainEvent, { kind: typeof AgentEventKinds.AssistantMessageCreated }>;
  result: AgentTerminalResult;
}

export interface AgentCompletedRunResult {
  terminal: AgentTerminalResult;
  decisionXml: string;
  modelProvider?: AgentModelProviderMetadata;
  usage?: AgentModelUsage;
  executedTools: ExecutedToolCallResult[];
  stepTraces: StepTrace[];
  loadedToolNames?: string[];
  /** One-shot continuity rules projected into this run and awaiting durable-turn acknowledgement. */
  continuityRuleDeliveryUris?: string[];
  physicalPiSessionId?: string;
  routingObservation?: AgentToolSearchObservation;
  stateCard?: AgentStateCard;
}
