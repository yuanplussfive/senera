import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentPromptContractView } from "./AgentPromptContractTypes.js";
import type { AgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";

export interface AgentPromptToolContext {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  argumentsContract?: AgentPromptContractView;
  documentationMarkdown: string;
}

export interface AgentPromptContext {
  ExecutionEnvironment: AgentExecutionEnvironmentContext;
  ToolCards: AgentPromptToolContext[];
  ToolDiscoveryToolName: string | null;
  RootCommand: AgentRootCommand | null;
  RoleplayPreset: AgentRoleplayPresetContext;
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[];
  toolSections?: AgentPromptSectionOptions;
  summarySection?: string;
  triggerSection?: string;
  avoidSection?: string;
  rootCommand?: AgentRootCommand;
  roleplayPreset?: AgentRoleplayPresetContext;
}

export interface AgentPromptSectionOptions {
  summary?: string;
  trigger?: string;
  avoid?: string;
}

export interface AgentPromptRootCommandOptions {
  decision: AgentActionDecision;
  loadedToolNames: readonly string[];
}
