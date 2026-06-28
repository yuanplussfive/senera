import type {
  AgentCliConfig,
  AgentFrontendConfig,
} from "./AgentAppConfigTypes.js";
import type { AgentDelegationConfig } from "./AgentDelegationConfigTypes.js";
import type {
  AgentActionPlannerConfig,
} from "./AgentPlannerConfigTypes.js";
import type {
  AgentArtifactsConfig,
  AgentConfigStoreConfig,
  AgentLoopConfig,
  AgentPresetsConfig,
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

export interface AgentDefaultsConfig {
  PluginRoots?: {
    System?: string[];
    User?: string[];
  };
  PluginDiscovery?: {
    ManifestFileName?: string;
    ConfigFileName?: string;
  };
  Cli?: AgentCliConfig;
  ToolExecution?: AgentToolExecutionConfig;
  AgentLoop?: AgentLoopConfig;
  AgentDelegation?: AgentDelegationConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}

export interface AgentSystemConfig {
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
    DecisionActionDescription?: {
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
  Cli?: AgentCliConfig;
  AgentLoop?: AgentLoopConfig;
  AgentDelegation?: AgentDelegationConfig;
  ToolSearch?: AgentToolSearchConfig;
  VectorModels?: AgentVectorModelsConfig;
  ToolLearning?: AgentToolLearningConfig;
  MemoryLearning?: AgentMemoryLearningConfig;
  Presets?: AgentPresetsConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: {
    Host?: string;
    Port?: number;
    HotReload?: boolean;
    RequestMaxBytes?: number;
  };
  Persistence?: {
    Kind?: "sqlite" | "memory";
    DatabasePath?: string;
  };
  ConfigStore?: AgentConfigStoreConfig;
}
