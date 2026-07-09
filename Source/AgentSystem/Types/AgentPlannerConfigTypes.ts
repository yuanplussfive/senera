export interface AgentActionPlannerConfig {
  Enabled?: boolean;
  MaxRepairAttempts?: number;
  Evidence?: AgentActionPlannerEvidenceConfig;
  Client?: AgentActionPlannerClientConfig;
  TurnUnderstandingClient?: AgentActionPlannerClientConfig;
  PlanningClient?: AgentActionPlannerClientConfig;
}

export interface AgentActionPlannerEvidenceConfig {
  StalledStepLag?: number;
}

export type AgentActionPlannerClientProvider =
  | "openai-generic"
  | "openai-responses"
  | "anthropic"
  | "google-ai";

export interface AgentActionPlannerClientConfig {
  ModelProviderId?: string;
  Provider?: AgentActionPlannerClientProvider;
  Temperature?: number;
  /** -1 means do not send a provider token limit field. */
  MaxTokens?: number;
}

export interface ResolvedAgentActionPlannerConfig {
  Enabled: boolean;
  MaxRepairAttempts: number;
  Evidence: Required<AgentActionPlannerEvidenceConfig>;
  Client: ResolvedAgentActionPlannerClientConfig;
  TurnUnderstandingClient: ResolvedAgentActionPlannerClientConfig;
  PlanningClient: ResolvedAgentActionPlannerClientConfig;
}

export interface ResolvedAgentActionPlannerClientConfig {
  ModelProviderId?: string;
  Provider: AgentActionPlannerClientProvider;
  BaseUrl: string;
  ApiKey: string;
  Model: string;
  Temperature: number;
  MaxTokens: number;
}
