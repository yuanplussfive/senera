import type { AgentFrontendConfig } from "./AgentAppConfigTypes.js";
import type { AgentActionPlannerConfig } from "./AgentPlannerConfigTypes.js";
import type {
  AgentArtifactsConfig,
  AgentConfigStoreConfig,
  AgentLoopConfig,
  AgentPresetsConfig,
  AgentPromptConfig,
  AgentSandboxRuntimeConfig,
  AgentServerConfig,
  AgentTodosConfig,
  AgentToolExecutionConfig,
  AgentUploadsConfig,
  AgentWorldConfig,
  AgentInferenceBudgetConfig,
} from "./AgentRuntimeConfigTypes.js";
import type {
  AgentContinuityLearningConfig,
  AgentToolLearningConfig,
  AgentToolSearchConfig,
  AgentVectorModelsConfig,
} from "./AgentToolAndMemoryConfigTypes.js";
import type {
  AgentModelGroupConfig,
  AgentModelProviderConfig,
  AgentModelProviderEndpointConfig,
} from "./AgentModelConfigTypes.js";
import type { CurrentAgentConfigVersion } from "../Config/AgentConfigVersion.js";

export interface AgentSystemExtensionConfig {
  Enabled?: boolean;
  Configuration?: Record<string, unknown>;
}

export interface AgentDefaultsConfig {
  ToolExecution?: AgentToolExecutionConfig;
  SandboxRuntime?: AgentSandboxRuntimeConfig;
  AgentLoop?: AgentLoopConfig;
  Todos?: AgentTodosConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  ContinuityLearning?: AgentContinuityLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
  };
  ConfigStore?: AgentConfigStoreConfig;
  Prompt?: AgentPromptConfig;
  World?: AgentWorldConfig;
  InferenceBudget?: AgentInferenceBudgetConfig;
}

export interface AgentSystemConfig {
  ConfigVersion?: typeof CurrentAgentConfigVersion;
  Defaults?: AgentDefaultsConfig;
  XmlProtocol?: {
    MaxDepth?: number;
    MaxTextLength?: number;
    MaxDecisionTokens?: number;
    MaxToolCalls?: number;
    ArrayElementNames?: string[];
    ArrayElementNameSuffix?: string;
  };
  ToolExecution?: AgentToolExecutionConfig;
  SandboxRuntime?: AgentSandboxRuntimeConfig;
  ToolDocumentation?: {
    Markdown?: {
      MinNonEmptyLines?: number;
      ExcludePathFragments?: string[];
    };
    ToolDescription?: {
      MinNonEmptyLines?: number;
      SummarySection?: string;
      TriggerSection?: string;
      AvoidSection?: string;
      RequiredSections?: string[];
    };
  };
  DefaultModelProviderId?: string;
  ModelProviderIdAliases?: Record<string, string>;
  ModelProviderEndpoints?: AgentModelProviderEndpointConfig[];
  ModelProviders: AgentModelProviderConfig[];
  ModelGroups?: AgentModelGroupConfig[];
  AgentLoop?: AgentLoopConfig;
  Todos?: AgentTodosConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  ContinuityLearning?: AgentContinuityLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
  };
  ConfigStore?: AgentConfigStoreConfig;
  Prompt?: AgentPromptConfig;
  World?: AgentWorldConfig;
  InferenceBudget?: AgentInferenceBudgetConfig;
  Extensions?: Record<string, AgentSystemExtensionConfig>;
}
