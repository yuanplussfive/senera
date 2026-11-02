import type {
  AgentActionPlannerClientConfig,
  AgentActionPlannerConfig,
  AgentActionPlannerTuningClientConfig,
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

export type AgentActionPlannerClientDefaultsConfig = Required<AgentActionPlannerTuningClientConfig>;

export type AgentActionPlannerFinalAnswerClientDefaultsConfig = Required<
  Omit<AgentActionPlannerClientConfig, "ModelProviderId">
> &
  Pick<AgentActionPlannerClientConfig, "ModelProviderId">;

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
  Omit<AgentContinuityLearningConfig, "Client" | "Runtime" | "MemOS" | "Diary" | "Retention">
> & {
  Client: AgentContinuityLearningClientDefaultsConfig;
  Runtime: AgentContinuityLearningRuntimeConfig;
  MemOS: AgentContinuityMemOSConfig;
  Diary: import("../Continuity/AgentMemoryDiaryContract.js").AgentMemoryDiaryConfig;
  Retention: import("../Continuity/AgentMemoryRetention.js").AgentMemoryRetentionPolicy;
  Recall: AgentContinuityLearningRecallConfig;
};

export type AgentActionPlannerDefaultsConfig = Required<
  Omit<AgentActionPlannerConfig, "Evidence" | "Client" | "FinalAnswerClient">
> & {
  Evidence: Required<NonNullable<AgentActionPlannerConfig["Evidence"]>>;
  Client: AgentActionPlannerClientDefaultsConfig;
  FinalAnswerClient: AgentActionPlannerFinalAnswerClientDefaultsConfig;
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
