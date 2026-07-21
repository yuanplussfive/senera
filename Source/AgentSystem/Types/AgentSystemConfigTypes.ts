import type { AgentFrontendConfig } from "./AgentAppConfigTypes.js";
import type { AgentActionPlannerConfig } from "./AgentPlannerConfigTypes.js";
import type {
  AgentArtifactsConfig,
  AgentConfigStoreConfig,
  AgentLoopConfig,
  AgentPresetsConfig,
  AgentSandboxRuntimeConfig,
  AgentServerConfig,
  AgentToolExecutionConfig,
  AgentUploadsConfig,
} from "./AgentRuntimeConfigTypes.js";
import type {
  AgentMemoryLearningConfig,
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

export interface AgentDefaultsConfig {
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  ToolExecution?: AgentToolExecutionConfig;
  SandboxRuntime?: AgentSandboxRuntimeConfig;
  AgentLoop?: AgentLoopConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}

export interface AgentSystemConfig {
  ConfigVersion?: typeof CurrentAgentConfigVersion;
  Defaults?: AgentDefaultsConfig;
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
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
  PluginDocumentation?: {
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
    PromptXml?: {
      XmlFenceLanguages?: string[];
      CodeFenceLanguages?: string[];
    };
  };
  DefaultModelProviderId?: string;
  ModelProviderEndpoints?: AgentModelProviderEndpointConfig[];
  ModelProviders: AgentModelProviderConfig[];
  ModelGroups?: AgentModelGroupConfig[];
  AgentLoop?: AgentLoopConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}
