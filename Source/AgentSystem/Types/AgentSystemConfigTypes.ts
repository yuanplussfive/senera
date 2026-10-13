import type { AgentFrontendConfig } from "./AgentAppConfigTypes.js";
import type { AgentActionPlannerConfig } from "./AgentPlannerConfigTypes.js";
import type {
  AgentArtifactsConfig,
  AgentConfigStoreConfig,
  AgentLoopConfig,
  AgentMcpConnectionsConfig,
  AgentPromptConfig,
  AgentSandboxRuntimeConfig,
  AgentServerConfig,
  AgentTodosConfig,
  AgentToolExecutionConfig,
  AgentUploadsConfig,
  AgentInferenceBudgetConfig,
  AgentEventWriterConfig,
} from "./AgentRuntimeConfigTypes.js";
import type {
  AgentContinuityLearningConfig,
  AgentStateCardConfig,
  AgentToolSearchConfig,
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

/** Plugin loading policy. `Enabled` is the opt-in whitelist: bundled plugins
 * ship with the runtime and load by default; user/project/pip plugins load
 * only when their id appears here. `Directories` appends pip-style discovery
 * roots for locally installed plugin packages. */
export interface AgentPluginsConfig {
  Enabled?: string[];
  Directories?: string[];
}

export interface AgentDefaultsConfig {
  ToolExecution?: AgentToolExecutionConfig;
  SandboxRuntime?: AgentSandboxRuntimeConfig;
  AgentLoop?: AgentLoopConfig;
  Todos?: AgentTodosConfig;
  ToolSearch?: AgentToolSearchConfig;
  StateCard?: AgentStateCardConfig;
  ContinuityLearning?: AgentContinuityLearningConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
    EventWriter?: AgentEventWriterConfig;
  };
  ConfigStore?: AgentConfigStoreConfig;
  Prompt?: AgentPromptConfig;
  InferenceBudget?: AgentInferenceBudgetConfig;
  McpConnections?: AgentMcpConnectionsConfig;
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
  StateCard?: AgentStateCardConfig;
  ContinuityLearning?: AgentContinuityLearningConfig;
  Artifacts?: AgentArtifactsConfig;
  Uploads?: AgentUploadsConfig;
  ActionPlanner?: AgentActionPlannerConfig;
  Frontend?: AgentFrontendConfig;
  Server?: AgentServerConfig;
  Persistence?: {
    Kind?: "sqlite" | "memory";
    EventWriter?: AgentEventWriterConfig;
  };
  ConfigStore?: AgentConfigStoreConfig;
  Prompt?: AgentPromptConfig;
  InferenceBudget?: AgentInferenceBudgetConfig;
  McpConnections?: AgentMcpConnectionsConfig;
  Extensions?: Record<string, AgentSystemExtensionConfig>;
  Plugins?: AgentPluginsConfig;
}
