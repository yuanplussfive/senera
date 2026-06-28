import type {
  AgentLoadedToolsConfig,
  ResolvedAgentLoopConfig,
} from "./AgentRuntimeConfigTypes.js";

export type AgentDelegationRuntimeMode = "directModel" | "agentLoop";

export interface AgentDelegationRuntimeProfileConfig {
  Mode?: AgentDelegationRuntimeMode;
  ModelProviderId?: string;
  AgentLoop?: {
    MaxSteps?: number;
    MaxRepairAttempts?: number;
    LoadedTools?: AgentLoadedToolsConfig;
  };
}

export interface AgentDelegationMergeConfig {
  ModelProviderId?: string;
}

export interface AgentDelegationTemplateConfig {
  ChildSystemPrompt?: string;
  MergeSystemPrompt?: string;
}

export interface AgentDelegationConfig {
  RuntimeProfileDefaults?: AgentDelegationRuntimeProfileConfig;
  RuntimeProfiles?: Record<string, AgentDelegationRuntimeProfileConfig>;
  Templates?: AgentDelegationTemplateConfig;
  Merge?: AgentDelegationMergeConfig;
}

export interface ResolvedAgentDelegationRuntimeProfileConfig {
  Name: string;
  Mode: AgentDelegationRuntimeMode;
  ModelProviderId?: string;
  AgentLoop: ResolvedAgentLoopConfig;
}

export interface ResolvedAgentDelegationConfig {
  RuntimeProfileDefaults?: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name">;
  RuntimeProfiles: Record<string, ResolvedAgentDelegationRuntimeProfileConfig>;
  Templates: Required<AgentDelegationTemplateConfig>;
  Merge: AgentDelegationMergeConfig;
}
