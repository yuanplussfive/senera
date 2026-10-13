import type {
  AgentActionPlannerConfig,
  AgentContinuityLearningConfig,
  AgentContinuityLearningRuntimeConfig,
  AgentContinuityLearningRecallConfig,
  AgentContinuityMemOSConfig,
  AgentStateCardConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentConfigStoreConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentLoopConfig,
  ResolvedAgentModelProviderEndpointConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentPromptConfig,
  ResolvedAgentSandboxRuntimeConfig,
  ResolvedAgentServerConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentTodosConfig,
  ResolvedAgentUploadsConfig,
  ResolvedAgentInferenceBudgetConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentModelRuntimeDefaultsConfig } from "../Types/AgentModelConfigTypes.js";

export type { AgentModelRuntimeDefaultsConfig } from "../Types/AgentModelConfigTypes.js";

export type ResolvedAgentModelRuntimeDefaultsConfig = AgentModelRuntimeDefaultsConfig & {
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  RetryBaseDelayMs: number;
  RetryMaxDelayMs: number;
  RetryAfterMaxDelayMs: number;
};

export type AgentActionPlannerClientDefaultsConfig = Required<
  Omit<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">
> &
  Pick<NonNullable<AgentActionPlannerConfig["Client"]>, "ModelProviderId">;

export type AgentStateCardClientDefaultsConfig = Required<
  Omit<NonNullable<AgentStateCardConfig["Client"]>, "ModelProviderId">
> &
  Pick<NonNullable<AgentStateCardConfig["Client"]>, "ModelProviderId">;

export type AgentStateCardDefaultsConfig = Required<Omit<AgentStateCardConfig, "Client">> & {
  Client: AgentStateCardClientDefaultsConfig;
};

export type AgentContinuityLearningClientDefaultsConfig = Required<
  Omit<NonNullable<AgentContinuityLearningConfig["Client"]>, "ModelProviderId">
> &
  Pick<NonNullable<AgentContinuityLearningConfig["Client"]>, "ModelProviderId">;

export type AgentContinuityLearningDefaultsConfig = Required<
  Omit<AgentContinuityLearningConfig, "Client" | "Runtime" | "MemOS">
> & {
  Client: AgentContinuityLearningClientDefaultsConfig;
  Runtime: AgentContinuityLearningRuntimeConfig;
  MemOS: AgentContinuityMemOSConfig;
  Recall: AgentContinuityLearningRecallConfig;
};

export type AgentActionPlannerDefaultsConfig = Required<
  Omit<AgentActionPlannerConfig, "Evidence" | "Client" | "PlanningClient" | "FinalAnswerClient">
> & {
  Evidence: Required<NonNullable<AgentActionPlannerConfig["Evidence"]>>;
  Client: AgentActionPlannerClientDefaultsConfig;
  PlanningClient: AgentActionPlannerClientDefaultsConfig;
  FinalAnswerClient: AgentActionPlannerClientDefaultsConfig;
};

export interface ResolvedAgentDefaultsConfig {
  ModelProviderEndpoints: ResolvedAgentModelProviderEndpointConfig[];
  ModelRuntime: ResolvedAgentModelRuntimeDefaultsConfig;
  InferenceBudget: ResolvedAgentInferenceBudgetConfig;
  ToolExecution: ResolvedAgentToolExecutionConfig;
  SandboxRuntime: ResolvedAgentSandboxRuntimeConfig;
  AgentLoop: ResolvedAgentLoopConfig;
  ToolSearch: ResolvedAgentToolSearchConfig;
  StateCard: AgentStateCardDefaultsConfig;
  Todos: ResolvedAgentTodosConfig;
  ContinuityLearning: AgentContinuityLearningDefaultsConfig;
  ActionPlanner: AgentActionPlannerDefaultsConfig;
  Artifacts: ResolvedAgentArtifactsConfig;
  Uploads: ResolvedAgentUploadsConfig;
  Frontend: ResolvedAgentFrontendConfig;
  Server: ResolvedAgentServerConfig;
  Prompt: ResolvedAgentPromptConfig;
  Persistence: ResolvedAgentPersistenceConfig;
  ConfigStore: ResolvedAgentConfigStoreConfig;
}
