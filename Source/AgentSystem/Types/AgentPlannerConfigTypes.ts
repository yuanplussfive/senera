export interface AgentActionPlannerConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  Evidence?: AgentActionPlannerEvidenceConfig;
  Client?: AgentActionPlannerTuningClientConfig;
  FinalAnswerClient?: AgentActionPlannerClientConfig;
}

export interface AgentActionPlannerEvidenceConfig {
  StalledStepLag?: number;
}

export interface AgentActionPlannerTuningClientConfig {
  Temperature?: number;
  /** -1 means do not send a provider token limit field. */
  MaxTokens?: number;
}

export interface AgentActionPlannerClientConfig extends AgentActionPlannerTuningClientConfig {
  ModelProviderId?: string;
}

export interface ResolvedAgentActionPlannerConfig {
  Enabled: boolean;
  MaxRepairAttempts: number;
  Evidence: Required<AgentActionPlannerEvidenceConfig>;
  Client: ResolvedAgentActionPlannerClientConfig;
  FinalAnswerClient: ResolvedAgentActionPlannerClientConfig;
}

export interface ResolvedAgentActionPlannerClientConfig {
  ModelProviderId?: string;
  ModelProvider: ResolvedAgentModelProviderConfig;
  BaseUrl: string;
  ApiKey: string;
  Model: string;
  Temperature: number;
  MaxTokens: number;
}
import type { ResolvedAgentModelProviderConfig } from "./AgentModelConfigTypes.js";
